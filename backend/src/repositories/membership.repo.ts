import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { serializePermissions } from '../lib/json.js';
import type { Db } from './types.js';

export type RoleKind = 'admin' | 'dispatcher' | 'member';

export const membershipRepo = {
  async upsert(
    workspaceId: string,
    userId: string,
    data: { role?: RoleKind; nickname?: string | null; permissions?: string[] },
    db: Db = prisma(),
  ) {
    return db.membership.upsert({
      where: { workspaceId_userId: { workspaceId, userId } },
      create: {
        workspaceId,
        userId,
        role: data.role ?? 'member',
        nickname: data.nickname ?? null,
        permissions: serializePermissions(data.permissions),
      },
      update: {
        role: data.role ?? undefined,
        nickname: data.nickname ?? undefined,
        permissions: data.permissions ? serializePermissions(data.permissions) : undefined,
        deletedAt: null,
      },
    });
  },

  async findByUserAndWorkspace(userId: string, workspaceId: string, db: Db = prisma()) {
    return db.membership.findFirst({
      where: { userId, workspaceId, deletedAt: null },
    });
  },

  async listByWorkspace(workspaceId: string, db: Db = prisma()) {
    return db.membership.findMany({
      where: { workspaceId, deletedAt: null },
      include: {
        user: { select: { id: true, name: true, email: true, status: true, ghostMode: true, lastSeenAt: true, isBot: true } },
      },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });
  },

  async listForUser(userId: string, db: Db = prisma()) {
    return db.membership.findMany({ where: { userId, deletedAt: null } });
  },

  async update(
    workspaceId: string,
    userId: string,
    data: Prisma.MembershipUpdateInput,
    db: Db = prisma(),
  ) {
    return db.membership.update({
      where: { workspaceId_userId: { workspaceId, userId } },
      data,
    });
  },

  async softDelete(workspaceId: string, userId: string, db: Db = prisma()) {
    await db.membership.update({
      where: { workspaceId_userId: { workspaceId, userId } },
      data: { deletedAt: new Date() },
    });
  },

  async countByWorkspace(workspaceId: string, db: Db = prisma()) {
    return db.membership.count({ where: { workspaceId, deletedAt: null } });
  },
};