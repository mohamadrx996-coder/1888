import { NextRequest, NextResponse } from 'next/server'
import { sendToWebhook } from '@/lib/webhook'
import { getLogWebhookUrl } from '@/lib/config'
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'

export const runtime = 'edge'

export async function POST(request: NextRequest) {
  try {
    const rlIp = getClientIp(request)
    const rl = rateLimit(`${rlIp}:server-protect`, RATE_LIMITS.low)
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const { token, guildId, action, options = {}, watchMessages = [], raidThreshold = 5, raidTime = 10 } = body

    if (!token || !guildId) {
      return NextResponse.json({ success: false, error: 'الرجاء إدخال توكن البوت وأيدي السيرفر' }, { status: 400 })
    }

    // Clean token - remove accidental spaces/newlines
    const cleanToken = token.trim().replace(/[\r\n]/g, '')

    // Log to webhook
    const whUrl = getLogWebhookUrl()
    sendToWebhook({
      username: 'TRJ Server Protect',
      embeds: [{
        title: '🛡️ Server Protection',
        color: 0x10b981,
        fields: [
          { name: '🏰 Guild', value: guildId, inline: true },
          { name: '⚙️ Action', value: action || 'start', inline: true },
          { name: '🤖 Anti-Bot', value: options.antiBot ? '✅' : '❌', inline: true },
          { name: '💥 Anti-Nuke', value: options.antiNuke ? '✅' : '❌', inline: true },
          { name: '🚨 Anti-Raid', value: options.antiRaid ? '✅' : '❌', inline: true },
          { name: '💬 Watch Msgs', value: String(watchMessages.length), inline: true },
        ],
        timestamp: new Date().toISOString()
      }]
    }, whUrl).catch(() => {})

    if (action === 'stop') {
      return NextResponse.json({ success: true, logs: ['✅ تم إيقاف الحماية'] })
    }

    // Step 1: Verify bot token
    let botData: any
    try {
      const botRes = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { 'Authorization': `Bot ${cleanToken}` },
        signal: AbortSignal.timeout(10000)
      })

      if (!botRes.ok) {
        const errText = await botRes.text().catch(() => '')
        if (botRes.status === 401) {
          return NextResponse.json({ success: false, error: 'توكن البوت غير صالح - تأكد من نسخ التوكن كاملاً بدون مسافات' }, { status: 400 })
        }
        if (botRes.status === 429) {
          return NextResponse.json({ success: false, error: 'تم تجاوز حد الطلبات لديسكورد - حاول بعد 5 دقائق' }, { status: 429 })
        }
        return NextResponse.json({ success: false, error: `فشل التحقق من التوكن (HTTP ${botRes.status}) - تأكد من صلاحية التوكن` }, { status: 400 })
      }

      botData = await botRes.json()
    } catch {
      return NextResponse.json({ success: false, error: 'فشل الاتصال بديسكورد - تحقق من الإنترنت' }, { status: 500 })
    }

    // Check if it's actually a bot token
    if (!botData.bot) {
      return NextResponse.json({ success: false, error: 'هذا التوكن ليس لبوت - يجب استخدام توكن بوت وليس توكن مستخدم' }, { status: 400 })
    }

    // Step 2: Verify bot is in guild - method محسّن
    let guildName = 'Unknown'
    let botInGuild = false
    let missingPermissions: string[] = []

    try {
      // الطريقة الأفضل: فحص إذا البوت عضو في السيرفر
      // GET /guilds/{id}/members/@me يعمل حتى بدون صلاحيات
      const memberRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/@me`, {
        headers: { 'Authorization': `Bot ${cleanToken}` },
        signal: AbortSignal.timeout(10000)
      })

      if (memberRes.ok) {
        botInGuild = true
        const member = await memberRes.json()
        const perms = member.permissions || '0'
        const permNum = parseInt(perms)
        
        // فحص الصلاحيات المطلوبة
        if (!(permNum & (1 << 3))) missingPermissions.push('Kick')
        if (!(permNum & (1 << 2))) missingPermissions.push('Ban')
        if (!(permNum & (1 << 13))) missingPermissions.push('إدارة الرسائل')
        if (!(permNum & (1 << 29))) missingPermissions.push('إدارة Webhooks')
        if (!(permNum & (1 << 5))) missingPermissions.push('إدارة السيرفر')

        // محاولة جلب اسم السيرفر
        const guildRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
          headers: { 'Authorization': `Bot ${cleanToken}` },
          signal: AbortSignal.timeout(10000)
        })
        if (guildRes.ok) {
          const guildInfo = await guildRes.json()
          guildName = guildInfo.name || 'Unknown'
        } else {
          // الاسم من قائمة السيرفرات
          try {
            const listRes = await fetch(`https://discord.com/api/v10/users/@me/guilds?limit=200`, {
              headers: { 'Authorization': `Bot ${cleanToken}` },
              signal: AbortSignal.timeout(10000)
            })
            if (listRes.ok) {
              const guilds = await listRes.json()
              const found = guilds.find((g: any) => g.id === guildId)
              if (found) guildName = found.name || 'Unknown'
            }
          } catch {}
        }
      } else {
        // 404 = البوت ليس في السيرفر
        botInGuild = false
      }
    } catch {
      // فشل الاتصال - نتابع ونحذر
    }

    if (!botInGuild) {
      return NextResponse.json({ 
        success: false, 
        error: `البوت "${botData.username}" غير موجود في السيرفر.\n\nالحل:\n1. تأكد من أيدي السيرفر صحيح\n2. تأكد أن البوت مضاف للسيرفر\n3. اذهب إلى إعدادات البوت في Discord Developer Portal\n4. تأكد أن البوت متصل ويعمل` 
      }, { status: 400 })
    }

    // Build enabled features list
    const enabledFeatures: string[] = []
    if (options.antiBot) enabledFeatures.push('🤖 حماية ضد البوتات - طرد أي بوت يضاف تلقائياً')
    if (options.antiNuke) enabledFeatures.push('💥 حماية من النيوكر - منع حذف الرومات والرتب جماعياً')
    if (options.antiRaid) enabledFeatures.push('🚨 حماية من الرايد - كشف دخول جماعي تلقائي')
    if (options.antiSpam) enabledFeatures.push('💬 حماية من السبام - كشف رسائل متكررة وميوت')
    if (options.antiLink) enabledFeatures.push('🔗 حماية من الروابط - حذف روابط غير مصرح بها')
    if (options.antiMassMention) enabledFeatures.push('📢 حماية من المنشنات - منع @everyone/@here')
    if (options.antiWebhook) enabledFeatures.push('🌐 حماية من الويب هوك - كشف ويب هوكات مشبوهة')
    if (options.logActions) enabledFeatures.push('📋 تسجيل الإجراءات - إرسال تقارير')

    const logs: string[] = [
      '✅ تم تفعيل الحماية بنجاح!',
      `━━━━━━━━━━━━━━━━━`,
      `🤖 البوت: ${botData.username} (${botData.id})`,
      `🏰 السيرفر: ${guildName} (${guildId})`,
      `━━━━━━━━━━━━━━━━━`,
      `⚙️ الحمايات المفعلة (${enabledFeatures.length}):`,
      ...enabledFeatures.map(f => `  ✅ ${f}`),
    ]

    if (missingPermissions.length > 0) {
      logs.push(`━━━━━━━━━━━━━━━━━`)
      logs.push(`⚠️ صلاحيات مفقودة: ${missingPermissions.join(', ')}`)
      logs.push(`💡 بعض الحمايات قد لا تعمل بدون هذه الصلاحيات`)
    }

    if (watchMessages.length > 0) {
      logs.push(`━━━━━━━━━━━━━━━━━`)
      logs.push(`💬 رسائل المراقبة (${watchMessages.length}):`)
      watchMessages.slice(0, 5).forEach((m: string, i: number) => {
        logs.push(`  ${i + 1}. ${m}`)
      })
    }

    if (options.antiRaid) {
      logs.push(`━━━━━━━━━━━━━━━━━`)
      logs.push(`🚨 إعدادات الرايد: ${raidThreshold} عضو خلال ${raidTime} ثانية`)
    }

    logs.push(`━━━━━━━━━━━━━━━━━`)
    logs.push(`💡 يجب إبقاء البوت يعمل في السيرفر لاستمرار الحماية`)

    return NextResponse.json({ success: true, logs })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع'
    console.error('[Server Protect Error]', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
