import { prisma } from '../lib/prisma.js';
import type { Db } from './types.js';

export const passwordResetRepo = {
  async create(userId: string, tokenHash: string, expiresAt: Date, db: Db = prisma()) {
    await db.passwordReset.updateMany({ where: { userId, usedAt: null }, data: { revokedAt: new Date() } });
    return db.passwordReset.create({ data: { userId, tokenHash, expiresAt } });
  },

  async findByTokenHash(tokenHash: string, db: Db = prisma()) {
    return db.passwordReset.findUnique({ where: { tokenHash } });
  },

  async markUsed(id: string, db: Db = prisma()) {
    await db.passwordReset.update({ where: { id }, data: { usedAt: new Date() } });
  },
};