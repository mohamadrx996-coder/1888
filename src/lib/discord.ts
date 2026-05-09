// src/lib/discord.ts - دالة موحدة للتعامل مع Discord API - محسّن v6

// @ts-ignore - accessible from all routes
export const DISCORD_API: string = 'https://discord.com/api/v10';

export interface DiscordResult {
  ok: boolean;
  data?: unknown;
  status: number;
}

interface DiscordFetchOptions {
  botOnly?: boolean;
  userOnly?: boolean;
  timeout?: number;
}

export function cleanToken(token: string): string {
  return String(token || '').trim().replace(/^(Bot |bearer |Bearer )/i, '');
}

// Auth cache - يحفظ النوع الصحيح بعد الكشف
const authCache = new Map<string, string>();

// Rate limit tracker
let globalRLUntil = 0;

async function smartSleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

export async function discordFetch(
  token: string,
  method: string,
  endpoint: string,
  body?: unknown,
  options: DiscordFetchOptions = {}
): Promise<DiscordResult> {
  const ct = cleanToken(token);
  const url = endpoint.startsWith('http')
    ? endpoint
    : endpoint.startsWith('/')
      ? `${DISCORD_API}${endpoint}`
      : `${DISCORD_API}/${endpoint}`;

  const { botOnly = false, userOnly = false, timeout = 15000 } = options;

  // انتظر global rate limit
  const now = Date.now();
  if (now < globalRLUntil) {
    await smartSleep(globalRLUntil - now + 100);
  }

  // تحقق من الكاش أولاً
  const cacheKey = ct;
  if (authCache.has(cacheKey)) {
    const cachedAuth = authCache.get(cacheKey)!;
    // تجاهل الكاش لو نوع المصادقة غير متوافق مع الخيارات
    if (userOnly && cachedAuth.startsWith('Bot ')) {
      authCache.delete(cacheKey);
    } else if (botOnly && !cachedAuth.startsWith('Bot ')) {
      authCache.delete(cacheKey);
    } else {
      const result = await doFetch(cachedAuth, method, url, body, timeout);
      if (result.status !== 401) return result;
      // لو فشل، حذف من الكاش
      authCache.delete(cacheKey);
    }
  }

  // كشف النوع
  let authMethods: string[];
  if (botOnly) {
    authMethods = [`Bot ${ct}`];
  } else if (userOnly) {
    authMethods = [ct];
  } else {
    // جرب User أولاً (أسرع لو هو user token)
    authMethods = [ct, `Bot ${ct}`];
  }

  let lastError: DiscordResult = { ok: false, status: 0 };

  for (const auth of authMethods) {
    const result = await doFetch(auth, method, url, body, timeout);

    if (result.status === 429) {
      // Rate limit - عودة للانتظار
      return result;
    }

    if (result.ok || result.status === 204) {
      // نجاح - احفظ في الكاش
      if (!authCache.has(cacheKey)) authCache.set(cacheKey, auth);
      return result;
    }

    if (result.status === 401) {
      // Auth خاطئ - جرب الطريقة الثانية
      lastError = result;
      continue;
    }

    // خطأ آخر (403, 404, etc.) - ارجع النتيجة
    return result;
  }

  return lastError;
}

async function doFetch(
  auth: string,
  method: string,
  url: string,
  body?: unknown,
  timeout = 15000,
): Promise<DiscordResult> {
  const headers: Record<string, string> = {
    'Authorization': auth,
    'Accept': 'application/json',
  };

  if (method !== 'GET' && method !== 'HEAD') {
    headers['Content-Type'] = 'application/json';
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const fetchBody = (method !== 'GET' && method !== 'HEAD' && body) ? JSON.stringify(body) : undefined;

    const res = await fetch(url, {
      method,
      headers,
      body: fetchBody,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    // Rate Limit
    if (res.status === 429) {
      try {
        const errData = await res.json() as { retry_after?: number };
        const wait = Math.min((errData.retry_after || 2) * 1000, 5000);
        globalRLUntil = Date.now() + wait;
        await smartSleep(wait);
      } catch {
        globalRLUntil = Date.now() + 2000;
        await smartSleep(2000);
      }
      return { ok: false, status: 429 };
    }

    if (res.status === 204) {
      return { ok: true, status: 204 };
    }

    if (res.ok) {
      try {
        const data = await res.json();
        return { ok: true, data, status: res.status };
      } catch {
        return { ok: true, status: res.status };
      }
    }

    try {
      const data = await res.json();
      return { ok: false, data, status: res.status };
    } catch {
      return { ok: false, status: res.status };
    }

  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') {
      return { ok: false, status: 0 };
    }
    return { ok: false, status: 0 };
  }
}

export async function batchProcess<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  batchSize = 15,
  delayBetweenBatches = 0
): Promise<{ results: R[]; successCount: number; failCount: number }> {
  const results: R[] = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map((item, idx) => fn(item, i + idx))
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
        successCount++;
      } else {
        failCount++;
      }
    }

    if (delayBetweenBatches > 0 && i + batchSize < items.length) {
      await new Promise(r => setTimeout(r, delayBetweenBatches));
    }
  }

  return { results, successCount, failCount };
}

export function resetGlobalRL() {
  globalRLUntil = 0;
}

export function getGlobalRLState() {
  return { until: globalRLUntil };
}
