// Edge Runtime compatible utility functions (replaces Node.js Buffer and crypto)

/**
 * Convert ArrayBuffer to base64 string (replaces Buffer.from(arrayBuffer).toString('base64'))
 */
export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert string to base64 (replaces Buffer.from(str).toString('base64'))
 */
export function stringToBase64(str: string): string {
  return btoa(unescape(encodeURIComponent(str)));
}

/**
 * Convert base64 to string (replaces Buffer.from(b64, 'base64').toString('utf-8'))
 */
export function base64ToString(b64: string): string {
  return decodeURIComponent(escape(atob(b64)));
}

/**
 * Convert Uint8Array to base64url string
 */
export function uint8ToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Convert string to base64url string
 */
export function stringToBase64Url(str: string): string {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Convert base64url to Uint8Array
 */
export function base64UrlToUint8(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert base64url to string (replaces Buffer.from(text, 'base64url').toString('utf-8'))
 */
export function base64UrlToString(base64url: string): string {
  const bytes = base64UrlToUint8(base64url);
  return new TextDecoder().decode(bytes);
}

/**
 * Get random bytes (replaces crypto.randomBytes)
 */
export function getRandomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * HMAC-SHA256 using Web Crypto API (replaces crypto.createHmac)
 */
export async function hmacSha256(keyBytes: Uint8Array, dataBytes: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, dataBytes));
}

/**
 * SHA-256 hash using Web Crypto API (replaces crypto.createHash('sha256'))
 */
export async function sha256(dataBytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', dataBytes));
}

/**
 * SHA-512 hash using Web Crypto API (replaces crypto.createHash('sha512'))
 */
export async function sha512(dataBytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-512', dataBytes));
}
