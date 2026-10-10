import { prisma } from '../lib/prisma.js';
import type { Db } from './types.js';

export const blockRepo = {
  async create(blockerId: string, blockedId: string, db: Db = prisma()) {
    return db.block.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      create: { blockerId, blockedId },
      update: {},
    });
  },

  async remove(blockerId: string, blockedId: string, db: Db = prisma()) {
    await db.block.deleteMany({ where: { blockerId, blockedId } });
  },

  async exists(blockerId: string, blockedId: string, db: Db = prisma()) {
    return (await db.block.findUnique({ where: { blockerId_blockedId: { blockerId, blockedId } } })) !== null;
  },

  /** Users this user has blocked, with blocked contact info. */
  async listBlocked(blockerId: string, db: Db = prisma()) {
    return db.block.findMany({
      where: { blockerId },
      include: {
        blocked: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  /** Users who blocked this user (kept private, used to hide presence/PTT). */
  async listBlockers(blockedId: string, db: Db = prisma()) {
    return db.block.findMany({ where: { blockedId }, select: { blockerId: true } });
  },
};