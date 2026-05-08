// src/app/api/webhook-finder/route.ts - Webhook Finder API v1.0
// ⚠️ PRIME ONLY - البحث عن ويب هوكات
export const runtime = 'edge';

import { cleanToken, discordFetch } from '@/lib/discord';
import { getLogWebhookUrl } from '@/lib/config';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { token, guildId } = body as {
      token: string;
      guildId?: string;
    };

    if (!token) {
      return Response.json({ success: false, error: 'أدخل التوكن' });
    }

    const ct = cleanToken(token);

    // التحقق من التوكن
    const verifyResult = await discordFetch(ct, 'GET', '/users/@me', undefined, { userOnly: true, timeout: 10000 });

    if (!verifyResult.ok || !verifyResult.data) {
      return Response.json({ success: false, error: 'توكن غير صالح' });
    }

    const userData = verifyResult.data as { id: string; username: string; discriminator?: string };
    const userTag = `${userData.username}#${userData.discriminator || '0'}`;

    const webhooks: { id: string; name: string; channelId: string; guildId: string; url?: string }[] = [];
    const logs: string[] = [];

    if (guildId) {
      // البحث في سيرفر محدد
      logs.push(`🔍 البحث عن ويب هوكات في سيرفر: ${guildId}`);
      
      const whRes = await discordFetch(ct, 'GET', `/guilds/${guildId}/webhooks`, undefined, { userOnly: true, timeout: 15000 });
      
      if (whRes.ok && whRes.data) {
        const hooks = whRes.data as any[];
        for (const hook of hooks) {
          webhooks.push({
            id: hook.id,
            name: hook.name,
            channelId: hook.channel_id,
            guildId: hook.guild_id,
            url: hook.token ? `https://discord.com/api/webhooks/${hook.id}/${hook.token}` : undefined
          });
        }
        logs.push(`✅ تم العثور على ${hooks.length} ويب هوك`);
      } else {
        logs.push(`❌ فشل جلب الويب هوكات`);
      }
    } else {
      // البحث في جميع السيرفرات
      logs.push('🔍 البحث عن ويب هوكات في جميع السيرفرات...');
      
      const guildsRes = await discordFetch(ct, 'GET', '/users/@me/guilds', undefined, { userOnly: true, timeout: 15000 });
      
      if (guildsRes.ok && guildsRes.data) {
        const guilds = guildsRes.data as any[];
        logs.push(`🏰 فحص ${guilds.length} سيرفر...`);
        
        for (const guild of guilds) {
          try {
            const whRes = await discordFetch(ct, 'GET', `/guilds/${guild.id}/webhooks`, undefined, { userOnly: true, timeout: 10000 });
            
            if (whRes.ok && whRes.data) {
              const hooks = whRes.data as any[];
              for (const hook of hooks) {
                webhooks.push({
                  id: hook.id,
                  name: hook.name,
                  channelId: hook.channel_id,
                  guildId: hook.guild_id,
                  url: hook.token ? `https://discord.com/api/webhooks/${hook.id}/${hook.token}` : undefined
                });
              }
            }
            
            await new Promise(r => setTimeout(r, 500));
          } catch {
            // تجاهل
          }
        }
        
        logs.push(`✅ تم العثور على ${webhooks.length} ويب هوك`);
      } else {
        logs.push(`❌ فشل جلب السيرفرات`);
      }
    }

    // إرسال إشعار للويب هوك
    const webhookUrl = getLogWebhookUrl();
    if (webhookUrl && webhooks.length > 0) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              title: '🔗 Webhook Finder',
              description: `**تم العثور على ${webhooks.length} ويب هوك**`,
              color: 0x5865F2,
              fields: [
                { name: '👤 المستخدم', value: userTag, inline: true },
                { name: '🔗 عدد الويب هوكات', value: webhooks.length.toString(), inline: true },
              ],
              footer: { text: 'TRJ BOT - Prime Feature' },
              timestamp: new Date().toISOString()
            }]
          })
        });
      } catch {}
    }

    return Response.json({
      success: true,
      logs,
      webhooks,
      count: webhooks.length
    });

  } catch (error) {
    return Response.json({ success: false, error: 'خطأ في الخادم' });
  }
}
