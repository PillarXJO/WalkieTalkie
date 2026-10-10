import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { publishServerEvent } from '../../lib/server-events.js';
import { channelMemberRepo } from '../../repositories/channel-member.repo.js';
import { channelRepo } from '../../repositories/channel.repo.js';
import { transmissionRepo } from '../../repositories/transmission.repo.js';
import type { Db } from '../../repositories/types.js';
import type { Role } from '../../domain/permissions.js';
import { membershipPermissions } from '../workspaces/service.js';
import { ensureEchoBot } from './echo.js';

export type FloorPriority = 'normal' | 'priority' | 'emergency';

const PRIORITY: Record<FloorPriority, number> = { normal: 0, priority: 1, emergency: 2 };

export interface FloorState {
  channelId: string;
  workspaceId: string;
  speakerId: string;
  priority: FloorPriority;
  emergency: boolean;
  startedAt: string;
  expiresAt: string;
}

export function floorKey(channelId: string): string {
  return `floor:${channelId}`;
}

function storedFloor(raw: Record<string, string> | null | undefined): FloorState | null {
  if (!raw || !raw.speakerId || !raw.channelId || !raw.workspaceId) return null;
  const expiresAt = Number(raw.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  const priority = (raw.priority as FloorPriority) ?? 'normal';
  return {
    channelId: raw.channelId,
    workspaceId: raw.workspaceId,
    speakerId: raw.speakerId,
    priority: PRIORITY[priority] !== undefined ? priority : 'normal',
    emergency: raw.emergency === '1',
    startedAt: new Date(Number(raw.startedAt)).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

async function readFloor(channelId: string): Promise<FloorState | null> {
  const raw = await redis().hgetall(floorKey(channelId));
  const state = storedFloor(raw);
  if (!state && raw && Object.keys(raw).length > 0) {
    await redis().del(floorKey(channelId));
  }
  return state;
}

async function writeFloor(state: FloorState): Promise<void> {
  await redis().hset(floorKey(state.channelId), {
    channelId: state.channelId,
    workspaceId: state.workspaceId,
    speakerId: state.speakerId,
    priority: state.priority,
    emergency: state.emergency ? '1' : '0',
    startedAt: String(Date.parse(state.startedAt)),
    expiresAt: String(Date.parse(state.expiresAt)),
  });
  await redis().expire(floorKey(state.channelId), Math.ceil(env.PTT_FLOOR_TTL_SECONDS * 1.5));
}

function nextExpiry(): Date {
  return new Date(Date.now() + env.PTT_FLOOR_TTL_SECONDS * 1000);
}

async function publishFloor(channelId: string, workspaceId: string, state: FloorState | null) {
  await publishServerEvent({ type: 'floor.state', channelId, workspaceId, at: new Date().toISOString(), data: { state } });
}

function canUsePriority(role?: Role, channelRole?: string | null): boolean {
  if (role === 'admin' || role === 'dispatcher') return true;
  return channelRole === 'owner' || channelRole === 'moderator';
}

/** Persist a finished talk segment and, on echo channels, mirror it back. */
async function recordTransmission(state: FloorState, db: Db) {
  const durationMs = Math.max(0, Date.now() - Date.parse(state.startedAt));
  const [members, channel] = await Promise.all([
    channelMemberRepo.countByChannel(state.channelId, db),
    channelRepo.findById(state.channelId, db),
  ]);
  const transmission = await transmissionRepo.create(
    {
      channelId: state.channelId,
      workspaceId: state.workspaceId,
      userId: state.speakerId,
      status: 'complete',
      startedAt: new Date(state.startedAt),
      durationMs,
      listeners: Math.max(0, members - 1),
    },
    db,
  );
  const base = {
    id: transmission.id,
    channelId: state.channelId,
    workspaceId: state.workspaceId,
    speakerId: state.speakerId,
    durationMs,
    startedAt: state.startedAt,
  };
  await publishServerEvent({
    type: 'transmission.complete',
    channelId: state.channelId,
    workspaceId: state.workspaceId,
    at: new Date().toISOString(),
    data: base,
  });

  if (channel?.type === 'echo') {
    const bot = await ensureEchoBot(db);
    const mirrored = await transmissionRepo.create(
      {
        channelId: state.channelId,
        workspaceId: state.workspaceId,
        userId: bot.id,
        status: 'complete',
        durationMs,
        listeners: Math.max(0, members - 1),
      },
      db,
    );
    await publishServerEvent({
      type: 'transmission.echo',
      channelId: state.channelId,
      workspaceId: state.workspaceId,
      at: new Date().toISOString(),
      data: { id: mirrored.id, channelId: state.channelId, speakerId: bot.id, durationMs, mirroredFrom: transmission.id },
    });
  }
}

export const floorService = {
  async get(channelId: string, db: Db = prisma()) {
    const channel = await channelRepo.findById(channelId, db);
    if (!channel) throw AppError.notFound('Channel not found');
    return readFloor(channelId);
  },

  async request(
    actor: { userId: string },
    channelId: string,
    priority: FloorPriority = 'normal',
    db: Db = prisma(),
  ): Promise<FloorState> {
    const channel = await channelRepo.findById(channelId, db);
    if (!channel) throw AppError.notFound('Channel not found');
    const perms = await membershipPermissions(actor.userId, channel.workspaceId, db);
    if (!perms) throw AppError.forbidden('You are not a member of this workspace');

    const membership = await channelMemberRepo.findByChannelAndUser(channelId, actor.userId, db);
    if (!membership) throw AppError.forbidden('You are not a member of this channel');
    if (membership.isMuted || (membership.mutedUntil && membership.mutedUntil > new Date())) {
      throw AppError.forbidden('You are muted in this channel');
    }

    const lvl = PRIORITY[priority];
    if (priority === 'priority' && !canUsePriority(perms.role, membership.role)) {
      throw AppError.forbidden('Priority talk requires an owner/moderator or dispatcher+ role');
    }

    const now = Date.now();
    const current = await readFloor(channelId);
    const granted: FloorState = {
      channelId,
      workspaceId: channel.workspaceId,
      speakerId: actor.userId,
      priority,
      emergency: priority === 'emergency',
      startedAt: new Date(now).toISOString(),
      expiresAt: nextExpiry().toISOString(),
    };

    if (current) {
      const interruptible = lvl > PRIORITY[current.priority] || Date.parse(current.expiresAt) <= now;
      if (current.speakerId === actor.userId && !interruptible) {
        // Same speaker renews their slot (sliding window).
        granted.startedAt = current.startedAt;
        granted.expiresAt = nextExpiry().toISOString();
        await writeFloor(granted);
        await publishFloor(channelId, channel.workspaceId, granted);
        return granted;
      }
      if (!interruptible && !(priority === 'emergency')) {
        throw AppError.conflict('Floor is busy', { current });
      }
      // Preemption: the interrupted segment is recorded for analytics/history.
      if (Date.parse(current.startedAt) < now) {
        await recordTransmission(current, db);
      }
    }

    await writeFloor(granted);
    await publishFloor(channelId, channel.workspaceId, granted);
    return granted;
  },

  async release(
    actor: { userId: string },
    channelId: string,
    db: Db = prisma(),
  ): Promise<{ ok: true; released: FloorState | null }> {
    const current = await readFloor(channelId);
    if (!current) {
      return { ok: true, released: null };
    }

    const channel = await channelRepo.findById(channelId, db);
    const perms = channel ? await membershipPermissions(actor.userId, channel.workspaceId, db) : null;
    const membership = channel ? await channelMemberRepo.findByChannelAndUser(channelId, actor.userId, db) : null;
    const canForce = perms?.role === 'admin' || membership?.role === 'owner' || membership?.role === 'moderator';
    if (current.speakerId !== actor.userId && !canForce) {
      throw AppError.forbidden('Only the current speaker (or a channel moderator) can release the floor');
    }

    await redis().del(floorKey(channelId));
    await recordTransmission(current, db);
    if (channel) await publishFloor(channelId, channel.workspaceId, null);
    return { ok: true, released: current };
  },
};