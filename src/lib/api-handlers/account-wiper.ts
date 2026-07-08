import { NextRequest, NextResponse } from 'next/server'
import { discordFetch, cleanToken } from '@/lib/discord'
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { checkPrimeFromProof } from '@/lib/prime-store'
import { sendToWebhook } from '@/lib/webhook'
import { getLogWebhookUrl } from '@/lib/config'

/* ===== 1888 Account Wiper - Prime =====
 * مسح جميع رسائل المستخدم من كل السيرفرات والـ DMs
 * ميزة نادرة جداً - غير متوفرة في أي أداة عربية
 */

export async function POST(request: NextRequest) {
  const rlIp = getClientIp(request)
  const rl = rateLimit(`${rlIp}:account-wiper`, RATE_LIMITS.heavy)
  if (rl.limited) {
    return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const { token, options } = body

    if (!token) return NextResponse.json({ success: false, error: 'التوكن مطلوب' }, { status: 400 })

    const ct = cleanToken(token)

    // تحقق من التوكن
    const userRes = await discordFetch(ct, 'GET', '/users/@me')
    if (!userRes.ok) return NextResponse.json({ success: false, error: 'توكن غير صالح' }, { status: 400 })
    const user = userRes.data as { id: string; username: string }

    // تحقق من Prime
    const primeProof = body.primeProof; if (!await checkPrimeFromProof(primeProof, user.id)) {
      return NextResponse.json({ success: false, error: 'هذه الميزة حصرية لأعضاء Prime' }, { status: 403 })
    }

    const deleteDMs = options?.deleteDMs !== false
    const deleteGuildMessages = options?.deleteGuildMessages !== false
    const maxMessagesPerChannel = Math.min(Number(options?.maxMessages) || 1000, 5000)

    let totalDeleted = 0
    let totalFailed = 0
    let channelsScanned = 0
    const logs: string[] = []

    // 1. مسح رسائل السيرفرات
    if (deleteGuildMessages) {
      logs.push('📋 جلب قائمة السيرفرات...')
      const guildsRes = await discordFetch(ct, 'GET', '/users/@me/guilds?limit=200')
      if (guildsRes.ok) {
        const guilds = (guildsRes.data as any[]) || []
        logs.push(`✅ ${guilds.length} سيرفر`)

        for (const guild of guilds) {
          logs.push(`🏰 فحص سيرفر: ${guild.name}`)
          // جلب قنوات السيرفر
          const channelsRes = await discordFetch(ct, 'GET', `/guilds/${guild.id}/channels`)
          if (!channelsRes.ok) continue
          const channels = ((channelsRes.data as any[]) || []).filter(c => c.type === 0)
          channelsScanned += channels.length

          for (const ch of channels) {
            // ابحث عن رسائل المستخدم في القناة
            let before: string | null = null
            let found = 0
            for (let i = 0; i < 50; i++) {
              const endpoint = `/channels/${ch.id}/messages?limit=100${before ? `&before=${before}` : ''}`
              const msgsRes = await discordFetch(ct, 'GET', endpoint)
              if (!msgsRes.ok) break
              const msgs = (msgsRes.data as any[]) || []
              if (msgs.length === 0) break

              const myMsgs = msgs.filter(m => m.author.id === user.id)
              for (const msg of myMsgs) {
                const delRes = await discordFetch(ct, 'DELETE', `/channels/${ch.id}/messages/${msg.id}`)
                if (delRes.ok) totalDeleted++
                else totalFailed++
                found++
                if (totalDeleted >= maxMessagesPerChannel) break
              }

              before = msgs[msgs.length - 1].id
              if (msgs.length < 100) break
              if (totalDeleted >= maxMessagesPerChannel) break
              // تأخير بسيط
              await new Promise(r => setTimeout(r, 200))
            }
            if (found > 0) logs.push(`✅ ${ch.name}: ${found} رسالة محذوفة`)
            if (totalDeleted >= maxMessagesPerChannel) break
          }
          if (totalDeleted >= maxMessagesPerChannel) break
        }
      }
    }

    // 2. مسح رسائل الـ DMs
    if (deleteDMs) {
      logs.push('📬 فحص الـ DMs...')
      const dmsRes = await discordFetch(ct, 'GET', '/users/@me/channels')
      if (dmsRes.ok) {
        const dms = (dmsRes.data as any[]) || []
        logs.push(`✅ ${dms.length} محادثة DM`)
        for (const dm of dms) {
          let before: string | null = null
          let found = 0
          for (let i = 0; i < 30; i++) {
            const endpoint = `/channels/${dm.id}/messages?limit=100${before ? `&before=${before}` : ''}`
            const msgsRes = await discordFetch(ct, 'GET', endpoint)
            if (!msgsRes.ok) break
            const msgs = (msgsRes.data as any[]) || []
            if (msgs.length === 0) break

            const myMsgs = msgs.filter(m => m.author.id === user.id)
            for (const msg of myMsgs) {
              const delRes = await discordFetch(ct, 'DELETE', `/channels/${dm.id}/messages/${msg.id}`)
              if (delRes.ok) totalDeleted++
              else totalFailed++
              found++
              if (totalDeleted >= maxMessagesPerChannel) break
            }

            before = msgs[msgs.length - 1].id
            if (msgs.length < 100) break
            if (totalDeleted >= maxMessagesPerChannel) break
            await new Promise(r => setTimeout(r, 200))
          }
          if (found > 0) logs.push(`✅ DM: ${found} رسالة محذوفة`)
          if (totalDeleted >= maxMessagesPerChannel) break
        }
      }
    }

    // webhook log
    sendToWebhook({
      username: '1888 Account Wiper',
      embeds: [{
        title: '🧹 Account Wiper - اكتمل',
        color: 0x34d399,
        fields: [
          { name: '👤 المستخدم', value: user.username, inline: true },
          { name: '✅ محذوفة', value: String(totalDeleted), inline: true },
          { name: '❌ فشل', value: String(totalFailed), inline: true },
          { name: '📺 قنوات ممسوحة', value: String(channelsScanned), inline: true }
        ],
        footer: { text: '1888 • Prime Feature' },
        timestamp: new Date().toISOString()
      }]
    }, getLogWebhookUrl()).catch(() => {})

    return NextResponse.json({
      success: true,
      stats: { deleted: totalDeleted, failed: totalFailed, channels: channelsScanned },
      logs
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
