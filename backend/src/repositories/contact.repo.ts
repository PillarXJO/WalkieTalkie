import { prisma } from '../lib/prisma.js';
import type { Db } from './types.js';

export interface NewContact {
  ownerId: string;
  contactId: string;
  nickname?: string | null;
  isFavorite?: boolean;
}

export const contactRepo = {
  async add(data: NewContact, db: Db = prisma()) {
    return db.contact.upsert({
      where: { ownerId_contactId: { ownerId: data.ownerId, contactId: data.contactId } },
      create: {
        ownerId: data.ownerId,
        contactId: data.contactId,
        nickname: data.nickname ?? null,
        isFavorite: data.isFavorite ?? false,
      },
      update: {},
    });
  },

  async exists(ownerId: string, contactId: string, db: Db = prisma()) {
    return (await db.contact.findUnique({ where: { ownerId_contactId: { ownerId, contactId } } })) !== null;
  },

  async listForOwner(ownerId: string, db: Db = prisma()) {
    return db.contact.findMany({
      where: { ownerId },
      include: {
        contact: {
          select: {
            id: true,
            name: true,
            email: true,
            status: true,
            statusMessage: true,
            ghostMode: true,
            avatarUrl: true,
            lastSeenAt: true,
            isBot: true,
            createdAt: true,
          },
        },
      },
      orderBy: [{ isFavorite: 'desc' }, { createdAt: 'asc' }],
    });
  },

  async findByOwnerAndContact(ownerId: string, contactId: string, db: Db = prisma()) {
    return db.contact.findUnique({ where: { ownerId_contactId: { ownerId, contactId } } });
  },

  async update(
    ownerId: string,
    contactId: string,
    data: { nickname?: string | null; isFavorite?: boolean },
    db: Db = prisma(),
  ) {
    return db.contact.update({
      where: { ownerId_contactId: { ownerId, contactId } },
      data: {
        nickname: data.nickname !== undefined ? data.nickname : undefined,
        isFavorite: data.isFavorite !== undefined ? data.isFavorite : undefined,
      },
    });
  },

  async remove(ownerId: string, contactId: string, db: Db = prisma()) {
    const res = await db.contact.deleteMany({ where: { ownerId, contactId } });
    return res.count === 1;
  },
};