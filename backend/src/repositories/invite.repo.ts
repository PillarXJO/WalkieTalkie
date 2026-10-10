import { randomBytes } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import type { Db } from './types.js';

export interface NewInvite {
  workspaceId: string;
  createdById?: string | null;
  role?: 'member' | 'dispatcher';
  maxUses?: number;
  expiresAt?: Date | null;
}

export type InviteRole = 'member' | 'dispatcher';

/** URL-safe codes should be easy to type/scan: 8 chars from a 36-char alphabet. */
export function generateInviteCode(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) code += alphabet[bytes[i]! % alphabet.length]!;
  return code;
}

export const inviteRepo = {
  async create(data: NewInvite, db: Db = prisma()) {
    return db.invite.create({
      data: {
        code: generateInviteCode(),
        workspaceId: data.workspaceId,
        createdById: data.createdById ?? null,
        role: data.role ?? 'member',
        maxUses: data.maxUses ?? 1,
        expiresAt: data.expiresAt ?? null,
      },
    });
  },

  async findByCode(code: string, db: Db = prisma()) {
    return db.invite.findUnique({ where: { code } });
  },

  async listByWorkspace(workspaceId: string, db: Db = prisma()) {
    return db.invite.findMany({
      where: { workspaceId, revokedAt: null, deletedAt: null },
      include: {
        inviteUses: { select: { userId: true, usedAt: true } },
        creator: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  async incrementUsage(id: string, db: Db = prisma()) {
    return db.invite.update({ where: { id }, data: { useCount: { increment: 1 } } });
  },

  async recordUse(id: string, userId: string, db: Db = prisma()) {
    return db.inviteUse.create({ data: { inviteId: id, userId } });
  },

  async revoke(id: string, db: Db = prisma()) {
    return db.invite.update({ where: { id }, data: { revokedAt: new Date() } });
  },
};