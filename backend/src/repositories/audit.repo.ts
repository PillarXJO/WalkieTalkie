import { prisma } from '../lib/prisma.js';
import { serializeJson } from '../lib/json.js';
import type { Db } from './types.js';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  actorId?: string | null;
  workspaceId?: string | null;
  data?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}

export const auditRepo = {
  async log(entry: AuditEntry, db: Db = prisma()) {
    return db.auditLog.create({
      data: {
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        actorId: entry.actorId ?? null,
        workspaceId: entry.workspaceId ?? null,
        data: serializeJson(entry.data ?? null),
        ip: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  },

  async listByWorkspace(
    workspaceId: string,
    options: { limit?: number; cursor?: string; action?: string },
    db: Db = prisma(),
  ) {
    return db.auditLog.findMany({
      where: { workspaceId, ...(options.action ? { action: options.action } : {}) },
      include: { actor: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: options.limit ?? 100,
      ...(options.cursor ? { cursor: { id: options.cursor } } : {}),
    });
  },

  async listByActor(
    actorId: string,
    options: { limit?: number },
    db: Db = prisma(),
  ) {
    return db.auditLog.findMany({
      where: { actorId },
      orderBy: { createdAt: 'desc' },
      take: options.limit ?? 100,
    });
  },

  async aggregateByAction(workspaceId: string, since: Date, db: Db = prisma()) {
    const grouped = await db.auditLog.groupBy({
      by: ['action'],
      where: { workspaceId, createdAt: { gte: since } },
      _count: { _all: true },
    });
    return grouped.map((g) => ({ action: g.action, count: g._count._all }));
  },
};