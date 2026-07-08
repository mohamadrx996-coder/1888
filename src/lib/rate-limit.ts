/**
 * 1888 Smart Rate Limit System v5.0
 * - متدرج حسب نوع الميزة
 * - يدعم burst (طلبات متتالية سريعة)
 * - يدعم cooldown (فترة تهدئة)
 * - يمنع الـ abuse بشكل ذكي
 */

interface RateLimitEntry {
  timestamps: number[]
  burstCount: number  // عدد الطلبات السريعة المتتالية
  burstStart: number  // بداية الـ burst
  cooldownUntil: number  // فترة التهدئة
}

interface RateLimitConfig {
  maxRequests: number
  windowMs: number
  burstLimit?: number  // أقصى طلب في 3 ثواني
  cooldownMs?: number  // مدة التهدئة بعد الـ burst
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxRequests: 30,
  windowMs: 60000,
  burstLimit: 10,
  cooldownMs: 30000
}

const store = new Map<string, RateLimitEntry>()
let lastCleanup = Date.now()

function cleanup() {
  const now = Date.now()
  if (now - lastCleanup < 300000) return
  lastCleanup = now
  for (const [key, entry] of store) {
    if (entry.timestamps.length > 0 && entry.timestamps[0] < now - 600000 && entry.cooldownUntil < now) {
      store.delete(key)
    }
  }
}

export function rateLimit(
  key: string,
  config: Partial<RateLimitConfig> = {}
): { limited: boolean; remaining: number; resetAt: number; cooldownActive: boolean } {
  cleanup()

  const { maxRequests, windowMs, burstLimit, cooldownMs } = { ...DEFAULT_CONFIG, ...config }
  const now = Date.now()
  const windowStart = now - windowMs

  let entry = store.get(key)
  if (!entry) {
    entry = { timestamps: [], burstCount: 0, burstStart: 0, cooldownUntil: 0 }
    store.set(key, entry)
  }

  // تحقق من فترة التهدئة
  if (entry.cooldownUntil > now) {
    return {
      limited: true,
      remaining: 0,
      resetAt: entry.cooldownUntil,
      cooldownActive: true
    }
  }

  entry.timestamps = entry.timestamps.filter(t => t > windowStart)

  // تحقق من الـ burst (طلبات سريعة متتالية في 3 ثواني)
  if (burstLimit && burstLimit > 0) {
    const burstWindow = 3000
    if (now - entry.burstStart > burstWindow) {
      entry.burstStart = now
      entry.burstCount = 1
    } else {
      entry.burstCount++
      if (entry.burstCount > burstLimit) {
        // فعّل فترة تهدئة
        entry.cooldownUntil = now + (cooldownMs || 30000)
        return {
          limited: true,
          remaining: 0,
          resetAt: entry.cooldownUntil,
          cooldownActive: true
        }
      }
    }
  }

  // تحقق من الحد الأقصى في النافذة
  if (entry.timestamps.length >= maxRequests) {
    const oldestInWindow = entry.timestamps[0]
    return {
      limited: true,
      remaining: 0,
      resetAt: oldestInWindow + windowMs,
      cooldownActive: false
    }
  }

  entry.timestamps.push(now)
  const remaining = maxRequests - entry.timestamps.length

  return {
    limited: false,
    remaining,
    resetAt: now + windowMs,
    cooldownActive: false
  }
}

export function getClientIp(request: Request): string {
  const cfIp = request.headers.get('CF-Connecting-IP')
  if (cfIp) return cfIp

  const xff = request.headers.get('X-Forwarded-For')
  if (xff) return xff.split(',')[0].trim()

  const realIp = request.headers.get('X-Real-IP')
  if (realIp) return realIp

  return 'unknown'
}

/**
 * تكوينات Rate Limit ذكية حسب نوع الميزة
 */
export const RATE_LIMITS = {
  /** ميزات ثقيلة جداً (nuker, copy, account-destruction) */
  heavy: { maxRequests: 3, windowMs: 60000, burstLimit: 2, cooldownMs: 60000 },
  /** ميزات ثقيلة (forum-nuker, slash-spam, account-wiper) */
  semi_heavy: { maxRequests: 5, windowMs: 60000, burstLimit: 3, cooldownMs: 45000 },
  /** ميزات متوسطة (spam, leveling, webhook) */
  medium: { maxRequests: 10, windowMs: 60000, burstLimit: 5, cooldownMs: 30000 },
  /** ميزات خفيفة (verify, info) */
  light: { maxRequests: 20, windowMs: 60000, burstLimit: 10, cooldownMs: 15000 },
  /** ميزات حساسة (token-gen, token-checker) */
  sensitive: { maxRequests: 5, windowMs: 60000, burstLimit: 2, cooldownMs: 60000 },
  /** افتراضي */
  default: { maxRequests: 15, windowMs: 60000, burstLimit: 7, cooldownMs: 30000 },
} as const
