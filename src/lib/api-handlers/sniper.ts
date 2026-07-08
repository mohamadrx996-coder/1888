import { NextRequest, NextResponse } from 'next/server'
import { cleanToken, DISCORD_API } from '@/lib/discord'
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { stringToBase64 } from '@/lib/edge-utils'

/* ===== 1888 Sniper Check - Cloudflare Compatible =====
 * يستخدم PATCH /users/@me فقط (pomelo-attempt مقيد من Discord - code 40333)
 * - بدون AbortSignal.timeout (يسبب قطع في Cloudflare)
 * - معالجة responses الفارغة (internal network error)
 * - يعمل بشكل موثوق على Cloudflare Workers
 */

export const runtime = 'edge'

// Headers مثل ديسكورد الأصلي
const SUPER_PROPERTIES = stringToBase64(JSON.stringify({
  os: "Windows",
  browser: "Discord Client",
  release_channel: "stable",
  client_version: "1.0.9032",
  os_version: "10.0.22631",
  os_arch: "x64",
  system_locale: "en-US",
  client_build_number: 345678,
  client_event_source: null,
}))

function dHeaders(token: string): Record<string, string> {
  return {
    'Authorization': token,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'X-Super-Properties': SUPER_PROPERTIES,
    'X-Discord-Locale': 'en-US',
    'Origin': 'https://discord.com',
    'Referer': 'https://discord.com/channels/@me',
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

// ===== فحص يوزر عبر PATCH /users/@me =====
// password فارغ يمنع التغيير الفعلي لكن يخبرنا بحالة اليوزر
async function checkUsername(token: string, username: string): Promise<CheckResult> {
  let res: Response
  try {
    res = await fetch(`${DISCORD_API}/users/@me`, {
      method: 'PATCH',
      headers: dHeaders(token),
      body: JSON.stringify({ username, password: '' }),
    })
  } catch {
    // فشل الـ fetch (Cloudflare قطع الاتصال)
    return { username, status: '⚠️ internal network error', color: 'yellow', method: 'PATCH', debug: 'fetch failed (cloudflare)' }
  }

  // response فارغ
  if (!res) {
    return { username, status: '⚠️ internal network error', color: 'yellow', method: 'PATCH', debug: 'empty response' }
  }

  // Rate limit
  if (res.status === 429) {
    return { username, status: '⏳ Rate Limit', color: 'yellow', rateLimited: true, method: 'PATCH', debug: 'HTTP 429' }
  }

  // توكن غير صالح
  if (res.status === 401) {
    return { username, status: '❌ توكن غير صالح', color: 'red', method: 'PATCH', debug: 'HTTP 401' }
  }

  // اقرأ الـ response كـ text
  let text = ''
  try {
    text = await res.text()
  } catch {
    return { username, status: '⚠️ internal network error', color: 'yellow', method: 'PATCH', debug: 'text() failed' }
  }

  // response فارغ (Cloudflare قطع)
  if (!text || text.length === 0) {
    return { username, status: '⚠️ internal network error', color: 'yellow', method: 'PATCH', debug: 'empty body' }
  }

  // parse JSON
  let data: any = null
  try {
    data = JSON.parse(text)
  } catch {
    return { username, status: `❓ HTTP ${res.status}`, color: 'yellow', method: 'PATCH', debug: `non-JSON: ${text.substring(0, 80)}` }
  }

  // 200 = تم التغيير (متاح)
  if (res.ok && data) {
    return {
      username,
      status: '✅ متاح! (تم التغيير)',
      color: 'green',
      taken: false,
      method: 'PATCH',
      debug: `HTTP 200 — username=${data.username}`,
    }
  }

  // 400/422 — نقرأ الأخطاء
  if (data) {
    const code = data.code
    const message = data.message || ''

    // 50033 = USERNAME_TAKEN
    if (code === 50033) {
      return { username, status: '❌ محجوز', color: 'red', taken: true, method: 'PATCH', debug: 'code=50033 USERNAME_TAKEN' }
    }

    // أخطاء اليوزر
    const usernameErrors = data.errors?.username?._errors || []
    if (usernameErrors.length > 0) {
      const first = usernameErrors[0]
      const ec = (first.code || '').toUpperCase()
      const em = (first.message || '').toLowerCase()
      if (ec.includes('TAKEN') || em.includes('taken') || em.includes('already') || em.includes('in use') || em.includes('someone')) {
        return { username, status: '❌ محجوز', color: 'red', taken: true, method: 'PATCH', debug: `username: ${first.code}` }
      }
      if (ec.includes('TOO_SHORT') || ec.includes('TOO_LONG') || ec.includes('INVALID') || ec.includes('ONLY') || em.includes('between') || em.includes('invalid') || em.includes('reserved') || em.includes('profane') || em.includes('alphanumeric') || em.includes('default')) {
        return { username, status: '❌ غير صالح', color: 'red', method: 'PATCH', debug: `username: ${first.code}` }
      }
      return { username, status: `⚠️ ${first.message || first.code}`, color: 'yellow', method: 'PATCH', debug: `username: ${first.code}` }
    }

    // أخطاء الباسورد — يعني اليوزر متاح لكن يحتاج password للتغيير
    const passwordErrors = data.errors?.password?._errors || []
    if (passwordErrors.length > 0) {
      const first = passwordErrors[0]
      const ec = (first.code || '').toUpperCase()
      const em = (first.message || '').toLowerCase()
      if (ec.includes('REQUIRED') || em.includes('required') || em.includes('password')) {
        return { username, status: '✅ متاح!', color: 'green', taken: false, method: 'PATCH', debug: 'password required → available' }
      }
      return { username, status: '⚠️ يحتاج password', color: 'yellow', method: 'PATCH', debug: `password: ${first.code}` }
    }

    // 50035 = INVALID_FORM_BODY
    if (code === 50035) {
      return { username, status: `⚠️ ${message || 'خطأ في الصيغة'}`, color: 'yellow', method: 'PATCH', debug: `code=50035 ${message}` }
    }

    // أخطاء عامة
    const msgL = message.toLowerCase()
    if (msgL.includes('taken') || msgL.includes('already')) {
      return { username, status: '❌ محجوز', color: 'red', taken: true, method: 'PATCH', debug: `msg: ${message}` }
    }
    return { username, status: `⚠️ ${message || 'خطأ ' + res.status}`, color: 'yellow', method: 'PATCH', debug: `HTTP ${res.status} code=${code}` }
  }

  return { username, status: `❓ HTTP ${res.status}`, color: 'yellow', method: 'PATCH', debug: `HTTP ${res.status} body=${text.substring(0, 80)}` }
}

export async function POST(request: NextRequest) {
  const rlIp = getClientIp(request)
  const rl = rateLimit(`${rlIp}:sniper-check`, RATE_LIMITS.light)
  if (rl.limited) {
    return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - انتظر قليلاً', rateLimited: true }, { status: 429 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const { token, username } = body

    if (!token) {
      return NextResponse.json({ success: false, error: 'التوكن مطلوب' }, { status: 400 })
    }
    if (!username) {
      return NextResponse.json({ success: false, error: 'اليوزر مطلوب' }, { status: 400 })
    }

    const ct = cleanToken(token)

    const cleanUsername = String(username).trim().toLowerCase().replace(/[^a-z0-9._]/g, '')
    if (!cleanUsername || cleanUsername.length < 2 || cleanUsername.length > 32) {
      return NextResponse.json({ success: false, error: 'اليوزر غير صالح (2-32 حرف)' }, { status: 400 })
    }

    const result = await checkUsername(ct, cleanUsername)

    return NextResponse.json({ success: true, result })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
