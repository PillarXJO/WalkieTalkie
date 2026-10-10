import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { serializePermissions } from '../lib/json.js';
import type { Db } from './types.js';

export type ChannelMemberRole = 'owner' | 'moderator' | 'member';

export const channelMemberRepo = {
  async join(
    channelId: string,
    userId: string,
    data: { role?: ChannelMemberRole; permissions?: string[] },
    db: Db = prisma(),
  ) {
    return db.channelMember.upsert({
      where: { channelId_userId: { channelId, userId } },
      create: {
        channelId,
        userId,
        role: data.role ?? 'member',
        permissions: serializePermissions(data.permissions),
      },
      update: { deletedAt: null, role: data.role ?? undefined },
    });
  },

  async findByChannelAndUser(channelId: string, userId: string, db: Db = prisma()) {
    return db.channelMember.findFirst({ where: { channelId, userId, deletedAt: null } });
  },

  async listByChannel(channelId: string, db: Db = prisma()) {
    return db.channelMember.findMany({
      where: { channelId, deletedAt: null },
      include: {
        user: {
          select: { id: true, name: true, email: true, status: true, ghostMode: true, lastSeenAt: true, isBot: true },
        },
      },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });
  },

  async listForUser(userId: string, db: Db = prisma()) {
    return db.channelMember.findMany({ where: { userId, deletedAt: null } });
  },

  /** Channel memberships of a user scoped to one workspace (with channel). */
  async listForUserInWorkspace(userId: string, workspaceId: string, db: Db = prisma()) {
    return db.channelMember.findMany({
      where: { userId, deletedAt: null, channel: { workspaceId, deletedAt: null } },
      include: { channel: { select: { id: true, name: true, type: true, isDefault: true } } },
      orderBy: [{ channel: { isDefault: 'desc' } }, { joinedAt: 'asc' }],
    });
  },

  async update(channelId: string, userId: string, data: Prisma.ChannelMemberUpdateInput, db: Db = prisma()) {
    return db.channelMember.update({ where: { channelId_userId: { channelId, userId } }, data });
  },

  async setMuted(channelId: string, userId: string, mutedUntil: Date | null, isMuted: boolean, db: Db = prisma()) {
    return db.channelMember.update({
      where: { channelId_userId: { channelId, userId } },
      data: { isMuted, mutedUntil },
    });
  },

  async countByChannel(channelId: string, db: Db = prisma()) {
    return db.channelMember.count({ where: { channelId, deletedAt: null } });
  },

  async softDelete(channelId: string, userId: string, db: Db = prisma()) {
    await db.channelMember.update({
      where: { channelId_userId: { channelId, userId } },
      data: { deletedAt: new Date() },
    });
  },
};