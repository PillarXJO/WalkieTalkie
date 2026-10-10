import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { sessionRepo } from '../repositories/session.repo.js';
import { userRepo } from '../repositories/user.repo.js';
import { membershipPermissions } from '../modules/workspaces/service.js';
import type { Permission, Role } from '../domain/permissions.js';
import { env } from '../config/env.js';

export interface AuthActor {
  userId: string;
  sessionId: string;
  /** Active workspace as carried in the access token (`wid`). */
  workspaceId?: string;
  role?: Role;
  /** Effective permissions in the active workspace (role defaults ∪ extras). */
  permissions: Permission[];
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthActor;
    requireAuth(): AuthActor;
    /** Like requireAuth but also guarantees a workspace is active. */
    requireWorkspace(mode?: 'member' | 'admin'): AuthActor;
    hasPermission(permission: Permission): boolean;
    requirePermission(permission: Permission): AuthActor;
  }
}

async function checkSession(sessionId: string): Promise<boolean> {
  const session = await sessionRepo.findByIdForAuth(sessionId);
  if (!session) return false;
  if (session.revokedAt) return false;
  if (session.expiresAt <= new Date()) return false;
  const idle = Date.now() - session.lastSeenAt.getTime();
  if (idle > env.SESSION_IDLE_TIMEOUT_MINUTES * 60_000) {
    await sessionRepo.revokeById(sessionId);
    return false;
  }
  await sessionRepo.touch(sessionId);
  return true;
}

/** Resolve an actor from a bare access token (no scheme), used by WebSocket auth. */
export async function resolveAccessActor(token: string): Promise<AuthActor> {
  let verified: Awaited<ReturnType<typeof verifyAccessToken>>;
  try {
    verified = await verifyAccessToken(token);
  } catch {
    throw AppError.unauthorized('Access token expired or invalid');
  }

  const user = await userRepo.findById(verified.userId);
  if (!user) throw AppError.unauthorized('Account not found');

  if (!(await checkSession(verified.sessionId))) {
    throw AppError.unauthorized('Session expired, please log in again');
  }

  const actor: AuthActor = {
    userId: verified.userId,
    sessionId: verified.sessionId,
    workspaceId: verified.workspaceId,
    permissions: [],
  };

  if (actor.workspaceId) {
    const membership = await membershipPermissions(actor.userId, actor.workspaceId);
    if (!membership) throw AppError.forbidden("You are not a member of the active workspace");
    actor.role = membership.role;
    actor.permissions = membership.permissions;
  }

  return actor;
}

async function resolveActor(raw: string): Promise<AuthActor> {
  const [scheme, token] = raw.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) throw AppError.unauthorized();
  return resolveAccessActor(token);
}

const error401 = AppError.unauthorized();

export async function registerAuthPlugin(app: FastifyInstance) {
  app.decorateRequest('requireAuth', function (this: FastifyRequest) {
    if (this.user) return this.user;
    throw error401;
  });

  app.decorateRequest('requireWorkspace', function (this: FastifyRequest, mode: 'member' | 'admin' = 'member') {
    const actor = this.requireAuth();
    if (!actor.workspaceId) throw AppError.preconditionFailed('No active workspace selected');
    if (mode === 'admin' && actor.role !== 'admin') throw AppError.forbidden('Admin access required');
    return actor;
  });

  app.decorateRequest('hasPermission', function (this: FastifyRequest, permission: Permission) {
    const actor = this.user;
    if (!actor) return false;
    if (actor.role === 'admin') return true;
    return actor.permissions.includes(permission);
  });

  app.decorateRequest('requirePermission', function (this: FastifyRequest, permission: Permission) {
    const actor = this.requireAuth();
    if (!this.hasPermission!(permission)) {
      throw AppError.forbidden(`Permission '${permission}' required`);
    }
    return actor;
  });

  app.addHook('preHandler', async (request) => {
    const header = request.headers.authorization;
    if (!header) return;
    // Resolved per request: revocation/disabling take effect immediately.
    request.user = await resolveActor(header);
  });
}