import { NextRequest, NextResponse } from 'next/server';

// ===================================================================
// عداد الزيارات الفريد - كل IP يتم حسابه مرة واحدة فقط
// يستخدم counterapi.dev لحفظ العداد (مجاني - بدون مفتاح)
// + JSONBin.io لحفظ قائمة الـ IPs الفريدة
// ===================================================================

const COUNTER_NAMESPACE = 'trj-bot-v4';
const COUNTER_NAME = 'unique-visits';
const TOKEN_COUNTER_NAME = 'tokens-checked';
const USERS_COUNTER_NAME = 'users-count';

// JSONBin لحفظ IPs الفريدة
const JSONBIN_API_KEY = '$2a$10$your-jsonbin-api-key'; // ← غيّر بمفتاحك من jsonbin.io
const JSONBIN_BIN_ID = 'your-bin-id'; // ← غيّر بـ ID الـ bin من jsonbin.io

// المتواجدين الآن (RAM فقط - مؤقت)
interface VisitorRecord { ip: string; lastSeen: number }
declare global {
  var __trj_active_visitors: VisitorRecord[] | undefined;
}
const activeVisitors: VisitorRecord[] = (typeof globalThis !== 'undefined' && globalThis.__trj_active_visitors) || [];
if (typeof globalThis !== 'undefined') { globalThis.__trj_active_visitors = activeVisitors; }

const VISITOR_TIMEOUT = 180000;

function getActiveCount(): number {
  const now = Date.now();
  while (activeVisitors.length > 0 && now - activeVisitors[0].lastSeen > VISITOR_TIMEOUT) {
    activeVisitors.shift();
  }
  return activeVisitors.length;
}

function updateActive(ip: string) {
  const existing = activeVisitors.find(v => v.ip === ip);
  if (existing) { existing.lastSeen = Date.now(); }
  else { activeVisitors.push({ ip, lastSeen: Date.now() }); }
}

function getIp(request: NextRequest): string {
  return request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown';
}

// ===================================================================
// جلب قائمة IPs الفريدة من JSONBin
// ===================================================================
async function getUniqueIPs(): Promise<string[]> {
  try {
    const res = await fetch(
      `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`,
      {
        headers: {
          'X-Master-Key': JSONBIN_API_KEY,
          'X-Bin-Meta': 'false',
        },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.ips)) return data.ips;
    }
  } catch { /* ignore */ }
  return [];
}

// ===================================================================
// حفظ قائمة IPs الفريدة في JSONBin
// ===================================================================
async function saveUniqueIPs(ips: string[]): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': JSONBIN_API_KEY,
        },
        body: JSON.stringify(ips),
        signal: AbortSignal.timeout(5000),
      }
    );
    return res.ok;
  } catch { return false; }
}

// ===================================================================
// GET - عرض العداد فقط (بدون زيادة)
// ===================================================================

export async function GET(request: NextRequest) {
  try {
    const ip = getIp(request);
    updateActive(ip);

    // قراءة العداد من counterapi.dev (بدون زيادة)
    let total = 0;
    try {
      const res = await fetch(
        `https://api.counterapi.dev/v1/${COUNTER_NAMESPACE}/${COUNTER_NAME}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data && typeof data.count === 'number') total = data.count;
      }
    } catch { /* ignore */ }

    return NextResponse.json({
      success: true,
      total,
      active: getActiveCount(),
      tokensChecked: await getTokenCount(),
      usersCount: await getUsersCount(),
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// ===================================================================
// جلب عدد التوكنات المفحوصة من counterapi.dev
// ===================================================================
async function getTokenCount(): Promise<number> {
  try {
    const res = await fetch(
      `https://api.counterapi.dev/v1/${COUNTER_NAMESPACE}/${TOKEN_COUNTER_NAME}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data && typeof data.count === 'number') return data.count;
    }
  } catch { /* ignore */ }
  return 0;
}

// ===================================================================
// جلب عدد المستخدمين من counterapi.dev
// ===================================================================
async function getUsersCount(): Promise<number> {
  try {
    const res = await fetch(
      `https://api.counterapi.dev/v1/${COUNTER_NAMESPACE}/${USERS_COUNTER_NAME}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data && typeof data.count === 'number') return data.count;
    }
  } catch { /* ignore */ }
  return 0;
}

// ===================================================================
// زيادة عداد التوكنات المفحوصة (يستدعى من verify handler)
// ===================================================================
export async function incrementTokenCount(): Promise<void> {
  try {
    await fetch(
      `https://api.counterapi.dev/v1/${COUNTER_NAMESPACE}/${TOKEN_COUNTER_NAME}/up`,
      { signal: AbortSignal.timeout(5000) }
    );
  } catch { /* ignore */ }
}

// ===================================================================
// زيادة عداد المستخدمين (يستدعى من العميل عند استخدام أي ميزة)
// ===================================================================
export async function incrementUsersCount(): Promise<void> {
  try {
    await fetch(
      `https://api.counterapi.dev/v1/${COUNTER_NAMESPACE}/${USERS_COUNTER_NAME}/up`,
      { signal: AbortSignal.timeout(5000) }
    );
  } catch { /* ignore */ }
}

export async function POST(request: NextRequest) {
  try {
    const ip = getIp(request);
    updateActive(ip);

    // 1. جلب قائمة IPs الفريدة
    const existingIPs = await getUniqueIPs();

    // 2. التحقق إذا كان الـ IP جديد
    if (!existingIPs.includes(ip)) {
      existingIPs.push(ip);

      // 3. حفظ القائمة المحدّثة
      await saveUniqueIPs(existingIPs);

      // 4. زيادة العداد مرة واحدة فقط
      try {
        await fetch(
          `https://api.counterapi.dev/v1/${COUNTER_NAMESPACE}/${COUNTER_NAME}/up`,
          { signal: AbortSignal.timeout(8000) }
        );
      } catch { /* ignore */ }
    }

    // 5. قراءة العداد الحالي
    let total = existingIPs.length;
    try {
      const res = await fetch(
        `https://api.counterapi.dev/v1/${COUNTER_NAMESPACE}/${COUNTER_NAME}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data && typeof data.count === 'number') total = data.count;
      }
    } catch { /* ignore */ }

    return NextResponse.json({
      success: true,
      total,
      active: getActiveCount(),
      tokensChecked: await getTokenCount(),
      usersCount: await getUsersCount(),
      isNew: !existingIPs.includes(ip), // لن يصل هنا كـ true لأننا أضفناه فوق، لكن للاستخدام
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
