// src/app/api/feedback/route.ts - Suggestions & Problems API
export const runtime = 'edge';

import { getLogWebhookUrl } from '@/lib/config';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { type, message, userId, username, isPrime } = body;

    if (!type || !message) {
      return Response.json({ success: false, error: 'أدخل نوع الرسالة والمحتوى' });
    }

    if (!message.trim() || message.trim().length < 5) {
      return Response.json({ success: false, error: 'الرسالة قصيرة جداً' });
    }

    if (message.length > 2000) {
      return Response.json({ success: false, error: 'الرسالة طويلة جداً (حد أقصى 2000 حرف)' });
    }

    const webhookUrl = getLogWebhookUrl();
    if (!webhookUrl) {
      return Response.json({ success: false, error: 'الخدمة غير متوفرة حالياً' });
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

    // If Prime, mention high priority
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
      return Response.json({ success: false, error: 'فشل إرسال الرسالة' });
    }

    return Response.json({
      success: true,
      message: isPrime
        ? '✅ شكراً لك! بما أنك Prime، سيتم النظر في طلبك فوراً ⚡'
        : '✅ تم إرسال طلبك بنجاح! سيتم مراجعته قريباً',
      isPrime
    });

  } catch (error) {
    return Response.json({ success: false, error: 'خطأ في الخادم' });
  }
}
