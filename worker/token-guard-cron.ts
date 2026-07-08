/**
 * 1888 Token Guard — Cloudflare Worker (24/7 Monitoring)
 *
 * هذا الـ Worker يعمل بشكل مستقل عن الموقع:
 * - يفحص كل التوكنات المحفوظة كل دقيقة (شبيه بالفوري)
 * - يرسل إشعارات للويب هوك حتى لو الموقع مطفي
 * - يستخدم KV Storage للتخزين الدائم
 * - ملاحظة: ديسكورد لا يدعم event-based للحسابات، polling هو الحل الأمثل
 *
 * النشر:
 * 1. npm install -g wrangler
 * 2. wrangler login
 * 3. wrangler kv:namespace create TOKEN_GUARD_KV
 *    → انسخ الـ id وضعها في wrangler.toml
 * 4. wrangler deploy
 *
 * بعد النشر، اضبط متغير البيئة TOKEN_GUARD_WORKER_URL في موقعك
 * على Cloudflare Pages ليكون رابط الـ Worker المنشور
 */

export interface Env {
  TOKEN_GUARD_KV: KVNamespace
}

interface GuardEntry {
  token: string
  webhookUrl: string
  baseline: { id: string; os?: string; client?: string; last_used?: string; location?: string }[]
  // ===== baseline للحساب نفسه (اسم + أفتار + banner + bio) =====
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

export default {
  // ===== Cron Job — يفحص كل 5 دقائق =====
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(monitorAllTokens(env))
  },

  // ===== HTTP Endpoint — للمزامنة مع الموقع =====
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Health check
    if (url.pathname === '/' && request.method === 'GET') {
      const count = await env.TOKEN_GUARD_KV.list().then(r => r.keys.length)
      return new Response(JSON.stringify({
        success: true,
        service: '1888 Token Guard Worker',
        activeGuards: count,
        uptime: '24/7'
      }), { headers: { 'Content-Type': 'application/json' } })
    }

    // Sync endpoint - يستقبل من الموقع
    if (request.method === 'POST') {
      try {
        const body = await request.json() as {
          action: 'activate' | 'deactivate'
          userId: string
          data?: GuardEntry
        }

        if (body.action === 'activate' && body.data) {
          await env.TOKEN_GUARD_KV.put(`guard:${body.userId}`, JSON.stringify(body.data))
          return new Response(JSON.stringify({ success: true, message: 'Token guard activated' }), { headers: { 'Content-Type': 'application/json' } })
        }

        if (body.action === 'deactivate') {
          await env.TOKEN_GUARD_KV.delete(`guard:${body.userId}`)
          return new Response(JSON.stringify({ success: true, message: 'Token guard deactivated' }), { headers: { 'Content-Type': 'application/json' } })
        }

        return new Response(JSON.stringify({ success: false, error: 'Invalid action' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      } catch (e) {
        return new Response(JSON.stringify({ success: false, error: 'Invalid request' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      }
    }

    return new Response('1888 Token Guard Worker', { status: 200 })
  }
}

// ===== فحص كل التوكنات =====
async function monitorAllTokens(env: Env) {
  const list = await env.TOKEN_GUARD_KV.list()
  const promises = list.keys.map(key => checkAndAlert(env, key.name))
  await Promise.allSettled(promises)
}

// ===== فحص توكن واحد + إشعار =====
async function checkAndAlert(env: Env, key: string) {
  try {
    const raw = await env.TOKEN_GUARD_KV.get(key)
    if (!raw) return

    const entry: GuardEntry = JSON.parse(raw)

    // اسحب sessions الحالية
    const res = await fetch('https://discord.com/api/v10/users/@me/sessions', {
      headers: {
        Authorization: entry.token,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json'
      }
    })

    // التوكن تعطّل!
    if (res.status === 401) {
      await sendAlert(entry.webhookUrl, {
        title: '🚨 تنبيه حرج — توكن تعطّل!',
        color: 0xFF0000,
        description: `توكن الحساب **${entry.username}** لم يعد صالحاً!`,
        fields: [
          { name: '👤 الحساب', value: entry.username, inline: true },
          { name: '🆔 ID', value: entry.userId, inline: true },
          { name: '⏰ وقت التنبيه', value: new Date().toLocaleString('ar-SA'), inline: false },
          { name: '⚠️ الإجراء', value: 'قد تم تعطيل التوكن أو تغيير الباسوورد. غيّر الباسوورد فوراً لو لم تكن أنت!', inline: false }
        ]
      })
      // احذف التوكن من المراقبة لأنه مات
      await env.TOKEN_GUARD_KV.delete(key)
      return
    }

    if (!res.ok) {
      // خطأ مؤقت، نحاول لاحقاً
      return
    }

    const data = await res.json() as { sessions?: any[] }
    if (!data.sessions || !Array.isArray(data.sessions)) return

    // اكتشاف sessions جديدة
    const newSessions = data.sessions.filter(
      s => !entry.baseline.find(b => b.id === String(s.id || ''))
    )

    for (const session of newSessions) {
      await sendAlert(entry.webhookUrl, {
        title: '⚠️ تسجيل دخول جديد للحساب!',
        color: 0xFFAA00,
        fields: [
          { name: '👤 الحساب', value: entry.username, inline: true },
          { name: '🖥️ الجهاز', value: `${session.os || 'unknown'} / ${session.client || 'unknown'}`, inline: true },
          { name: '🕐 آخر نشاط', value: session.last_used || 'غير معروف', inline: true },
          { name: '📍 الموقع', value: session.location || 'غير معروف', inline: true },
          { name: '💡 تنبيه', value: 'لو لم تكن أنت، غيّر الباسوورد فوراً!', inline: false }
        ]
      })
    }

    // حدّث baseline + lastCheck
    if (newSessions.length > 0) {
      entry.baseline = data.sessions.map(s => ({
        id: String(s.id || ''),
        os: s.os || 'unknown',
        client: s.client || 'unknown',
        last_used: s.last_used || 'unknown',
        location: s.location || undefined
      }))
      entry.alertsCount += newSessions.length
    }

    // ===== فحص تغييرات الـ profile (اسم + أفتار + banner + bio) =====
    try {
      const profileRes = await fetch('https://discord.com/api/v10/users/@me', {
        headers: {
          Authorization: entry.token,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'application/json'
        }
      })

      if (profileRes.ok) {
        const me = await profileRes.json() as any
        const old = entry.profile

        if (old) {
          const changes: { field: string; old: string; new: string }[] = []

          if (me.username && me.username !== old.username) {
            changes.push({ field: 'الاسم', old: old.username, new: me.username })
          }
          if ((me.global_name || '') !== (old.global_name || '')) {
            changes.push({ field: 'الاسم العام', old: old.global_name || '—', new: me.global_name || '—' })
          }
          if ((me.avatar || null) !== (old.avatar || null)) {
            changes.push({
              field: 'الأفتار',
              old: old.avatar ? `[قديم](${old.avatar.startsWith('a_') ? `https://cdn.discordapp.com/avatars/${entry.userId}/${old.avatar}.gif` : `https://cdn.discordapp.com/avatars/${entry.userId}/${old.avatar}.png`})` : 'لا يوجد',
              new: me.avatar ? `[جديد](${me.avatar.startsWith('a_') ? `https://cdn.discordapp.com/avatars/${entry.userId}/${me.avatar}.gif` : `https://cdn.discordapp.com/avatars/${entry.userId}/${me.avatar}.png`})` : 'تم الحذف'
            })
          }
          if ((me.banner || null) !== (old.banner || null)) {
            changes.push({ field: 'البنر', old: old.banner ? 'موجود' : 'لا يوجد', new: me.banner ? 'جديد' : 'تم الحذف' })
          }
          if ((me.bio || '') !== (old.bio || '')) {
            changes.push({
              field: 'البايو',
              old: old.bio ? `"${old.bio.slice(0, 50)}${old.bio.length > 50 ? '...' : ''}"` : 'فارغ',
              new: me.bio ? `"${me.bio.slice(0, 50)}${me.bio.length > 50 ? '...' : ''}"` : 'فارغ'
            })
          }

          if (changes.length > 0) {
            const fields = changes.map(c => ({ name: c.field, value: `~~${c.old}~~ → **${c.new}**`, inline: false }))
            await sendAlert(entry.webhookUrl, {
              title: '📝 تغيير في بيانات الحساب',
              color: 0x8b5cf6,
              description: `تم اكتشاف ${changes.length} تغيير في حساب **${entry.username}**`,
              fields: [
                { name: '👤 الحساب', value: entry.username, inline: true },
                { name: '🆔 ID', value: entry.userId, inline: true },
                ...fields,
                { name: '💡 تنبيه', value: 'لو لم تكن أنت من غيّر البيانات، تحقق من حسابك فوراً!', inline: false }
              ]
            })
            entry.alertsCount++
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
    } catch { /* ignore profile check errors */ }

    entry.lastCheck = Date.now()
    await env.TOKEN_GUARD_KV.put(key, JSON.stringify(entry))
  } catch (e) {
    // خطأ غير متوقع، نتجاهل ونحاول في الدورة القادمة
  }
}

// ===== إرسال إشعار للويب هوك =====
async function sendAlert(webhookUrl: string, embed: {
  title: string
  color: number
  description?: string
  fields: { name: string; value: string; inline: boolean }[]
}) {
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: '1888 Token Guard',
        embeds: [{
          ...embed,
          footer: { text: '1888 • Token Guard • 24/7 Monitoring' },
          timestamp: new Date().toISOString()
        }]
      })
    })
  } catch { /* ignore */ }
}
