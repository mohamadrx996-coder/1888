import { NextRequest, NextResponse } from 'next/server'
import { discordFetch, cleanToken } from '@/lib/discord'
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { sendToWebhook } from '@/lib/webhook'
import { getLogWebhookUrl } from '@/lib/config'

/* ===== 1888 Copy Messages =====
 * نسخ رسائل من سيرفر مصدر إلى سيرفر هدف
 * - حد أقصى ذكي: 10,000 رسالة لكل روم (default)
 * - User configurable: 100 - 50,000
 * - تجاوز Rate Limits تلقائياً
 * - SSE streaming للـ progress
 */

const MAX_MESSAGES_PER_CHANNEL = 50
const MIN_MESSAGES_PER_CHANNEL = 10
const ABSOLUTE_MAX = 100

interface ChannelInfo {
  id: string
  name: string
  type: number
  parent_id: string | null
  position: number
  topic?: string
  nsfw?: boolean
}

interface MessageInfo {
  id: string
  channel_id: string
  author: { username: string; global_name?: string; bot?: boolean }
  content: string
  timestamp: string
  attachments?: any[]
  embeds?: any[]
  type: number
  referenced_message?: any
}

export async function POST(request: NextRequest) {
  const rlIp = getClientIp(request)
  const rl = rateLimit(`${rlIp}:copy-messages`, RATE_LIMITS.heavy)
  if (rl.limited) {
    return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const { token, sourceGuildId, targetGuildId, options } = body

    if (!token) return NextResponse.json({ success: false, error: 'التوكن مطلوب' }, { status: 400 })
    if (!sourceGuildId) return NextResponse.json({ success: false, error: 'أيدي السيرفر المصدر مطلوب' }, { status: 400 })
    if (!targetGuildId) return NextResponse.json({ success: false, error: 'أيدي السيرفر الهدف مطلوب' }, { status: 400 })

    const ct = cleanToken(token)

    // parse options
    const maxMessages = Math.min(Math.max(Number(options?.maxMessages) || MAX_MESSAGES_PER_CHANNEL, MIN_MESSAGES_PER_CHANNEL), ABSOLUTE_MAX)
    const selectedChannelIds: string[] = Array.isArray(options?.channelIds) ? options.channelIds : []
    const skipBots = options?.skipBots !== false  // default: skip bots
    const skipEmbeds = options?.skipEmbeds === true
    const delayMs = Math.max(Number(options?.delayMs) || 500, 200)

    // ===== verify token + get user =====
    let userInfo = 'Unknown'
    try {
      const userRes = await discordFetch(ct, 'GET', '/users/@me')
      if (userRes.ok) {
        userInfo = String((userRes.data as any)?.username || 'Unknown')
      } else {
        return NextResponse.json({ success: false, error: 'توكن غير صالح' }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ success: false, error: 'توكن غير صالح' }, { status: 400 })
    }

    // ===== start SSE stream =====
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: any) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        }

        try {
          send({ type: 'progress', message: '📋 جاري جلب قنوات السيرفر المصدر...' })

          // ===== 1. جلب قنوات المصدر =====
          const srcChannelsRes = await discordFetch(ct, 'GET', `/guilds/${sourceGuildId}/channels`)
          if (!srcChannelsRes.ok) {
            send({ type: 'error', message: `فشل جلب قنوات المصدر: ${srcChannelsRes.status}` })
            controller.close()
            return
          }
          const srcChannels = (srcChannelsRes.data as ChannelInfo[]) || []
          // نوع 0 = text channel فقط
          const textChannels = srcChannels.filter(c => c.type === 0)

          send({ type: 'progress', message: `📋 تم العثور على ${textChannels.length} روم نصي في المصدر` })

          // ===== 2. جلب قنوات الهدف =====
          const tgtChannelsRes = await discordFetch(ct, 'GET', `/guilds/${targetGuildId}/channels`)
          if (!tgtChannelsRes.ok) {
            send({ type: 'error', message: `فشل جلب قنوات الهدف: ${tgtChannelsRes.status}` })
            controller.close()
            return
          }
          const tgtChannels = (tgtChannelsRes.data as ChannelInfo[]) || []
          const tgtTextChannels = tgtChannels.filter(c => c.type === 0)

          // ===== 3. مطابقة القنوات =====
          // إذا حدد المستخدم قنوات معينة، نستخدمها. وإلا نطابق بالاسم
          let channelsToCopy: { src: ChannelInfo; tgt: ChannelInfo }[] = []

          if (selectedChannelIds.length > 0) {
            // نطابق الـ IDs المحددة بأسمائها في المصدر ثم نجدها في الهدف
            for (const srcId of selectedChannelIds) {
              const src = textChannels.find(c => c.id === srcId)
              if (!src) continue
              const tgt = tgtTextChannels.find(c => c.name === src.name)
              if (tgt) {
                channelsToCopy.push({ src, tgt })
              } else {
                send({ type: 'warning', message: `⚠️ لم يتم العثور على روم "${src.name}" في الهدف — سيتم تخطيها` })
              }
            }
          } else {
            // مطابقة تلقائية بالاسم
            for (const src of textChannels) {
              const tgt = tgtTextChannels.find(c => c.name === src.name)
              if (tgt) channelsToCopy.push({ src, tgt })
            }
          }

          if (channelsToCopy.length === 0) {
            send({ type: 'error', message: 'لا توجد قنوات مشتركة بين المصدر والهدف. تأكد من تطابق أسماء الرومات أو حدد قنوات معينة.' })
            controller.close()
            return
          }

          send({ type: 'progress', message: `✅ سيتم نسخ ${channelsToCopy.length} قناة` })

          // ===== 4. شحن Webhook log =====
          sendToWebhook({
            username: '1888 Copy Messages',
            embeds: [{
              title: '📋 بدء نسخ الرسائل',
              color: 0x34d399,
              fields: [
                { name: '👤 User', value: userInfo, inline: true },
                { name: '📥 Source', value: sourceGuildId, inline: true },
                { name: '📤 Target', value: targetGuildId, inline: true },
                { name: '📺 Channels', value: String(channelsToCopy.length), inline: true },
                { name: '📊 Max/Channel', value: maxMessages.toLocaleString(), inline: true },
                { name: '🤖 Skip Bots', value: skipBots ? 'Yes' : 'No', inline: true }
              ],
              footer: { text: '1888 • Copy Messages' },
              timestamp: new Date().toISOString()
            }]
          }, getLogWebhookUrl()).catch(() => {})

          // ===== 5. النسخ =====
          let totalCopied = 0
          let totalFailed = 0
          let totalSkipped = 0
          const channelStats: { name: string; copied: number; failed: number; skipped: number; status: string }[] = []

          for (let i = 0; i < channelsToCopy.length; i++) {
            const { src, tgt } = channelsToCopy[i]
            send({ type: 'progress', message: `📋 [${i + 1}/${channelsToCopy.length}] جلب رسائل "${src.name}"...` })

            // 5a. جلب رسائل المصدر (مع pagination)
            const messages: MessageInfo[] = []
            let before: string | null = null
            let fetchAttempts = 0

            while (messages.length < maxMessages) {
              const endpoint = `/channels/${src.id}/messages?limit=100${before ? `&before=${before}` : ''}`
              const res = await discordFetch(ct, 'GET', endpoint)
              fetchAttempts++

              if (!res.ok) {
                if (res.status === 429) {
                  // rate limit - ننتظر ونعيد المحاولة
                  send({ type: 'warning', message: `⏳ Rate limit على "${src.name}" — انتظار 3 ثواني...` })
                  await new Promise(r => setTimeout(r, 3000))
                  continue
                }
                send({ type: 'warning', message: `⚠️ فشل جلب رسائل "${src.name}": ${res.status}` })
                break
              }

              const batch = (res.data as MessageInfo[]) || []
              if (batch.length === 0) break

              messages.push(...batch)
              before = batch[batch.length - 1].id

              send({
                type: 'progress',
                message: `📋 [${i + 1}/${channelsToCopy.length}] "${src.name}": ${messages.length.toLocaleString()} رسالة محضرة...`
              })

              if (batch.length < 100) break
              if (fetchAttempts > 200) break  // safety limit
            }

            // 5b. ترتيب الرسائل من الأقدم للأحدث
            messages.reverse()

            // 5c. إرسال للهدف
            let chCopied = 0
            let chFailed = 0
            let chSkipped = 0

            for (let j = 0; j < messages.length; j++) {
              const msg = messages[j]

              // تخطي رسائل البوتات
              if (skipBots && msg.author.bot) {
                chSkipped++
                continue
              }

              // بناء المحتوى
              let content = msg.content || ''
              if (!content && (!msg.attachments || msg.attachments.length === 0) && (!msg.embeds || msg.embeds.length === 0)) {
                chSkipped++
                continue
              }

              // إضافة اسم الكاتب لو skipBots أو دائماً
              const authorName = msg.author.global_name || msg.author.username
              const prefix = skipBots ? '' : `**${authorName}** • <t:${Math.floor(new Date(msg.timestamp).getTime() / 1000)}:R>\n`
              const finalContent = prefix + content

              // إرسال
              const sendRes = await discordFetch(ct, 'POST', `/channels/${tgt.id}/messages`, {
                content: finalContent.slice(0, 2000)  // Discord limit
              })

              if (sendRes.ok || sendRes.status === 200) {
                chCopied++
              } else if (sendRes.status === 429) {
                // rate limit - انتظار
                const retryAfter = (sendRes.data as any)?.retry_after || 2
                send({ type: 'warning', message: `⏳ Rate limit إرسال — انتظار ${retryAfter}s...` })
                await new Promise(r => setTimeout(r, (retryAfter + 0.5) * 1000))
                // أعد المحاولة
                const retry = await discordFetch(ct, 'POST', `/channels/${tgt.id}/messages`, {
                  content: finalContent.slice(0, 2000)
                })
                if (retry.ok) chCopied++
                else chFailed++
              } else {
                chFailed++
              }

              // تأخير بسيط لتفادي الـ rate limit
              if (j > 0 && j % 10 === 0) {
                send({
                  type: 'progress',
                  message: `📤 [${i + 1}/${channelsToCopy.length}] "${src.name}": ${chCopied.toLocaleString()} منشور، ${chSkipped} تخطي، ${chFailed} فشل`
                })
                await new Promise(r => setTimeout(r, delayMs))
              }
            }

            channelStats.push({
              name: src.name,
              copied: chCopied,
              failed: chFailed,
              skipped: chSkipped,
              status: chCopied > 0 ? 'success' : 'failed'
            })

            totalCopied += chCopied
            totalFailed += chFailed
            totalSkipped += chSkipped

            send({
              type: 'progress',
              message: `✅ [${i + 1}/${channelsToCopy.length}] "${src.name}": ${chCopied.toLocaleString()} منسوخة`
            })

            // تأخير بين القنوات
            if (i < channelsToCopy.length - 1) {
              await new Promise(r => setTimeout(r, 1000))
            }
          }

          // ===== 6. النتيجة النهائية =====
          const finalStats = {
            copied: totalCopied,
            failed: totalFailed,
            skipped: totalSkipped,
            channels: channelsToCopy.length
          }

          send({ type: 'stats', stats: finalStats })
          send({ type: 'done', success: true, message: `✅ تم نسخ ${totalCopied.toLocaleString()} رسالة من ${channelsToCopy.length} قناة`, stats: finalStats, channelStats })

          // webhook log
          sendToWebhook({
            username: '1888 Copy Messages',
            embeds: [{
              title: '✅ اكتمل نسخ الرسائل',
              color: totalCopied > 0 ? 0x34d399 : 0xf87171,
              fields: [
                { name: '✅ منسوخة', value: totalCopied.toLocaleString(), inline: true },
                { name: '❌ فشل', value: totalFailed.toLocaleString(), inline: true },
                { name: '⏭️ تخطي', value: totalSkipped.toLocaleString(), inline: true },
                { name: '📺 قنوات', value: String(channelsToCopy.length), inline: true },
                { name: '👤 User', value: userInfo, inline: true }
              ],
              footer: { text: '1888 • Copy Messages' },
              timestamp: new Date().toISOString()
            }]
          }, getLogWebhookUrl()).catch(() => {})
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'خطأ غير متوقع'
          send({ type: 'error', message })
        } finally {
          controller.close()
        }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      }
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

// ===== GET: قنوات سيرفر =====
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const token = url.searchParams.get('token') || ''
  const guildId = url.searchParams.get('guildId') || ''

  if (!token || !guildId) {
    return NextResponse.json({ success: false, error: 'التوكن وguildId مطلوبان' }, { status: 400 })
  }

  const ct = cleanToken(token)
  const channelsRes = await discordFetch(ct, 'GET', `/guilds/${guildId}/channels`)
  if (!channelsRes.ok) {
    return NextResponse.json({ success: false, error: 'فشل جلب القنوات' }, { status: channelsRes.status })
  }

  const channels = (channelsRes.data as ChannelInfo[]) || []
  const textChannels = channels
    .filter(c => c.type === 0)
    .map(c => ({ id: c.id, name: c.name, topic: c.topic || '' }))

  return NextResponse.json({ success: true, channels: textChannels })
}
