import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

// ===================================================================
// عداد الزيارات - حفظ دائم باستخدام JSONBin.io
// total = إجمالي الزيارات الفريدة (لا ينقص أبداً)
// active = عدد المتواجدين الآن (آخر 3 دقائق)
// ===================================================================

declare global {
  var __trj_vis_bin_id: string | undefined;
  var __trj_vis_total: number | undefined;
  var __trj_vis_ips: string[] | undefined;
}

let binId: string = (typeof globalThis !== 'undefined' && globalThis.__trj_vis_bin_id) || '';
let totalVisits: number = (typeof globalThis !== 'undefined' && globalThis.__trj_vis_total) || 0;
let knownIps: string[] = (typeof globalThis !== 'undefined' && globalThis.__trj_vis_ips) || [];

// للعدد الفوري (RAM فقط - مسموح يضيع)
interface VisitorRecord { ip: string; lastSeen: number }
const activeVisitors: VisitorRecord[] = [];
const VISITOR_TIMEOUT = 180000; // 3 دقائق

if (typeof globalThis !== 'undefined') {
  globalThis.__trj_vis_bin_id = binId;
  globalThis.__trj_vis_total = totalVisits;
  globalThis.__trj_vis_ips = knownIps;
}

// ===================================================================
// JSONBin API
// ===================================================================

async function createBin(data: any): Promise<string | null> {
  try {
    const res = await fetch('https://api.jsonbin.io/v3/b', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bin-Private': 'false' },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    return json?.metadata?.id || null;
  } catch { return null; }
}

async function readBin(id: string): Promise<any | null> {
  try {
    const res = await fetch(`https://api.jsonbin.io/v3/b/${id}/latest`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    return json?.record || json?.data || null;
  } catch { return null; }
}

async function updateBin(id: string, data: any): Promise<boolean> {
  try {
    const res = await fetch(`https://api.jsonbin.io/v3/b/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch { return false; }
}

// ===================================================================
// حفظ وتحميل الإجمالي (فقط - بدون IPs الفردية عشان الحجم)
// ===================================================================

let saveQueued = false;
let lastSaveTime = 0;

async function saveTotal() {
  // لا نحفظ أكثر من مرة كل 5 ثواني
  const now = Date.now();
  if (now - lastSaveTime < 5000) {
    if (!saveQueued) {
      saveQueued = true;
      setTimeout(() => { saveQueued = false; saveTotal(); }, 5500);
    }
    return;
  }
  lastSaveTime = now;

  if (typeof globalThis !== 'undefined') {
    globalThis.__trj_vis_total = totalVisits;
  }

  if (binId) {
    await updateBin(binId, { total: totalVisits, updatedAt: now });
    return;
  }

  const newId = await createBin({ total: totalVisits, updatedAt: now });
  if (newId) {
    binId = newId;
    if (typeof globalThis !== 'undefined') {
      globalThis.__trj_vis_bin_id = binId;
    }
  }
}

async function loadTotal(): Promise<void> {
  if (totalVisits > 0) return; // عندنا بيانات بالفعل

  if (binId) {
    const data = await readBin(binId);
    if (data && typeof data.total === 'number') {
      totalVisits = data.total;
      if (typeof globalThis !== 'undefined') {
        globalThis.__trj_vis_total = totalVisits;
      }
    }
  }
}

// ===================================================================
// المتواجدين الآن (RAM فقط)
// ===================================================================

function getActiveCount(): number {
  const now = Date.now();
  while (activeVisitors.length > 0 && now - activeVisitors[0].lastSeen > VISITOR_TIMEOUT) {
    activeVisitors.shift();
  }
  return activeVisitors.length;
}

function updateActive(ip: string) {
  const existing = activeVisitors.find(v => v.ip === ip);
  if (existing) {
    existing.lastSeen = Date.now();
  } else {
    activeVisitors.push({ ip, lastSeen: Date.now() });
  }
}

// ===================================================================
// GET - زيارة + عرض العداد
// ===================================================================

function getIp(request: NextRequest): string {
  return request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown';
}

export async function GET(request: NextRequest) {
  try {
    const ip = getIp(request);
    const rl = rateLimit(`${ip}:visitor`, RATE_LIMITS.light);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد' }, { status: 429 });
    }

    // تحميل الإجمالي من JSONBin أول مرة
    await loadTotal();

    // زيارة جديدة؟
    const isNew = !knownIps.includes(ip);
    if (isNew) {
      knownIps.push(ip);
      totalVisits++;
      // حفظ الإجمالي في JSONBin (بعد أول زيارة جديدة)
      saveTotal();
    }

    // تحديث المتواجدين
    updateActive(ip);

    return NextResponse.json({
      success: true,
      total: totalVisits,
      active: getActiveCount(),
    });
  } catch (error: any) {
    console.error('Visitor GET Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const ip = getIp(request);

    if (body.action === 'ping') {
      updateActive(ip);
    }

    await loadTotal();

    return NextResponse.json({
      success: true,
      total: totalVisits,
      active: getActiveCount(),
    });
  } catch (error: any) {
    console.error('Visitor POST Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
