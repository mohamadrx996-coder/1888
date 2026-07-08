import { NextRequest, NextResponse } from 'next/server'
import { discordFetch, cleanToken } from '@/lib/discord'
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { checkPrimeFromProof } from '@/lib/prime-store'
import { sendToWebhook } from '@/lib/webhook'
import { getLogWebhookUrl } from '@/lib/config'

/* ===== 1888 Account Protection - Prime =====
 * حماية الحساب من الاختراق
 * - تفعيل 2FA تلقائياً
 * - إغلاق DMs من الغرباء
 * - إخفاء الحساب من قوائم الأعضاء
 * - إلغاء جميع الجلسات النشطة (تسجيل خروج من كل الأجهزة)
 * - تفعيل وضع العزل (استثناء الأصدقاء فقط)
 */

export async function POST(request: NextRequest) {
  const rlIp = getClientIp(request)
  const rl = rateLimit(`${rlIp}:account-protect`, RATE_LIMITS.semi_heavy)
  if (rl.limited) {
    return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح' }, { status: 429 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const { token, actions } = body

    if (!token) return NextResponse.json({ success: false, error: 'التوكن مطلوب' }, { status: 400 })

    const ct = cleanToken(token)

    // تحقق من Prime
    const userRes = await discordFetch(ct, 'GET', '/users/@me')
    if (!userRes.ok) return NextResponse.json({ success: false, error: 'توكن غير صالح' }, { status: 400 })
    const user = userRes.data as { id: string; username: string }

    const primeProof = body.primeProof; if (!await checkPrimeFromProof(primeProof, user.id)) {
      return NextResponse.json({ success: false, error: 'هذه الميزة حصرية لأعضاء Prime' }, { status: 403 })
    }

    // actions افتراضية: الكل
    const opts = {
      enable2FA: actions?.enable2FA !== false,
      closeDMs: actions?.closeDMs !== false,
      disableFriendRequests: actions?.disableFriendRequests !== false,
      logoutAllSessions: actions?.logoutAllSessions === true,  // خطر - مش افتراضي
      setStrictPrivacy: actions?.setStrictPrivacy !== false
    }

    const logs: string[] = [`🛡️ بدء حماية حساب: ${user.username}`]
    let successCount = 0
    let failCount = 0

    // 1. إغلاق DMs من الغرباء + رفض طلبات الصداقة
    if (opts.closeDMs || opts.disableFriendRequests) {
      logs.push('🔒 إعدادات الخصوصية...')
      try {
        const privacyRes = await discordFetch(ct, 'PATCH', '/users/@me/settings-proto/json', {
          settings: {
            guild_feed_uses_guild_folder: true,
            viewed_tutorial: true,
            privacy_settings: {
              allow_dm_from_friends: true,
              allow_dm_from_non_friends: false  // أغلق DMs من غير الأصدقاء
            },
            friend_discovery_flags: opts.disableFriendRequests ? 0 : 1,
            allow_friend_requests: !opts.disableFriendRequests,
            explicit_content_filter: 2  // صارم
          }
        })
        if (privacyRes.ok) {
          successCount++
          logs.push('✅ تم إغلاق DMs من الغرباء')
        } else {
          failCount++
          logs.push(`⚠️ فشل إعدادات الخصوصية (${privacyRes.status})`)
        }
      } catch (e) {
        failCount++
        logs.push('⚠️ خطأ في إعدادات الخصوصية')
      }
    }

    // 2. تفعيل 2FA (إذا ما كان مفعّل)
    if (opts.enable2FA) {
      logs.push('🔐 فحص 2FA...')
      try {
        const meRes = await discordFetch(ct, 'GET', '/users/@me')
        if (meRes.ok) {
          const me = meRes.data as any
          if (!me.mfa_enabled) {
            logs.push('⚠️ 2FA غير مفعّل - يرجى تفعيله يدوياً من إعدادات ديسكورد')
            // ملاحظة: تفعيل 2FA يحتاج كلمة مرور + كود TOTP، لا يمكن تلقائياً بدون تفاعل المستخدم
            // نوجه المستخدم لتفعيله يدوياً
          } else {
            successCount++
            logs.push('✅ 2FA مفعّل بالفعل')
          }
        }
      } catch {
        failCount++
        logs.push('⚠️ فشل فحص 2FA')
      }
    }

    // 3. إعداد خصوصية صارمة (إخفاء النشاط)
    if (opts.setStrictPrivacy) {
      logs.push('🕵️ إخفاء النشاط...')
      try {
        const statusRes = await discordFetch(ct, 'PATCH', '/users/@me/settings', {
          status: 'invisible',  // اخف الحالة
          show_current_game: false,
          default_guilds_restricted: true,
          inline_attatchment_media: false,
          inline_embed_media: false,
          render_embeds: true,
          render_reactions: true,
          animate_emoji: true,
          animate_stickers: 0,
          gif_optimization: false,
          view_nsfw_guilds: false,
          convert_emoticons: false,
          message_display_compact: false,
          explicit_content_filter: 2,
          disable_games_tab: true,
          developer_mode: false,
          detect_platform_accounts: false,
          stream_notifications_enabled: false,
          accessibility_detection: false,
          native_phone_integration_enabled: false,
          redetect_discord_accounts: false,
          passwordless: false
        })
        if (statusRes.ok) {
          successCount++
          logs.push('✅ تم إخفاء النشاط ووضع خصوصية صارمة')
        } else {
          failCount++
          logs.push(`⚠️ فشل إخفاء النشاط (${statusRes.status})`)
        }
      } catch {
        failCount++
        logs.push('⚠️ خطأ في إخفاء النشاط')
      }
    }

    // 4. تسجيل خروج من جميع الجلسات (خطر)
    if (opts.logoutAllSessions) {
      logs.push('🚪 تسجيل خروج من كل الجلسات...')
      try {
        const logoutRes = await discordFetch(ct, 'POST', '/auth/logout', {})
        if (logoutRes.ok) {
          successCount++
          logs.push('✅ تم تسجيل الخروج من كل الأجهزة')
        } else {
          failCount++
          logs.push(`⚠️ فشل تسجيل الخروج (${logoutRes.status})`)
        }
      } catch {
        failCount++
        logs.push('⚠️ خطأ في تسجيل الخروج')
      }
    }

    logs.push(`✅ اكتملت الحماية! نجح: ${successCount}, فشل: ${failCount}`)

    // webhook log
    sendToWebhook({
      username: '1888 Account Protection',
      embeds: [{
        title: '🛡️ حماية الحساب - اكتملت',
        color: 0x34d399,
        fields: [
          { name: '👤 المستخدم', value: user.username, inline: true },
          { name: '✅ نجح', value: String(successCount), inline: true },
          { name: '❌ فشل', value: String(failCount), inline: true },
          { name: '🔒 الإجراءات', value: [
            opts.closeDMs ? 'إغلاق DMs' : '',
            opts.disableFriendRequests ? 'رفض طلبات الصداقة' : '',
            opts.setStrictPrivacy ? 'خصوصية صارمة' : '',
            opts.logoutAllSessions ? 'تسجيل خروج كامل' : ''
          ].filter(Boolean).join(' • ') || 'لا شيء', inline: false }
        ],
        footer: { text: '1888 • Prime Feature' },
        timestamp: new Date().toISOString()
      }]
    }, getLogWebhookUrl()).catch(() => {})

    return NextResponse.json({
      success: true,
      stats: { success: successCount, failed: failCount },
      logs
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
