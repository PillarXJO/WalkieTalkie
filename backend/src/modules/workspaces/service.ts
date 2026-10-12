import {
  ROLE_PERMISSIONS,
  type Permission,
  type Role,
} from '../../domain/permissions.js';
import { parsePermissions, parseSettings, serializeJson } from '../../lib/json.js';
import { prisma } from '../../lib/prisma.js';
import { channelRepo } from '../../repositories/channel.repo.js';
import { membershipRepo } from '../../repositories/membership.repo.js';
import { workspaceRepo } from '../../repositories/workspace.repo.js';
import type { Db } from '../../repositories/types.js';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from '../../lib/audit.js';
import { assertValidPermissions } from './schema.js';

export interface ProvisionedWorkspace {
  workspace: Awaited<ReturnType<typeof workspaceRepo.create>>;
  channels: Awaited<ReturnType<typeof channelRepo.create>>[];
}

/**
 * Every account gets a personal workspace. Channels are no longer provisioned
 * automatically — workspace members create channels explicitly (the creator
 * becomes the channel owner/admin).
 */
export async function provisionNewWorkspace(
  ownerId: string,
  name: string,
  db: Db = prisma(),
  tx: Db = db,
): Promise<ProvisionedWorkspace> {
  const workspace = await workspaceRepo.create({ name, ownerId }, tx);
  await membershipRepo.upsert(workspace.id, ownerId, { role: 'admin' }, tx);
  const refreshed = await workspaceRepo.findById(workspace.id, db);
  return { workspace: refreshed ?? workspace, channels: [] };
}

/** Effective permission set = role defaults ∪ explicit extras. */
export function effectivePermissions(role: Role, extras: string[] = []): Permission[] {
  return [...new Set<string>([...ROLE_PERMISSIONS[role], ...extras])] as Permission[];
}

export async function membershipPermissions(
  userId: string,
  workspaceId: string,
  db: Db = prisma(),
): Promise<{ role: Role; permissions: Permission[] } | null> {
  const m = await membershipRepo.findByUserAndWorkspace(userId, workspaceId, db);
  if (!m) return null;
  const role = m.role as Role;
  return { role, permissions: effectivePermissions(role, parsePermissions(m.permissions)) };
}

export type WorkspaceRow = {
  id: string;
  name: string;
  defaultChannelId?: string | null;
  settings: string;
  createdAt: Date;
};

export function workspaceDto(w: WorkspaceRow, role?: Role) {
  return {
    id: w.id,
    name: w.name,
    ...(role ? { role } : {}),
    defaultChannelId: w.defaultChannelId,
    settings: parseSettings<Record<string, unknown>>(w.settings),
    createdAt: w.createdAt,
  };
}

export function assertMember(actor: { userId: string }, wid: string, db: Db = prisma()) {
  return membershipRepo.findByUserAndWorkspace(actor.userId, wid, db).then((m) => {
    if (!m) throw AppError.forbidden('You are not a member of this workspace');
    return m;
  });
}

export const workspaceService = {
  /** Like assertMember but also enforces the admin role. */
  assertAdmin: async (actor: { userId: string }, wid: string, db: Db = prisma()) => {
    const m = await membershipRepo.findByUserAndWorkspace(actor.userId, wid, db);
    if (!m) throw AppError.forbidden('You are not a member of this workspace');
    if (m.role !== 'admin') throw AppError.forbidden('Only workspace admins can perform this action');
    return m;
  },

  /** Create a workspace; the creator becomes its admin. */
  async create(actor: { userId: string }, name: string) {
    const { workspace, channels } = await provisionNewWorkspace(actor.userId, name);
    const membership = await membershipRepo.findByUserAndWorkspace(actor.userId, workspace.id);
    await recordAudit(
      { action: 'workspace.create', entityType: 'workspace', entityId: workspace.id, actorId: actor.userId, workspaceId: workspace.id, data: { name } },
    );
    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        role: membership?.role as Role,
        defaultChannelId: workspace.defaultChannelId,
        settings: parseSettings<Record<string, unknown>>(workspace.settings),
        createdAt: workspace.createdAt,
      },
      channels,
    };
  },

  async listForUser(userId: string) {
    const rows = await workspaceRepo.listForUser(userId);
    return Promise.all(
      rows.map(async (w) => {
        const [channels, members] = await Promise.all([
          channelRepo.listByWorkspace(w.id).then((c) => c.length),
          membershipRepo.countByWorkspace(w.id),
        ]);
        return { ...workspaceDto(w, (w.members[0]?.role as Role) ?? undefined), channelCount: channels, memberCount: members };
      }),
    );
  },

  async get(actor: { userId: string }, workspaceId: string) {
    const my = await assertMember(actor, workspaceId);
    const workspace = await workspaceRepo.findById(workspaceId);
    if (!workspace) throw AppError.notFound('Workspace not found');
    const [channels, memberCount] = await Promise.all([
      channelRepo.listByWorkspace(workspaceId),
      membershipRepo.countByWorkspace(workspaceId),
    ]);
    return {
      workspace: workspaceDto(workspace, my.role as Role),
      role: my.role as Role,
      permissions: effectivePermissions(my.role as Role, parsePermissions(my.permissions)),
      channels,
      memberCount,
    };
  },

  async update(actor: { userId: string }, workspaceId: string, data: { name?: string; settings?: Record<string, unknown> }) {
    const my = await assertMember(actor, workspaceId);
    const existing = await workspaceRepo.findById(workspaceId);
    if (!existing) throw AppError.notFound('Workspace not found');

    const update: { name?: string; settings?: string } = {};
    if (data.name !== undefined) update.name = data.name;
    if (data.settings !== undefined) {
      const merged = { ...parseSettings<Record<string, unknown>>(existing.settings), ...data.settings };
      update.settings = serializeJson(merged);
    }
    const updated = await workspaceRepo.update(workspaceId, update);
    await recordAudit(
      { action: 'workspace.update', entityType: 'workspace', entityId: workspaceId, actorId: actor.userId, workspaceId, data: { ...update } },
    );
    return workspaceDto(updated, my.role as Role);
  },

  async remove(actor: { userId: string }, workspaceId: string, db: Db = prisma()) {
    await assertMember(actor, workspaceId, db);
    await workspaceRepo.softDelete(workspaceId, db);
    await recordAudit(
      { action: 'workspace.delete', entityType: 'workspace', entityId: workspaceId, actorId: actor.userId, workspaceId },
      db,
    );
    return { ok: true };
  },

  async listMembers(actor: { userId: string }, workspaceId: string) {
    await assertMember(actor, workspaceId);
    const rows = await membershipRepo.listByWorkspace(workspaceId);
    return rows.map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      permissions: parsePermissions(m.permissions),
      nickname: m.nickname,
      joinedAt: m.joinedAt,
      user: m.user,
    }));
  },

  /** Admin-provisioned add (bypasses invites). */
  async addMember(
    actor: { userId: string },
    workspaceId: string,
    input: { userId: string; role?: Role; nickname?: string | null; permissions?: string[] },
    db: Db = prisma(),
  ) {
    await this.assertAdmin(actor, workspaceId, db);

    const user = await db.user.findFirst({ where: { id: input.userId, deletedAt: null }, select: { id: true, isBot: true } });
    if (!user) throw AppError.notFound('User not found');
    const existing = await membershipRepo.findByUserAndWorkspace(input.userId, workspaceId, db);
    if (existing && !existing.deletedAt) throw AppError.conflict('User is already a member');

    const toUpsert: { role?: Role; nickname?: string | null; permissions?: string[] } = {};
    if (input.role) toUpsert.role = input.role;
    if (input.nickname !== undefined) toUpsert.nickname = input.nickname;
    if (input.permissions) {
      assertValidPermissions(input.permissions);
      toUpsert.permissions = input.permissions;
    }

    const updated = await membershipRepo.upsert(workspaceId, input.userId, toUpsert, db);
    await recordAudit(
      { action: 'member.add', entityType: 'membership', entityId: input.userId, actorId: actor.userId, workspaceId, data: { role: updated.role, permissions: parsePermissions(updated.permissions) } },
      db,
    );
    return {
      userId: input.userId,
      role: updated.role,
      permissions: parsePermissions(updated.permissions),
      nickname: updated.nickname,
    };
  },

  async updateMember(
    actor: { userId: string },
    workspaceId: string,
    userId: string,
    data: { role?: Role; nickname?: string | null; permissions?: string[]; merge?: boolean },
    db: Db = prisma(),
  ) {
    const my = await assertMember(actor, workspaceId, db);
    if (my.role !== 'admin') throw AppError.forbidden('Only workspace admins can edit members');

    const target = await membershipRepo.findByUserAndWorkspace(userId, workspaceId, db);
    if (!target) throw AppError.notFound('Member not found');

    if (data.permissions) {
      assertValidPermissions(data.permissions);
    }

    // Do not strip admin from the last admin to make the workspace headless.
    const isLastAdmin =
      my.userId === userId &&
      target.role === 'admin' &&
      (await db.membership.count({ where: { workspaceId, role: 'admin', deletedAt: null } })) <= 1 &&
      data.role !== 'admin';
    if (isLastAdmin) throw AppError.conflict('Cannot change the role of the last workspace admin');

    const toUpsert: { role?: Role; nickname?: string | null; permissions?: string[] } = {};
    if (data.role) toUpsert.role = data.role;
    if (data.nickname !== undefined) toUpsert.nickname = data.nickname;
    if (data.permissions) {
      const base = data.merge ? parsePermissions(target.permissions) : [];
      toUpsert.permissions = [...new Set([...base, ...data.permissions])];
    }

    const updated = await membershipRepo.upsert(workspaceId, userId, toUpsert, db);
    await recordAudit(
      { action: 'member.update', entityType: 'membership', entityId: userId, actorId: actor.userId, workspaceId, data: { role: updated.role, permissions: parsePermissions(updated.permissions) } },
      db,
    );
    return {
      userId,
      role: updated.role,
      permissions: parsePermissions(updated.permissions),
      nickname: updated.nickname,
    };
  },

  async removeMember(actor: { userId: string }, workspaceId: string, userId: string, db: Db = prisma()) {
    const my = await assertMember(actor, workspaceId, db);
    if (my.role !== 'admin') throw AppError.forbidden('Only workspace admins can remove members');

    const target = await membershipRepo.findByUserAndWorkspace(userId, workspaceId, db);
    if (!target) throw AppError.notFound('Member not found');

    if (target.role === 'admin') {
      const admins = await db.membership.count({ where: { workspaceId, role: 'admin', deletedAt: null } });
      if (admins <= 1) throw AppError.conflict('Cannot remove the last workspace admin');
    }

    await membershipRepo.softDelete(workspaceId, userId, db);
    await db.channelMember.updateMany({
      where: { userId, deletedAt: null, channel: { workspaceId } },
      data: { deletedAt: new Date() },
    });
    await recordAudit(
      { action: 'member.remove', entityType: 'membership', entityId: userId, actorId: actor.userId, workspaceId },
      db,
    );
    return { ok: true };
  },

  /** Usage stats for a workspace window (admins / dispatchers with admin.stats). */
  async stats(workspaceId: string, days: number = 7, db: Db = prisma()) {
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const [usage, members] = await Promise.all([
      channelRepo.usageStats(workspaceId, from, to, db),
      membershipRepo.countByWorkspace(workspaceId, db),
    ]);
    return { from, to, memberCount: members, ...usage };
  },
};