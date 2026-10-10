import type { Presence } from '../../domain/permissions.js';
import { AppError } from '../../lib/errors.js';
import { getPresence, setPresence } from '../../lib/presence.js';
import { prisma } from '../../lib/prisma.js';
import { blockRepo } from '../../repositories/block.repo.js';
import { contactRepo } from '../../repositories/contact.repo.js';
import { userRepo } from '../../repositories/user.repo.js';
import type { Db } from '../../repositories/types.js';

/** True when either user has blocked the other (blocks are mutual in effect). */
export async function anyBlock(a: string, b: string, db: Db = prisma()): Promise<boolean> {
  return (await blockRepo.exists(a, b, db)) || (await blockRepo.exists(b, a, db));
}

export const usersService = {
  async listContacts(ownerId: string, db: Db = prisma()) {
    const rows = await contactRepo.listForOwner(ownerId, db);
    return Promise.all(
      rows.map(async (row) => {
        const contact = row.contact;
        const hidden = await anyBlock(ownerId, contact.id, db);
        return {
          id: row.id,
          nickname: row.nickname,
          isFavorite: row.isFavorite,
          addedAt: row.createdAt,
          user: {
            id: contact.id,
            name: contact.name,
            email: contact.email,
            avatarUrl: contact.avatarUrl,
            isBot: contact.isBot,
            createdAt: contact.createdAt,
          },
          presence: await getPresence(contact.id, { isGhost: contact.ghostMode, hiddenByBlock: hidden }),
          blocked: hidden,
        };
      }),
    );
  },

  async addContact(ownerId: string, input: { userId: string; nickname?: string | null; isFavorite?: boolean }, db: Db = prisma()) {
    const { userId } = input;
    if (userId === ownerId) throw AppError.badRequest('You cannot add yourself as a contact');
    const target = await db.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true, isBot: true } });
    if (!target) throw AppError.notFound('User not found');
    if (await contactRepo.exists(ownerId, userId, db)) throw AppError.conflict('Already a contact');

    const row = await contactRepo.add({ ownerId, contactId: userId, nickname: input.nickname, isFavorite: input.isFavorite }, db);
    return { id: row.id, userId, nickname: row.nickname, isFavorite: row.isFavorite };
  },

  async updateContact(ownerId: string, rowId: string, input: { nickname?: string | null; isFavorite?: boolean }, db: Db = prisma()) {
    const row = await db.contact.findFirst({ where: { id: rowId, ownerId } });
    if (!row) throw AppError.notFound('Contact not found');
    const updated = await contactRepo.update(ownerId, row.contactId, input, db);
    return { id: updated.id, userId: row.contactId, nickname: updated.nickname, isFavorite: updated.isFavorite };
  },

  async removeContact(ownerId: string, rowId: string, db: Db = prisma()) {
    const row = await db.contact.findFirst({ where: { id: rowId, ownerId } });
    if (!row) throw AppError.notFound('Contact not found');
    await contactRepo.remove(ownerId, row.contactId, db);
    return { ok: true };
  },

  async listBlocks(viewerId: string, db: Db = prisma()) {
    const rows = await blockRepo.listBlocked(viewerId, db);
    return rows.map((r) => ({
      id: r.id,
      blockedAt: r.createdAt,
      user: r.blocked,
    }));
  },

  async blockUser(viewerId: string, targetId: string, db: Db = prisma()) {
    if (targetId === viewerId) throw AppError.badRequest('You cannot block yourself');
    const target = await db.user.findFirst({ where: { id: targetId, deletedAt: null }, select: { id: true } });
    if (!target) throw AppError.notFound('User not found');
    if (await blockRepo.exists(viewerId, targetId, db)) throw AppError.conflict('Already blocked');
    await blockRepo.create(viewerId, targetId, db);
    return { ok: true };
  },

  async unblockUser(viewerId: string, targetId: string, db: Db = prisma()) {
    const existed = await blockRepo.exists(viewerId, targetId, db);
    if (!existed) throw AppError.notFound('Block not found');
    await blockRepo.remove(viewerId, targetId, db);
    return { ok: true };
  },

  /** Public profile that respects the block rules (no presence leak). */
  async profile(targetId: string, viewerId?: string, db: Db = prisma()) {
    const user = await userRepo.findById(targetId, db);
    if (!user) throw AppError.notFound('User not found');
    if (viewerId && viewerId !== targetId) {
      const blocked = await anyBlock(viewerId, targetId, db);
      if (blocked) throw AppError.notFound('User not found');
    }
    const isSelf = viewerId === targetId;
    return {
      id: user.id,
      name: user.name,
      email: isSelf ? user.email : undefined, // email is private to the account owner
      avatarUrl: user.avatarUrl,
      phone: isSelf ? user.phone : undefined,
      locale: user.locale,
      isBot: user.isBot,
      createdAt: user.createdAt,
      presence: await getPresence(targetId, { isGhost: isSelf ? false : user.ghostMode }),
      friend: viewerId ? await contactRepo.exists(viewerId, targetId, db) : false,
    };
  },

  async updateStatus(userId: string, input: { status: Presence; statusMessage?: string }, db: Db = prisma()) {
    await userRepo.update(userId, {
      status: input.status,
      statusMessage: input.statusMessage ?? '',
      lastSeenAt: new Date(),
    }, db);
    await setPresence(userId, { status: input.status, statusMessage: input.statusMessage ?? '' });
    const me = await userRepo.findById(userId, db);
    return { status: me?.status, statusMessage: me?.statusMessage ?? '' };
  },

  async updateProfile(userId: string, input: Record<string, unknown>, db: Db = prisma()) {
    const update: Record<string, unknown> = { ...input };
    if (input.status !== undefined || input.statusMessage !== undefined) {
      const status = (input.status as Presence) ?? (await db.user.findUnique({ where: { id: userId } }))?.status ?? 'offline';
      await setPresence(userId, {
        status,
        statusMessage: (input.statusMessage as string) ?? '',
      });
    }
    const updated = await userRepo.update(userId, update as never, db);
    if (!updated) throw AppError.notFound('User not found');
    return updated;
  },
};