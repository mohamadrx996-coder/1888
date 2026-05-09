
import { NextRequest, NextResponse } from 'next/server';
import { activateWithKey, ADMIN_CODE } from '@/lib/prime-store';
import { sendToWebhook } from '@/lib/webhook';
import { getLogWebhookUrl } from '@/lib/config';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { adminCode, targetUserId } = body;

    if (!adminCode || adminCode !== ADMIN_CODE) {
      return NextResponse.json({ success: false, error: 'Invalid admin code' }, { status: 403 });
    }

    if (!targetUserId || typeof targetUserId !== 'string') {
      return NextResponse.json({ success: false, error: 'targetUserId is required' }, { status: 400 });
    }

    activateWithKey(targetUserId, 'admin');

    sendToWebhook({
      embeds: [{
        title: '👑 Prime Manually Activated (Admin API)',
        description: `Prime has been manually given to <@${targetUserId}> via admin panel`,
        color: 0xE74C3C,
        fields: [
          { name: '👤 Target User', value: `${targetUserId}`, inline: true },
          { name: '🔑 Method', value: 'Admin Panel API', inline: true },
          { name: '⏰ Time', value: new Date().toISOString(), inline: true },
        ],
        timestamp: new Date().toISOString(),
      }],
    }, getLogWebhookUrl()).catch(() => {});

    return NextResponse.json({ success: true, message: `Prime activated for ${targetUserId}` });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

