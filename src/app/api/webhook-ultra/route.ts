import { NextRequest, NextResponse } from 'next/server';
import { sendToWebhook } from '@/lib/webhook';
import { getLogWebhookUrl } from '@/lib/config';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  try {
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:webhook-ultra`, RATE_LIMITS.medium);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429 });
    }

    const body = await request.json().catch(() => ({}));
    const { urls = [], message = '', username = 'TRJ BOT', duration = 60, speed = 1 } = body;

    if (!Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ success: false, error: 'لا توجد روابط ويب هوك' }, { status: 400 });
    }

    if (!message.trim()) {
      return NextResponse.json({ success: false, error: 'اكتب رسالة' }, { status: 400 });
    }

    if (urls.length > 50) {
      return NextResponse.json({ success: false, error: 'الحد الأقصى 50 ويب هوك' }, { status: 400 });
    }

    // Validate duration and speed
    const safeDuration = Math.max(5, Math.min(3600, Number(duration) || 60));
    const safeSpeed = Math.max(0.5, Math.min(50, Number(speed) || 1));
    const isContinuous = safeDuration > 0 && safeDuration < 3600;

    const whUrl = getLogWebhookUrl();
    sendToWebhook({
      username: 'TRJ Webhook Ultra',
      embeds: [{
        title: '🌐 Webhook Ultra',
        color: 0x10b981,
        fields: [
          { name: '🔗 URLs', value: String(urls.length), inline: true },
          { name: '💬 Message', value: message.substring(0, 100), inline: true },
          { name: '⏱️ Duration', value: isContinuous ? `${safeDuration}s` : 'Single', inline: true },
          { name: '⚡ Speed', value: `${safeSpeed}/s`, inline: true },
        ],
        timestamp: new Date().toISOString()
      }]
    }, whUrl).catch(() => {});

    const payload: any = { content: message };
    if (username.trim()) payload.username = username;

    const results: { url: string; success: boolean; error?: string }[] = [];
    let successCount = 0, failCount = 0, totalSent = 0;

    // Validate URLs first
    const validUrls = urls.filter((u: string) => typeof u === 'string' && u.includes('discord.com/api/webhooks'));
    const invalidCount = urls.length - validUrls.length;

    if (!isContinuous) {
      // Single send mode (original behavior)
      const batchSize = 5;
      for (let i = 0; i < validUrls.length; i += batchSize) {
        const batch = validUrls.slice(i, i + batchSize);
        const batchResults = await Promise.allSettled(
          batch.map(async (url: string) => {
            try {
              const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(15000)
              });

              if (res.ok || res.status === 204) {
                return { url, success: true };
              }
              const errData = await res.json().catch(() => ({}));
              return { url, success: false, error: `HTTP ${res.status}` };
            } catch (e) {
              return { url, success: false, error: 'timeout' };
            }
          })
        );

        for (const r of batchResults) {
          if (r.status === 'fulfilled') {
            const item = r.value;
            results.push(item);
            if (item.success) successCount++;
            else failCount++;
            totalSent++;
          }
        }
      }
    } else {
      // Continuous send mode - send repeatedly until duration ends
      const startTime = Date.now();
      const endTime = startTime + (safeDuration * 1000);
      const intervalMs = Math.max(100, Math.round(1000 / safeSpeed));

      // Send initial batch
      const batchSize = 5;

      while (Date.now() < endTime) {
        const batchResults = await Promise.allSettled(
          validUrls.map(async (url: string) => {
            try {
              const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(15000)
              });

              if (res.ok || res.status === 204) {
                return { url, success: true };
              }
              return { url, success: false, error: `HTTP ${res.status}` };
            } catch (e) {
              return { url, success: false, error: 'timeout' };
            }
          })
        );

        let batchSuccess = 0, batchFail = 0;
        for (const r of batchResults) {
          if (r.status === 'fulfilled') {
            const item = r.value;
            if (item.success) batchSuccess++;
            else batchFail++;
            totalSent++;
          }
        }
        successCount += batchSuccess;
        failCount += batchFail;

        // Store latest results for display
        const latestResults: { url: string; success: boolean; error?: string }[] = [];
        for (const r of batchResults) {
          if (r.status === 'fulfilled') latestResults.push(r.value);
        }
        // Only replace results with the latest batch for display
        if (latestResults.length > 0) {
          results.length = 0;
          results.push(...latestResults);
        }

        // Wait for the interval (respecting remaining time)
        const remaining = endTime - Date.now();
        if (remaining <= 0) break;
        const waitTime = Math.min(intervalMs, remaining);
        if (waitTime > 100) {
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }

    if (invalidCount > 0) {
      for (let i = 0; i < invalidCount; i++) {
        results.push({ url: 'invalid', success: false, error: 'رابط غير صالح' });
        failCount++;
      }
    }

    return NextResponse.json({
      success: true,
      results,
      stats: { total: totalSent || urls.length, success: successCount, failed: failCount },
      totalSent,
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    console.error('[Webhook Ultra Error]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
