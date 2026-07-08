import { NextRequest, NextResponse } from 'next/server'
import { incrementUsersCount } from '@/lib/api-handlers/visitor-count'

/* ===== 1888 User Action Tracker =====
 * يُستدعى من العميل عندما يستخدم المستخدم أي ميزة تتطلب توكن
 * يزيد عداد المستخدمين العالمي +1 (مرة واحدة لكل جلسة)
 */

export async function POST(request: NextRequest) {
  try {
    await incrementUsersCount()
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ success: false }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ success: true, feature: '1888 User Action Tracker' })
}
