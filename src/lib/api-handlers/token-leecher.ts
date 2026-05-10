
import { NextRequest, NextResponse } from 'next/server';
import { cleanToken, discordFetch } from '@/lib/discord';
import { getLogWebhookUrl } from '@/lib/config';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:token-leecher`, RATE_LIMITS.medium);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }

    const body = await request.json();
    const { token, guildId } = body as {
      token: string;
      guildId: string;
    };

    if (!token || !guildId) {
      return NextResponse.json({ success: false, error: 'أدخل التوكن وأيدي السيرفر' });
    }

    const ct = cleanToken(token);

    const verifyResult = await discordFetch(ct, 'GET', '/users/@me', undefined, { userOnly: true, timeout: 10000 });

    if (!verifyResult.ok || !verifyResult.data) {
      return NextResponse.json({ success: false, error: 'توكن غير صالح' });
    }

    const userData = verifyResult.data as { id: string; username: string; discriminator?: string };
    const userTag = `${userData.username}#${userData.discriminator || '0'}`;

    const logs: string[] = [`🔍 بدء استخراج معلومات من سيرفر: ${guildId}`];
    const extractedData: {
      members: { id: string; username: string; discriminator: string; avatar?: string; bot?: boolean }[];
      channels: { id: string; name: string; type: number }[];
      roles: { id: string; name: string; color: number }[];
      emojis: { id: string; name: string; animated: boolean }[];
      webhooks: { id: string; name: string; url?: string }[];
    } = {
      members: [],
      channels: [],
      roles: [],
      emojis: [],
      webhooks: []
    };

    logs.push('📋 جاري جلب معلومات السيرفر...');

    const guildRes = await discordFetch(ct, 'GET', `/guilds/${guildId}?with_counts=true`, undefined, { userOnly: true, timeout: 15000 });

    if (!guildRes.ok || !guildRes.data) {
      return NextResponse.json({ success: false, error: 'فشل جلب معلومات السيرفر', logs });
    }

    const guild = guildRes.data as any;
    logs.push(`🏰 السيرفر: ${guild.name}`);
    logs.push(`👥 الأعضاء: ${guild.approximate_member_count || 'N/A'}`);

    logs.push('👥 جاري جلب الأعضاء...');
    const membersRes = await discordFetch(ct, 'GET', `/guilds/${guildId}/members?limit=1000`, undefined, { userOnly: true, timeout: 20000 });

    if (membersRes.ok && membersRes.data) {
      const members = membersRes.data as any[];
      for (const m of members) {
        if (m.user) {
          extractedData.members.push({
            id: m.user.id,
            username: m.user.username,
            discriminator: m.user.discriminator || '0',
            avatar: m.user.avatar,
            bot: m.user.bot
          });
        }
      }
      logs.push(`   ✅ ${extractedData.members.length} عضو`);
    }

    logs.push('📝 جاري جلب القنوات...');
    const channelsRes = await discordFetch(ct, 'GET', `/guilds/${guildId}/channels`, undefined, { userOnly: true, timeout: 15000 });

    if (channelsRes.ok && channelsRes.data) {
      const channels = channelsRes.data as any[];
      for (const ch of channels) {
        extractedData.channels.push({
          id: ch.id,
          name: ch.name,
          type: ch.type
        });
      }
      logs.push(`   ✅ ${extractedData.channels.length} قناة`);
    }

    logs.push('🛡️ جاري جلب الرتب...');
    const rolesRes = await discordFetch(ct, 'GET', `/guilds/${guildId}/roles`, undefined, { userOnly: true, timeout: 15000 });

    if (rolesRes.ok && rolesRes.data) {
      const roles = rolesRes.data as any[];
      for (const r of roles) {
        extractedData.roles.push({
          id: r.id,
          name: r.name,
          color: r.color
        });
      }
      logs.push(`   ✅ ${extractedData.roles.length} رتبة`);
    }

    logs.push('😀 جاري جلب الإيموجي...');
    const emojisRes = await discordFetch(ct, 'GET', `/guilds/${guildId}/emojis`, undefined, { userOnly: true, timeout: 15000 });

    if (emojisRes.ok && emojisRes.data) {
      const emojis = emojisRes.data as any[];
      for (const e of emojis) {
        extractedData.emojis.push({
          id: e.id,
          name: e.name,
          animated: e.animated
        });
      }
      logs.push(`   ✅ ${extractedData.emojis.length} إيموجي`);
    }

    logs.push('🔗 جاري جلب الويب هوكات...');
    const webhooksRes = await discordFetch(ct, 'GET', `/guilds/${guildId}/webhooks`, undefined, { userOnly: true, timeout: 15000 });

    if (webhooksRes.ok && webhooksRes.data) {
      const hooks = webhooksRes.data as any[];
      for (const h of hooks) {
        extractedData.webhooks.push({
          id: h.id,
          name: h.name,
          url: h.token ? `https://discord.com/api/webhooks/${h.id}/${h.token}` : undefined
        });
      }
      logs.push(`   ✅ ${extractedData.webhooks.length} ويب هوك`);
    }

    logs.push('');
    logs.push('✅ تم الانتهاء من استخراج جميع البيانات!');

    const webhookUrl = getLogWebhookUrl();
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              title: '🔍 Token Leecher',
              description: `**تم استخراج بيانات من:** ${guild.name}`,
              color: 0x5865F2,
              fields: [
                { name: '👤 المستخدم', value: userTag, inline: true },
                { name: '🏰 السيرفر', value: guild.name, inline: true },
                { name: '👥 الأعضاء', value: extractedData.members.length.toString(), inline: true },
                { name: '📝 القنوات', value: extractedData.channels.length.toString(), inline: true },
                { name: '🛡️ الرتب', value: extractedData.roles.length.toString(), inline: true },
                { name: '🔗 ويب هوكات', value: extractedData.webhooks.length.toString(), inline: true },
              ],
              footer: { text: 'TRJ BOT - Prime Feature' },
              timestamp: new Date().toISOString()
            }]
          })
        });
      } catch {}
    }

    return NextResponse.json({
      success: true,
      logs,
      data: extractedData,
      guild: { id: guild.id, name: guild.name, icon: guild.icon, owner: guild.owner_id }
    });

  } catch (error) {
    return NextResponse.json({ success: false, error: 'خطأ في الخادم' });
  }
}

