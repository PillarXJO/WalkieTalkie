import { env } from '../../config/env.js';
import type { Role } from '../../domain/permissions.js';
import { AppError } from '../../lib/errors.js';
import { hashPassword, hmacSha256, randomToken, verifyPassword } from '../../lib/password.js';
import { prisma } from '../../lib/prisma.js';
import { generateBackupCodes, generateTotpSecret, qrDataUrl, totpUri, verifyTotp } from '../../lib/totp.js';
import { signAccessToken, signMfaToken, verifyMfaToken, type TokenResult } from '../../lib/tokens.js';
import { backupCodeRepo } from '../../repositories/backup-code.repo.js';
import { channelMemberRepo } from '../../repositories/channel-member.repo.js';
import { passwordResetRepo } from '../../repositories/password-reset.repo.js';
import { sessionRepo } from '../../repositories/session.repo.js';
import { userRepo, type PublicUser } from '../../repositories/user.repo.js';
import { workspaceRepo } from '../../repositories/workspace.repo.js';
import { provisionNewWorkspace } from '../workspaces/service.js';

export interface SessionMeta {
  deviceId?: string;
  deviceName?: string;
  platform?: string;
  osVersion?: string;
  appVersion?: string;
  ip?: string;
  userAgent?: string;
}

export interface WorkspaceBrief {
  id: string;
  name: string;
  role: Role;
  defaultChannelId?: string | null;
}

export interface ChannelBrief {
  id: string;
  name: string;
  type: string;
}

export interface AuthResult extends TokenResult {
  auth: 'ok';
  /** Opaque refresh token — rotated on every refresh. */
  refreshToken: string;
  user: PublicUser;
  workspaces: WorkspaceBrief[];
  workspace: WorkspaceBrief;
  channels: ChannelBrief[];
}

export interface MfaChallenge {
  auth: 'mfa_required';
  mfaToken: string;
  expiresInSeconds: number;
}

export function serializeSession(s: Awaited<ReturnType<typeof sessionRepo.listByUser>>[number]) {
  return {
    id: s.id,
    deviceId: s.deviceId,
    deviceName: s.deviceName,
    platform: s.platform,
    osVersion: s.osVersion,
    appVersion: s.appVersion,
    ip: s.ip,
    userAgent: s.userAgent,
    lastSeenAt: s.lastSeenAt,
    expiresAt: s.expiresAt,
    createdAt: s.createdAt,
  };
}

function refreshTokenHash(token: string): string {
  return hmacSha256(env.JWT_REFRESH_SECRET, token);
}

const sessionExpiry = () => new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);

async function listWorkspacesFor(userId: string): Promise<WorkspaceBrief[]> {
  const rows = await workspaceRepo.listForUser(userId);
  return rows.map((w) => ({
    id: w.id,
    name: w.name,
    role: w.members[0]?.role as Role,
    defaultChannelId: w.defaultChannelId,
  }));
}

async function channelsFor(userId: string, workspaceId: string): Promise<ChannelBrief[]> {
  const rows = await channelMemberRepo.listForUserInWorkspace(userId, workspaceId);
  return rows.map((c) => ({ id: c.channel.id, name: c.channel.name, type: c.channel.type }));
}

function activeWorkspaceFor(userId: string): Promise<WorkspaceBrief> {
  return listWorkspacesFor(userId).then((workspaces) => {
    const ws = workspaces[0];
    if (!ws) throw AppError.preconditionFailed('Account has no workspaces yet');
    return ws;
  });
}

async function openSession(
  userId: string,
  workspaceId: string | null,
  meta: SessionMeta,
): Promise<{ result: AuthResult; refreshToken: string }> {
  const refreshToken = randomToken();
  const expiresAt = sessionExpiry();
  const session = await sessionRepo.create({
    userId,
    refreshTokenHash: refreshTokenHash(refreshToken),
    workspaceId: workspaceId ?? undefined,
    deviceId: meta.deviceId,
    deviceName: meta.deviceName,
    platform: meta.platform,
    osVersion: meta.osVersion,
    appVersion: meta.appVersion,
    ip: meta.ip,
    userAgent: meta.userAgent,
    expiresAt,
  });

  let workspace: WorkspaceBrief;
  if (workspaceId) {
    const all = await listWorkspacesFor(userId);
    workspace = all.find((w) => w.id === workspaceId) ?? all[0]!;
  } else {
    workspace = await activeWorkspaceFor(userId);
  }
  workspaceId = workspace.id;

  const access = await signAccessToken(userId, session.id, workspaceId);
  const user = (await userRepo.findById(userId))!;
  const channels = await channelsFor(userId, workspaceId);

  return {
    result: {
      auth: 'ok',
      ...access,
      refreshToken,
      user,
      workspaces: await listWorkspacesFor(userId),
      workspace,
      channels,
    },
    refreshToken,
  };
}

async function verifyBackupCode(user: { id: string }, code: string): Promise<boolean> {
  const codeHash = hmacSha256(env.JWT_REFRESH_SECRET, `backup:${code}`);
  const rows = await backupCodeRepo.listAvailable(user.id);
  const match = rows.find((r) => r.codeHash === codeHash);
  if (!match) return false;
  await backupCodeRepo.useById(match.id);
  return true;
}

export const authService = {
  async register(input: { name: string; email: string; password: string; phone?: string | null }, meta: SessionMeta) {
    const existing = await userRepo.findByEmailIncludeDeleted(input.email);
    if (existing) throw AppError.conflict('An account with this email already exists');

    const user = await userRepo.create({
      email: input.email,
      passwordHash: await hashPassword(input.password, { cost: env.SCRYPT_COST }),
      name: input.name,
      phone: input.phone,
    });
    const { workspace } = await provisionNewWorkspace(user.id, `${input.name}'s Workspace`);
    return (await openSession(user.id, workspace.id, meta)).result;
  },

  async login(
    input: { email: string; password: string; totpCode?: string | null; backupCode?: string | null },
    meta: SessionMeta,
  ): Promise<AuthResult | MfaChallenge> {
    const user = await userRepo.findByEmail(input.email);
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      throw AppError.unauthorized('Invalid email or password');
    }

    if (user.totpEnabled) {
      if (input.backupCode && (await verifyBackupCode(user, input.backupCode))) {
        // single-use backup code accepted below
      } else if (input.totpCode && user.totpSecret && verifyTotp(user.totpSecret, input.totpCode)) {
        // authenticator code accepted below
      } else {
        const mfa = await signMfaToken(user.id);
        return { auth: 'mfa_required', mfaToken: mfa.accessToken, expiresInSeconds: mfa.expiresInSeconds };
      }
    }

    return (await openSession(user.id, null, meta)).result;
  },

  async verifyMfa(input: { mfaToken: string; code: string }, meta: SessionMeta): Promise<AuthResult> {
    const userId = await verifyMfaToken(input.mfaToken);
    const user = await userRepo.rawById(userId);
    if (!user) throw AppError.unauthorized('Account not found');

    const ok =
      (input.code.length > 6 && (await verifyBackupCode({ id: userId }, input.code))) ||
      (user.totpEnabled && user.totpSecret ? verifyTotp(user.totpSecret, input.code) : false);
    if (!ok) throw AppError.unauthorized('Invalid or expired code');

    return (await openSession(userId, null, meta)).result;
  },

  async refresh(input: { refreshToken: string }, meta: SessionMeta): Promise<AuthResult> {
    const session = await sessionRepo.findByRefreshHash(refreshTokenHash(input.refreshToken));
    if (!session) throw AppError.unauthorized('Invalid refresh token');
    if (session.revokedAt || session.expiresAt <= new Date()) {
      throw AppError.unauthorized('Session has ended, please log in again');
    }

    const newRefresh = randomToken();
    await sessionRepo.rotateToken(session.id, refreshTokenHash(newRefresh));
    const workspaceId = session.workspaceId;

    const all = await listWorkspacesFor(session.userId);
    const workspace: WorkspaceBrief =
      (workspaceId ? all.find((w) => w.id === workspaceId) : undefined) ?? all[0] ?? (await activeWorkspaceFor(session.userId));

    const access = await signAccessToken(session.userId, session.id, workspace.id);
    const user = (await userRepo.findById(session.userId))!;
    return {
      auth: 'ok',
      ...access,
      refreshToken: newRefresh,
      user,
      workspaces: all,
      workspace,
      channels: await channelsFor(session.userId, workspace.id),
    };
  },

  async logout(refreshToken: string) {
    const session = await sessionRepo.findByRefreshHash(refreshTokenHash(refreshToken));
    if (session) await sessionRepo.revokeById(session.id);
    return { ok: true };
  },

  async listSessions(userId: string, currentSessionId: string) {
    const sessions = await sessionRepo.listByUser(userId);
    return sessions.map((s) => ({ ...serializeSession(s), isCurrent: s.id === currentSessionId }));
  },

  async revokeSession(userId: string, sessionId: string) {
    const revoked = await sessionRepo.revokeSessionForUser(userId, sessionId);
    if (!revoked) throw AppError.notFound('Session not found');
    return { ok: true };
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await userRepo.rawById(userId);
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
      throw AppError.unauthorized('Current password is incorrect');
    }
    const passwordHash = await hashPassword(newPassword, { cost: env.SCRYPT_COST });
    await userRepo.update(userId, { passwordHash });
    await sessionRepo.revokeAllForUserExcept(userId, userId); // caller re-auths via a fresh session
    return { ok: true };
  },

  async requestPasswordReset(email: string) {
    const user = await userRepo.findByEmail(email);
    if (!user) return { ok: true }; // never reveal account existence
    const resetToken = randomToken();
    const expiresAt = new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60_000);
    await passwordResetRepo.create(user.id, hmacSha256(env.JWT_REFRESH_SECRET, `reset:${resetToken}`), expiresAt);
    // In dev/test the token is returned so flows are testable without an SMTP.
    return { ok: true, ...(env.NODE_ENV === 'production' ? {} : { resetToken }) };
  },

  async resetPassword(token: string, newPassword: string) {
    const row = await passwordResetRepo.findByTokenHash(
      hmacSha256(env.JWT_REFRESH_SECRET, `reset:${token}`),
    );
    if (!row || row.usedAt || row.revokedAt || row.expiresAt <= new Date()) {
      throw AppError.badRequest('Reset token is invalid or has expired');
    }
    const passwordHash = await hashPassword(newPassword, { cost: env.SCRYPT_COST });
    await userRepo.update(row.userId, { passwordHash });
    await passwordResetRepo.markUsed(row.id);
    await sessionRepo.revokeAllForUser(row.userId);
    return { ok: true };
  },

  async deleteAccount(userId: string, password: string) {
    const user = await userRepo.rawById(userId);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw AppError.unauthorized('Password is incorrect');
    }
    await sessionRepo.revokeAllForUser(userId);
    await userRepo.softDelete(userId);
    return { ok: true };
  },

  async setupTotp(userId: string) {
    const user = await userRepo.rawById(userId);
    if (!user) throw AppError.notFound('Account not found');
    if (user.totpEnabled) throw AppError.conflict('Two-factor authentication is already enabled');

    const secret = generateTotpSecret();
    await userRepo.update(userId, { totpSecret: secret });
    const uri = totpUri(secret, user.email);
    return { secret, otpauthUrl: uri, qrDataUrl: await qrDataUrl(uri) };
  },

  async confirmTotp(userId: string, code: string) {
    const user = await userRepo.rawById(userId);
    if (!user || !user.totpSecret) throw AppError.badRequest('Start two-factor setup first');
    if (!verifyTotp(user.totpSecret, code)) throw AppError.badRequest('Invalid verification code');

    await userRepo.update(userId, { totpEnabled: true });
    const codes = generateBackupCodes();
    await backupCodeRepo.createMany(
      userId,
      codes.map((c) => hmacSha256(env.JWT_REFRESH_SECRET, `backup:${c}`)),
    );
    return { backupCodes: codes };
  },

  async disableTotp(userId: string, password: string) {
    const user = await userRepo.rawById(userId);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw AppError.unauthorized('Password is incorrect');
    }
    await userRepo.update(userId, { totpEnabled: false, totpSecret: null });
    await backupCodeRepo.deleteAllForUser(userId);
    return { ok: true };
  },

  async regenerateBackupCodes(userId: string) {
    const user = await userRepo.rawById(userId);
    if (!user?.totpEnabled) throw AppError.conflict('Two-factor authentication is not enabled');
    await backupCodeRepo.deleteAllForUser(userId);
    const codes = generateBackupCodes();
    await backupCodeRepo.createMany(
      userId,
      codes.map((c) => hmacSha256(env.JWT_REFRESH_SECRET, `backup:${c}`)),
    );
    return { backupCodes: codes };
  },

  async backupCodeCount(userId: string) {
    return { count: await backupCodeRepo.countAvailable(userId) };
  },

  async switchWorkspace(userId: string, sessionId: string, workspaceId: string) {
    const membership = await prisma().membership.findFirst({
      where: { userId, workspaceId, deletedAt: null },
    });
    if (!membership) throw AppError.forbidden('You are not a member of this workspace');

    await sessionRepo.setWorkspace(sessionId, workspaceId);
    const [workspaces, access] = await Promise.all([
      listWorkspacesFor(userId),
      signAccessToken(userId, sessionId, workspaceId),
    ]);
    const workspace = workspaces.find((w) => w.id === workspaceId)!;
    return { accessToken: access.accessToken, expiresInSeconds: access.expiresInSeconds, workspace, workspaces };
  },
};