import { prisma } from '../lib/prisma.js';
import type { Db } from './types.js';

export interface NewSession {
  userId: string;
  refreshTokenHash: string;
  workspaceId?: string | null;
  deviceId?: string | null;
  deviceName?: string | null;
  platform?: string | null;
  osVersion?: string | null;
  appVersion?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  expiresAt: Date;
}

export const sessionRepo = {
  async create(data: NewSession, db: Db = prisma()) {
    return db.session.create({
      data: {
        userId: data.userId,
        refreshTokenHash: data.refreshTokenHash,
        workspaceId: data.workspaceId ?? null,
        deviceId: data.deviceId ?? null,
        deviceName: data.deviceName ?? null,
        platform: data.platform ?? null,
        osVersion: data.osVersion ?? null,
        appVersion: data.appVersion ?? null,
        ip: data.ip ?? null,
        userAgent: data.userAgent ?? null,
        expiresAt: data.expiresAt,
      },
    });
  },

  async findByRefreshHash(hash: string, db: Db = prisma()) {
    return db.session.findUnique({ where: { refreshTokenHash: hash } });
  },

  /** Lookup by primary key including the fields the request guard needs. */
  async findByIdForAuth(id: string, db: Db = prisma()) {
    return db.session.findFirst({ where: { id } });
  },

  async listByUser(userId: string, db: Db = prisma()) {
    return db.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
    });
  },

  async touch(id: string, db: Db = prisma()) {
    await db.session.update({ where: { id }, data: { lastSeenAt: new Date() } });
  },

  async revokeById(id: string, db: Db = prisma()) {
    await db.session.update({ where: { id }, data: { revokedAt: new Date() } });
  },

  /** Revoke a session but only if it belongs to the given user. */
  async revokeSessionForUser(userId: string, sessionId: string, db: Db = prisma()) {
    const res = await db.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return res.count === 1;
  },

  /** Rotate a refresh token on a live session. */
  async rotateToken(id: string, newHash: string, db: Db = prisma()) {
    await db.session.update({
      where: { id },
      data: { refreshTokenHash: newHash, lastSeenAt: new Date() },
    });
  },

  /** Change the active workspace for a session (drives the `wid` claim). */
  async setWorkspace(id: string, workspaceId: string, db: Db = prisma()) {
    await db.session.update({ where: { id }, data: { workspaceId, lastSeenAt: new Date() } });
  },

  async revokeAllForUserExcept(userId: string, keepId: string, db: Db = prisma()) {
    await db.session.updateMany({
      where: { userId, revokedAt: null, NOT: { id: keepId } },
      data: { revokedAt: new Date() },
    });
  },

  async revokeAllForUser(userId: string, db: Db = prisma()) {
    await db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  },

  /** No-op delete of expired sessions. Returns rows affected. */
  async pruneExpired(db: Db = prisma()) {
    const res = await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    return res.count;
  },
};