import type { Presence } from '../domain/permissions.js';
import { PRESENCE } from '../domain/permissions.js';
import { AppError } from './errors.js';
import { redis, pubSubClient } from './redis.js';

const PRESENCE_CHANNEL = 'presence';

export function presenceKey(userId: string): string {
  return `presence:user:${userId}`;
}

export interface PresenceSnapshot {
  userId: string;
  status: Presence;
  statusMessage: string;
  lastSeenAt: string | null;
}

export async function getPresence(userId: string, opts: { isGhost?: boolean; hiddenByBlock?: boolean } = {}): Promise<PresenceSnapshot> {
  if (opts.isGhost || opts.hiddenByBlock) {
    return { userId, status: 'offline', statusMessage: '', lastSeenAt: null };
  }

  const raw = await redis().hgetall(presenceKey(userId));
  if (!raw || Object.keys(raw).length === 0) {
    // Fall back to the persisted value in the profile.
    return { userId, status: 'offline', statusMessage: '', lastSeenAt: null };
  }

  const status = (raw.status as Presence) ?? 'offline';
  return {
    userId,
    status: PRESENCE.includes(status) ? status : 'offline',
    statusMessage: raw.statusMessage ?? '',
    lastSeenAt: raw.lastSeenAt ?? null,
  };
}

/**
 * Update Redis presence and fan out a presence event. Voice/status changes
 * are persisted to the user profile separately by the caller.
 */
export async function setPresence(
  userId: string,
  data: { status?: Presence; statusMessage?: string; lastSeenAt?: string },
): Promise<void> {
  if (data.status !== undefined && !PRESENCE.includes(data.status)) {
    throw AppError.badRequest(`Invalid presence: ${data.status}`);
  }

  const entry: Record<string, string> = {};
  if (data.status !== undefined) entry.status = data.status;
  if (data.statusMessage !== undefined) entry.statusMessage = data.statusMessage;
  entry.lastSeenAt = data.lastSeenAt ?? new Date().toISOString();

  if (Object.keys(entry).length > 0) {
    await redis().hset(presenceKey(userId), entry);
    await redis().expire(presenceKey(userId), 7 * 86_400); // keep presence for a week
  }

  const status = data.status ?? (await redis().hget(presenceKey(userId), 'status')) ?? 'offline';
  const statusMessage = data.statusMessage ?? (await redis().hget(presenceKey(userId), 'statusMessage')) ?? '';

  const pub = pubSubClient();
  try {
    await pub.publish(PRESENCE_CHANNEL, JSON.stringify({ userId, status, statusMessage, at: new Date().toISOString() }));
  } finally {
    pub.disconnect();
  }
}

export async function clearPresence(userId: string): Promise<void> {
  await redis().del(presenceKey(userId));
}

export { PRESENCE_CHANNEL };