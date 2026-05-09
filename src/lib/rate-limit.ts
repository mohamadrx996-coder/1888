// Edge Runtime Rate Limiter - IP-based with sliding window
// Compatible with Cloudflare Workers / Edge Runtime

interface RateLimitEntry {
  timestamps: number[];
}

interface RateLimitConfig {
  /** Max requests in the window */
  maxRequests: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxRequests: 30,
  windowMs: 60000, // 1 minute
}

// Per-IP rate limit store (Edge-compatible Map)
const store = new Map<string, RateLimitEntry>();

// Auto-cleanup old entries every 5 minutes
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < 300000) return; // 5 min
  lastCleanup = now;
  for (const [key, entry] of store) {
    // Remove entries older than 10 minutes
    if (entry.timestamps.length > 0 && entry.timestamps[0] < now - 600000) {
      store.delete(key);
    }
  }
}

/**
 * Check rate limit for a given key (usually IP + endpoint)
 * @returns { limited: boolean, remaining: number, resetAt: number }
 */
export function rateLimit(
  key: string,
  config: Partial<RateLimitConfig> = {}
): { limited: boolean; remaining: number; resetAt: number } {
  cleanup();

  const { maxRequests, windowMs } = { ...DEFAULT_CONFIG, ...config };
  const now = Date.now();
  const windowStart = now - windowMs;

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Filter out timestamps outside the window
  entry.timestamps = entry.timestamps.filter(t => t > windowStart);

  if (entry.timestamps.length >= maxRequests) {
    const oldestInWindow = entry.timestamps[0];
    return {
      limited: true,
      remaining: 0,
      resetAt: oldestInWindow + windowMs,
    };
  }

  entry.timestamps.push(now);
  const remaining = maxRequests - entry.timestamps.length;

  return {
    limited: false,
    remaining,
    resetAt: now + windowMs,
  };
}

/**
 * Get client IP from request (works with Cloudflare CF-Connecting-IP header)
 */
export function getClientIp(request: Request): string {
  // Cloudflare
  const cfIp = request.headers.get('CF-Connecting-IP');
  if (cfIp) return cfIp;

  // Standard proxies
  const xff = request.headers.get('X-Forwarded-For');
  if (xff) return xff.split(',')[0].trim();

  // Fallback
  const realIp = request.headers.get('X-Real-IP');
  if (realIp) return realIp;

  return 'unknown';
}

/**
 * Rate limit configurations for different endpoint types
 */
export const RATE_LIMITS = {
  /** Heavy endpoints (nuker, copy, backup) */
  heavy: { maxRequests: 5, windowMs: 60000 },
  /** Medium endpoints (spam, leveling, webhook) */
  medium: { maxRequests: 15, windowMs: 60000 },
  /** Light endpoints (verify, info) */
  light: { maxRequests: 30, windowMs: 60000 },
  /** Token generator / checker - very limited */
  sensitive: { maxRequests: 8, windowMs: 60000 },
  /** Default */
  default: { maxRequests: 20, windowMs: 60000 },
} as const;
