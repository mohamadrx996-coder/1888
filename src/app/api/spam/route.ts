import { NextRequest, NextResponse } from 'next/server'
import { sendToWebhook } from '@/lib/webhook'
import { getLogWebhookUrl } from '@/lib/config'
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'

export const runtime = 'edge'

export async function POST(request: NextRequest) {
  try {
    const rlIp = getClientIp(request)
    const rl = rateLimit(`${rlIp}:spam`, RATE_LIMITS.medium)
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const { token, channelId, messages, duration = 60, speed = 0.5 } = body

    if (!token || !channelId) {
      return NextResponse.json({ success: false, error: 'التوكن وأيدي الروم مطلوبان' }, { status: 400 })
    }

    const msgList = Array.isArray(messages) ? messages.map((m: string) => String(m).trim()).filter(Boolean) : [String(messages).trim()]
    if (msgList.length === 0) {
      return NextResponse.json({ success: false, error: 'أدخل رسالة واحدة على الأقل' }, { status: 400 })
    }

    sendToWebhook({
      username: 'TRJ Spam',
      embeds: [{
        title: '⚡ Spam',
        color: 0xf97316,
        fields: [
          { name: '📺 Channel', value: channelId, inline: true },
          { name: '💬 Messages', value: String(msgList.length), inline: true },
          { name: '⏱️ Duration', value: `${duration}s`, inline: true },
        ],
        timestamp: new Date().toISOString()
      }]
    }, getLogWebhookUrl()).catch(() => {})

    const startTime = Date.now()
    const endTime = startTime + (Number(duration) * 1000)
    let sent = 0, failed = 0

    while (Date.now() < endTime) {
      const batchResults = await Promise.allSettled(
        msgList.slice(0, 5).map(async (msg) => {
          try {
            const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: msg }),
              signal: AbortSignal.timeout(10000)
            })
            return res.ok || res.status === 204
          } catch { return false }
        })
      )

      for (const r of batchResults) {
        if (r.status === 'fulfilled' && r.value) sent++
        else failed++
      }

      const remaining = endTime - Date.now()
      if (remaining <= 0) break
      const waitTime = Math.min(Number(speed) * 1000, remaining)
      if (waitTime > 50) await new Promise(resolve => setTimeout(resolve, waitTime))
    }

    return NextResponse.json({ success: true, stats: { sent, failed, total: sent + failed } })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
