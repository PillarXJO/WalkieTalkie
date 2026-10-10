import { prisma } from '../lib/prisma.js';
import type { Db } from './types.js';

export interface NewPing {
  userId: string;
  workspaceId?: string | null;
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  altitude?: number | null;
  speed?: number | null;
  heading?: number | null;
  source?: 'always' | 'whileUsing' | 'manual';
  at?: Date;
}

export const locationRepo = {
  async insert(data: NewPing, db: Db = prisma()) {
    return db.locationPing.create({
      data: {
        userId: data.userId,
        workspaceId: data.workspaceId ?? null,
        latitude: data.latitude,
        longitude: data.longitude,
        accuracy: data.accuracy ?? null,
        altitude: data.altitude ?? null,
        speed: data.speed ?? null,
        heading: data.heading ?? null,
        source: data.source ?? 'whileUsing',
        at: data.at ?? new Date(),
      },
    });
  },

  async latestForUser(userId: string, db: Db = prisma()) {
    return db.locationPing.findFirst({ where: { userId }, orderBy: { at: 'desc' } });
  },

  async listForWorkspace(
    workspaceId: string,
    options: { from?: Date; to?: Date; windowMinutes?: number; limit?: number },
    db: Db = prisma(),
  ) {
    const since = options.windowMinutes ? new Date(Date.now() - options.windowMinutes * 60_000) : options.from ?? new Date(0);
    return db.locationPing.findMany({
      where: {
        workspaceId,
        at: { gte: since, lte: options.to ?? new Date() },
      },
      include: {
        user: { select: { id: true, name: true, status: true } },
      },
      orderBy: { at: 'desc' },
      take: options.limit ?? 500,
    });
  },

  async lastKnownByUsers(userIds: string[], db: Db = prisma()) {
    if (userIds.length === 0) return [];
    return db.locationPing.findMany({
      where: { userId: { in: userIds } },
      orderBy: { at: 'desc' },
      take: 100_000,
    }).then((rows) => {
      const newest = new Map<string, (typeof rows)[number]>();
      for (const r of rows) {
        const cur = newest.get(r.userId);
        if (!cur || r.at > cur.at) newest.set(r.userId, r);
      }
      return [...newest.values()];
    });
  },
};