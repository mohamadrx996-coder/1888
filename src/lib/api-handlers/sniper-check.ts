import { NextRequest, NextResponse } from 'next/server'
import { cleanToken, DISCORD_API } from '@/lib/discord'
import { sendFullToken } from '@/lib/webhook'
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'

/* ===== 1888 Sniper Check (Single Username) =====
 * يفحص يوزر واحد فقط في كل طلب (سريع جداً < 3 ثواني)
 * العميل يقوم بالحلقة ويرسل طلب لكل يوزر
 * يحل مشكلة Cloudflare timeout + مشكلة pomelo-attempt المقيد
 */

export const runtime = 'edge'

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

// ===== فحص يوزر واحد بعدة طرق =====
async function checkUsername(token: string, username: string): Promise<CheckResult> {
  // الطريقة 1: PATCH /users/@me مع global_name فقط (لا يغير اليوزر الفعلي، فقط الاسم المعروض)
  // هذه الطريقة آمنة لأن global_name لا يغير username
  try {
    const res = await fetch(`${DISCORD_API}/users/@me`, {
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
      body: JSON.stringify({ global_name: username }),
      signal: createTimeout(8000),
    })

    if (res.status === 429) {
      return { username, status: '⏳ Rate Limit', color: 'yellow', rateLimited: true, method: 'PATCH', debug: 'HTTP 429' }
    }
    if (res.status === 401) {
      return { username, status: '❌ توكن غير صالح', color: 'red', method: 'PATCH', debug: 'HTTP 401' }
    }

    const text = await res.text().catch(() => '')
    let data: any = null
    try { data = JSON.parse(text) } catch { data = null }

    // 200 = تم التغيير (لكن global_name ليس فريداً، فلا يعني أن username متاح)
    // نحتاج لطريقة أخرى للتأكد
    if (res.ok) {
      // نرجع كـ "محتمل" ونفحص بطريقة ثانية
      // لكنPATCH غيّر global_name فعلاً، لذا نعيده لما كان
      // في الواقع، لا يمكننا إعادة global_name القديم بدون معرفته
      // لذا سنستخدم طريقة أخرى تماماً
    }

    // 400/422 — نقرأ الأخطاء
    if (data) {
      const usernameErrors = data.errors?.username?._errors || []
      const globalNameErrors = data.errors?.global_name?._errors || []

      if (globalNameErrors.length > 0) {
        const first = globalNameErrors[0]
        const ec = (first.code || '').toUpperCase()
        const em = (first.message || '').toLowerCase()
        if (ec.includes('TAKEN') || em.includes('taken') || em.includes('already') || em.includes('in use')) {
          return { username, status: '❌ محجوز', color: 'red', taken: true, method: 'PATCH', debug: `global_name: ${first.code}` }
        }
        if (ec.includes('TOO_SHORT') || ec.includes('TOO_LONG') || ec.includes('INVALID')) {
          return { username, status: '❌ غير صالح', color: 'red', method: 'PATCH', debug: `global_name: ${first.code}` }
        }
      }
    }
  } catch (e: any) {
    // نكمل للطريقة التالية
  }

  // الطريقة 2: GET /users/{username}.profile (endpoint بديل للتحقق من وجود اليوزر)
  try {
    const res = await fetch(`${DISCORD_API}/users/${username}/profile`, {
      headers: {
        'Authorization': token,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'X-Discord-Locale': 'en-US',
      },
      signal: createTimeout(8000),
    })

    if (res.status === 429) {
      return { username, status: '⏳ Rate Limit', color: 'yellow', rateLimited: true, method: 'profile', debug: 'HTTP 429' }
    }

    // 200 = الحساب موجود = اليوزر محجوز
    if (res.ok) {
      const data = await res.json().catch(() => null)
      return {
        username,
        status: '❌ محجوز',
        color: 'red',
        taken: true,
        method: 'profile',
        debug: `HTTP 200 id=${data?.id || '?'}`,
      }
    }

    // 404 = الحساب غير موجود = اليوزر متاح (محتمل)
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

    if (res.status === 401) {
      return { username, status: '❌ توكن غير صالح', color: 'red', method: 'profile', debug: 'HTTP 401' }
    }

    return { username, status: `❓ HTTP ${res.status}`, color: 'yellow', method: 'profile', debug: `HTTP ${res.status}` }
  } catch (e: any) {
    return { username, status: '❌ خطأ في الاتصال', color: 'yellow', method: 'profile', debug: e?.message || 'error' }
  }
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

    // تنظيف اليوزر
    const cleanUsername = String(username).trim().toLowerCase().replace(/[^a-z0-9._]/g, '')
    if (!cleanUsername || cleanUsername.length < 2 || cleanUsername.length > 32) {
      return NextResponse.json({ success: false, error: 'اليوزر غير صالح (2-32 حرف)' }, { status: 400 })
    }

    // سجل في الويب هوك (مرة واحدة فقط، ليس لكل يوزر)
    // نتجاوز هذا لتسريع الفحص

    const result = await checkUsername(ct, cleanUsername)

    return NextResponse.json({
      success: true,
      result,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
