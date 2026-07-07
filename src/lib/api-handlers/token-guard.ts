import { NextRequest, NextResponse } from 'next/server'
import { discordFetch, cleanToken } from '@/lib/discord'
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { sendToWebhook } from '@/lib/webhook'
import { checkPrimeFromProof } from '@/lib/prime-store'

/* ===== 1888 Token Guard =====
 * يوفر مراقبة للحساب:
 * - في الموقع: مراقبة فورية + فحص يدوي
 * - 24/7: انشر Cloudflare Worker من مجلد worker/ للمراقبة الدائمة
 *   حتى لو الموقع مغلق، الإشعارات تصل للويب هوك
 *   الـ Worker يفحص كل دقيقة (شبه فوري)
 *   ملاحظة: ديسكورد لا يدعم event-based للحسابات، polling هو الحل الوحيد
 */

interface GuardEntry {
  token: string
  webhookUrl: string
  baseline: { id: string; os?: string; client?: string; last_used?: string; location?: string }[]
  // ===== baseline للحساب نفسه (اسم + أفتار + banner) =====
  profile?: {
    username: string
    global_name?: string
    avatar?: string | null
    banner?: string | null
    bio?: string
  }
  userId: string
  username: string
  activatedAt: number
  lastCheck: number
  alertsCount: number
}

// في الذاكرة (يدوم طوال عمر Edge instance)
// للمراقبة 24/7 الحقيقية، انشر Worker من مجلد worker/
const guardStore = new Map<string, GuardEntry>()

export async function POST(request: NextRequest) {
  const rlIp = getClientIp(request)
  const rl = rateLimit(`${rlIp}:token-guard`, RATE_LIMITS.medium)
  if (rl.limited) {
    return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const { token, webhookUrl, action, primeProof } = body

    if (!action) {
      return NextResponse.json({ success: false, error: 'الإجراء مطلوب: activate, deactivate, status, check' }, { status: 400 })
    }

    // ===== ACTIVATE =====
    if (action === 'activate') {
      if (!token) return NextResponse.json({ success: false, error: 'التوكن مطلوب' }, { status: 400 })
      if (!webhookUrl || !webhookUrl.startsWith('http')) {
        return NextResponse.json({ success: false, error: 'رابط الويب هوك مطلوب ويجب أن يبدأ بـ http' }, { status: 400 })
      }

      const ct = cleanToken(token)

      // جلب معلومات المستخدم
      const userRes = await discordFetch(ct, 'GET', '/users/@me')
      if (!userRes.ok) {
        return NextResponse.json({ success: false, error: 'توكن غير صالح' }, { status: 400 })
      }
      const user = userRes.data as { id: string; username: string }
      const userId = user.id
      const username = user.username

      // ===== تحقق من Prime =====
      if (!await checkPrimeFromProof(primeProof, userId)) {
        return NextResponse.json({ success: false, error: 'هذه الميزة حصرية لأعضاء Prime' }, { status: 403 })
      }

      // جلب sessions الحالية كـ baseline
      const sessionsRes = await discordFetch(ct, 'GET', '/users/@me/sessions')
      let baseline: GuardEntry['baseline'] = []
      if (sessionsRes.ok) {
        const data = sessionsRes.data as { sessions?: any[] } | null
        if (data && Array.isArray(data.sessions)) {
          baseline = data.sessions.map((s: any) => ({
            id: String(s.id || ''),
            os: s.os || 'unknown',
            client: s.client || 'unknown',
            last_used: s.last_used || 'unknown',
            location: s.location || undefined
          }))
        }
      }

      // ===== حفظ profile baseline (اسم + أفتار + banner + bio) =====
      const profile = {
        username: (user as any).username || '',
        global_name: (user as any).global_name || '',
        avatar: (user as any).avatar || null,
        banner: (user as any).banner || null,
        bio: (user as any).bio || ''
      }

      const entry: GuardEntry = {
        token: ct,
        webhookUrl,
        baseline,
        profile,
        userId,
        username,
        activatedAt: Date.now(),
        lastCheck: Date.now(),
        alertsCount: 0
      }
      guardStore.set(`guard:${userId}`, entry)

      // محاولة المزامنة مع Worker (لو منشور)
      const workerUrl = process.env.TOKEN_GUARD_WORKER_URL
      if (workerUrl) {
        try {
          await fetch(workerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'activate',
              userId,
              data: { token: ct, webhookUrl, baseline, username }
            })
          })
        } catch { /* Worker غير منشور، نكمل بالمحلي */ }
      }

      // إرسال إشعار تأكيد التفعيل
      try {
        await sendToWebhook({
          username: '1888 Token Guard',
          embeds: [{
            title: '🛡️ Token Guard تم التفعيل',
            color: 0x34d399,
            fields: [
              { name: '👤 الحساب', value: username, inline: true },
              { name: '🆔 ID', value: userId, inline: true },
              { name: '📊 Sessions مسجلة', value: String(baseline.length), inline: true },
              { name: '⏰ المراقبة', value: workerUrl ? '24/7 تلقائي (Worker منشور)' : 'يدوي - انشر Worker للمراقبة 24/7', inline: false }
            ],
            footer: { text: '1888 • Token Guard' },
            timestamp: new Date().toISOString()
          }]
        }, webhookUrl).catch(() => {})
      } catch {}

      return NextResponse.json({
        success: true,
        message: 'تم تفعيل Token Guard بنجاح',
        data: {
          userId,
          username,
          baselineCount: baseline.length,
          workerSynced: !!workerUrl,
          note: workerUrl ? 'المراقبة 24/7 مفعلة' : 'للمراقبة 24/7 حتى لو الموقع مغلق، انشر Cloudflare Worker من مجلد worker/'
        }
      })
    }

    // ===== DEACTIVATE =====
    if (action === 'deactivate') {
      if (!token) return NextResponse.json({ success: false, error: 'التوكن مطلوب' }, { status: 400 })
      const ct = cleanToken(token)
      const userRes = await discordFetch(ct, 'GET', '/users/@me')
      if (!userRes.ok) return NextResponse.json({ success: false, error: 'توكن غير صالح' }, { status: 400 })
      const userId = (userRes.data as { id: string }).id

      // ===== تحقق من Prime =====
      if (!await checkPrimeFromProof(primeProof, userId)) {
        return NextResponse.json({ success: false, error: 'هذه الميزة حصرية لأعضاء Prime' }, { status: 403 })
      }

      const entry = guardStore.get(`guard:${userId}`)
      guardStore.delete(`guard:${userId}`)

      // مزامنة مع Worker
      const workerUrl = process.env.TOKEN_GUARD_WORKER_URL
      if (workerUrl) {
        try {
          await fetch(workerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'deactivate', userId })
          })
        } catch {}
      }

      if (entry) {
        try {
          await sendToWebhook({
            username: '1888 Token Guard',
            embeds: [{
              title: '🔴 Token Guard تم إيقافه',
              color: 0xf87171,
              fields: [
                { name: '👤 الحساب', value: entry.username, inline: true },
                { name: '🔔 تنبيهات مرسلة', value: String(entry.alertsCount), inline: true }
              ],
              footer: { text: '1888 • Token Guard' },
              timestamp: new Date().toISOString()
            }]
          }, entry.webhookUrl).catch(() => {})
        } catch {}
      }

      return NextResponse.json({ success: true, message: 'تم إيقاف المراقبة' })
    }

    // ===== STATUS =====
    if (action === 'status') {
      if (!token) return NextResponse.json({ success: false, error: 'التوكن مطلوب' }, { status: 400 })
      const ct = cleanToken(token)
      const userRes = await discordFetch(ct, 'GET', '/users/@me')
      if (!userRes.ok) return NextResponse.json({ success: false, error: 'توكن غير صالح' }, { status: 400 })
      const userId = (userRes.data as { id: string }).id

      // ===== تحقق من Prime =====
      if (!await checkPrimeFromProof(primeProof, userId)) {
        return NextResponse.json({ success: false, error: 'هذه الميزة حصرية لأعضاء Prime' }, { status: 403 })
      }

      const entry = guardStore.get(`guard:${userId}`)

      return NextResponse.json({
        success: true,
        active: !!entry,
        data: entry ? {
          username: entry.username,
          activatedAt: new Date(entry.activatedAt).toISOString(),
          lastCheck: new Date(entry.lastCheck).toISOString(),
          alertsCount: entry.alertsCount,
          baselineCount: entry.baseline.length
        } : null
      })
    }

    // ===== CHECK (Manual trigger) =====
    if (action === 'check') {
      // تحقق أن العميل Prime (أي مستخدم Prime صالح)
      const { verifyPrimeProof } = await import('@/lib/prime-store')
      const primeResult = await verifyPrimeProof(String(primeProof || ''))
      if (!primeResult.valid) {
        return NextResponse.json({ success: false, error: 'هذه الميزة حصرية لأعضاء Prime' }, { status: 403 })
      }

      const results: { userId: string; username: string; alerts: number; status: string }[] = []
      for (const [key, entry] of guardStore.entries()) {
        const result = await checkGuardEntry(entry)
        if (result.alerts > 0) {
          entry.alertsCount += result.alerts
        }
        entry.lastCheck = Date.now()
        guardStore.set(key, entry)
        results.push({ userId: entry.userId, username: entry.username, alerts: result.alerts, status: result.status })
      }

      return NextResponse.json({
        success: true,
        checked: results.length,
        results
      })
    }

    return NextResponse.json({ success: false, error: 'إجراء غير معروف - استخدم: activate, deactivate, status, check' }, { status: 400 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    success: true,
    activeGuards: guardStore.size,
    workerConfigured: !!process.env.TOKEN_GUARD_WORKER_URL,
    note: 'للمراقبة 24/7، انشر Cloudflare Worker من مجلد worker/'
  })
}

// ===== فحص توكن واحد =====
async function checkGuardEntry(entry: GuardEntry): Promise<{ alerts: number; status: string }> {
  let alerts = 0
  let status = 'ok'

  try {
    const sessionsRes = await discordFetch(entry.token, 'GET', '/users/@me/sessions')

    if (!sessionsRes.ok) {
      if (sessionsRes.status === 401) {
        // التوكن تعطّل!
        await sendToWebhook({
          username: '1888 Token Guard',
          embeds: [{
            title: '🚨 تنبيه حرج - توكن تعطّل!',
            color: 0xFF0000,
            description: `توكن الحساب **${entry.username}** لم يعد صالحاً!`,
            fields: [
              { name: '👤 الحساب', value: entry.username, inline: true },
              { name: '🆔 ID', value: entry.userId, inline: true },
              { name: '⏰ وقت التنبيه', value: new Date().toLocaleString('ar-SA'), inline: false },
              { name: '⚠️ الإجراء', value: 'قد تم تعطيل التوكن أو تغيير الباسوورد. غيّر الباسوورد فوراً لو لم تكن أنت!', inline: false }
            ],
            footer: { text: '1888 • Token Guard' },
            timestamp: new Date().toISOString()
          }]
        }, entry.webhookUrl).catch(() => {})
        alerts++
        status = 'token_dead'
      }
      return { alerts, status }
    }

    const data = sessionsRes.data as { sessions?: any[] } | null
    if (!data || !Array.isArray(data.sessions)) return { alerts, status }

    // اكتشاف sessions جديدة
    const newSessions = data.sessions.filter(
      (s: any) => !entry.baseline.find(b => b.id === String(s.id || ''))
    )

    for (const session of newSessions) {
      await sendToWebhook({
        username: '1888 Token Guard',
        embeds: [{
          title: '⚠️ تسجيل دخول جديد للحساب!',
          color: 0xFFAA00,
          fields: [
            { name: '👤 الحساب', value: entry.username, inline: true },
            { name: '🖥️ الجهاز', value: `${session.os || 'unknown'} / ${session.client || 'unknown'}`, inline: true },
            { name: '🕐 آخر نشاط', value: session.last_used || 'غير معروف', inline: true },
            { name: '📍 الموقع', value: session.location || 'غير معروف', inline: true },
            { name: '💡 تنبيه', value: 'لو لم تكن أنت، غيّر الباسوورد فوراً!', inline: false }
          ],
          footer: { text: '1888 • Token Guard' },
          timestamp: new Date().toISOString()
        }]
      }, entry.webhookUrl).catch(() => {})
      alerts++
    }

    // تحديث baseline
    if (newSessions.length > 0) {
      entry.baseline = data.sessions.map((s: any) => ({
        id: String(s.id || ''),
        os: s.os || 'unknown',
        client: s.client || 'unknown',
        last_used: s.last_used || 'unknown',
        location: s.location || undefined
      }))
    }

    status = newSessions.length > 0 ? 'new_session' : 'ok'

    // ===== فحص تغييرات الـ profile (اسم + أفتار + banner + bio) =====
    const profileRes = await discordFetch(entry.token, 'GET', '/users/@me')
    if (profileRes.ok) {
      const me = profileRes.data as any
      const old = entry.profile

      if (old) {
        const changes: { field: string; old: string; new: string }[] = []

        // تغيير الاسم
        if (me.username && me.username !== old.username) {
          changes.push({ field: 'الاسم', old: old.username, new: me.username })
        }

        // تغيير global name
        if ((me.global_name || '') !== (old.global_name || '')) {
          changes.push({ field: 'الاسم العام', old: old.global_name || '—', new: me.global_name || '—' })
        }

        // تغيير الأفتار
        if ((me.avatar || null) !== (old.avatar || null)) {
          changes.push({
            field: 'الأفتار',
            old: old.avatar ? `[قديم](${old.avatar.startsWith('a_') ? `https://cdn.discordapp.com/avatars/${entry.userId}/${old.avatar}.gif` : `https://cdn.discordapp.com/avatars/${entry.userId}/${old.avatar}.png`})` : 'لا يوجد',
            new: me.avatar ? `[جديد](${me.avatar.startsWith('a_') ? `https://cdn.discordapp.com/avatars/${entry.userId}/${me.avatar}.gif` : `https://cdn.discordapp.com/avatars/${entry.userId}/${me.avatar}.png`})` : 'تم الحذف'
          })
        }

        // تغيير الـ banner
        if ((me.banner || null) !== (old.banner || null)) {
          changes.push({
            field: 'البنر',
            old: old.banner ? 'موجود' : 'لا يوجد',
            new: me.banner ? 'جديد' : 'تم الحذف'
          })
        }

        // تغيير الـ bio
        if ((me.bio || '') !== (old.bio || '')) {
          changes.push({
            field: 'البايو',
            old: old.bio ? `"${old.bio.slice(0, 50)}${old.bio.length > 50 ? '...' : ''}"` : 'فارغ',
            new: me.bio ? `"${me.bio.slice(0, 50)}${me.bio.length > 50 ? '...' : ''}"` : 'فارغ'
          })
        }

        // إرسال إشعار لو فيه تغييرات
        if (changes.length > 0) {
          const fields = changes.map(c => ({
            name: c.field,
            value: `~~${c.old}~~ → **${c.new}**`,
            inline: false
          }))

          await sendToWebhook({
            username: '1888 Token Guard',
            embeds: [{
              title: '📝 تغيير في بيانات الحساب',
              color: 0x8b5cf6,
              description: `تم اكتشاف ${changes.length} تغيير في حساب **${entry.username}**`,
              fields: [
                { name: '👤 الحساب', value: entry.username, inline: true },
                { name: '🆔 ID', value: entry.userId, inline: true },
                ...fields,
                { name: '💡 تنبيه', value: 'لو لم تكن أنت من غيّر البيانات، تحقق من حسابك فوراً!', inline: false }
              ],
              footer: { text: '1888 • Token Guard • Profile Monitor' },
              timestamp: new Date().toISOString()
            }]
          }, entry.webhookUrl).catch(() => {})

          alerts++
          status = 'profile_changed'

          // تحديث baseline
          entry.profile = {
            username: me.username || '',
            global_name: me.global_name || '',
            avatar: me.avatar || null,
            banner: me.banner || null,
            bio: me.bio || ''
          }
        }
      }
    }
  } catch {
    status = 'error'
  }

  return { alerts, status }
}
