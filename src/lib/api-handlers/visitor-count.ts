import { NextRequest, NextResponse } from 'next/server';

// ===================================================================
// عداد الزيارات - حفظ دائم باستخدام counterapi.dev (مجاني - بدون مفتاح)
// العداد لا يرست أبداً - عنوان ثابت
// ===================================================================

const COUNTER_NAMESPACE = 'trj-bot-v4';
const COUNTER_NAME = 'total-visits';

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
// GET - زيادة العداد + عرض
// ===================================================================

export async function GET(request: NextRequest) {
  try {
    const ip = getIp(request);
    updateActive(ip);

    // زيادة العداد في counterapi.dev (ثابت - لا يضيع أبداً)
    let total = 0;
    try {
      const res = await fetch(
        `https://api.counterapi.dev/v1/${COUNTER_NAMESPACE}/${COUNTER_NAME}/up`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data && typeof data.count === 'number') total = data.count;
      }
    } catch { /* لو فشل نرجع 0 */ }

    return NextResponse.json({
      success: true,
      total,
      active: getActiveCount(),
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// ===================================================================
// POST - ping فقط
// ===================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const ip = getIp(request);

    if (body.action === 'ping') updateActive(ip);

    // قراءة العداد بدون زيادة
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
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
