// src/lib/prime-store.ts - Prime activation storage - TRJ BOT v4.3

export const PRIME_KEY = 'lolezfuck';
export const ADMIN_CODE = 'ezlolyou';
export const OWNER_ID = '1460035924250333376';
export const PRIME_PRICE = 2000000;
export const SERVER_INVITE = 'https://discord.gg/MpwvCypA66';

/** Stores userId -> activation data for key activations */
export interface PrimeActivation {
  userId: string;
  username: string;
  activatedAt: number;
  method: string;
}

export const KEY_ACTIVATIONS = new Map<string, PrimeActivation>();

/** Stores userId -> { serverId, timestamp } for server-post activations */
export interface ServerPostActivation {
  userId: string;
  username: string;
  activatedAt: number;
  code: string;
}

export const SERVER_POST_ACTIVATIONS = new Map<string, ServerPostActivation>();

/** Check if a user has Prime (either via key or server-post) */
export function hasPrime(userId: string): boolean {
  if (KEY_ACTIVATIONS.has(userId)) return true;
  if (SERVER_POST_ACTIVATIONS.has(userId)) return true;
  return false;
}

/** Activate via key */
export function activateWithKey(userId: string, username: string): boolean {
  KEY_ACTIVATIONS.set(userId, { userId, username, activatedAt: Date.now(), method: 'key' });
  return true;
}

/** Activate via server-post */
export function activateWithServerPost(userId: string, username: string, code: string): boolean {
  SERVER_POST_ACTIVATIONS.set(userId, { userId, username, activatedAt: Date.now(), code });
  return true;
}

/** Get activation info for a user */
export function getActivationInfo(userId: string): { hasPrime: boolean; method?: string; activatedAt?: number } {
  const keyInfo = KEY_ACTIVATIONS.get(userId);
  if (keyInfo) {
    return { hasPrime: true, method: keyInfo.method || 'key', activatedAt: keyInfo.activatedAt };
  }
  const serverInfo = SERVER_POST_ACTIVATIONS.get(userId);
  if (serverInfo) {
    return { hasPrime: true, method: 'server-post', activatedAt: serverInfo.activatedAt };
  }
  return { hasPrime: false };
}
