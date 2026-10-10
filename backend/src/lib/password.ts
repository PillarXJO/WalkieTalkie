import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (password: Buffer, salt: Buffer, keylen: number, options: object) => Promise<Buffer>;

export const SCRYPT_KEYLEN = 64;
export const SCRYPT_SALT_LEN = 16;

export interface HashOptions {
  /** CPU/memory cost (N = 2^14 by default, ~64 MB). */
  cost?: number;
  r?: number;
  p?: number;
}

export async function hashPassword(password: string, options: HashOptions = {}): Promise<string> {
  const cost = options.cost ?? 16384;
  const r = options.r ?? 8;
  const p = options.p ?? 1;
  const salt = randomBytes(SCRYPT_SALT_LEN);
  const key = await scrypt(Buffer.from(password), salt, SCRYPT_KEYLEN, { N: cost, r, p });
  return `scrypt$${cost}$${r}$${p}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, costStr, rStr, pStr, saltHex, keyHex] = stored.split('$');
  if (scheme !== 'scrypt' || !costStr || !rStr || !pStr || !saltHex || !keyHex) return false;
  const cost = Number(costStr);
  const r = Number(rStr);
  const p = Number(pStr);
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(keyHex, 'hex');
  if (![cost, r, p].every(Number.isInteger) || cost <= 0 || salt.length === 0) return false;
  const actual = await scrypt(Buffer.from(password), salt, expected.length, { N: cost, r, p });
  return timingSafeEqual(actual, expected);
}

/** Random high-entropy token (password reset, refresh tokens). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** HMAC-SHA256 used to pepper refresh tokens and backup codes at rest. */
export function hmacSha256(key: string, value: string): string {
  return createHmac('sha256', key).update(value).digest('hex');
}