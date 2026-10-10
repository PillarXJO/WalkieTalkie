import { prisma } from '../lib/prisma.js';
import type { Db } from './types.js';

export const backupCodeRepo = {
  async createMany(userId: string, codeHashes: string[], db: Db = prisma()) {
    return db.backupCode.createMany({
      data: codeHashes.map((codeHash) => ({ userId, codeHash })),
    });
  },

  async listAvailable(userId: string, db: Db = prisma()) {
    const codes = await db.backupCode.findMany({
      where: { userId, usedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    // The hashes are returned so the client can display one-time codes.
    return codes.map((c) => ({ id: c.id, codeHash: c.codeHash, usedAt: c.usedAt, createdAt: c.createdAt }));
  },

  async useById(id: string, db: Db = prisma()) {
    const res = await db.backupCode.updateMany({ where: { id, usedAt: null }, data: { usedAt: new Date() } });
    return res.count === 1;
  },

  async countAvailable(userId: string, db: Db = prisma()) {
    return db.backupCode.count({ where: { userId, usedAt: null } });
  },

  async deleteAllForUser(userId: string, db: Db = prisma()) {
    await db.backupCode.deleteMany({ where: { userId } });
  },
};