import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'

// ===== عداد زيارات بسيط =====
// كل ريفريش = زيارة +1

const KV_REST_API_URL = process.env.KV_REST_API_URL || ''
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN || ''
const hasKV = KV_REST_API_URL.length > 0 && KV_REST_API_TOKEN.length > 0

// In-memory fallback
let memTotal = 0

async function kvGet(key: string): Promise<any> {
  if (!hasKV) return null
  try {
    const res = await fetch(KV_REST_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['GET', key]),
    })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

async function kvSet(key: string, value: string, ex?: number): Promise<void> {
  if (!hasKV) return
  try {
    const args = ex ? ['SET', key, value, 'EX', String(ex)] : ['SET', key, value]
    await fetch(KV_REST_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    })
  } catch {}
}

async function kvIncr(key: string): Promise<number> {
  if (!hasKV) return 0
  try {
    const res = await fetch(KV_REST_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['INCR', key]),
    })
    if (!res.ok) return 0
    return Number(await res.json()) || 0
  } catch { return 0 }
}

export async function GET(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`${ip}:visitor-get`, RATE_LIMITS.light)
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح' }, { status: 429 })
    }

    let total = 0

    if (hasKV) {
      total = await kvIncr('v:total')
    } else {
      memTotal++
      total = memTotal
    }

    return NextResponse.json({
      success: true,
      total,
    })
  } catch (error: any) {
    console.error('Visitor Error:', error)
    return NextResponse.json({ success: false, error: error.message || 'خطأ' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`${ip}:visitor-post`, RATE_LIMITS.light)
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح' }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const { action } = body

    if (action === 'ping') {
      let total = 0
      if (hasKV) {
        const val = await kvGet('v:total')
        total = Number(val) || 0
      } else {
        total = memTotal
      }
      return NextResponse.json({ success: true, total })
    }

    return NextResponse.json({ success: true, total: hasKV ? Number(await kvGet('v:total')) || 0 : memTotal })
  } catch (error: any) {
    console.error('Visitor POST Error:', error)
    return NextResponse.json({ success: false, error: error.message || 'خطأ' }, { status: 500 })
  }
}
