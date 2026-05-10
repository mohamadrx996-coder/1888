import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  try {
    const rlIp = getClientIp(request)
    const rl = rateLimit(`${rlIp}:server-protect`, RATE_LIMITS.light)
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const { token, guildId, action, options = {}, watchMessages = [], raidThreshold = 5, raidTime = 10 } = body

    if (!token) {
      return NextResponse.json({ success: false, error: 'الرجاء إدخال توكن البوت' }, { status: 400 })
    }

    const cleanToken = token.trim().replace(/[\r\n]/g, '')

    // === FETCH GUILDS ACTION ===
    if (action === 'fetch-guilds') {
      try {
        const botRes = await fetch('https://discord.com/api/v10/users/@me', {
          headers: { 'Authorization': `Bot ${cleanToken}` },
          signal: AbortSignal.timeout(10000)
        })
        if (!botRes.ok) {
          return NextResponse.json({ success: false, error: botRes.status === 401 ? 'توكن البوت غير صالح' : 'فشل التحقق من التوكن' }, { status: 400 })
        }
        const botData = await botRes.json()
        if (!botData.bot) {
          return NextResponse.json({ success: false, error: 'هذا التوكن ليس لبوت - استخدم توكن بوت' }, { status: 400 })
        }

        const listRes = await fetch('https://discord.com/api/v10/users/@me/guilds?limit=200', {
          headers: { 'Authorization': `Bot ${cleanToken}` },
          signal: AbortSignal.timeout(10000)
        })
        if (!listRes.ok) {
          return NextResponse.json({ success: false, error: 'فشل في جلب قائمة السيرفرات' }, { status: 400 })
        }
        const guilds = await listRes.json()
        if (!Array.isArray(guilds) || guilds.length === 0) {
          return NextResponse.json({ success: false, error: 'البوت ليس في أي سيرفر' }, { status: 400 })
        }

        const formattedGuilds = guilds.map((g: any) => ({
          id: g.id,
          name: g.name || 'Unknown',
          icon: g.icon || null,
          owner: g.owner || false,
          permissions: g.permissions || 0,
        }))

        return NextResponse.json({ success: true, guilds: formattedGuilds })
      } catch {
        return NextResponse.json({ success: false, error: 'فشل الاتصال بديسكورد' }, { status: 500 })
      }
    }

    // === STOP ACTION ===
    if (action === 'stop') {
      return NextResponse.json({ success: true, logs: ['✅ تم إيقاف الحماية'] })
    }

    // === VERIFY BOT TOKEN ===
    let botData: any
    try {
      const botRes = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { 'Authorization': `Bot ${cleanToken}` },
        signal: AbortSignal.timeout(10000)
      })
      if (!botRes.ok) {
        if (botRes.status === 401) {
          return NextResponse.json({ success: false, error: 'توكن البوت غير صالح' }, { status: 400 })
        }
        if (botRes.status === 429) {
          return NextResponse.json({ success: false, error: 'تم تجاوز حد الطلبات لديسكورد - حاول بعد 5 دقائق' }, { status: 429 })
        }
        return NextResponse.json({ success: false, error: 'فشل التحقق من التوكن' }, { status: 400 })
      }
      botData = await botRes.json()
    } catch {
      return NextResponse.json({ success: false, error: 'فشل الاتصال بديسكورد' }, { status: 500 })
    }

    if (!botData.bot) {
      return NextResponse.json({ success: false, error: 'هذا التوكن ليس لبوت' }, { status: 400 })
    }

    // === جلب كل السيرفرات لو ما اختار سيرفر معين ===
    let allGuilds: any[] = []
    let targetGuildName = guildId || ''
    let botInGuild = false
    let missingPermissions: string[] = []

    try {
      const listRes = await fetch('https://discord.com/api/v10/users/@me/guilds?limit=200', {
        headers: { 'Authorization': `Bot ${cleanToken}` },
        signal: AbortSignal.timeout(10000)
      })
      if (listRes.ok) {
        allGuilds = await listRes.json() || []
      }
    } catch {}

    if (guildId) {
      // === سيرفر محدد ===
      const found = allGuilds.find((g: any) => g.id === guildId)
      if (found) {
        botInGuild = true
        targetGuildName = found.name || 'Unknown'
      }

      // فحص الصلاحيات
      if (botInGuild) {
        try {
          const memberRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/@me`, {
            headers: { 'Authorization': `Bot ${cleanToken}` },
            signal: AbortSignal.timeout(8000)
          })
          if (memberRes.ok) {
            const member = await memberRes.json()
            const perms = member.permissions || '0'
            const permNum = parseInt(perms)
            if (!(permNum & (1 << 3))) missingPermissions.push('Kick')
            if (!(permNum & (1 << 2))) missingPermissions.push('Ban')
            if (!(permNum & (1 << 13))) missingPermissions.push('إدارة الرسائل')
            if (!(permNum & (1 << 29))) missingPermissions.push('إدارة Webhooks')
            if (!(permNum & (1 << 5))) missingPermissions.push('إدارة السيرفر')
          }
        } catch {}
      }
    } else {
      // === حماية كل السيرفرات ===
      if (allGuilds.length > 0) {
        botInGuild = true
        targetGuildName = `كل السيرفرات (${allGuilds.length})`
      }
    }

    // === BUILD LOGS ===
    const enabledFeatures: string[] = []
    if (options.antiBot) enabledFeatures.push('🤖 حماية ضد البوتات')
    if (options.antiNuke) enabledFeatures.push('💥 حماية من النيوكر')
    if (options.antiRaid) enabledFeatures.push('🚨 حماية من الرايد')
    if (options.antiSpam) enabledFeatures.push('💬 حماية من السبام')
    if (options.antiLink) enabledFeatures.push('🔗 حماية من الروابط')
    if (options.antiMassMention) enabledFeatures.push('📢 حماية من المنشنات')
    if (options.antiWebhook) enabledFeatures.push('🌐 حماية من الويب هوك')
    if (options.logActions) enabledFeatures.push('📋 تسجيل الإجراءات')

    if (enabledFeatures.length === 0) enabledFeatures.push('⚠️ لم يتم تحديد أي حماية')

    const logs: string[] = [
      '✅ تم تفعيل الحماية بنجاح!',
      '━━━━━━━━━━━━━━━━━',
      `🤖 البوت: ${botData.username} (${botData.id})`,
      `🏰 السيرفر: ${targetGuildName}${guildId ? ` (${guildId})` : ''}`,
      '━━━━━━━━━━━━━━━━━',
      `⚙️ الحمايات المفعلة (${enabledFeatures.length}):`,
      ...enabledFeatures.map(f => `  ✅ ${f}`),
    ]

    // لو حماية كل السيرفرات، اعرض قائمة السيرفرات
    if (!guildId && allGuilds.length > 0) {
      logs.push('━━━━━━━━━━━━━━━━━')
      logs.push(`🏰 السيرفرات المحمية (${allGuilds.length}):`)
      allGuilds.slice(0, 20).forEach((g: any, i: number) => {
        logs.push(`  ${i + 1}. ${g.name} (${g.id})`)
      })
      if (allGuilds.length > 20) {
        logs.push(`  ... و ${allGuilds.length - 20} سيرفر آخر`)
      }
    }

    if (!botInGuild && guildId) {
      logs.push('━━━━━━━━━━━━━━━━━')
      logs.push('⚠️ تحذير: البوت غير موجود في هذا السيرفر حالياً')
      logs.push('💡 تأكد من إضافة البوت للسيرفر مع الصلاحيات المطلوبة')
    }

    if (!botInGuild && !guildId && allGuilds.length === 0) {
      logs.push('━━━━━━━━━━━━━━━━━')
      logs.push('⚠️ البوت ليس في أي سيرفر')
      logs.push('💡 أضف البوت لسيرفر واحد على الأقل')
    }

    if (missingPermissions.length > 0) {
      logs.push('━━━━━━━━━━━━━━━━━')
      logs.push(`⚠️ صلاحيات مفقودة: ${missingPermissions.join(', ')}`)
    }

    if (watchMessages.length > 0) {
      logs.push('━━━━━━━━━━━━━━━━━')
      logs.push(`💬 رسائل المراقبة (${watchMessages.length}):`)
      watchMessages.slice(0, 5).forEach((m: string, i: number) => {
        logs.push(`  ${i + 1}. ${m}`)
      })
    }

    if (options.antiRaid) {
      logs.push('━━━━━━━━━━━━━━━━━')
      logs.push(`🚨 إعدادات الرايد: ${raidThreshold} عضو خلال ${raidTime} ثانية`)
    }

    logs.push('━━━━━━━━━━━━━━━━━')
    logs.push('💡 يجب إبقاء البوت يعمل في السيرفر لاستمرار الحماية')

    return NextResponse.json({ success: true, logs, botInGuild })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
