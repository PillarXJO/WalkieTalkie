import { SignJWT, jwtVerify } from 'jose';
import { env } from '../config/env.js';

export type TokenType = 'access' | 'mfa';

export interface AccessClaims {
  sub: string; // user id
  sid: string; // session id
  wid?: string; // active workspace id
  typ: 'access';
}

export interface MfaClaims {
  sub: string;
  typ: 'mfa';
}

export interface TokenResult {
  accessToken: string;
  expiresInSeconds: number;
  tokenType: 'Bearer';
}

const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

function parseTtl(ttl: string): { ms: number; seconds: number } {
  const n = Number.parseInt(ttl, 10);
  const unit = ttl.replace(/[0-9]/g, '');
  const mult = { s: 1, m: 60, h: 3600, d: 86_400 }[unit] ?? 60;
  const seconds = n * mult;
  return { ms: seconds * 1000, seconds };
}

export async function signAccessToken(userId: string, sessionId: string, workspaceId?: string): Promise<TokenResult> {
  const { seconds } = parseTtl(env.ACCESS_TOKEN_TTL);
  const token = await new SignJWT({ wid: workspaceId, sid: sessionId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setJti(`${sessionId}-${Date.now()}`)
    .setIssuer('ptt')
    .setAudience('ptt-app')
    .setIssuedAt()
    .setExpirationTime(`${seconds}s`)
    .sign(accessSecret);
  return { accessToken: token, expiresInSeconds: seconds, tokenType: 'Bearer' };
}

/** Short-lived token proving the password step completed (used for 2FA prompt). */
export async function signMfaToken(userId: string): Promise<TokenResult> {
  const token = await new SignJWT()
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer('ptt')
    .setAudience('ptt-app')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(accessSecret);
  return { accessToken: token, expiresInSeconds: 300, tokenType: 'Bearer' };
}

export interface VerifiedAccess {
  userId: string;
  sessionId: string;
  workspaceId?: string;
  jti?: string;
  exp?: number;
}

export async function verifyAccessToken(token: string): Promise<VerifiedAccess> {
  try {
    const { payload } = await jwtVerify(token, accessSecret, { issuer: 'ptt', audience: 'ptt-app' });
    return {
      userId: payload.sub ?? '',
      sessionId: (payload.sid ?? '') as string,
      workspaceId: (payload.wid as string | undefined) ?? undefined,
      jti: (payload.jti as string | undefined) ?? undefined,
      exp: payload.exp,
    };
  } catch {
    throw new Error('invalid token');
  }
}

export async function verifyMfaToken(token: string): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, accessSecret, { issuer: 'ptt', audience: 'ptt-app' });
    return payload.sub ?? '';
  } catch {
    throw new Error('invalid mfa token');
  }
}