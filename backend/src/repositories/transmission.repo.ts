import { prisma } from '../lib/prisma.js';
import type { Db } from './types.js';

export interface NewTransmission {
  channelId: string;
  workspaceId: string;
  userId: string;
  startedAt?: Date;
  durationMs: number;
  audioKey?: string | null;
  sizeBytes?: number | null;
  status?: 'live' | 'complete' | 'failed';
  listeners?: number;
}

export const transmissionRepo = {
  async create(data: NewTransmission, db: Db = prisma()) {
    return db.transmission.create({
      data: {
        channelId: data.channelId,
        workspaceId: data.workspaceId,
        userId: data.userId,
        startedAt: data.startedAt ?? new Date(),
        durationMs: data.durationMs,
        audioKey: data.audioKey ?? null,
        sizeBytes: data.sizeBytes ?? null,
        status: data.status ?? 'complete',
        listeners: data.listeners ?? 0,
      },
    });
  },

  async markCompleted(id: string, audioKey: string, sizeBytes: number, db: Db = prisma()) {
    return db.transmission.update({
      where: { id },
      data: { audioKey, sizeBytes, status: 'complete' },
    });
  },

  async markFailed(id: string, db: Db = prisma()) {
    return db.transmission.update({ where: { id }, data: { status: 'failed' } });
  },

  async findById(id: string, db: Db = prisma()) {
    return db.transmission.findFirst({
      where: { id, deletedAt: null },
      include: {
        channel: { select: { id: true, name: true, workspaceId: true, type: true } },
        user: { select: { id: true, name: true, avatarUrl: true, isBot: true } },
      },
    });
  },

  /** Cross-contact/channel/history search inside a workspace. */
  async search(
    workspaceId: string,
    query: string,
    options: { channelId?: string; userId?: string; from?: Date; to?: Date; limit?: number; cursor?: Date } = {},
    db: Db = prisma(),
  ) {
    const where = {
      workspaceId,
      deletedAt: null,
      startedAt: { gte: options.from, lte: options.to },
      ...(options.channelId ? { channelId: options.channelId } : {}),
      ...(options.userId ? { userId: options.userId } : {}),
      ...(query
        ? {
            OR: [
              { channel: { name: { contains: query, mode: 'insensitive' as const } } },
              { user: { name: { contains: query, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };
    return db.transmission.findMany({
      where,
      include: {
        channel: { select: { id: true, name: true, type: true } },
        user: { select: { id: true, name: true, avatarUrl: true, isBot: true } },
      },
      orderBy: { startedAt: 'desc' },
      take: options.limit ?? 50,
    });
  },

  async listByChannel(
    channelId: string,
    options: { from?: Date; to?: Date; limit?: number; after?: Date },
    db: Db = prisma(),
  ) {
    return db.transmission.findMany({
      where: {
        channelId,
        deletedAt: null,
        startedAt: { gte: options.from, lte: options.to },
        ...(options.after ? { startedAt: { gt: options.after } } : {}),
      },
      include: {
        channel: { select: { id: true, name: true, type: true } },
        user: { select: { id: true, name: true, avatarUrl: true, isBot: true } },
      },
      orderBy: { startedAt: 'desc' },
      take: options.limit ?? 100,
    });
  },

  async recentForUser(
    userId: string,
    options: { workspaceId: string; limit?: number },
    db: Db = prisma(),
  ) {
    return db.transmission.findMany({
      where: { userId, workspaceId: options.workspaceId, deletedAt: null },
      include: {
        channel: { select: { id: true, name: true, type: true } },
      },
      orderBy: { startedAt: 'desc' },
      take: options.limit ?? 50,
    });
  },

  async countByWorkspace(workspaceId: string, db: Db = prisma()) {
    return db.transmission.count({ where: { workspaceId, deletedAt: null } });
  },

  /** Soft-delete a single transmission (history privacy / moderation). */
  async softDelete(id: string, db: Db = prisma()) {
    await db.transmission.update({ where: { id }, data: { deletedAt: new Date() } });
  },

  /** Purge rows across workspaces older than `before` (retention policy). */
  async purgeOlderThan(before: Date, db: Db = prisma()) {
    const res = await db.transmission.deleteMany({ where: { startedAt: { lt: before } } });
    return res.count;
  },
};