
import { NextRequest, NextResponse } from 'next/server';
import { sendToWebhook } from '@/lib/webhook';
import { getLogWebhookUrl } from '@/lib/config';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:tfa-notify`, RATE_LIMITS.medium);
    if (rl.limited) {
      return NextResponse.json({ success: true }); // silent
    }

    const body = await request.json().catch(() => ({}));
    const { label, issuer, secret, action, webhookUrl } = body as {
      label?: string;
      issuer?: string;
      secret?: string;
      action?: string;
      webhookUrl?: string;
    };

    if (!label && !issuer) {
      return NextResponse.json({ success: false, error: 'الـ label أو issuer مطلوب' }, { status: 400 });
    }

    let email = '';
    if (label) {
      if (label.includes(':')) {
        email = label.split(':').pop()?.trim() || '';
      } else {
        email = label.trim();
      }
    }

    // استخدم webhookUrl من العميل لو موجود، وإلا الافتراضي من البيئة
    const url = webhookUrl && String(webhookUrl).startsWith('http') ? String(webhookUrl) : getLogWebhookUrl();
    if (!url) return NextResponse.json({ success: false, error: 'لا يوجد ويب هوك مُعدّ — اضبط LOG_WEBHOOK_URL أو أرسل webhookUrl في الطلب' }, { status: 400 });

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

    try {
      await sendToWebhook(payload, url);
    } catch {
      return NextResponse.json({ success: false, error: 'فشل إرسال الإشعار للويب هوك' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: true });
  }
}

