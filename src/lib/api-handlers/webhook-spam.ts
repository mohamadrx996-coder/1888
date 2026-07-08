import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'

/* ===== 1888 Webhook Spammer Pro =====
 * ميزة قوية: سبام عدة ويب هوكات بالتوازي
 * - بدون توكن (يستخدم روابط الويب هوك مباشرة)
 * - يدعم عدة ويب هوكات بنفس الوقت
 * - يسبام لمدة محددة بالثواني
 * - يقدر يرسل: نص + embed + اسم مستخدم + أفتار
 */

export const runtime = 'nodejs'
export const maxDuration = 300

interface WebhookPayload {
  content?: string
  username?: string
  avatar_url?: string
  embeds?: any[]
}

interface SendResult {
  webhookIndex: number
  success: boolean
  error?: string
}

// إرسال لويب هوك واحد
async function sendToWebhook(url: string, payload: WebhookPayload, timeoutMs = 10000): Promise<{ ok: boolean; retryAfter: number; status: number }> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    })
    clearTimeout(id)

    if (res.status === 429) {
      try {
        const err = await res.json()
        return { ok: false, retryAfter: (err.retry_after || 1) * 1000, status: 429 }
      } catch {
        return { ok: false, retryAfter: 1000, status: 429 }
      }
    }

    if (res.status === 204 || res.ok) {
      return { ok: true, retryAfter: 0, status: res.status }
    }

    return { ok: false, retryAfter: 0, status: res.status }
  } catch {
    clearTimeout(id)
    return { ok: false, retryAfter: 0, status: 0 }
  }
}

export async function POST(request: NextRequest) {
  const rlIp = getClientIp(request)
  const rl = rateLimit(`${rlIp}:webhook-spam`, RATE_LIMITS.medium)
  if (rl.limited) {
    return NextResponse.json({
      success: false,
      error: rl.cooldownActive ? 'تم تفعيل فترة تهدئة - انتظر قليلاً' : 'تم تجاوز الحد المسموح'
    }, {
      status: 429,
      headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) }
    })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const {
      webhooks,  // array of URLs أو string مفصول بأسطر
      message,
      username,
      avatarUrl,
      durationSeconds,  // مدة السبام بالثواني
      delayMs,  // تأخير بين الإرسال
      parallel,  // إرسال بالتوازي
      embed  // embed object (اختياري)
    } = body

    // ===== Validation =====
    if (!webhooks) return NextResponse.json({ success: false, error: 'روابط الويب هوك مطلوبة' }, { status: 400 })
    if (!message && !embed) return NextResponse.json({ success: false, error: 'الرسالة أو الـ embed مطلوب' }, { status: 400 })

    // تحويل webhooks لمصفوفة
    let webhookList: string[]
    if (Array.isArray(webhooks)) {
      webhookList = webhooks
    } else {
      webhookList = String(webhooks).split(/[\n,]/).map(w => w.trim()).filter(w => w.startsWith('http'))
    }

    if (webhookList.length === 0) {
      return NextResponse.json({ success: false, error: 'لا توجد روابط ويب هوك صالحة' }, { status: 400 })
    }
    if (webhookList.length > 20) {
      return NextResponse.json({ success: false, error: 'حد أقصى 20 ويب هوك' }, { status: 400 })
    }

    const duration = Math.min(Math.max(Number(durationSeconds) || 60, 5), 300)  // 5 ثواني إلى 5 دقائق
    const delay = Math.max(Number(delayMs) || 500, 200)  // حد أدنى 200ms
    const useParallel = parallel !== false  // default true

    // ===== Payload =====
    const payload: WebhookPayload = {}
    if (message) payload.content = String(message).slice(0, 2000)
    if (username) payload.username = String(username).slice(0, 80)
    if (avatarUrl) payload.avatar_url = String(avatarUrl)
    if (embed && typeof embed === 'object') {
      payload.embeds = [embed]
    }

    // ===== Execute =====
    const startTime = Date.now()
    const endTime = startTime + (duration * 1000)
    let totalSent = 0
    let totalFailed = 0
    const webhookStats: { url: string; sent: number; failed: number; status: string }[] = webhookList.map(url => ({
      url: url.substring(0, 50) + '...',
      sent: 0,
      failed: 0,
      status: 'active'
    }))

    const logs: string[] = [`🚀 بدء السبام على ${webhookList.length} ويب هوك لمدة ${duration} ثانية`]

    // دالة إرسال لكل الويب هوكات (متوازية أو متتابعة)
    const sendRound = async (): Promise<void> => {
      if (useParallel) {
        // إرسال بالتوازي
        const promises = webhookList.map(async (url, idx) => {
          if (webhookStats[idx].status === 'dead') return
          const result = await sendToWebhook(url, payload)
          if (result.ok) {
            webhookStats[idx].sent++
            totalSent++
          } else {
            webhookStats[idx].failed++
            totalFailed++
            // لو الويب هوك ميت (404 أو 401)، علّمه كميت
            if (result.status === 404 || result.status === 401 || result.status === 403) {
              webhookStats[idx].status = 'dead'
              logs.push(`💀 ويب هوك ${idx + 1} ميت (${result.status})`)
            }
            // لو rate limit، انتظر
            if (result.retryAfter > 0) {
              await new Promise(r => setTimeout(r, result.retryAfter))
            }
          }
        })
        await Promise.allSettled(promises)
      } else {
        // إرسال متتابع
        for (let idx = 0; idx < webhookList.length; idx++) {
          if (webhookStats[idx].status === 'dead') continue
          if (Date.now() >= endTime) break
          const result = await sendToWebhook(webhookList[idx], payload)
          if (result.ok) {
            webhookStats[idx].sent++
            totalSent++
          } else {
            webhookStats[idx].failed++
            totalFailed++
            if (result.status === 404 || result.status === 401 || result.status === 403) {
              webhookStats[idx].status = 'dead'
              logs.push(`💀 ويب هوك ${idx + 1} ميت (${result.status})`)
            }
            if (result.retryAfter > 0) {
              await new Promise(r => setTimeout(r, result.retryAfter))
            }
          }
        }
      }
    }

    // حلقة السبام الرئيسية
    let roundCount = 0
    while (Date.now() < endTime) {
      await sendRound()
      roundCount++

      // إحصائيات دورية
      if (roundCount % 10 === 0) {
        const remaining = Math.ceil((endTime - Date.now()) / 1000)
        logs.push(`📊 جولة ${roundCount} — أرسل: ${totalSent}, فشل: ${totalFailed}, متبقي: ${remaining}ث`)
      }

      // تأخير بين الجولات
      if (Date.now() < endTime) {
        await new Promise(r => setTimeout(r, delay))
      }
    }

    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1)
    logs.push(`✅ اكتمل! ${roundCount} جولة في ${elapsedSeconds} ثانية`)
    logs.push(`📊 إجمالي: ${totalSent} مرسل، ${totalFailed} فشل`)

    return NextResponse.json({
      success: true,
      stats: {
        sent: totalSent,
        failed: totalFailed,
        rounds: roundCount,
        duration: Number(elapsedSeconds),
        webhooks: webhookList.length,
        activeWebhooks: webhookStats.filter(w => w.status === 'active').length,
        deadWebhooks: webhookStats.filter(w => w.status === 'dead').length
      },
      webhookStats,
      logs
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    feature: '1888 Webhook Spammer Pro',
    capabilities: [
      'سبام بدون توكن (يستخدم روابط الويب هوك)',
      'يدعم حتى 20 ويب هوك بنفس الوقت',
      'مدة قابلة للتعديل (5 ثواني - 5 دقائق)',
      'إرسال بالتوازي أو متتابع',
      'كشف الويب هوكات الميتة تلقائياً',
      'يدعم: نص + embed + username + avatar'
    ]
  })
}
