import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { sendPush, type PushMessage } from '../../lib/push.js';
import { channelMemberRepo } from '../../repositories/channel-member.repo.js';
import { membershipRepo } from '../../repositories/membership.repo.js';
import { notificationRepo, type NotifKind } from '../../repositories/notification.repo.js';
import { pushTokenRepo } from '../../repositories/push-token.repo.js';
import type { Db } from '../../repositories/types.js';

function inQuietHours(startMin: number, endMin: number, now = new Date()): boolean {
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (startMin === endMin) return false;
  if (startMin < endMin) return minutes >= startMin && minutes < endMin;
  // Window wraps midnight (e.g. 23:00 -> 07:00).
  return minutes >= startMin || minutes < endMin;
}

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  priority?: 'default' | 'high';
  channelId?: string;
  sound?: 'default' | null;
}

export const notificationsService = {
  async registerToken(actor: { userId: string }, input: { token: string; platform: string; appId?: string | null }, db: Db = prisma()) {
    const row = await pushTokenRepo.upsert(actor.userId, input, db);
    return { id: row.id, token: row.token, platform: row.platform, appId: row.appId };
  },

  async removeToken(actor: { userId: string }, token: string, db: Db = prisma()) {
    await pushTokenRepo.remove(actor.userId, token, db);
    return { ok: true };
  },

  async listTokens(actor: { userId: string }, db: Db = prisma()) {
    const rows = await pushTokenRepo.listForUser(actor.userId, db);
    return { tokens: rows.map((r) => ({ id: r.id, token: r.token, platform: r.platform, appId: r.appId, lastUsedAt: r.lastUsedAt })) };
  },

  async listSettings(actor: { userId: string }, db: Db = prisma()) {
    const rows = await notificationRepo.listForUser(actor.userId, db);
    return {
      settings: rows.map((r) => ({
        kind: r.kind,
        targetId: r.targetId,
        targetUserId: r.targetUserId,
        pushEnabled: r.pushEnabled,
        priority: r.priority,
        dnd: { enabled: r.dndEnabled, startMin: r.dndStartMin, endMin: r.dndEndMin },
        muteUntil: r.muteUntil,
      })),
    };
  },

  async upsertSetting(
    actor: { userId: string },
    input: {
      kind: NotifKind;
      targetId?: string | null;
      targetUserId?: string | null;
      pushEnabled?: boolean;
      priority?: 'default' | 'high';
      dnd?: { enabled: boolean; startMin: number; endMin: number } | null;
      muteUntil?: string | null;
    },
    db: Db = prisma(),
  ) {
    if (input.kind === 'contact' && !input.targetUserId) {
      throw AppError.badRequest('targetUserId is required for contact notification settings');
    }
    if ((input.kind === 'channel' || input.kind === 'workspace') && !input.targetId) {
      throw AppError.badRequest('targetId is required for channel/workspace notification settings');
    }
    const row = await notificationRepo.upsert(
      {
        userId: actor.userId,
        kind: input.kind,
        targetId: input.targetId ?? null,
        targetUserId: input.targetUserId ?? null,
        pushEnabled: input.pushEnabled,
        priority: input.priority,
        dnd: input.dnd ?? undefined,
        muteUntil: input.muteUntil === undefined ? undefined : input.muteUntil === null ? null : new Date(input.muteUntil),
      },
      db,
    );
    return {
      setting: {
        kind: row.kind,
        targetId: row.targetId,
        targetUserId: row.targetUserId,
        pushEnabled: row.pushEnabled,
        priority: row.priority,
        dnd: { enabled: row.dndEnabled, startMin: row.dndStartMin, endMin: row.dndEndMin },
        muteUntil: row.muteUntil,
      },
    };
  },

  /**
   * Decide whether a user wants a push for a given context.
   * A specific kind setting overrides the catch-all `all` setting.
   */
  async shouldPush(
    userId: string,
    context: { kind: NotifKind; targetId?: string | null; targetUserId?: string | null },
    requestedPriority: 'default' | 'high' = 'default',
    db: Db = prisma(),
  ): Promise<{ allow: boolean; priority: 'default' | 'high' }> {
    const settings = await notificationRepo.forPushResolution(userId, db);
    const now = new Date();

    const specific =
      context.kind === 'channel' || context.kind === 'workspace'
        ? settings.find((s) => s.kind === context.kind && s.targetId === context.targetId)
        : context.kind === 'contact'
          ? settings.find((s) => s.kind === 'contact' && s.targetUserId === context.targetUserId)
          : undefined;
    const all = settings.find((s) => s.kind === 'all');
    const effective = specific ?? all;

    let priority: 'default' | 'high' = requestedPriority;
    if (effective) {
      if (!effective.pushEnabled) return { allow: false, priority: 'default' };
      if (effective.priority === 'high') priority = 'high';
      if (effective.muteUntil && effective.muteUntil > now) return { allow: false, priority };
      // High-priority notifications (emergency alerts) bypass quiet hours.
      if (effective.dndEnabled && inQuietHours(effective.dndStartMin, effective.dndEndMin, now) && priority !== 'high') {
        return { allow: false, priority };
      }
    }
    return { allow: true, priority };
  },

  /** Fan a notification out to every device of the given users, honouring settings. */
  async notifyUsers(
    userIds: string[],
    payload: PushPayload,
    context: { kind: NotifKind; targetId?: string | null; targetUserId?: string | null } = { kind: 'all' },
    db: Db = prisma(),
  ) {
    const unique = [...new Set(userIds)];
    const targets: Array<{ userId: string; token: string; priority: 'default' | 'high' }> = [];

    for (const userId of unique) {
      const decision = await this.shouldPush(userId, context, payload.priority ?? 'default', db);
      if (!decision.allow) continue;
      const tokens = await pushTokenRepo.listForUser(userId, db);
      const priority = payload.priority ?? decision.priority;
      for (const t of tokens) targets.push({ userId, token: t.token, priority });
    }

    if (targets.length === 0) return { attempted: 0, ok: 0, failed: 0, unregistered: [] as string[] };

    const messages: PushMessage[] = targets.map((t) => ({
      to: t.token,
      title: payload.title,
      body: payload.body,
      data: payload.data,
      priority: t.priority,
      channelId: payload.channelId,
      sound: payload.sound === undefined ? 'default' : payload.sound,
    }));

    const result = await sendPush(messages);
    for (const token of result.unregistered) {
      const owner = targets.find((t) => t.token === token);
      if (owner) await pushTokenRepo.remove(owner.userId, token, db);
    }
    return { attempted: result.attempted, ok: result.ok, failed: result.failed, unregistered: result.unregistered };
  },

  /** Notify all members of a workspace (excluding the actor), honouring per-user settings. */
  async notifyWorkspace(workspaceId: string, actorId: string | null, payload: PushPayload, db: Db = prisma()) {
    const members = await membershipRepo.listByWorkspace(workspaceId, db);
    const recipients = members.map((m) => m.userId).filter((id) => id !== actorId);
    return this.notifyUsers(recipients, payload, { kind: 'workspace', targetId: workspaceId }, db);
  },

  /** Notify all members of a channel (excluding the actor), honouring per-user settings. */
  async notifyChannel(channelId: string, actorId: string | null, payload: PushPayload, db: Db = prisma()) {
    const members = await channelMemberRepo.listByChannel(channelId, db);
    const recipients = members.map((m) => m.userId).filter((id) => id !== actorId);
    return this.notifyUsers(recipients, payload, { kind: 'channel', targetId: channelId }, db);
  },

  /** Send a test push to the caller's own devices. */
  async testPush(actor: { userId: string }, payload: { title?: string; body?: string }, db: Db = prisma()) {
    const tokens = await pushTokenRepo.listForUser(actor.userId, db);
    if (tokens.length === 0) throw AppError.badRequest('No push tokens registered for this account');
    const messages: PushMessage[] = tokens.map((t) => ({
      to: t.token,
      title: payload.title ?? 'PTT test notification',
      body: payload.body ?? 'Push notifications are working.',
      priority: 'high',
    }));
    const result = await sendPush(messages);
    for (const token of result.unregistered) {
      await pushTokenRepo.remove(actor.userId, token, db);
    }
    return result;
  },
};