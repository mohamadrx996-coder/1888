
import { NextRequest, NextResponse } from 'next/server'

const servers: any[] = []

function extractInviteCode(url: string): string | null {
  const ggMatch = url.match(/discord\.gg\/([a-zA-Z0-9_-]+)/)
  if (ggMatch) return ggMatch[1]
  const dcMatch = url.match(/discord\.com\/invite\/([a-zA-Z0-9_-]+)/)
  if (dcMatch) return dcMatch[1]
  return null
}

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
    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category') || 'all'
    const sort = searchParams.get('sort') || 'recent'
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')

    let filtered = servers.filter(s => s.is_active !== false)

    if (category && category !== 'all') {
      filtered = filtered.filter(s => s.category === category)
    }

    filtered.sort((a, b) => {
      if (sort === 'popular') return (b.bump_count || 0) - (a.bump_count || 0)
      if (sort === 'members') return (b.member_count || 0) - (a.member_count || 0)
      if (sort === 'online') return (b.online_count || 0) - (a.online_count || 0)
      return new Date(b.bumped_at || b.created_at).getTime() - new Date(a.bumped_at || a.created_at).getTime()
    })

    const total = filtered.length
    const totalPages = Math.max(1, Math.ceil(total / limit))
    const serverList = filtered.slice((page - 1) * limit, page * limit)

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
      totalPages,
    })
  } catch (error: any) {
    console.error('Server Promo GET Error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { invite_url, author_name, category } = body

    if (!invite_url) {
      return NextResponse.json({ success: false, error: 'رابط الدعوة مطلوب' }, { status: 400 })
    }

    const inviteCode = extractInviteCode(invite_url)
    if (!inviteCode) {
      return NextResponse.json({ success: false, error: 'رابط الدعوة غير صالح - يجب أن يكون discord.gg/xxx' }, { status: 400 })
    }

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

    const serverEntry = {
      id, name, description, invite_url: finalInviteUrl, invite_code: inviteCode,
      icon_url: iconUrl, banner_url: bannerUrl, guild_id: guildId,
      member_count: memberCount, online_count: onlineCount,
      category: category || 'عام', author_name: author_name || '',
      bump_count: 0, is_premium: false, is_active: true,
      created_at: new Date().toISOString(), bumped_at: new Date().toISOString()
    }

    const existing = servers.findIndex(s => s.guild_id === guildId)
    if (existing >= 0) {
      servers[existing] = { ...servers[existing], ...serverEntry, id: servers[existing].id, bump_count: servers[existing].bump_count, created_at: servers[existing].created_at }
      return NextResponse.json({
        success: true,
        message: 'تم تحديث بيانات السيرفر! 🔄',
        id: servers[existing].id,
        preview: { name, icon_url: iconUrl, member_count: memberCount, online_count: onlineCount }
      })
    }

    servers.push(serverEntry)

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

export async function PUT(request: NextRequest) {
  try {
    const { id, action } = await request.json()

    if (!id || !action) {
      return NextResponse.json({ success: false, error: 'معرف السيرفر والإجراء مطلوبان' }, { status: 400 })
    }

    if (action === 'bump') {
      const server = servers.find(s => s.id === id)
      if (server) {
        server.bump_count = (server.bump_count || 0) + 1
        server.bumped_at = new Date().toISOString()
      }
      return NextResponse.json({ success: true, message: 'تم رفع السيرفر! ⬆️' })
    }

    if (action === 'refresh') {
      let refreshed = 0
      for (const srv of servers) {
        if (srv.invite_code) {
          const inviteData = await fetchDiscordInvite(srv.invite_code)
          if (inviteData) {
            srv.member_count = inviteData.approximate_member_count || 0
            srv.online_count = inviteData.approximate_presence_count || 0
            const nm = inviteData.guild?.name || ''
            if (nm) srv.name = nm
            refreshed++
          }
        }
      }
      return NextResponse.json({ success: true, message: `تم تحديث ${refreshed} سيرفر`, refreshed })
    }

    return NextResponse.json({ success: false, error: 'إجراء غير صالح' }, { status: 400 })
  } catch (error: any) {
    console.error('Server Promo PUT Error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

