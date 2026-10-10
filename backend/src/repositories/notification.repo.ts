import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { Db } from './types.js';

export type NotifKind = 'all' | 'workspace' | 'channel' | 'contact' | 'echo';

export interface NewNotifSetting {
  userId: string;
  kind: NotifKind;
  targetId?: string | null;
  targetUserId?: string | null;
  pushEnabled?: boolean;
  priority?: 'default' | 'high';
  dnd?: { enabled: boolean; startMin: number; endMin: number } | null;
  muteUntil?: Date | null;
}

/** One row per (user, kind, target) — a deterministic id powers the upsert. */
function settingId(userId: string, kind: NotifKind, targetId?: string | null, targetUserId?: string | null): string {
  return createHash('sha256')
    .update([userId, kind, targetId ?? '', targetUserId ?? ''].join('|'))
    .digest('hex')
    .slice(0, 32);
}

function payload(data: NewNotifSetting): Prisma.NotificationSettingUncheckedCreateInput {
  return {
    userId: data.userId,
    kind: data.kind,
    targetId: data.kind === 'channel' || data.kind === 'workspace' ? (data.targetId ?? null) : null,
    targetUserId: data.kind === 'contact' ? (data.targetUserId ?? null) : null,
    pushEnabled: data.pushEnabled ?? true,
    priority: data.priority ?? 'default',
    dndEnabled: data.dnd?.enabled ?? false,
    dndStartMin: data.dnd?.startMin ?? 1380,
    dndEndMin: data.dnd?.endMin ?? 420,
    muteUntil: data.muteUntil ?? null,
  };
}

export const notificationRepo = {
  async upsert(data: NewNotifSetting, db: Db = prisma()) {
    if (data.kind === 'contact' && !data.targetUserId) {
      throw new Error('targetUserId is required for contact notification settings');
    }
    const id = settingId(data.userId, data.kind, data.targetId, data.targetUserId);
    const create = { id, ...payload(data) };
    const update: Prisma.NotificationSettingUncheckedUpdateInput = {
      pushEnabled: data.pushEnabled ?? undefined,
      priority: data.priority ?? undefined,
      dndEnabled: data.dnd?.enabled ?? undefined,
      dndStartMin: data.dnd?.startMin ?? undefined,
      dndEndMin: data.dnd?.endMin ?? undefined,
      muteUntil: data.muteUntil ?? undefined,
    };
    return db.notificationSetting.upsert({ where: { id }, create, update });
  },

  async listForUser(userId: string, db: Db = prisma()) {
    return db.notificationSetting.findMany({ where: { userId } });
  },

  async findChannelSetting(userId: string, channelId: string, db: Db = prisma()) {
    return db.notificationSetting.findFirst({
      where: { userId, kind: 'channel', targetId: channelId },
    });
  },

  async findContactSetting(userId: string, targetUserId: string, db: Db = prisma()) {
    return db.notificationSetting.findFirst({
      where: { userId, kind: 'contact', targetUserId },
    });
  },

  /** All settings relevant to a user, merged by application later. */
  async forPushResolution(userId: string, db: Db = prisma()) {
    return db.notificationSetting.findMany({ where: { userId } });
  },
};