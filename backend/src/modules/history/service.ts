import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { getPresignedGetUrl } from '../../lib/s3.js';
import { channelRepo } from '../../repositories/channel.repo.js';
import { transmissionRepo } from '../../repositories/transmission.repo.js';
import type { Db } from '../../repositories/types.js';
import { membershipPermissions } from '../workspaces/service.js';

interface ChannelRef {
  id: string;
  name: string;
  type: string;
}

interface UserRef {
  id: string;
  name: string;
  avatarUrl: string | null;
  isBot: boolean;
}

function transmissionDto(t: {
  id: string;
  channelId: string;
  workspaceId: string;
  startedAt: Date;
  durationMs: number;
  audioKey: string | null;
  sizeBytes: number | null;
  listeners: number;
  status: string;
  channel?: ChannelRef | null;
  user?: UserRef | null;
}) {
  return {
    id: t.id,
    channelId: t.channelId,
    workspaceId: t.workspaceId,
    startedAt: t.startedAt,
    durationMs: t.durationMs,
    audioKey: t.audioKey,
    sizeBytes: t.sizeBytes,
    listeners: t.listeners,
    status: t.status,
    ...(t.channel ? { channel: { id: t.channel.id, name: t.channel.name, type: t.channel.type } } : {}),
    ...(t.user ? { user: { id: t.user.id, name: t.user.name, avatarUrl: t.user.avatarUrl, isBot: t.user.isBot } } : {}),
  };
}

/** Attach a short-lived signed GET URL for stored audio, when present. */
async function withAudioUrl<T extends { audioKey?: string | null; audioUrl?: string | null }>(item: T): Promise<T & { audioUrl: string | null }> {
  if (!item.audioKey) return { ...item, audioUrl: null };
  try {
    const { url } = await getPresignedGetUrl({ key: item.audioKey });
    return { ...item, audioUrl: url };
  } catch {
    return { ...item, audioUrl: null };
  }
}

export const historyService = {
  /** Recent transmissions in one channel, newest first. */
  async listChannelHistory(
    actor: { userId: string },
    channelId: string,
    options: { limit?: number; after?: string; userId?: string } = {},
    db: Db = prisma(),
  ) {
    const channel = await channelRepo.findById(channelId, db);
    if (!channel) throw AppError.notFound('Channel not found');
    const perms = await membershipPermissions(actor.userId, channel.workspaceId, db);
    if (!perms) throw AppError.forbidden('You are not a member of this workspace');

    const limit = Math.min(options.limit ?? 50, 100);
    const rows = await transmissionRepo.listByChannel(
      channelId,
      {
        limit: limit + 1,
        after: options.after ? new Date(options.after) : undefined,
        to: options.userId ? undefined : undefined,
        // userId filtering is applied below; listByChannel has no user filter.
      },
      db,
    );
    const filtered = options.userId ? rows.filter((r) => r.userId === options.userId) : rows;
    const hasMore = filtered.length > limit;
    const items = await Promise.all(filtered.slice(0, limit).map((r) => withAudioUrl(transmissionDto(r))));
    return { items, hasMore };
  },

  /** Recent transmissions across a workspace, newest first. */
  async listWorkspaceHistory(
    actor: { userId: string },
    workspaceId: string,
    options: { limit?: number; after?: string; userId?: string } = {},
    db: Db = prisma(),
  ) {
    const perms = await membershipPermissions(actor.userId, workspaceId, db);
    if (!perms) throw AppError.forbidden('You are not a member of this workspace');

    const limit = Math.min(options.limit ?? 50, 100);
    const rows = await transmissionRepo.search(
      workspaceId,
      '',
      {
        limit: limit + 1,
        userId: options.userId,
        from: options.after ? new Date(options.after) : undefined,
        to: undefined,
      },
      db,
    );
    const hasMore = rows.length > limit;
    const items = await Promise.all(rows.slice(0, limit).map((r) => withAudioUrl(transmissionDto(r))));
    return { items, hasMore };
  },

  async searchWorkspaceHistory(
    actor: { userId: string },
    workspaceId: string,
    options: { q?: string; channelId?: string; userId?: string; from?: string; to?: string; limit?: number } = {},
    db: Db = prisma(),
  ) {
    const perms = await membershipPermissions(actor.userId, workspaceId, db);
    if (!perms) throw AppError.forbidden('You are not a member of this workspace');

    const limit = Math.min(options.limit ?? 50, 100);
    const rows = await transmissionRepo.search(
      workspaceId,
      options.q ?? '',
      {
        channelId: options.channelId,
        userId: options.userId,
        from: options.from ? new Date(options.from) : undefined,
        to: options.to ? new Date(options.to) : undefined,
        limit: limit + 1,
      },
      db,
    );
    const hasMore = rows.length > limit;
    const items = await Promise.all(rows.slice(0, limit).map((r) => withAudioUrl(transmissionDto(r))));
    return { items, hasMore };
  },

  async getOne(actor: { userId: string }, transmissionId: string, db: Db = prisma()) {
    const transmission = await transmissionRepo.findById(transmissionId, db);
    if (!transmission) throw AppError.notFound('Transmission not found');
    const perms = await membershipPermissions(actor.userId, transmission.workspaceId, db);
    if (!perms) throw AppError.forbidden('You are not a member of this workspace');
    return { transmission: await withAudioUrl(transmissionDto(transmission)) };
  },

  async remove(actor: { userId: string }, transmissionId: string, db: Db = prisma()) {
    const transmission = await transmissionRepo.findById(transmissionId, db);
    if (!transmission) throw AppError.notFound('Transmission not found');
    const perms = await membershipPermissions(actor.userId, transmission.workspaceId, db);
    if (!perms) throw AppError.forbidden('You are not a member of this workspace');
    if (perms.role !== 'admin' && transmission.userId !== actor.userId) {
      throw AppError.forbidden('Only the speaker or a workspace admin can remove a transmission');
    }
    await transmissionRepo.softDelete(transmissionId, db);
    return { ok: true };
  },
};