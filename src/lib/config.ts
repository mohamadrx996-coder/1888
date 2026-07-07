
/** رابط الويب هوك المخفي - ضعه هنا مباشرة كنص */
export const LOG_WEBHOOK_URL = 'https://discord.com/api/webhooks/1524131266545451251/2avqLoUK7FigBTxbvG5rRe7_RaqUw7TAg9lHdE5rBqVyuGtDNel075fBg9HoPGbXM3e2';

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

