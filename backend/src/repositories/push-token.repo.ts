import { prisma } from '../lib/prisma.js';
import type { Db } from './types.js';

export const pushTokenRepo = {
  async upsert(
    userId: string,
    data: { token: string; platform: string; appId?: string | null },
    db: Db = prisma(),
  ) {
    return db.pushToken.upsert({
      where: { token: data.token },
      create: {
        userId,
        token: data.token,
        platform: data.platform,
        appId: data.appId ?? null,
        lastUsedAt: new Date(),
      },
      update: { userId, platform: data.platform, appId: data.appId ?? undefined, deletedAt: null, lastUsedAt: new Date() },
    });
  },

  async listForUser(userId: string, db: Db = prisma()) {
    return db.pushToken.findMany({ where: { userId, deletedAt: null } });
  },

  async remove(userId: string, token: string, db: Db = prisma()) {
    await db.pushToken.updateMany({ where: { userId, token }, data: { deletedAt: new Date() } });
  },

  async listForUsers(userIds: string[], db: Db = prisma()) {
    if (userIds.length === 0) return [];
    return db.pushToken.findMany({ where: { userId: { in: userIds }, deletedAt: null } });
  },
};