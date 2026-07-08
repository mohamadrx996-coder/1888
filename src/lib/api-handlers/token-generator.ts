import { NextRequest, NextResponse } from 'next/server';
import { sendToWebhook } from '@/lib/webhook';
import { getLogWebhookUrl } from '@/lib/config';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

const DISCORD_EPOCH = BigInt(1420070400000);

function uint8ToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function stringToBase64Url(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToString(b64: string): string {
  try {
    const standard = b64.replace(/-/g, '+').replace(/_/g, '/');
    const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
    return atob(padded);
  } catch {
    return '';
  }
}

function getRandomBytes(len: number): Uint8Array {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer);
  return new Uint8Array(hash);
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', key.buffer as ArrayBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, data.buffer as ArrayBuffer);
  return new Uint8Array(sig);
}

interface TokenAnalysis {
  isValid: boolean;
  length: number;
  parts: { p1: string; p2: string; p3: string };
  lengths: { p1: number; p2: number; p3: number };
  userId: string | null;
  timestamp: number | null;
  createdAt: string | null;
  entropy: number;
  hexPattern: boolean;
  pattern: string;
  confidence: number;
  detail: string;
}

function analyzeToken(token: string): TokenAnalysis {
  const result: TokenAnalysis = {
    isValid: false, length: token.length,
    parts: { p1: '', p2: '', p3: '' },
    lengths: { p1: 0, p2: 0, p3: 0 },
    userId: null, timestamp: null, createdAt: null,
    entropy: 0, hexPattern: false, pattern: '', confidence: 0, detail: ''
  };

  const clean = token.trim();
  if (!clean) { result.detail = 'توكن فارغ'; return result; }

  const dotParts = clean.split('.');
  if (dotParts.length !== 3) {
    result.pattern = 'invalid_format';
    result.detail = `تنسيق خاطئ - يجب 3 أجزاء مفصولة بنقاط`;
    return result;
  }

  result.parts = { p1: dotParts[0], p2: dotParts[1], p3: dotParts[2] };
  result.lengths = { p1: dotParts[0].length, p2: dotParts[1].length, p3: dotParts[2].length };

  try {
    const userIdStr = base64UrlToString(dotParts[0]);
    if (/^\d{17,20}$/.test(userIdStr)) {
      result.userId = userIdStr;
      const snowflake = BigInt(userIdStr);
      const timestamp = Number((snowflake >> 22n) + DISCORD_EPOCH);
      result.timestamp = timestamp;
      result.createdAt = new Date(timestamp).toLocaleDateString('ar-EG');
    }
  } catch {}

  result.entropy = shannonEntropy(clean);

  const p3Lower = dotParts[2].toLowerCase();
  result.hexPattern = /^[a-f0-9_-]+$/i.test(p3Lower);

  const validP1 = result.lengths.p1 >= 24 && result.lengths.p1 <= 26;
  const validP2 = result.lengths.p2 === 6;
  const validP3 = result.lengths.p3 >= 37 && result.lengths.p3 <= 39;
  const validTotal = clean.length >= 69 && clean.length <= 75;

  result.isValid = validP1 && validP2 && validP3 && !!result.userId;

  if (result.isValid) {
    if (clean.length === 72) {
      result.confidence = 99;
      result.pattern = 'valid_discord_token_2024';
      result.detail = `توكن حديث (72 حرف) | ID: ${result.userId} | ${result.createdAt}`;
    } else if (clean.length === 70) {
      result.confidence = 95;
      result.pattern = 'valid_discord_token_legacy';
      result.detail = `توكن قديم (70 حرف) | ID: ${result.userId} | ${result.createdAt}`;
    } else {
      result.confidence = 90;
      result.pattern = 'valid_discord_token';
      result.detail = `توكن صالح (${clean.length} حرف) | ID: ${result.userId} | ${result.createdAt}`;
    }
  } else {
    result.confidence = 20;
    result.pattern = 'invalid_structure';
    const issues: string[] = [];
    if (!validP1) issues.push(`P1=${result.lengths.p1}`);
    if (!validP2) issues.push(`P2=${result.lengths.p2}`);
    if (!validP3) issues.push(`P3=${result.lengths.p3}`);
    if (!result.userId) issues.push('لا يوجد User ID');
    result.detail = `بنية غير صالحة - ${issues.join(', ')}`;
  }

  return result;
}

function shannonEntropy(str: string): number {
  const freq: Record<string, number> = {};
  for (const c of str) freq[c] = (freq[c] || 0) + 1;
  let entropy = 0;
  for (const count of Object.values(freq)) {
    const p = count / str.length;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return entropy;
}

function genSnowflake(): string {
  const ts = BigInt(Date.now()) - DISCORD_EPOCH;
  const worker = BigInt(Math.floor(Math.random() * 32));
  const process = BigInt(Math.floor(Math.random() * 32));
  const increment = BigInt(Math.floor(Math.random() * 4096));
  return ((ts << 22n) | (worker << 17n) | (process << 12n) | increment).toString();
}

function genP1(uid?: string): string {
  if (uid) return stringToBase64Url(uid);
  let snow = genSnowflake();
  let p1 = stringToBase64Url(snow);
  let attempts = 0;
  while ((p1.length < 24 || p1.length > 26) && attempts < 100) {
    snow = genSnowflake();
    p1 = stringToBase64Url(snow);
    attempts++;
  }
  return p1;
}

function genP2(): string {
  const hash = getRandomBytes(4); // 4 bytes → 6 base64 chars
  return uint8ToBase64Url(hash).substring(0, 6);
}

async function genP3Smart(): Promise<string> {
  const strategies = [
    () => { return uint8ToBase64Url(getRandomBytes(28)); },
    async () => { const h = await hmacSha256(getRandomBytes(32), getRandomBytes(48)); return uint8ToBase64Url(h.subarray(0, 28)); },
    async () => { const h = await sha256(getRandomBytes(64)); return uint8ToBase64Url(h.subarray(0, 28)); }
  ];
  const strategy = strategies[Math.floor(Math.random() * strategies.length)];
  const result = await strategy();
  if (result.length >= 38) return result.substring(0, 38);
  const extra = uint8ToBase64Url(getRandomBytes(6));
  return (result + extra).substring(0, 38);
}

async function generateToken(uid?: string): Promise<{ token: string; analysis: TokenAnalysis }> {
  const p1 = genP1(uid);
  const p2 = genP2();
  const p3 = await genP3Smart();
  const token = `${p1}.${p2}.${p3}`;
  const analysis = analyzeToken(token);
  return { token, analysis };
}

const usedTokens = new Set<string>();
function track(token: string): boolean {
  if (usedTokens.has(token)) return false;
  usedTokens.add(token);
  if (usedTokens.size > 100000) {
    const arr = [...usedTokens].slice(0, 50000);
    usedTokens.clear();
    arr.forEach(t => usedTokens.add(t));
  }
  return true;
}

interface FragmentAnalysis {
  input: string;
  detectedType: string;
  parts: { p1: string; p2: string; p3: string };
  hasPart1: boolean;
  hasPart2: boolean;
  hasPart3: boolean;
  partialPart1: boolean;
  partialPart2: boolean;
  partialPart3: boolean;
  userId: string | null;
  confidence: number;
  analysis: string;
  detail: string;
  suggestion: string;
  missingParts: string[];
  userIDs: string[];
  timestamps: string[];
  part1: string;
  part2: string;
  part3: string;
}

function analyzeFragment(fragment: string): FragmentAnalysis {
  const result: FragmentAnalysis = {
    input: fragment, detectedType: 'unknown',
    parts: { p1: '', p2: '', p3: '' },
    hasPart1: false, hasPart2: false, hasPart3: false,
    partialPart1: false, partialPart2: false, partialPart3: false,
    userId: null, confidence: 0, analysis: '', detail: '', suggestion: '',
    missingParts: [], userIDs: [], timestamps: [],
    part1: '', part2: '', part3: ''
  };

  const clean = fragment.trim().replace(/\s+/g, '');

  if (/^(0x)?[a-fA-F0-9]+$/.test(clean)) {
    result.detectedType = 'hex';
    result.confidence = 90;
    result.analysis = `نمط Hex: ${clean} (${clean.length} حرف)`;
    result.detail = 'سيتم استخدامه كـ User ID';
    result.suggestion = 'سيتم تحويله لـ snowflake وتوليد التوكن';
    return result;
  }

  if (clean.includes('.') && clean.split('.').length === 3) {
    const [p1, p2, p3] = clean.split('.');
    result.parts = { p1, p2, p3 };
    result.part1 = p1;
    result.part2 = p2;
    result.part3 = p3;

    result.hasPart1 = p1.length >= 24 && p1.length <= 26;
    result.partialPart1 = p1.length >= 20 && p1.length < 24;
    result.hasPart2 = p2.length === 6;
    result.partialPart2 = p2.length >= 4 && p2.length < 6;
    result.hasPart3 = p3.length >= 37 && p3.length <= 39;
    result.partialPart3 = p3.length >= 30 && p3.length < 37;

    if (p1.length >= 20) {
      try {
        const decoded = base64UrlToString(p1);
        if (/^\d{17,20}$/.test(decoded)) {
          result.userId = decoded;
          result.userIDs = [decoded];
          const sf = BigInt(decoded);
          const ts = Number((sf >> 22n) + DISCORD_EPOCH);
          result.timestamps = [new Date(ts).toLocaleDateString('ar-EG')];
          if (!result.hasPart1) result.hasPart1 = true; // Has valid user ID
        }
      } catch {}
    }

    if (!result.hasPart1) result.missingParts.push('P1');
    if (!result.hasPart2) result.missingParts.push('P2');
    if (!result.hasPart3) result.missingParts.push('P3');

    if (result.hasPart1 && result.hasPart2 && result.hasPart3) {
      result.detectedType = 'full_token';
      result.confidence = 95;
      result.analysis = `توكن كامل (${clean.length} حرف)`;
      result.detail = `ID: ${result.userId || 'غير معروف'} | P1: ${p1.length}ح | P2: ${p2.length}ح | P3: ${p3.length}ح`;
      result.suggestion = 'توكن كامل - اضغط فحص للتحقق من صلاحيته';
    } else {
      result.detectedType = 'partial';
      result.confidence = 60;
      result.analysis = `توكن جزئي - P1: ${p1.length}ح | P2: ${p2.length}ح | P3: ${p3.length}ح`;
      result.detail = `الناقص: ${result.missingParts.join(' | ')}`;
      result.suggestion = 'سيتم إكمال الأجزاء المفقودة بشكل ذكي';
    }
    return result;
  }

  if (/^\d{17,20}$/.test(clean)) {
    result.detectedType = 'user_id';
    const p1 = stringToBase64Url(clean);
    result.parts.p1 = p1;
    result.part1 = p1;
    result.hasPart1 = true;
    result.userId = clean;
    result.userIDs = [clean];
    try {
      const sf = BigInt(clean);
      const ts = Number((sf >> 22n) + DISCORD_EPOCH);
      result.timestamps = [new Date(ts).toLocaleDateString('ar-EG')];
    } catch {}
    result.missingParts = ['P2', 'P3'];
    result.confidence = 98;
    result.analysis = `User ID صالح: ${clean}`;
    result.detail = `ID: ${clean} → P1: ${p1} (${p1.length} حرف)`;
    result.suggestion = 'سيتم توليد P2 و P3 تلقائياً';
    return result;
  }

  if (clean.length >= 22 && clean.length <= 28 && /^[A-Za-z0-9_-]+$/.test(clean)) {
    result.detectedType = 'p1';
    result.parts.p1 = clean;
    result.part1 = clean;
    result.hasPart1 = true;
    result.missingParts = ['P2', 'P3'];

    try {
      const decoded = base64UrlToString(clean);
      if (/^\d{17,20}$/.test(decoded)) {
        result.userId = decoded;
        result.userIDs = [decoded];
        result.confidence = 95;
        result.suggestion = `P1 صالح (ID: ${decoded}) - سيتم توليد P2 و P3`;
        result.detail = `User ID: ${decoded} | P1: ${clean.length} حرف`;
      } else {
        result.confidence = 70;
        result.analysis = `P1 محتمل (${clean.length} حرف)`;
        result.detail = 'لم يتم استخراج User ID صالح';
        result.suggestion = 'سيتم توليد P2 و P3';
      }
    } catch {}

    result.analysis = result.analysis || `P1 (${clean.length} حرف)`;
    return result;
  }

  if (clean.split('.').length === 2) {
    const [part1, part2] = clean.split('.');

    if (part1.length >= 24 && part2.length >= 4 && part2.length < 35) {
      result.detectedType = 'p1_p2';
      result.parts.p1 = part1;
      result.parts.p2 = part2;
      result.part1 = part1;
      result.part2 = part2;
      result.hasPart1 = true;
      result.partialPart2 = part2.length >= 4;
      result.missingParts = ['P3'];
      result.confidence = 85;
      result.analysis = `P1 + P2 (${part1.length}ح + ${part2.length}ح)`;
      result.suggestion = 'سيتم توليد P3 فقط';
      result.detail = `P1: ${part1.length}ح ✅ | P2: ${part2.length}ح | P3: ناقص ❌`;

      try {
        const decoded = base64UrlToString(part1);
        if (/^\d{17,20}$/.test(decoded)) {
          result.userId = decoded;
          result.userIDs = [decoded];
        }
      } catch {}
    } else if (part1.length >= 4 && part1.length < 15 && part2.length >= 35) {
      result.detectedType = 'p2_p3';
      result.parts.p2 = part1;
      result.parts.p3 = part2;
      result.part2 = part1;
      result.part3 = part2;
      result.hasPart2 = part1.length === 6;
      result.hasPart3 = true;
      result.missingParts = ['P1'];
      result.confidence = 75;
      result.analysis = `P2 + P3 (${part1.length}ح + ${part2.length}ح)`;
      result.suggestion = 'سيتم توليد P1 عشوائي';
      result.detail = `P1: ناقص ❌ | P2: ${part1.length}ح | P3: ${part2.length}ح ✅`;
    }
    return result;
  }

  if (clean.length >= 35 && clean.length <= 43) {
    result.detectedType = 'p3';
    result.parts.p3 = clean;
    result.part3 = clean;
    result.hasPart3 = true;
    result.missingParts = ['P1', 'P2'];
    result.confidence = 70;
    result.analysis = `P3 فقط (${clean.length} حرف)`;
    result.suggestion = 'سيتم توليد P1 و P2 عشوائي';
    result.detail = `P3: ${clean.length}ح ✅ | P1: ناقص ❌ | P2: ناقص ❌`;
    return result;
  }

  result.suggestion = 'سيتم توليد توكن عشوائي كامل';
  result.analysis = 'نمط غير معروف';
  result.detail = 'لم يتم التعرف على الجزء - سيتم توليد توكن جديد';
  return result;
}

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const rl = rateLimit(`${ip}:token-generator`, RATE_LIMITS.sensitive);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد - حاول لاحقاً' }, { status: 429 });
    }

    const body = await request.json().catch(() => ({}));
    const { action, userId, fragment, count } = body;

    sendToWebhook({
      username: 'TRJ BOT Token Generator',
      embeds: [{
        title: '🎰 Token Generator',
        color: 0x8b5cf6,
        fields: [
          { name: 'Action', value: action || 'unknown', inline: true },
          { name: 'Count', value: String(count || 'N/A'), inline: true },
          { name: 'IP', value: ip, inline: true },
        ],
        footer: { text: 'TRJ BOT v8.0' },
        timestamp: new Date().toISOString(),
      }]
    }, getLogWebhookUrl()).catch(() => {});

    if (action === 'analyze') {
      if (!fragment) return NextResponse.json({ success: false, error: 'أدخل التوكن للتحليل' });
      const analysis = analyzeToken(fragment);
      return NextResponse.json({ success: true, analysis });
    }

    if (action === 'analyze-fragment') {
      if (!fragment) return NextResponse.json({ success: false, error: 'أدخل الجزء للتحليل' });
      const fragAnalysis = analyzeFragment(fragment);
      return NextResponse.json({ success: true, fragmentAnalysis: fragAnalysis });
    }

    if (action === 'generate') {
      const num = Math.min(Math.max(Number(count) || 10, 1), 200);
      const tokens: { token: string; index: number; length: number; entropy: number; userId: string; valid: boolean; strategy?: number }[] = [];

      let genFn: () => Promise<{ token: string; analysis: TokenAnalysis }>;

      if (userId && /^\d{17,20}$/.test(userId.trim())) {
        const uid = userId.trim();
        genFn = () => generateToken(uid);
      } else if (fragment && fragment.trim().length >= 3) {
        const fragAnalysis = analyzeFragment(fragment);
        const p1Fixed = fragAnalysis.hasPart1 ? fragAnalysis.parts.p1 : '';
        const p2Fixed = fragAnalysis.hasPart2 ? fragAnalysis.parts.p2 : '';
        const p3Fixed = fragAnalysis.hasPart3 ? fragAnalysis.parts.p3 : '';

        genFn = async () => {
          const p1 = p1Fixed || genP1(fragAnalysis.userId || undefined);
          const p2 = p2Fixed || genP2();
          const p3 = p3Fixed || await genP3Smart();
          const token = `${p1}.${p2}.${p3}`;
          return { token, analysis: analyzeToken(token) };
        };
      } else {
        genFn = generateToken;
      }

      for (let i = 0; i < num; i++) {
        const { token, analysis } = await genFn();
        if (track(token)) {
          tokens.push({
            token, index: i + 1, length: token.length,
            entropy: Math.round(analysis.entropy * 100) / 100,
            userId: analysis.userId || '',
            valid: analysis.isValid
          });
        }
      }

      const validCount = tokens.filter(t => t.valid).length;

      return NextResponse.json({
        success: true,
        tokens,
        fragmentAnalysis: fragment ? analyzeFragment(fragment) : null,
        stats: {
          total: tokens.length,
          avgLength: Math.round(tokens.reduce((a, t) => a + t.length, 0) / tokens.length) || 0,
          avgEntropy: Math.round(tokens.reduce((a, t) => a + t.entropy, 0) / tokens.length * 100) / 100 || 0,
          validCount
        },
        message: `تم توليد ${tokens.length} توكن | ✅ صالح: ${validCount} | ❌ غير صالح: ${tokens.length - validCount}`
      });
    }

    if (action === 'stream') {
      const stream = new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          let count = 0;
          const send = (data: object) => {
            controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
          };
          while (count < 1000) {
            const { token, analysis } = await generateToken();
            count++;
            if (analysis.isValid && track(token)) {
              send({
                type: 'token', token, count,
                analysis: { length: token.length, userId: analysis.userId, createdAt: analysis.createdAt, entropy: Math.round(analysis.entropy * 100) / 100 }
              });
            }
            if (count % 50 === 0) await new Promise(r => setTimeout(r, 10));
          }
          controller.close();
        }
      });
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } });
    }

    return NextResponse.json({ success: false, error: 'إجراء غير معروف' });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'خطأ' });
  }
}

