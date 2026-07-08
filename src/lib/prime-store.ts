// src/lib/prime-store.ts - 1888 Prime System v7.0
// نظام Signed Tokens + مفاتيح ذاتية التحقق (Stateless)
// - المفاتيح تحتوي checksum مدمج = تعمل عبر كل Edge instances بدون ذاكرة مشتركة
// - التحقق فوري ومحلي = موثوق 100%

export const ADMIN_KEY = 'PyGenlol'
const PRIME_SECRET = '1888-prime-secret-key-2025-trojan'
const KEY_SECRET = '1888-prime-key-hmac-2025-trojan'
const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 32 chars (no confusing 0/O/1/I)

// ===== توليد Prime Proof (يُولّد مرة واحدة عند التفعيل) =====
export async function generatePrimeProof(userId: string, key: string): Promise<string> {
  const data = `${userId}|${key}|${PRIME_SECRET}`
  const encoder = new TextEncoder()
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data))
  const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
  // base64 encode (Edge-safe)
  const raw = `${userId}|${key}|${hash}`
  return btoa(raw)
}

// ===== التحقق من Prime Proof (فوري - بدون API خارجي) =====
export async function verifyPrimeProof(proof: string): Promise<{ valid: boolean; userId?: string; key?: string }> {
  try {
    if (!proof || typeof proof !== 'string') return { valid: false }
    const decoded = atob(proof)
    const parts = decoded.split('|')
    if (parts.length !== 3) return { valid: false }
    const [userId, key, hash] = parts
    if (!userId || !key || !hash) return { valid: false }

    // أعد حساب الـ hash
    const data = `${userId}|${key}|${PRIME_SECRET}`
    const encoder = new TextEncoder()
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data))
    const expectedHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')

    if (hash === expectedHash) {
      return { valid: true, userId, key }
    }
    return { valid: false }
  } catch {
    return { valid: false }
  }
}

// ===== فحص Prime من request body =====
export async function checkPrimeFromProof(primeProof: string | undefined, expectedUserId: string): Promise<boolean> {
  if (!primeProof) return false
  const result = await verifyPrimeProof(primeProof)
  return result.valid && result.userId === expectedUserId
}

// ===== Admin Key =====
export function isAdminKey(key: string): boolean {
  return key === ADMIN_KEY
}

// ===== Hash متزامن لإنشاء checksum المفتاح (Edge-safe) =====
function keyChecksum(randomPart: string): string {
  // DJB2-style hash مع الـ secret
  let hash = 5381
  const data = randomPart + KEY_SECRET
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) + hash + data.charCodeAt(i)) | 0
  }
  // خذ 4 أحرف من الـ alphabet
  let result = ''
  let h = Math.abs(hash)
  for (let i = 0; i < 4; i++) {
    result += KEY_ALPHABET[h % 32]
    h = Math.floor(h / 32)
  }
  return result
}

// ===== توليد مفتاح Prime ذاتي التحقق =====
// الصيغة: XXXX-XXXX-XXXX-XXXX
// - أول 12 حرف: عشوائي
// - آخر 4 أحرف: checksum(أول 12 + KEY_SECRET)
// التحقق: أعد حساب الـ checksum وقارن — لا يحتاج ذاكرة مشتركة!
export function generatePrimeKey(): string {
  let randomPart = ''
  for (let i = 0; i < 12; i++) {
    randomPart += KEY_ALPHABET[Math.floor(Math.random() * 32)]
  }
  const checksum = keyChecksum(randomPart)
  const fullKey = randomPart + checksum
  return fullKey.match(/.{1,4}/g)!.join('-')
}

// ===== فحص ذتي (Stateless) لو المفتاح صالح =====
// لا يحتاج ذاكرة — الـ checksum مدمج في المفتاح نفسه
export function isKeyRegistered(key: string): boolean {
  if (!key || typeof key !== 'string') return false
  const clean = key.replace(/-/g, '').toUpperCase()
  if (clean.length !== 16) return false
  // تحقق إن كل الأحرف من الـ alphabet
  for (const c of clean) {
    if (!KEY_ALPHABET.includes(c)) return false
  }
  const randomPart = clean.substring(0, 12)
  const checksum = clean.substring(12, 16)
  const expectedChecksum = keyChecksum(randomPart)
  return checksum === expectedChecksum
}

// ===== ذاكرة محلية لتتبع المفاتيح المولّدة والمستخدمة (للعرض فقط) =====
// ملاحظة: في الإنتاج مع Edge instances متعددة، هذه القائمة قد تكون ناقصة
// لكن التحقق من صحة المفتاح (isKeyRegistered) يعمل بشكل كامل stateless
const generatedKeys: { key: string; createdAt: number }[] = []
const usedKeys = new Set<string>()
interface PrimeUserRecord { userId: string; username: string; key: string; activatedAt: number }
const primeUsers: PrimeUserRecord[] = []

// ===== تسجيل مفتاح جديد (للعرض في لوحة الأدمن) =====
export function registerKey(key: string): void {
  if (!generatedKeys.find(k => k.key === key)) {
    generatedKeys.push({ key, createdAt: Date.now() })
  }
}

// ===== المفاتيح المستخدمة (in-memory - للعرض فقط) =====
export function markKeyUsed(key: string): void {
  usedKeys.add(key)
}

export function isKeyUsed(key: string): boolean {
  return usedKeys.has(key)
}

export function recordPrimeUser(userId: string, username: string, key: string): void {
  const exists = primeUsers.find(u => u.userId === userId && u.key === key)
  if (!exists) primeUsers.push({ userId, username, key, activatedAt: Date.now() })
}

// ===== قائمة المفاتيح (للأدمن) =====
export function listAllKeys(): { key: string; used: boolean; usedBy?: string; createdAt?: number }[] {
  return generatedKeys.map(k => ({
    key: k.key,
    createdAt: k.createdAt,
    used: usedKeys.has(k.key),
    usedBy: primeUsers.find(u => u.key === k.key)?.username
  }))
}

// ===== قائمة المستخدمين النشطين (للأدمن) =====
export function listAllPrimeUsers(): PrimeUserRecord[] {
  return primeUsers.slice()
}

// ===== إنشاء مفتاح + تسجيله =====
export function createPrimeKey(): { key: string; createdAt: number } {
  const key = generatePrimeKey()
  registerKey(key)
  return { key, createdAt: Date.now() }
}

// ===== تفعيل كامل =====
export async function activateKey(
  key: string,
  userId: string,
  username: string
): Promise<{ success: boolean; error?: string; transferred?: boolean; proof?: string }> {
  // 1. تحقق ذتي (Stateless) من صحة المفتاح — يعمل عبر كل Edge instances
  if (!isKeyRegistered(key)) {
    return { success: false, error: 'مفتاح غير صحيح أو منتهي الصلاحية' }
  }

  // 2. علّم المفتاح كمستخدم (للعرض في لوحة الأدمن)
  markKeyUsed(key)
  recordPrimeUser(userId, username, key)

  // 3. ولّد الـ proof
  const proof = await generatePrimeProof(userId, key)

  return { success: true, proof, transferred: false }
}
