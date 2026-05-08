import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// In-memory storage as fallback
const servers: any[] = []

// Initialize DB table if needed
async function ensureDB() {
  try {
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ServerPromo (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        invite_url TEXT NOT NULL,
        invite_code TEXT DEFAULT '',
        icon_url TEXT DEFAULT '',
        banner_url TEXT DEFAULT '',
        splash_url TEXT DEFAULT '',
        guild_id TEXT DEFAULT '',
        member_count INTEGER DEFAULT 0,
        online_count INTEGER DEFAULT 0,
        category TEXT DEFAULT 'عام',
        author_name TEXT DEFAULT '',
        tags TEXT DEFAULT '',
        bump_count INTEGER DEFAULT 0,
        is_premium INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        bumped_at DATETIME
      )
    `)
  } catch (e) {
    console.error('ensureDB error:', e)
  }
}

// Extract invite code from URL
function extractInviteCode(url: string): string | null {
  const ggMatch = url.match(/discord\.gg\/([a-zA-Z0-9_-]+)/)
  if (ggMatch) return ggMatch[1]
  const dcMatch = url.match(/discord\.com\/invite\/([a-zA-Z0-9_-]+)/)
  if (dcMatch) return dcMatch[1]
  return null
}

// Fetch server info from Discord API (no auth needed)
async function fetchDiscordInvite(code: string): Promise<any | null> {
  try {
    const ctrl = new AbortController()
    const tid = setTimeout(() => ctrl.abort(), 10000)
    const res = await fetch(`https://discord.com/api/v10/invites/${code}?with_counts=true&with_expiration=true`, {
      signal: ctrl.signal,
      headers: { 'Accept': 'application/json' }
    })
    clearTimeout(tid)

    if (res.status === 404) return null
    if (res.status === 429) {
      const errData = await res.json().catch(() => ({ retry_after: 2 }))
      await new Promise(r => setTimeout(r, (errData.retry_after || 2) * 1000))
      const res2 = await fetch(`https://discord.com/api/v10/invites/${code}?with_counts=true&with_expiration=true`)
      if (!res2.ok) return null
      return await res2.json()
    }
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// Build icon URL from guild data
function buildIconUrl(guild: any): string | null {
  if (!guild || !guild.icon) return null
  const format = guild.icon.startsWith('a_') ? 'gif' : 'png'
  return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${format}?size=256`
}

function buildBannerUrl(guild: any): string | null {
  if (!guild || !guild.banner) return null
  const format = guild.banner.startsWith('a_') ? 'gif' : 'png'
  return `https://cdn.discordapp.com/banners/${guild.id}/${guild.banner}.${format}?size=512`
}

export async function GET(request: NextRequest) {
  try {
    await ensureDB()
    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category') || 'all'
    const sort = searchParams.get('sort') || 'recent'
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')

    let query = 'SELECT * FROM ServerPromo WHERE is_active = 1'
    const params: any[] = []

    if (category && category !== 'all') {
      query += ' AND category = ?'
      params.push(category)
    }

    if (sort === 'popular') {
      query += ' ORDER BY bump_count DESC, created_at DESC'
    } else if (sort === 'members') {
      query += ' ORDER BY member_count DESC, created_at DESC'
    } else if (sort === 'online') {
      query += ' ORDER BY online_count DESC, created_at DESC'
    } else {
      query += ' ORDER BY COALESCE(bumped_at, created_at) DESC'
    }

    query += ' LIMIT ? OFFSET ?'
    params.push(limit, (page - 1) * limit)

    let serverList: any[] = []
    try {
      serverList = await db.$queryRawUnsafe(query, ...params)
    } catch {
      serverList = servers.filter(s => category === 'all' || s.category === category)
        .sort((a, b) => {
          if (sort === 'popular') return b.bump_count - a.bump_count
          if (sort === 'members') return (b.member_count || 0) - (a.member_count || 0)
          if (sort === 'online') return (b.online_count || 0) - (a.online_count || 0)
          return new Date(b.bumped_at || b.created_at).getTime() - new Date(a.bumped_at || a.created_at).getTime()
        })
        .slice((page - 1) * limit, page * limit)
    }

    // Get total count
    let total = 0
    try {
      const countQuery = category && category !== 'all'
        ? 'SELECT COUNT(*) as count FROM ServerPromo WHERE is_active = 1 AND category = ?'
        : 'SELECT COUNT(*) as count FROM ServerPromo WHERE is_active = 1'
      const countParams = category && category !== 'all' ? [category] : []
      const countResult = await db.$queryRawUnsafe(countQuery, ...countParams) as any[]
      total = Number(countResult[0]?.count || 0)
    } catch {
      total = servers.length
    }

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
    ]

    return NextResponse.json({
      success: true,
      servers: serverList.map((s: any) => ({
        id: String(s.id),
        name: String(s.name || ''),
        description: s.description ? String(s.description) : null,
        invite_url: String(s.invite_url || ''),
        icon_url: s.icon_url ? String(s.icon_url) : null,
        banner_url: s.banner_url ? String(s.banner_url) : null,
        guild_id: s.guild_id ? String(s.guild_id) : null,
        member_count: Number(s.member_count || 0),
        online_count: Number(s.online_count || 0),
        category: String(s.category || 'عام'),
        author_name: s.author_name ? String(s.author_name) : null,
        bump_count: Number(s.bump_count || 0),
        created_at: s.created_at ? String(s.created_at) : null,
        bumped_at: s.bumped_at ? String(s.bumped_at) : null,
      })),
      categories,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    })
  } catch (error: any) {
    console.error('Server Promo GET Error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureDB()
    const body = await request.json()
    const { invite_url, author_name, category } = body

    if (!invite_url) {
      return NextResponse.json({ success: false, error: 'رابط الدعوة مطلوب' }, { status: 400 })
    }

    // Extract invite code
    const inviteCode = extractInviteCode(invite_url)
    if (!inviteCode) {
      return NextResponse.json({ success: false, error: 'رابط الدعوة غير صالح - يجب أن يكون discord.gg/xxx' }, { status: 400 })
    }

    // Fetch server info from Discord
    const inviteData = await fetchDiscordInvite(inviteCode)
    if (!inviteData) {
      return NextResponse.json({ success: false, error: 'لم يتم العثور على السيرفر - تأكد من صلاحية الرابط' }, { status: 404 })
    }

    const guild = inviteData.guild
    const name = guild?.name || 'Unknown Server'
    const description = guild?.description || ''
    const iconUrl = buildIconUrl(guild)
    const bannerUrl = buildBannerUrl(guild)
    const memberCount = inviteData.approximate_member_count || guild?.approximate_member_count || 0
    const onlineCount = inviteData.approximate_presence_count || guild?.approximate_presence_count || 0
    const guildId = guild?.id || ''
    const finalInviteUrl = `https://discord.gg/${inviteCode}`

    const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 8)

    try {
      await db.$executeRawUnsafe(
        `INSERT INTO ServerPromo (id, name, description, invite_url, invite_code, icon_url, banner_url, guild_id, member_count, online_count, category, author_name, tags, bump_count, is_premium, is_active, created_at, bumped_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 0, 0, 1, datetime('now'), datetime('now'))`,
        id, name, description, finalInviteUrl, inviteCode, iconUrl, bannerUrl, guildId, memberCount, onlineCount, category || 'عام', author_name || ''
      )
    } catch (e) {
      console.error('Insert DB error, using in-memory:', e)
      servers.push({
        id, name, description, invite_url: finalInviteUrl, invite_code: inviteCode,
        icon_url: iconUrl, banner_url: bannerUrl, guild_id: guildId,
        member_count: memberCount, online_count: onlineCount,
        category: category || 'عام', author_name: author_name || '',
        bump_count: 0, is_premium: false,
        created_at: new Date().toISOString(), bumped_at: new Date().toISOString()
      })
    }

    return NextResponse.json({
      success: true,
      message: 'تم نشر السيرفر بنجاح! 🎉',
      id,
      preview: {
        name, icon_url: iconUrl, member_count: memberCount, online_count: onlineCount
      }
    })
  } catch (error: any) {
    console.error('Server Promo POST Error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

// Refresh server data (update member counts) / bump
export async function PUT(request: NextRequest) {
  try {
    await ensureDB()
    const { id, action } = await request.json()

    if (!id || !action) {
      return NextResponse.json({ success: false, error: 'معرف السيرفر والإجراء مطلوبان' }, { status: 400 })
    }

    if (action === 'bump') {
      try {
        const serverRow = await db.$queryRawUnsafe(
          'SELECT invite_code, guild_id FROM ServerPromo WHERE id = ? AND is_active = 1', id
        ) as any[]

        if (serverRow && serverRow[0]?.invite_code) {
          const inviteData = await fetchDiscordInvite(serverRow[0].invite_code)
          if (inviteData) {
            const mc = inviteData.approximate_member_count || 0
            const oc = inviteData.approximate_presence_count || 0
            await db.$executeRawUnsafe(
              "UPDATE ServerPromo SET bump_count = bump_count + 1, member_count = ?, online_count = ?, bumped_at = datetime('now') WHERE id = ?",
              mc, oc, id
            )
            return NextResponse.json({ success: true, message: 'تم رفع السيرفر! ⬆️' })
          }
        }

        await db.$executeRawUnsafe(
          "UPDATE ServerPromo SET bump_count = bump_count + 1, bumped_at = datetime('now') WHERE id = ?", id
        )
      } catch {
        const server = servers.find(s => s.id === id)
        if (server) { server.bump_count++; server.bumped_at = new Date().toISOString() }
      }
      return NextResponse.json({ success: true, message: 'تم رفع السيرفر! ⬆️' })
    }

    if (action === 'refresh') {
      try {
        const allServers = await db.$queryRawUnsafe(
          'SELECT id, invite_code FROM ServerPromo WHERE is_active = 1'
        ) as any[]

        let refreshed = 0
        let expired = 0
        for (const srv of allServers) {
          if (srv.invite_code) {
            const inviteData = await fetchDiscordInvite(srv.invite_code)
            if (inviteData) {
              const mc = inviteData.approximate_member_count || 0
              const oc = inviteData.approximate_presence_count || 0
              const nm = inviteData.guild?.name || ''
              await db.$executeRawUnsafe(
                'UPDATE ServerPromo SET member_count = ?, online_count = ?, name = ? WHERE id = ?',
                mc, oc, nm, srv.id
              )
              refreshed++
            }
            // لا نحذف السيرفر أبداً حتى لو الرابط منتهي
          }
        }

        return NextResponse.json({ success: true, message: `تم تحديث ${refreshed} سيرفر`, refreshed })
      } catch {
        return NextResponse.json({ success: false, error: 'فشل في التحديث' })
      }
    }

    return NextResponse.json({ success: false, error: 'إجراء غير صالح' }, { status: 400 })
  } catch (error: any) {
    console.error('Server Promo PUT Error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
