import { authenticator } from 'otplib';
import * as qrcode from 'qrcode';
import { env } from '../config/env.js';

authenticator.options = { window: 2, step: 30 };

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function totpUri(secret: string, email: string): string {
  return authenticator.keyuri(email, env.TOTP_ISSUER, secret);
}

export async function qrDataUrl(uri: string): Promise<string> {
  return qrcode.toDataURL(uri, { margin: 1, width: 256 });
}

export function verifyTotp(secret: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  try {
    return authenticator.verify({ token: code, secret });
  } catch {
    return false;
  }
}

/** One-time recovery codes, returned to the user exactly once. */
export function generateBackupCodes(count = 8): string[] {
  const out: string[] = [];
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < count; i++) {
    let code = '';
    for (let j = 0; j < 10; j++) code += chars[Math.floor(Math.random() * chars.length)];
    out.push(code);
  }
  return out;
}