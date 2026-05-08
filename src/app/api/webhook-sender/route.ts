import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  try {
    // Rate Limiting
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:webhook-sender`, RATE_LIMITS.default);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }

    const body = await request.json().catch(() => ({}));
    const { url, message, username, avatar_url, embed } = body as {
      url?: string;
      message?: string;
      username?: string;
      avatar_url?: string;
      embed?: { 
        title?: string; 
        description?: string; 
        color?: number;
        image?: { url: string };
        thumbnail?: { url: string };
      };
    };

    if (!url) {
      return NextResponse.json({ success: false, error: 'أدخل رابط الويب هوك' }, { status: 400 });
    }
    if (!message && !embed) {
      return NextResponse.json({ success: false, error: 'أدخل الرسالة أو الإيمبد' }, { status: 400 });
    }

    // بناء الـ payload
    const payload: Record<string, unknown> = {
      content: message || '',
    };
    if (username) payload.username = username;
    if (avatar_url) payload.avatar_url = avatar_url;

    // إضافة الإيمبد إذا تم توفيره
    if (embed) {
      const embedObj: Record<string, unknown> = {};
      if (embed.title) embedObj.title = embed.title;
      if (embed.description) embedObj.description = embed.description;
      if (embed.color) embedObj.color = embed.color;
      if (embed.image?.url) embedObj.image = { url: embed.image.url };
      if (embed.thumbnail?.url) embedObj.thumbnail = { url: embed.thumbnail.url };
      embedObj.timestamp = new Date().toISOString();
      payload.embeds = [embedObj];
    }

    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(tid);

      if (res.status === 204 || res.ok) {
        return NextResponse.json({ success: true });
      }

      // محاولة قراءة خطأ Discord
      let errorDetail = 'فشل إرسال الرسالة عبر الويب هوك';
      try {
        const errData = await res.json() as { message?: string };
        if (errData.message) errorDetail = errData.message;
      } catch { /* ignore */ }

      return NextResponse.json({ success: false, error: errorDetail }, { status: res.status });
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') {
        return NextResponse.json({ success: false, error: 'انتهت مهلة إرسال الويب هوك' }, { status: 408 });
      }
      return NextResponse.json({ success: false, error: 'فشل الاتصال بالويب هوك - تأكد من صحة الرابط' }, { status: 502 });
    }

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
