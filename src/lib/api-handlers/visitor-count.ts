import { NextRequest, NextResponse } from 'next/server';

// Track visitors with timestamps for accurate active count
interface VisitorRecord {
  ip: string;
  lastSeen: number;
}

declare global {
  var __trj_visitors: VisitorRecord[] | undefined;
  var __trj_total_visits: number | undefined;
}

const visitors: VisitorRecord[] = (typeof globalThis !== 'undefined' && globalThis.__trj_visitors) || [];
let totalVisits: number = (typeof globalThis !== 'undefined' && globalThis.__trj_total_visits) || 0;

if (typeof globalThis !== 'undefined') {
  globalThis.__trj_visitors = visitors;
  globalThis.__trj_total_visits = totalVisits;
}

const VISITOR_TIMEOUT = 120000; // 2 minutes

function cleanup() {
  const now = Date.now();
  while (visitors.length > 0 && now - visitors[0].lastSeen > VISITOR_TIMEOUT) {
    visitors.shift();
  }
}

function getActiveCount(): number {
  cleanup();
  return visitors.length;
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get('CF-Connecting-IP') ||
             request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
             request.ip ||
             'unknown';

  totalVisits++;

  // Update or add visitor
  const existing = visitors.find(v => v.ip === ip);
  if (existing) {
    existing.lastSeen = Date.now();
  } else {
    visitors.push({ ip, lastSeen: Date.now() });
  }

  // Persist
  if (typeof globalThis !== 'undefined') {
    globalThis.__trj_total_visits = totalVisits;
  }

  return NextResponse.json({
    success: true,
    total: totalVisits,
    active: getActiveCount(),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { action } = body;

  if (action === 'ping') {
    const ip = request.headers.get('CF-Connecting-IP') ||
               request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
               request.ip ||
               'unknown';

    const existing = visitors.find(v => v.ip === ip);
    if (existing) {
      existing.lastSeen = Date.now();
    } else {
      visitors.push({ ip, lastSeen: Date.now() });
    }

    return NextResponse.json({
      success: true,
      total: totalVisits,
      active: getActiveCount(),
    });
  }

  return NextResponse.json({
    success: true,
    total: totalVisits,
    active: getActiveCount(),
  });
}
