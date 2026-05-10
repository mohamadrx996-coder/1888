import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

// ===== Vercel KV Setup =====
// الفايل يستخدم Vercel KV لحفظ البيانات مشتركة بين كل السيرفرات
// مجاني - خطوات التفعيل بالأسفل

const VISITOR_TIMEOUT = 180; // 3 دقائق بالثواني
const KV_REST_API_URL = process.env.KV_REST_API_URL || '';
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN || '';
const hasKV = KV_REST_API_URL.length > 0 && KV_REST_API_TOKEN.length > 0;

// In-memory fallback لو KV مو مفعل
interface VisitorRecord {
  ip: string;
  lastSeen: number;
}
const memVisitors: VisitorRecord[] = [];
let memTotal = 0;
const memIps = new Set<string>();

function memCleanup() {
  const now = Date.now();
  while (memVisitors.length > 0 && now - memVisitors[0].lastSeen > VISITOR_TIMEOUT * 1000) {
    memVisitors.shift();
  }
}

// ===== KV REST API (بدون npm package) =====
async function kvCommand(...args: (string | number)[]): Promise<any> {
  if (!hasKV) return null;
  try {
    const res = await fetch(KV_REST_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function getIp(request: NextRequest): string {
  return request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown';
}

export async function GET(request: NextRequest) {
  try {
    const ip = getIp(request);
    const rl = rateLimit(`${ip}:visitor-get`, RATE_LIMITS.light);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429 });
    }

    // ===== لو Vercel KV مفعل =====
    if (hasKV) {
      const now = Date.now();
      const ipKey = `v:ip:${ip.replace(/[^a-f0-9.:]/g, '')}`;

      // التحقق هل الزائر جديد
      const exists = await kvCommand('GET', ipKey);
      const isNew = !exists;

      if (isNew) {
        await kvCommand('SET', ipKey, '1', 'EX', '86400'); // 24 ساعة
        await kvCommand('INCR', 'v:total');
      }

      // تحديث النشاط
      await kvCommand('HSET', 'v:active', ip.replace(/[^a-f0-9.:]/g, ''), String(now));
      await kvCommand('EXPIRE', 'v:active', String(VISITOR_TIMEOUT));

      // تنظيف الزوار المنتهيين وحساب النشط
      const activeData = await kvCommand('HGETALL', 'v:active');
      let activeCount = 0;
      const expiredKeys: string[] = [];

      // HGETALL returns flat array: [key1, val1, key2, val2, ...]
      if (Array.isArray(activeData)) {
        for (let i = 0; i < activeData.length; i += 2) {
          const ts = parseInt(activeData[i + 1]);
          if (now - ts > VISITOR_TIMEOUT * 1000) {
            expiredKeys.push(activeData[i]);
          } else {
            activeCount++;
          }
        }
      }

      // حذف المنتهيين
      if (expiredKeys.length > 0) {
        for (const ek of expiredKeys.slice(0, 10)) {
          await kvCommand('HDEL', 'v:active', ek);
        }
      }

      const total = await kvCommand('GET', 'v:total');

      return NextResponse.json({
        success: true,
        total: Number(total) || 0,
        active: activeCount,
        isNew,
      });
    }

    // ===== Fallback: In-memory =====
    const isNew = !memIps.has(ip);
    if (isNew) {
      memIps.add(ip);
      memTotal++;
    }

    const existing = memVisitors.find(v => v.ip === ip);
    if (existing) {
      existing.lastSeen = Date.now();
    } else {
      memVisitors.push({ ip, lastSeen: Date.now() });
    }

    memCleanup();

    return NextResponse.json({
      success: true,
      total: memTotal,
      active: memVisitors.length,
      isNew,
    });
  } catch (error: any) {
    console.error('Visitor GET Error:', error);
    return NextResponse.json({ success: false, error: error.message || 'حدث خطأ' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { action } = body;
    const ip = getIp(request);

    if (action === 'ping') {
      // ===== لو Vercel KV مفعل =====
      if (hasKV) {
        const now = Date.now();
        const safeIp = ip.replace(/[^a-f0-9.:]/g, '');

        await kvCommand('HSET', 'v:active', safeIp, String(now));
        await kvCommand('EXPIRE', 'v:active', String(VISITOR_TIMEOUT));

        // حساب النشط
        const activeData = await kvCommand('HGETALL', 'v:active');
        let activeCount = 0;
        if (Array.isArray(activeData)) {
          for (let i = 0; i < activeData.length; i += 2) {
            const ts = parseInt(activeData[i + 1]);
            if (now - ts <= VISITOR_TIMEOUT * 1000) {
              activeCount++;
            }
          }
        }

        const total = await kvCommand('GET', 'v:total');

        return NextResponse.json({
          success: true,
          total: Number(total) || 0,
          active: activeCount,
        });
      }

      // ===== Fallback =====
      const existing = memVisitors.find(v => v.ip === ip);
      if (existing) {
        existing.lastSeen = Date.now();
      } else {
        const isNew = !memIps.has(ip);
        if (isNew) { memIps.add(ip); memTotal++; }
        memVisitors.push({ ip, lastSeen: Date.now() });
      }
      memCleanup();

      return NextResponse.json({
        success: true,
        total: memTotal,
        active: memVisitors.length,
      });
    }

    // Default response
    const total = hasKV ? (Number(await kvCommand('GET', 'v:total')) || 0) : memTotal;
    const active = hasKV ? 0 : (() => { memCleanup(); return memVisitors.length; })();

    return NextResponse.json({
      success: true,
      total,
      active,
    });
  } catch (error: any) {
    console.error('Visitor POST Error:', error);
    return NextResponse.json({ success: false, error: error.message || 'حدث خطأ' }, { status: 500 });
  }
}
