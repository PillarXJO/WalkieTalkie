import * as qrcode from 'qrcode';
import { env } from '../../config/env.js';
import type { ChannelType, Permission, Role } from '../../domain/permissions.js';
import { INVITE_ROLES } from '../../domain/permissions.js';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from '../../lib/audit.js';
import { parsePermissions, serializePermissions } from '../../lib/json.js';
import { prisma } from '../../lib/prisma.js';
import { channelMemberRepo } from '../../repositories/channel-member.repo.js';
import { channelRepo } from '../../repositories/channel.repo.js';
import { inviteRepo } from '../../repositories/invite.repo.js';
import { membershipRepo } from '../../repositories/membership.repo.js';
import { workspaceRepo } from '../../repositories/workspace.repo.js';
import type { Db } from '../../repositories/types.js';
import { membershipPermissions } from '../workspaces/service.js';

function assertChannelPermissionNames(permissions: string[]) {
  const known = new Set<string>(['channel.broadcast', 'channel.view_history', 'channel.session_expire']);
  const unknown = permissions.filter((p) => !known.has(p));
  if (unknown.length > 0) {
    throw AppError.badRequest(`Unsupported per-channel permission(s): ${unknown.join(', ')}`);
  }
}

function inviteLinks(code: string) {
  const deepLink = `${env.DEEP_LINK_SCHEME}://invite/${code}`;
  return {
    deepLink,
    url: `${env.INVITE_BASE_URL.replace(/\/$/, '')}/i/${code}`,
    webUrl: `${env.WEB_BASE_URL.replace(/\/$/, '')}/i/${code}`,
  };
}

export const channelsService = {
  async createChannel(
    actor: { userId: string },
    workspaceId: string,
    input: { name: string; description?: string | null; type?: ChannelType; memberIds?: string[] },
    db: Db = prisma(),
  ) {
    const perms = await membershipPermissions(actor.userId, workspaceId, db);
    if (!perms) throw AppError.forbidden('You are not a member of this workspace');
    if (perms.role !== 'admin' && !perms.permissions.includes('channel.create')) {
      throw AppError.forbidden("Permission 'channel.create' required");
    }

    const ws = await workspaceRepo.findById(workspaceId, db);
    if (!ws) throw AppError.notFound('Workspace not found');

    const clash = await db.channel.findFirst({ where: { workspaceId, name: input.name, deletedAt: null }, select: { id: true } });
    if (clash) throw AppError.conflict('A channel with this name already exists');

    const channel = await channelRepo.create(
      {
        workspaceId,
        name: input.name,
        description: input.description ?? null,
        type: input.type ?? 'channel',
        createdById: actor.userId,
      },
      db,
    );
    await channelMemberRepo.join(channel.id, actor.userId, { role: 'owner' }, db);

    // Add the chosen workspace members (the creator is already the owner/admin).
    const selected = new Set(input.memberIds ?? []);
    selected.delete(actor.userId);
    for (const userId of selected) {
      const membership = await membershipRepo.findByUserAndWorkspace(userId, workspaceId, db);
      if (!membership || membership.deletedAt) continue; // only workspace members can be added
      await channelMemberRepo.join(channel.id, userId, {}, db);
    }

    await recordAudit(
      { action: 'channel.create', entityType: 'channel', entityId: channel.id, actorId: actor.userId, workspaceId, data: { name: channel.name, type: channel.type, memberIds: [...selected] } },
      db,
    );
    return channel;
  },

  async getChannel(actor: { userId: string }, channelId: string, db: Db = prisma()) {
    const channel = await channelRepo.findById(channelId, db);
    if (!channel) throw AppError.notFound('Channel not found');
    const perms = await membershipPermissions(actor.userId, channel.workspaceId, db);
    if (!perms) throw AppError.forbidden('You are not a member of this workspace');
    const membership = await channelMemberRepo.findByChannelAndUser(channelId, actor.userId, db);
    return {
      ...channel,
      counts: { members: channel._count.members, transmissions: channel._count.transmissions },
      myRole: membership?.role ?? null,
      isMuted: membership?.isMuted ?? false,
    };
  },

  async updateChannel(actor: { userId: string }, channelId: string, input: { name?: string; description?: string | null }, db: Db = prisma()) {
    const channel = await channelRepo.findById(channelId, db);
    if (!channel) throw AppError.notFound('Channel not found');
    const perms = await membershipPermissions(actor.userId, channel.workspaceId, db);
    if (!perms) throw AppError.forbidden('You are not a member of this workspace');
    if (perms.role !== 'admin' && !perms.permissions.includes('channel.manage')) {
      throw AppError.forbidden("Permission 'channel.manage' required");
    }

    const data: { name?: string; description?: string | null } = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    const updated = await channelRepo.update(channelId, data, db);
    await recordAudit(
      { action: 'channel.update', entityType: 'channel', entityId: channelId, actorId: actor.userId, workspaceId: channel.workspaceId, data: { ...data } },
      db,
    );
    return updated;
  },

  async deleteChannel(actor: { userId: string }, channelId: string, db: Db = prisma()) {
    const channel = await channelRepo.findById(channelId, db);
    if (!channel) throw AppError.notFound('Channel not found');
    if (channel.isDefault) throw AppError.badRequest('A default channel cannot be deleted');
    const perms = await membershipPermissions(actor.userId, channel.workspaceId, db);
    if (!perms) throw AppError.forbidden('You are not a member of this workspace');
    if (perms.role !== 'admin' && !perms.permissions.includes('channel.delete')) {
      throw AppError.forbidden("Permission 'channel.delete' required");
    }
    await channelRepo.softDelete(channelId, db);
    await recordAudit(
      { action: 'channel.delete', entityType: 'channel', entityId: channelId, actorId: actor.userId, workspaceId: channel.workspaceId, data: { name: channel.name } },
      db,
    );
    return { ok: true };
  },

  async joinChannel(actor: { userId: string }, channelId: string, db: Db = prisma()) {
    const channel = await channelRepo.findById(channelId, db);
    if (!channel) throw AppError.notFound('Channel not found');
    const perms = await membershipPermissions(actor.userId, channel.workspaceId, db);
    if (!perms) throw AppError.forbidden('You are not a member of this workspace');
    const joined = await channelMemberRepo.join(channelId, actor.userId, {}, db);
    return { id: joined.id, channelId, joinedAt: joined.joinedAt };
  },

  async leaveChannel(actor: { userId: string }, channelId: string, db: Db = prisma()) {
    const channel = await channelRepo.findById(channelId, db);
    if (!channel) throw AppError.notFound('Channel not found');
    if (channel.isDefault) throw AppError.badRequest('You cannot leave the default channel');
    const membership = await channelMemberRepo.findByChannelAndUser(channelId, actor.userId, db);
    if (!membership) throw AppError.notFound('You are not a member of this channel');
    await channelMemberRepo.softDelete(channelId, actor.userId, db);
    return { ok: true };
  },

  async listMembers(actor: { userId: string }, channelId: string, db: Db = prisma()) {
    const channel = await channelRepo.findById(channelId, db);
    if (!channel) throw AppError.notFound('Channel not found');
    const perms = await membershipPermissions(actor.userId, channel.workspaceId, db);
    if (!perms) throw AppError.forbidden('You are not a member of this workspace');
    const rows = await channelMemberRepo.listByChannel(channelId, db);
    return rows.map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      permissions: parsePermissions(m.permissions),
      isMuted: m.isMuted,
      mutedUntil: m.mutedUntil,
      joinedAt: m.joinedAt,
      user: m.user,
    }));
  },

  /** Per-channel permissions editor (channel owner → moderators/members). */
  async updateMember(
    actor: { userId: string },
    channelId: string,
    userId: string,
    input: { role?: 'owner' | 'moderator' | 'member'; permissions?: string[]; isMuted?: boolean; mutedUntil?: Date | null },
    db: Db = prisma(),
  ) {
    const channel = await channelRepo.findById(channelId, db);
    if (!channel) throw AppError.notFound('Channel not found');
    const perms = await membershipPermissions(actor.userId, channel.workspaceId, db);
    if (!perms) throw AppError.forbidden('You are not a member of this workspace');

    const target = await channelMemberRepo.findByChannelAndUser(channelId, userId, db);
    if (!target) throw AppError.notFound('Channel member not found');

    const myMembership = await channelMemberRepo.findByChannelAndUser(channelId, actor.userId, db);
    const myRole = myMembership?.role ?? 'member';
    const isOwnerOrAdmin = perms.role === 'admin' || myRole === 'owner';
    if (!isOwnerOrAdmin) throw AppError.forbidden('Only the channel owner (or a workspace admin) can edit members');

    if (input.permissions) {
      assertChannelPermissionNames(input.permissions);
    }

    const data: Record<string, unknown> = {};
    if (input.role) {
      // An owner cannot be demoted by a regular member; and you cannot edit another owner.
      if (target.role === 'owner' && input.role !== 'owner' && target.userId !== actor.userId) {
        throw AppError.forbidden('Only the owner themselves can change their channel role');
      }
      if (input.role === 'owner' && target.userId !== actor.userId && perms.role !== 'admin') {
        throw AppError.forbidden('Ownership can only be transferred by the owner');
      }
      data.role = input.role;
    }
    if (input.permissions) data.permissions = serializePermissions(input.permissions);
    if (input.isMuted !== undefined) data.isMuted = input.isMuted;
    if (input.mutedUntil !== undefined) data.mutedUntil = input.mutedUntil;

    const updated = await channelMemberRepo.update(channelId, userId, data as never, db);
    return {
      userId,
      role: updated.role,
      permissions: parsePermissions(updated.permissions),
      isMuted: updated.isMuted,
      mutedUntil: updated.mutedUntil,
    };
  },

  async removeMember(actor: { userId: string }, channelId: string, userId: string, db: Db = prisma()) {
    const channel = await channelRepo.findById(channelId, db);
    if (!channel) throw AppError.notFound('Channel not found');
    const perms = await membershipPermissions(actor.userId, channel.workspaceId, db);
    if (!perms) throw AppError.forbidden('You are not a member of this workspace');

    const target = await channelMemberRepo.findByChannelAndUser(channelId, userId, db);
    if (!target) throw AppError.notFound('Channel member not found');
    const owner =
      await db.channelMember.count({ where: { channelId, role: 'owner', deletedAt: null } });
    if (perms.role !== 'admin' && target.role === 'owner') {
      throw AppError.forbidden('Only a workspace admin can remove the channel owner');
    }
    if (owner <= 1 && target.role === 'owner') {
      throw AppError.conflict('Cannot remove the last channel owner');
    }
    await channelMemberRepo.softDelete(channelId, userId, db);
    return { ok: true };
  },

  async muteSelf(userId: string, channelId: string, until: Date | null, db: Db = prisma()) {
    const channel = await channelRepo.findById(channelId, db);
    if (!channel) throw AppError.notFound('Channel not found');
    const membership = await channelMemberRepo.findByChannelAndUser(channelId, userId, db);
    if (!membership) throw AppError.notFound('You are not a member of this channel');
    await channelMemberRepo.setMuted(channelId, userId, until, until !== null, db);
    return { isMuted: until !== null, mutedUntil: until };
  },

  async channelStats(actor: { userId: string }, channelId: string, days: number, db: Db = prisma()) {
    const channel = await channelRepo.findById(channelId, db);
    if (!channel) throw AppError.notFound('Channel not found');
    const perms = await membershipPermissions(actor.userId, channel.workspaceId, db);
    if (!perms) throw AppError.forbidden('You are not a member of this workspace');

    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const agg = await db.transmission.aggregate({
      where: { channelId, status: 'complete', startedAt: { gte: from, lt: to } },
      _count: { _all: true },
      _sum: { durationMs: true },
    });
    const talkers = await db.transmission.groupBy({
      by: ['userId'],
      where: { channelId, startedAt: { gte: from, lt: to } },
      _count: { _all: true },
    });
    return {
      from,
      to,
      transmissionCount: agg._count._all,
      talkTimeMs: agg._sum.durationMs ?? 0,
      activeTalkers: talkers.length,
    };
  },

  // --- Invites -----------------------------------------------------------------
  async createInvite(
    actor: { userId: string },
    workspaceId: string,
    input: { role?: Role; maxUses?: number; expiresInHours?: number },
    db: Db = prisma(),
  ) {
    const perms = await membershipPermissions(actor.userId, workspaceId, db);
    if (!perms) throw AppError.forbidden('You are not a member of this workspace');
    if (perms.role !== 'admin' && !perms.permissions.includes('member.invite')) {
      throw AppError.forbidden("Permission 'member.invite' required");
    }
    const role = (input.role ?? 'member') as 'member' | 'dispatcher';
    if (!INVITE_ROLES.includes(role)) {
      throw AppError.badRequest('Invites may only grant the member or dispatcher roles');
    }
    const expiresAt = input.expiresInHours ? new Date(Date.now() + input.expiresInHours * 3_600_000) : null;
    const invite = await inviteRepo.create(
      { workspaceId, createdById: actor.userId, role, maxUses: input.maxUses ?? 1, expiresAt },
      db,
    );
    const links = inviteLinks(invite.code);
    await recordAudit(
      { action: 'invite.create', entityType: 'invite', entityId: invite.id, actorId: actor.userId, workspaceId, data: { role, maxUses: invite.maxUses } },
      db,
    );
    return {
      id: invite.id,
      code: invite.code,
      role: invite.role,
      maxUses: invite.maxUses,
      useCount: 0,
      expiresAt,
      ...links,
      qrDataUrl: await qrcode.toDataURL(links.deepLink, { margin: 1, width: 256 }),
    };
  },

  async listInvites(actor: { userId: string }, workspaceId: string, db: Db = prisma()) {
    const perms = await membershipPermissions(actor.userId, workspaceId, db);
    if (!perms) throw AppError.forbidden('You are not a member of this workspace');
    if (perms.role !== 'admin' && !perms.permissions.includes('member.invite')) {
      throw AppError.forbidden("Permission 'member.invite' required");
    }
    const rows = await inviteRepo.listByWorkspace(workspaceId, db);
    return rows.map((inv) => ({
      id: inv.id,
      code: inv.code,
      role: inv.role,
      maxUses: inv.maxUses,
      useCount: inv.useCount,
      expiresAt: inv.expiresAt,
      createdByName: inv.creator?.name ?? null,
      ...inviteLinks(inv.code),
    }));
  },

  async revokeInvite(actor: { userId: string }, workspaceId: string, code: string, db: Db = prisma()) {
    const perms = await membershipPermissions(actor.userId, workspaceId, db);
    if (!perms) throw AppError.forbidden('You are not a member of this workspace');
    if (perms.role !== 'admin' && !perms.permissions.includes('member.invite')) {
      throw AppError.forbidden("Permission 'member.invite' required");
    }
    const invite = await inviteRepo.findByCode(code, db);
    if (!invite || invite.workspaceId !== workspaceId) throw AppError.notFound('Invite not found');
    await inviteRepo.revoke(invite.id, db);
    await recordAudit(
      { action: 'invite.revoke', entityType: 'invite', entityId: invite.id, actorId: actor.userId, workspaceId, data: { code } },
      db,
    );
    return { ok: true };
  },

  /** Public invite preview (no auth) for the join screen. */
  async peekInvite(code: string, db: Db = prisma()) {
    const invite = await inviteRepo.findByCode(code, db);
    if (!invite) throw AppError.notFound('Invite not found');
    if (invite.revokedAt) throw AppError.gone('This invite has been revoked');
    if (invite.expiresAt && invite.expiresAt <= new Date()) throw AppError.gone('This invite has expired');
    if (invite.useCount >= invite.maxUses) throw AppError.gone('This invite has reached its usage limit');

    const workspace = await workspaceRepo.findById(invite.workspaceId, db);
    if (!workspace) throw AppError.gone('The workspace for this invite no longer exists');
    return { code: invite.code, role: invite.role, workspaceName: workspace.name, expiresAt: invite.expiresAt };
  },

  async redeemInvite(actor: { userId: string }, code: string, db: Db = prisma()) {
    const invite = await inviteRepo.findByCode(code, db);
    if (!invite) throw AppError.notFound('Invite not found');
    if (invite.revokedAt) throw AppError.gone('This invite has been revoked');
    if (invite.expiresAt && invite.expiresAt <= new Date()) throw AppError.gone('This invite has expired');
    if (invite.useCount >= invite.maxUses) throw AppError.gone('This invite has reached its usage limit');

    const workspace = await workspaceRepo.findById(invite.workspaceId, db);
    if (!workspace) throw AppError.gone('The workspace no longer exists');

    let membership = await membershipRepo.findByUserAndWorkspace(actor.userId, invite.workspaceId, db);
    if (!membership || membership.deletedAt) {
      membership = await membershipRepo.upsert(invite.workspaceId, actor.userId, { role: invite.role as Role }, db);
      await inviteRepo.incrementUsage(invite.id, db);
      await inviteRepo.recordUse(invite.id, actor.userId, db);
    }

    // Join the workspace's existing channels so the workspace is usable.
    const channels = await channelRepo.listByWorkspace(invite.workspaceId, db);
    for (const channel of channels) {
      await channelMemberRepo.join(channel.id, actor.userId, {}, db);
    }
    await recordAudit(
      { action: 'invite.redeem', entityType: 'invite', entityId: invite.id, actorId: actor.userId, workspaceId: invite.workspaceId, data: { code } },
      db,
    );

    const all = await workspaceRepo.listForUser(actor.userId, db);
    const workspaces = all.map((w) => ({
      id: w.id,
      name: w.name,
      role: w.members[0]?.role as Role,
      defaultChannelId: w.defaultChannelId,
    }));
    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        role: membership.role,
        defaultChannelId: workspace.defaultChannelId,
      },
      channels: channels.map((c) => ({ id: c.id, name: c.name, type: c.type as string })),
      workspaces,
    };
  },
};

export type { Permission };