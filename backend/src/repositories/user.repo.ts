import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { Db } from './types.js';

const userSelect = {
  id: true,
  email: true,
  name: true,
  avatarUrl: true,
  phone: true,
  locale: true,
  status: true,
  statusMessage: true,
  ghostMode: true,
  isBot: true,
  lastSeenAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{ select: typeof userSelect }>;

const withSecret = {
  id: true,
  email: true,
  passwordHash: true,
  name: true,
  avatarUrl: true,
  phone: true,
  locale: true,
  status: true,
  statusMessage: true,
  ghostMode: true,
  isBot: true,
  totpSecret: true,
  totpEnabled: true,
  lastSeenAt: true,
  createdAt: true,
  deletedAt: true,
} satisfies Prisma.UserSelect;

type UserWithSecret = Prisma.UserGetPayload<{ select: typeof withSecret }>;

function toPublic(u: UserWithSecret): PublicUser {
  const { passwordHash, totpSecret, ...rest } = u;
  return rest;
}

export const userRepo = {
  async findById(id: string, db: Db = prisma()): Promise<PublicUser | null> {
    const u = await db.user.findFirst({
      where: { id, deletedAt: null },
      select: withSecret,
    });
    return u ? toPublic(u) : null;
  },

  async findByEmail(email: string, db: Db = prisma()): Promise<UserWithSecret | null> {
    return db.user.findFirst({
      where: { email: email.toLowerCase(), deletedAt: null },
      select: withSecret,
    });
  },

  async findByEmailIncludeDeleted(email: string, db: Db = prisma()): Promise<UserWithSecret | null> {
    return db.user.findUnique({
      where: { email: email.toLowerCase() },
      select: withSecret,
    });
  },

  async create(
    data: { email: string; passwordHash: string; name: string; phone?: string | null },
    db: Db = prisma(),
  ): Promise<PublicUser> {
    const u = await db.user.create({
      data: { ...data, email: data.email.toLowerCase() },
      select: withSecret,
    });
    return toPublic(u);
  },

  async update(id: string, data: Prisma.UserUpdateInput, db: Db = prisma()): Promise<PublicUser | null> {
    const u = await db.user.update({ where: { id }, data, select: withSecret });
    return u ? toPublic(u) : null;
  },

  async softDelete(id: string, db: Db = prisma()): Promise<void> {
    // GDPR delete: keep the row for referential integrity but purge PII.
    await db.user.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        email: `deleted-${id}@ptt.invalid`,
        name: 'Deleted user',
        statusMessage: '',
        phone: null,
        avatarUrl: null,
        totpSecret: null,
        passwordHash: '!',
      },
    });
  },

  /** Remove the row entirely along with all cascading data (GDPR erase). */
  async hardDelete(id: string, db: Db = prisma()): Promise<void> {
    await db.user.delete({ where: { id } });
  },

  async countActive(db: Db = prisma()): Promise<number> {
    return db.user.count({ where: { deletedAt: null } });
  },

  /** Full-row access for the auth service. */
  async rawById(id: string, db: Db = prisma()) {
    return db.user.findFirst({ where: { id, deletedAt: null }, select: withSecret });
  },

  async listByIds(ids: string[], db: Db = prisma()): Promise<PublicUser[]> {
    if (ids.length === 0) return [];
    const rows = await db.user.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: withSecret,
    });
    return rows.map(toPublic);
  },

  async search(query: string, limit = 20, db: Db = prisma()): Promise<PublicUser[]> {
    const rows = await db.user.findMany({
      where: {
        deletedAt: null,
        OR: [{ name: { contains: query, mode: 'insensitive' } }, { email: { contains: query, mode: 'insensitive' } }],
      },
      orderBy: { name: 'asc' },
      take: limit,
      select: withSecret,
    });
    return rows.map(toPublic);
  },
};