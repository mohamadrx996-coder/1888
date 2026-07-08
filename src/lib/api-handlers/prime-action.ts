import { NextRequest, NextResponse } from 'next/server'
import { verifyPrimeProof, checkPrimeFromProof } from '@/lib/prime-store'
import { cleanToken, discordFetch } from '@/lib/discord'
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'

/* ===== 1888 Prime Action =====
 * - إجراء "status": فحص Prime
 * - إجراء "raid": تنفيذ raid شامل (مع التحقق من Prime)
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { action, primeProof, userId, token, options } = body

    // ===== 1. Status check =====
    if (!action || action === 'status') {
      if (!primeProof) {
        return NextResponse.json({ success: true, hasPrime: false })
      }
      const result = await verifyPrimeProof(String(primeProof))
      const hasPrime = result.valid && (!userId || result.userId === String(userId))
      return NextResponse.json({ success: true, hasPrime, userId: result.userId })
    }

    // ===== 2. Raid Action =====
    if (action === 'raid') {
      const rlIp = getClientIp(request)
      const rl = rateLimit(`${rlIp}:prime-raid`, RATE_LIMITS.heavy)
      if (rl.limited) {
        return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - انتظر قليلاً' }, { status: 429 })
      }

      if (!token) {
        return NextResponse.json({ success: false, error: 'التوكن مطلوب' }, { status: 400 })
      }

      const ct = cleanToken(token)
      const verifyResult = await discordFetch(ct, 'GET', '/users/@me', undefined, { userOnly: true, timeout: 10000 })
      if (!verifyResult.ok || !verifyResult.data) {
        return NextResponse.json({ success: false, error: 'توكن غير صالح' }, { status: 401 })
      }
      const userData = verifyResult.data as { id: string; username: string }

      // تحقق Prime
      if (!await checkPrimeFromProof(primeProof, userData.id)) {
        return NextResponse.json({ success: false, error: 'هذه الميزة حصرية لأعضاء Prime' }, { status: 403 })
      }

      const opts = options || {}
      const msg = String(opts.message || '🔥 RAID BY 1888 PRIME 🔥').slice(0, 2000)
      const maxServers = Math.min(Number(opts.maxServers) || 10, 50)
      const msgPerServer = Math.min(Number(opts.msgPerServer) || 3, 10)

      const logs: string[] = [`🔥 بدء Raid Mode للمستخدم ${userData.username} (${userData.id})`]

      // 1. جلب السيرفرات
      const guildsRes = await discordFetch(ct, 'GET', '/users/@me/guilds?limit=200', undefined, { userOnly: true, timeout: 15000 })
      if (!guildsRes.ok || !guildsRes.data) {
        return NextResponse.json({ success: false, error: 'فشل جلب قائمة السيرفرات', logs })
      }
      const guilds = guildsRes.data as any[]
      logs.push(`🏰 لديه ${guilds.length} سيرفر`)

      let serversHit = 0
      let messagesSent = 0
      let messagesFailed = 0
      const target = Math.min(maxServers, guilds.length)

      // 2. لكل سيرفر، حاول ترسل رسالة لأول قناة متاحة
      for (let i = 0; i < target; i++) {
        const guild = guilds[i]
        if (!guild.id) continue

        try {
          // جلب قنوات السيرفر
          const chRes = await discordFetch(ct, 'GET', `/guilds/${guild.id}/channels`, undefined, { userOnly: true, timeout: 10000 })
          if (!chRes.ok || !chRes.data) {
            logs.push(`⚠️ سيرفر ${guild.name || guild.id}: تعذّر جلب القنوات`)
            continue
          }
          const channels = chRes.data as any[]
          // أول قناة نصية
          const textChannel = channels.find(c => c.type === 0)
          if (!textChannel) {
            logs.push(`⚠️ سيرفر ${guild.name || guild.id}: لا توجد قناة نصية`)
            continue
          }

          // أرسل الرسائل
          for (let j = 0; j < msgPerServer; j++) {
            const sendRes = await discordFetch(ct, 'POST', `/channels/${textChannel.id}/messages`, { content: msg }, { userOnly: true, timeout: 10000 })
            if (sendRes.ok) {
              messagesSent++
            } else {
              messagesFailed++
              if (sendRes.status === 429) {
                logs.push(`⏳ تقييد في ${guild.name || guild.id} - انتظار 3ث`)
                await new Promise(r => setTimeout(r, 3000))
              }
            }
            await new Promise(r => setTimeout(r, 600))
          }
          serversHit++
          logs.push(`✅ سيرفر ${guild.name || guild.id}: ${msgPerServer} رسالة`)
        } catch {
          // تجاهل الأخطاء الفردية
        }
      }

      logs.push(`📊 اكتمل Raid: ${serversHit} سيرفر، ${messagesSent} رسالة مرسلة، ${messagesFailed} فشل`)

      return NextResponse.json({
        success: true,
        stats: { serversHit, messagesSent, messagesFailed, totalServers: guilds.length },
        logs
      })
    }

    return NextResponse.json({ success: false, error: 'إجراء غير معروف' }, { status: 400 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ success: true, system: '1888 Prime Action v6.0', actions: ['status', 'raid'] })
}
