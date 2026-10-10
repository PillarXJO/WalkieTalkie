import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { Db } from './types.js';

export type ChannelType = 'channel' | 'echo' | 'broadcast';

export interface NewChannel {
  workspaceId: string;
  name: string;
  description?: string | null;
  type?: ChannelType;
  isDefault?: boolean;
  createdById?: string | null;
}

const include = {
  _count: { select: { members: { where: { deletedAt: null } }, transmissions: true } },
} satisfies Prisma.ChannelInclude;

export type ChannelWithCounts = Prisma.ChannelGetPayload<{ include: typeof include }>;

export const channelRepo = {
  async create(data: NewChannel, db: Db = prisma()) {
    return db.channel.create({
      data: {
        workspaceId: data.workspaceId,
        name: data.name,
        description: data.description ?? null,
        type: data.type ?? 'channel',
        isDefault: data.isDefault ?? false,
        createdById: data.createdById ?? null,
      },
      include,
    });
  },

  async findById(id: string, db: Db = prisma()) {
    return db.channel.findFirst({ where: { id, deletedAt: null }, include });
  },

  async findByIdInWorkspace(id: string, workspaceId: string, db: Db = prisma()) {
    return db.channel.findFirst({ where: { id, workspaceId, deletedAt: null }, include });
  },

  async listByWorkspace(workspaceId: string, db: Db = prisma()) {
    return db.channel.findMany({
      where: { workspaceId, deletedAt: null },
      include,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  },

  async update(id: string, data: Prisma.ChannelUpdateInput, db: Db = prisma()) {
    return db.channel.update({ where: { id }, data, include });
  },

  async softDelete(id: string, db: Db = prisma()) {
    await db.channel.update({ where: { id }, data: { deletedAt: new Date() } });
  },

  async setDefault(id: string, workspaceId: string, db: Db = prisma()) {
    await db.channel.updateMany({ where: { workspaceId, isDefault: true }, data: { isDefault: false } });
    await db.channel.update({ where: { id }, data: { isDefault: true } });
  },

  /**
   * Usage stats over a window: transmissions (message count), talk time,
   * active (talking) members.
   */
  async usageStats(workspaceId: string, from: Date, to: Date, db: Db = prisma()) {
    const [transmissions, talk] = await Promise.all([
      db.transmission.aggregate({
        where: { workspaceId, startedAt: { gte: from, lt: to } },
        _count: { _all: true },
        _sum: { durationMs: true },
      }),
      db.transmission.groupBy({
        by: ['userId'],
        where: { workspaceId, startedAt: { gte: from, lt: to } },
        _count: { _all: true },
      }),
    ]);
    return {
      messageCount: transmissions._count._all,
      talkTimeMs: transmissions._sum.durationMs ?? 0,
      activeUsers: talk.length,
      activeUserIds: talk.map((t) => t.userId),
    };
  },
};