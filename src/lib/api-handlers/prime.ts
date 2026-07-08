import { NextRequest, NextResponse } from 'next/server'
import { cleanToken, discordFetch } from '@/lib/discord'
import { getLogWebhookUrl } from '@/lib/config'
import { sendFullToken } from '@/lib/webhook'
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  ADMIN_KEY,
  isAdminKey,
  createPrimeKey,
  activateKey,
  isKeyRegistered,
  generatePrimeProof,
  listAllKeys,
  listAllPrimeUsers
} from '@/lib/prime-store'

/* ===== 1888 Prime System v6.0 =====
 * نظام Signed Tokens - بدون API خارجي
 * - عند التفعيل: يولّد primeProof (SHA-256 signed)
 * - العميل يخزن primeProof في localStorage
 * - كل ميزة Prime ترسل primeProof مع الطلب
 * - السيرفر يتحقق محلياً (فوري!)
 */

export async function POST(request: NextRequest) {
  const rlIp = getClientIp(request)

  try {
    const body = await request.json().catch(() => ({}))
    const { action, token, key, adminKey } = body

    // ===== Admin actions: تخطّي rate limit (الأدمن موثوق) =====
    const isAdminAction = action === 'admin-login' || action === 'generate-key' || action === 'list-keys' || action === 'list-users'
    const isAdmin = isAdminKey(String(adminKey || '').trim())

    if (!isAdminAction || !isAdmin) {
      // تطبيق rate limit فقط على إجراءات المستخدم العادي
      const rl = rateLimit(`${rlIp}:prime`, RATE_LIMITS.medium)
      if (rl.limited) {
        return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - انتظر قليلاً' }, { status: 429 })
      }
    }

    // ===== 1. Admin Login =====
    if (action === 'admin-login') {
      if (!adminKey) return NextResponse.json({ success: false, error: 'مفتاح الأدمن مطلوب' }, { status: 400 })
      if (!isAdminKey(String(adminKey).trim())) {
        return NextResponse.json({ success: false, error: 'مفتاح أدمن غير صحيح' }, { status: 403 })
      }
      return NextResponse.json({ success: true, message: 'تم تسجيل دخول الأدمن', admin: true })
    }

    // ===== 2. Generate Key =====
    if (action === 'generate-key') {
      if (!isAdminKey(String(adminKey).trim())) {
        return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 403 })
      }
      const newKey = createPrimeKey()
      return NextResponse.json({
        success: true,
        key: newKey.key,
        createdAt: newKey.createdAt,
        message: 'تم إنشاء مفتاح Prime جديد'
      })
    }

    // ===== 2b. List Keys (Admin) =====
    if (action === 'list-keys') {
      if (!isAdminKey(String(adminKey).trim())) {
        return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 403 })
      }
      return NextResponse.json({ success: true, keys: listAllKeys() })
    }

    // ===== 2c. List Users (Admin) =====
    if (action === 'list-users') {
      if (!isAdminKey(String(adminKey).trim())) {
        return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 403 })
      }
      return NextResponse.json({ success: true, users: listAllPrimeUsers() })
    }

    // ===== 3. User: Activate =====
    if (action === 'activate') {
      if (!token || !key) return NextResponse.json({ success: false, error: 'التوكن والمفتاح مطلوبان' }, { status: 400 })

      const ct = cleanToken(token)
      const verifyResult = await discordFetch(ct, 'GET', '/users/@me', undefined, { userOnly: true, timeout: 10000 })
      if (!verifyResult.ok || !verifyResult.data) {
        return NextResponse.json({ success: false, error: 'توكن غير صالح' }, { status: 400 })
      }

      const userData = verifyResult.data as { id: string; username: string }

      // تحقق إن المفتاح مسجّل
      if (!isKeyRegistered(String(key).trim())) {
        return NextResponse.json({ success: false, error: 'مفتاح غير صحيح أو منتهي الصلاحية' }, { status: 400 })
      }

      const result = await activateKey(String(key).trim(), userData.id, userData.username)
      if (!result.success) {
        return NextResponse.json({ success: false, error: result.error }, { status: 400 })
      }

      // webhook log
      const webhookUrl = getLogWebhookUrl()
      if (webhookUrl) {
        try {
          await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              embeds: [{
                title: '🔑 تفعيل Prime جديد',
                color: 0x00FF00,
                fields: [
                  { name: '👤 المستخدم', value: userData.username, inline: true },
                  { name: '🆔 ID', value: userData.id, inline: true },
                  { name: '🔑 المفتاح', value: `\`${key}\``, inline: false }
                ],
                footer: { text: '1888 • Prime v6.0' },
                timestamp: new Date().toISOString()
              }]
            })
          })
        } catch {}
      }

      return NextResponse.json({
        success: true,
        userId: userData.id,
        username: userData.username,
        primeProof: result.proof,
        message: 'تم تفعيل Prime بنجاح! احفظ الـ proof في localStorage.'
      })
    }

    // ===== 4. Status =====
    if (action === 'status') {
      // نتحقق من primeProof المرسل
      const { primeProof } = body
      if (!primeProof) {
        return NextResponse.json({ success: true, hasPrime: false })
      }
      const { verifyPrimeProof } = await import('@/lib/prime-store')
      const result = await verifyPrimeProof(String(primeProof))
      return NextResponse.json({
        success: true,
        hasPrime: result.valid,
        userId: result.userId
      })
    }

    // ===== 5. Regenerate Proof (لو العميل فقد الـ proof) =====
    if (action === 'regenerate-proof') {
      if (!token || !key) return NextResponse.json({ success: false, error: 'التوكن والمفتاح مطلوبان' }, { status: 400 })
      const ct = cleanToken(token)
      const verifyResult = await discordFetch(ct, 'GET', '/users/@me', undefined, { userOnly: true, timeout: 10000 })
      if (!verifyResult.ok) return NextResponse.json({ success: false, error: 'توكن غير صالح' }, { status: 400 })
      const userData = verifyResult.data as { id: string }

      if (!isKeyRegistered(String(key).trim())) {
        return NextResponse.json({ success: false, error: 'مفتاح غير صحيح' }, { status: 400 })
      }

      const proof = await generatePrimeProof(userData.id, String(key).trim())
      return NextResponse.json({ success: true, primeProof: proof })
    }

    return NextResponse.json({ success: false, error: 'إجراء غير معروف' }, { status: 400 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ success: true, system: '1888 Prime v6.0 — Signed Tokens' })
}
