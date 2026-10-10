import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { locationRepo } from '../../repositories/location.repo.js';
import { membershipRepo } from '../../repositories/membership.repo.js';
import type { Db } from '../../repositories/types.js';
import { membershipPermissions } from '../workspaces/service.js';

function pingDto(p: {
  id: string;
  userId: string;
  workspaceId: string | null;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  speed: number | null;
  heading: number | null;
  source: string;
  at: Date;
  user?: { id: string; name: string; status: string } | null;
}) {
  return {
    id: p.id,
    userId: p.userId,
    workspaceId: p.workspaceId,
    latitude: p.latitude,
    longitude: p.longitude,
    accuracy: p.accuracy,
    altitude: p.altitude,
    speed: p.speed,
    heading: p.heading,
    source: p.source,
    at: p.at,
    ...(p.user ? { user: { id: p.user.id, name: p.user.name, status: p.user.status } } : {}),
  };
}

export const locationService = {
  /** Record a location ping for the authenticated user. */
  async record(
    actor: { userId: string },
    input: {
      latitude: number;
      longitude: number;
      accuracy?: number | null;
      altitude?: number | null;
      speed?: number | null;
      heading?: number | null;
      source?: 'always' | 'whileUsing' | 'manual';
      workspaceId?: string;
      at?: string;
    },
    db: Db = prisma(),
  ) {
    if (input.workspaceId) {
      const perms = await membershipPermissions(actor.userId, input.workspaceId, db);
      if (!perms) throw AppError.forbidden('You are not a member of this workspace');
    }
    const ping = await locationRepo.insert(
      {
        userId: actor.userId,
        workspaceId: input.workspaceId ?? null,
        latitude: input.latitude,
        longitude: input.longitude,
        accuracy: input.accuracy ?? null,
        altitude: input.altitude ?? null,
        speed: input.speed ?? null,
        heading: input.heading ?? null,
        source: input.source,
        at: input.at ? new Date(input.at) : undefined,
      },
      db,
    );
    return { ping: pingDto(ping) };
  },

  async myLatest(actor: { userId: string }, db: Db = prisma()) {
    const ping = await locationRepo.latestForUser(actor.userId, db);
    return { ping: ping ? pingDto(ping) : null };
  },

  /**
   * Last known location of a user. Self is always allowed; otherwise the
   * caller must share a workspace with `location.view`.
   */
  async latestForUser(actor: { userId: string }, targetUserId: string, db: Db = prisma()) {
    if (targetUserId !== actor.userId) {
      const viewer = await membershipRepo.listForUser(actor.userId, db);
      let allowed = false;
      for (const m of viewer) {
        const perms = await membershipPermissions(actor.userId, m.workspaceId, db);
        if (perms?.permissions.includes('location.view')) {
          const target = await membershipRepo.findByUserAndWorkspace(targetUserId, m.workspaceId, db);
          if (target) {
            allowed = true;
            break;
          }
        }
      }
      if (!allowed) throw AppError.forbidden("Permission 'location.view' required to see another member's location");
    }
    const ping = await locationRepo.latestForUser(targetUserId, db);
    return { ping: ping ? pingDto(ping) : null };
  },

  /** Recent pings in a workspace, optionally collapsed to one per user. */
  async listWorkspace(
    actor: { userId: string },
    workspaceId: string,
    query: { windowMinutes?: number; from?: string; to?: string; limit?: number; latest?: boolean; userId?: string },
    db: Db = prisma(),
  ) {
    const perms = await membershipPermissions(actor.userId, workspaceId, db);
    if (!perms) throw AppError.forbidden('You are not a member of this workspace');
    if (perms.role !== 'admin' && !perms.permissions.includes('location.view')) {
      throw AppError.forbidden("Permission 'location.view' required");
    }

    if (query.latest) {
      const members = await membershipRepo.listByWorkspace(workspaceId, db);
      const rows = await locationRepo.lastKnownByUsers(
        members.map((m) => m.userId),
        db,
      );
      const filtered = query.userId ? rows.filter((r) => r.userId === query.userId) : rows;
      return { pings: filtered.map((r) => pingDto(r)), latest: true as const };
    }

    const rows = await locationRepo.listForWorkspace(
      workspaceId,
      {
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        windowMinutes: query.windowMinutes,
        limit: query.limit,
      },
      db,
    );
    const filtered = query.userId ? rows.filter((r) => r.userId === query.userId) : rows;
    return { pings: filtered.map((r) => pingDto(r)), latest: false as const };
  },
};