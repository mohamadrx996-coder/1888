
import { NextRequest, NextResponse } from 'next/server';
import { getLogWebhookUrl } from '@/lib/config';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:feedback`, RATE_LIMITS.medium);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }

    const body = await request.json();
    const { type, message, userId, username, isPrime } = body;

    if (!type || !message) {
      return NextResponse.json({ success: false, error: 'أدخل نوع الرسالة والمحتوى' });
    }

    if (!message.trim() || message.trim().length < 5) {
      return NextResponse.json({ success: false, error: 'الرسالة قصيرة جداً' });
    }

    if (message.length > 2000) {
      return NextResponse.json({ success: false, error: 'الرسالة طويلة جداً (حد أقصى 2000 حرف)' });
    }

    const webhookUrl = getLogWebhookUrl();
    if (!webhookUrl) {
      return NextResponse.json({ success: false, error: 'الخدمة غير متوفرة حالياً' });
    }

    const isSuggestion = type === 'suggestion';
    const primeStatus = isPrime ? '⭐ Prime' : 'عادي';

    const embed = {
      title: isSuggestion ? '💡 اقتراح جديد' : '⚠️ مشكلة جديدة',
      description: `**${message.trim()}**`,
      color: isSuggestion ? 0x5865F2 : 0xFF6B6B,
      fields: [
        { name: '👤 المستخدم', value: username || 'مجهول', inline: true },
        { name: '🆔 User ID', value: userId || 'غير متوفر', inline: true },
        { name: '⭐ الحالة', value: primeStatus, inline: true },
        { name: '⚡ الأولوية', value: isPrime ? '🔥 عالية - تنفيذ فوري' : 'عادية', inline: true },
        { name: '📅 الوقت', value: new Date().toLocaleString('ar-EG'), inline: false },
      ],
      footer: { text: `TRJ BOT - ${isSuggestion ? 'اقتراحات' : 'مشاكل'} v5.0` },
      timestamp: new Date().toISOString()
    };

    if (isPrime) {
      embed.fields.push({
        name: '🔔 تنبيه',
        value: 'هذا المستخدم Prime - سيتم الاهتمام بطلبه فوراً!',
        inline: false
      });
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] })
    });

    if (!response.ok) {
      return NextResponse.json({ success: false, error: 'فشل إرسال الرسالة' });
    }

    return NextResponse.json({
      success: true,
      message: isPrime
        ? '✅ شكراً لك! بما أنك Prime، سيتم النظر في طلبك فوراً ⚡'
        : '✅ تم إرسال طلبك بنجاح! سيتم مراجعته قريباً',
      isPrime
    });

  } catch (error) {
    return NextResponse.json({ success: false, error: 'خطأ في الخادم' });
  }
}

