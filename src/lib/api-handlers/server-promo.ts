import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

// ===================================================================
// حفظ السيرفرات باستخدام JSONBin.io (مجاني - بدون مفتاح)
// إذا فشل JSONBin يرجع للذاكرة المؤقتة
// ===================================================================

declare global {
  var __trj_promo_bin_id: string | undefined;
  var __trj_promo_cache: any[] | undefined;
  var __trj_promo_bumps: Record<string, number> | undefined;
}

let binId: string = (typeof globalThis !== 'undefined' && globalThis.__trj_promo_bin_id) || '';
let serverCache: any[] = (typeof globalThis !== 'undefined' && globalThis.__trj_promo_cache) || [];
const bumpCache: Record<string, number> = (typeof globalThis !== 'undefined' && globalThis.__trj_promo_bumps) || {};

if (typeof globalThis !== 'undefined') {
  globalThis.__trj_promo_bin_id = binId;
  globalThis.__trj_promo_cache = serverCache;
  globalThis.__trj_promo_bumps = bumpCache;
}

// ===================================================================
// JSONBin API - مجاني بالكامل
// ===================================================================

const JSONBIN_API = 'https://api.jsonbin.io/v3';
const JSONBIN_MASTER_KEY = '$2a$10$dummy'; // لا يحتاج مفتاح للقراءة

async function createBin(data: any): Promise<string | null> {
  try {
    const res = await fetch(`${JSONBIN_API}/b`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bin-Private': 'false' },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    return json?.metadata?.id || json?.id || null;
  } catch { return null; }
}

async function readBin(id: string): Promise<any[] | null> {
  try {
    const res = await fetch(`${JSONBIN_API}/b/${id}/latest`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    return json?.record || json?.data || null;
  } catch { return null; }
}

async function updateBin(id: string, data: any): Promise<boolean> {
  try {
    const res = await fetch(`${JSONBIN_API}/b/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch { return false; }
}

async function saveServers(servers: any[]) {
  serverCache = servers;
  if (typeof globalThis !== 'undefined') globalThis.__trj_promo_cache = serverCache;

  if (binId) {
    await updateBin(binId, servers);
    return;
  }

  const newId = await createBin(servers);
  if (newId) {
    binId = newId;
    if (typeof globalThis !== 'undefined') globalThis.__trj_promo_bin_id = binId;
  }
}

async function loadServers(): Promise<any[]> {
  if (serverCache.length > 0) return serverCache;

  if (binId) {
    const data = await readBin(binId);
    if (data && Array.isArray(data)) {
      serverCache = data;
      return serverCache;
    }
  }

  return serverCache;
}

// ===================================================================
// Seed servers
// ===================================================================

const seedServers: any[] = [
  {
    id: 'seed_trj',
    name: 'TRJ BOT - Official',
    description: 'الموقع الرسمي لـ TRJ BOT v4.3 - أفضل أداة ديسكورد عربية | 34 ميزة متكاملة',
    invite_url: 'https://discord.gg/MpwvCypA66',
    invite_code: 'MpwvCypA66',
    icon_url: null,
    banner_url: null,
    guild_id: '1365853182088773744',
    member_count: 1500,
    online_count: 200,
    category: 'other',
    author_name: 'TRJ Team',
    bump_count: 99,
    is_active: true,
    created_at: '2025-01-01T00:00:00.000Z',
    bumped_at: new Date().toISOString(),
  },
  {
    id: 'seed_discord',
    name: 'Discord Arabic Community',
    description: 'أكبر مجتمع عربي على ديسكورد - تعارف، مساعدة، برمجة، تصميم وأكثر',
    invite_url: 'https://discord.gg/discord',
    invite_code: 'discord',
    icon_url: null,
    banner_url: null,
    guild_id: '0',
    member_count: 800000,
    online_count: 150000,
    category: 'social',
    author_name: 'Community',
    bump_count: 50,
    is_active: true,
    created_at: '2025-01-01T00:00:00.000Z',
    bumped_at: new Date().toISOString(),
  },
];

function getAllServers(): any[] {
  return [...serverCache, ...seedServers];
}

// ===================================================================
// Discord invite helpers
// ===================================================================

function extractInviteCode(url: string): string | null {
  const ggMatch = url.match(/discord\.gg\/([a-zA-Z0-9_-]+)/);
  if (ggMatch) return ggMatch[1];
  const dcMatch = url.match(/discord\.com\/invite\/([a-zA-Z0-9_-]+)/);
  if (dcMatch) return dcMatch[1];
  return null;
}

async function fetchDiscordInvite(code: string): Promise<any | null> {
  try {
    const res = await fetch(
      `https://discord.com/api/v10/invites/${code}?with_counts=true&with_expiration=true`,
      { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) }
    );
    if (res.status === 404) return null;
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 3000));
      const res2 = await fetch(
        `https://discord.com/api/v10/invites/${code}?with_counts=true&with_expiration=true`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!res2.ok) return null;
      return await res2.json().catch(() => null);
    }
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch { return null; }
}

function buildIconUrl(guild: any): string | null {
  if (!guild || !guild.icon) return null;
  const fmt = guild.icon.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${fmt}?size=256`;
}

function buildBannerUrl(guild: any): string | null {
  if (!guild || !guild.banner) return null;
  const fmt = guild.banner.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/banners/${guild.id}/${guild.banner}.${fmt}?size=512`;
}

function mapServer(s: any) {
  return {
    id: String(s.id),
    name: String(s.name || ''),
    description: s.description ? String(s.description) : null,
    invite_url: String(s.invite_url || ''),
    icon_url: s.icon_url ? String(s.icon_url) : null,
    banner_url: s.banner_url ? String(s.banner_url) : null,
    guild_id: s.guild_id ? String(s.guild_id) : null,
    member_count: Number(s.member_count || 0),
    online_count: Number(s.online_count || 0),
    category: String(s.category || 'other'),
    author_name: s.author_name ? String(s.author_name) : null,
    bump_count: Number(s.bump_count || 0),
    created_at: s.created_at ? String(s.created_at) : null,
    bumped_at: s.bumped_at ? String(s.bumped_at) : null,
  };
}

// ===================================================================
// GET - عرض السيرفرات
// ===================================================================

const categories = [
  { id: 'all', name: 'الكل', icon: '🌐' },
  { id: 'gaming', name: 'جيمنج', icon: '🎮' },
  { id: 'programming', name: 'برمجة', icon: '💻' },
  { id: 'design', name: 'تصميم', icon: '🎨' },
  { id: 'trading', name: 'تريد', icon: '📈' },
  { id: 'social', name: 'تواصل', icon: '💬' },
  { id: 'music', name: 'موسيقى', icon: '🎵' },
  { id: 'anime', name: 'أنمي', icon: '🎌' },
  { id: 'education', name: 'تعليم', icon: '📚' },
  { id: 'other', name: 'أخرى', icon: '⚡' },
];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category') || 'all';
    const sort = searchParams.get('sort') || 'recent';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');

    // تحميل من JSONBin أو من الكاش
    await loadServers();

    const allServers = getAllServers();
    let filtered = allServers.filter(s => s.is_active !== false);

    if (category && category !== 'all') {
      filtered = filtered.filter(s => s.category === category);
    }

    filtered.sort((a, b) => {
      if (sort === 'popular') return (b.bump_count || 0) - (a.bump_count || 0);
      if (sort === 'members') return (b.member_count || 0) - (a.member_count || 0);
      if (sort === 'online') return (b.online_count || 0) - (a.online_count || 0);
      return new Date(b.bumped_at || b.created_at).getTime() - new Date(a.bumped_at || a.created_at).getTime();
    });

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const serverList = filtered.slice((page - 1) * limit, page * limit);

    return NextResponse.json({
      success: true,
      servers: serverList.map(mapServer),
      categories,
      total,
      page,
      totalPages,
    });
  } catch (error: any) {
    console.error('Server Promo GET Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// ===================================================================
// POST - نشر سيرفر جديد
// ===================================================================

export async function POST(request: NextRequest) {
  try {
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:server-promo`, RATE_LIMITS.medium);
    if (rl.limited) {
      return NextResponse.json(
        { success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { invite_url, author_name, category } = body;

    if (!invite_url) {
      return NextResponse.json({ success: false, error: 'رابط الدعوة مطلوب' }, { status: 400 });
    }

    const inviteCode = extractInviteCode(invite_url);
    if (!inviteCode) {
      return NextResponse.json({ success: false, error: 'رابط الدعوة غير صالح' }, { status: 400 });
    }

    const inviteData = await fetchDiscordInvite(inviteCode);
    if (!inviteData) {
      return NextResponse.json({ success: false, error: 'لم يتم العثور على السيرفر' }, { status: 404 });
    }

    const guild = inviteData.guild;
    const name = guild?.name || 'Unknown Server';
    const description = guild?.description || '';
    const iconUrl = buildIconUrl(guild);
    const bannerUrl = buildBannerUrl(guild);
    const memberCount = inviteData.approximate_member_count || 0;
    const onlineCount = inviteData.approximate_presence_count || 0;
    const guildId = guild?.id || '';
    const finalUrl = `https://discord.gg/${inviteCode}`;

    // تحميل السيرفرات الحالية
    await loadServers();

    const newEntry = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 8),
      name,
      description,
      invite_url: finalUrl,
      invite_code: inviteCode,
      icon_url: iconUrl,
      banner_url: bannerUrl,
      guild_id: guildId,
      member_count: memberCount,
      online_count: onlineCount,
      category: category || 'other',
      author_name: author_name || '',
      bump_count: 0,
      is_active: true,
      created_at: new Date().toISOString(),
      bumped_at: new Date().toISOString(),
    };

    // تحقق إن كان السيرفر موجود مسبقاً
    const existingIdx = serverCache.findIndex(s => s.guild_id === guildId);
    if (existingIdx >= 0) {
      const old = serverCache[existingIdx];
      serverCache[existingIdx] = {
        ...old,
        name,
        description,
        icon_url: iconUrl,
        banner_url: bannerUrl,
        member_count: memberCount,
        online_count: onlineCount,
        invite_url: finalUrl,
        invite_code: inviteCode,
        bumped_at: new Date().toISOString(),
      };
    } else {
      // حد أقصى 100 سيرفر عشان ما يتجاهظ JSONBin
      if (serverCache.length >= 100) {
        serverCache.sort((a, b) => new Date(b.bumped_at).getTime() - new Date(a.bumped_at).getTime());
        serverCache = serverCache.slice(0, 99);
      }
      serverCache.push(newEntry);
    }

    // حفظ في JSONBin
    await saveServers(serverCache);

    const allServers = getAllServers();
    return NextResponse.json({
      success: true,
      message: existingIdx >= 0 ? 'تم تحديث السيرفر! 🔄' : 'تم نشر السيرفر بنجاح! 🎉',
      id: existingIdx >= 0 ? serverCache[existingIdx].id : newEntry.id,
      preview: { name, icon_url: iconUrl, member_count: memberCount, online_count: onlineCount },
      servers: allServers.map(mapServer),
    });
  } catch (error: any) {
    console.error('Server Promo POST Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// ===================================================================
// PUT - bump / refresh
// ===================================================================

export async function PUT(request: NextRequest) {
  try {
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:server-promo`, RATE_LIMITS.medium);
    if (rl.limited) {
      return NextResponse.json(
        { success: false, error: 'تم تجاوز الحد المسموح' },
        { status: 429 }
      );
    }

    const { id, action } = await request.json().catch(() => ({}));
    if (!id || !action) {
      return NextResponse.json({ success: false, error: 'معرف والإجراء مطلوبان' }, { status: 400 });
    }

    await loadServers();

    if (action === 'bump') {
      const allServers = getAllServers();
      const server = allServers.find(s => s.id === id);
      if (server) {
        server.bump_count = (server.bump_count || 0) + 1;
        server.bumped_at = new Date().toISOString();
        // حفظ التعديلات
        if (serverCache.find(s => s.id === id)) {
          await saveServers(serverCache);
        }
      }
      return NextResponse.json({ success: true, message: 'تم رفع السيرفر! ⬆️' });
    }

    if (action === 'refresh') {
      let refreshed = 0;
      const allServers = getAllServers();
      for (const srv of allServers) {
        if (srv.invite_code) {
          const inv = await fetchDiscordInvite(srv.invite_code);
          if (inv) {
            srv.member_count = inv.approximate_member_count || 0;
            srv.online_count = inv.approximate_presence_count || 0;
            const nm = inv.guild?.name || '';
            if (nm) srv.name = nm;
            refreshed++;
          }
        }
      }
      await saveServers(serverCache);
      return NextResponse.json({ success: true, message: `تم تحديث ${refreshed} سيرفر`, refreshed });
    }

    return NextResponse.json({ success: false, error: 'إجراء غير صالح' }, { status: 400 });
  } catch (error: any) {
    console.error('Server Promo PUT Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
