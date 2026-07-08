import { NextRequest, NextResponse } from 'next/server'
import { cleanToken } from '@/lib/discord'
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'

/* ===== 1888 Sniper Check - Cloudflare Resilient =====
 * يحل مشكلة "internal network error" على Cloudflare:
 * 1. استخدام endpoint /users/{username}/profile?type=user_decoration (لا يحتاج auth أحياناً)
 * 2. إعادة المحاولة 3 مرات عند الفشل
 * 3. تأخير تصاعدي بين المحاولات
 * 4. بدون AbortSignal (يسبب قطع في Cloudflare)
 */

export const runtime = 'edge'

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
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

// ===== fetch مع إعادة المحاولة =====
async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, options)
      if (res) return res
    } catch {
      // انتظر قبل إعادة المحاولة (تصاعدي: 500ms, 1000ms, 2000ms)
      if (attempt < maxRetries - 1) {
        await sleep(500 * Math.pow(2, attempt))
      }
    }
  }
  return null
}

// ===== الطريقة 1: GET /users/{username}/profile =====
// آمن — لا يغير شيئاً
// 200 = الحساب موجود = محجوز
// 404 = الحساب غير موجود = متاح
async function checkUserProfile(token: string, username: string): Promise<CheckResult | null> {
  const res = await fetchWithRetry(
    `https://discord.com/api/v10/users/${username}/profile`,
    {
      headers: {
        'Authorization': token,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'X-Discord-Locale': 'en-US',
      },
    }
  )

  if (!res) return null

  if (res.status === 429) {
    return { username, status: '⏳ Rate Limit', color: 'yellow', rateLimited: true, method: 'profile', debug: 'HTTP 429' }
  }
  if (res.status === 401) {
    return { username, status: '❌ توكن غير صالح', color: 'red', method: 'profile', debug: 'HTTP 401' }
  }
  if (res.status === 403) {
    // endpoint مقيد → ننتقل للطريقة التالية
    return null
  }

  // 200 = الحساب موجود = محجوز
  if (res.ok) {
    let data: any = null
    try {
      const text = await res.text()
      if (text) data = JSON.parse(text)
    } catch {}
    return {
      username,
      status: '❌ محجوز',
      color: 'red',
      taken: true,
      method: 'profile',
      debug: `HTTP 200 id=${data?.id || '?'}`,
    }
  }

  // 404 = الحساب غير موجود = متاح
  if (res.status === 404) {
    return {
      username,
      status: '✅ متاح!',
      color: 'green',
      taken: false,
      method: 'profile',
      debug: 'HTTP 404',
    }
  }

  return null
}

// ===== الطريقة 2: PATCH /users/@me (احتياطي) =====
async function checkPatchUser(token: string, username: string): Promise<CheckResult | null> {
  const res = await fetchWithRetry(
    'https://discord.com/api/v10/users/@me',
    {
      method: 'PATCH',
      headers: {
        'Authorization': token,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'X-Discord-Locale': 'en-US',
        'Origin': 'https://discord.com',
        'Referer': 'https://discord.com/channels/@me',
      },
      body: JSON.stringify({ username, password: '' }),
    }
  )

  if (!res) return null

  if (res.status === 429) {
    return { username, status: '⏳ Rate Limit', color: 'yellow', rateLimited: true, method: 'PATCH', debug: 'HTTP 429' }
  }
  if (res.status === 401) {
    return { username, status: '❌ توكن غير صالح', color: 'red', method: 'PATCH', debug: 'HTTP 401' }
  }

  let text = ''
  try {
    text = await res.text()
  } catch {
    return null
  }

  if (!text) return null

  let data: any = null
  try { data = JSON.parse(text) } catch { return null }

  // 200 = تم التغيير (متاح)
  if (res.ok && data) {
    return {
      username,
      status: '✅ متاح! (تم التغيير)',
      color: 'green',
      taken: false,
      method: 'PATCH',
      debug: `HTTP 200`,
    }
  }

  if (data) {
    const code = data.code
    if (code === 50033) {
      return { username, status: '❌ محجوز', color: 'red', taken: true, method: 'PATCH', debug: 'code=50033' }
    }

    const usernameErrors = data.errors?.username?._errors || []
    if (usernameErrors.length > 0) {
      const first = usernameErrors[0]
      const ec = (first.code || '').toUpperCase()
      const em = (first.message || '').toLowerCase()
      if (ec.includes('TAKEN') || em.includes('taken') || em.includes('already') || em.includes('in use')) {
        return { username, status: '❌ محجوز', color: 'red', taken: true, method: 'PATCH', debug: `username: ${first.code}` }
      }
      if (ec.includes('TOO_SHORT') || ec.includes('TOO_LONG') || ec.includes('INVALID') || em.includes('invalid') || em.includes('reserved') || em.includes('profane')) {
        return { username, status: '❌ غير صالح', color: 'red', method: 'PATCH', debug: `username: ${first.code}` }
      }
    }
  }

  return null
}

// ===== فحص شامل مع إعادة المحاولة =====
async function checkUsername(token: string, username: string): Promise<CheckResult> {
  // الطريقة 1: GET /users/{username}/profile (الأكثر موثوقية)
  const r1 = await checkUserProfile(token, username)
  if (r1) return r1

  // الطريقة 2: PATCH /users/@me (احتياطي)
  const r2 = await checkPatchUser(token, username)
  if (r2) return r2

  // فشلت كل الطرق
  return { username, status: '⚠️ internal network error', color: 'yellow', method: 'all', debug: 'all methods failed' }
}

export async function POST(request: NextRequest) {
  const rlIp = getClientIp(request)
  const rl = rateLimit(`${rlIp}:sniper-check`, RATE_LIMITS.light)
  if (rl.limited) {
    return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - انتظر قليلاً', rateLimited: true }, { status: 429 })
  }

  try {
    // قراءة body بأمان
    let body: any = {}
    try {
      const text = await request.text()
      if (text && text.length > 0) {
        body = JSON.parse(text)
      }
    } catch {
      try {
        const formData = await request.formData()
        body = {
          token: formData.get('token'),
          username: formData.get('username')
        }
      } catch { body = {} }
    }

    const { token, username } = body as { token?: string; username?: string }

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
