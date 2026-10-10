import { z } from 'zod';
import { NOTIFICATION_KINDS } from '../../domain/permissions.js';

export const registerPushTokenBody = z.object({
  token: z.string().trim().min(8).max(512),
  platform: z.enum(['android', 'ios', 'web']),
  appId: z.string().trim().max(255).optional().nullable(),
});

export const removePushTokenBody = z.object({
  token: z.string().trim().min(8).max(512),
});

export const updateNotificationBody = z.object({
  kind: z.enum(NOTIFICATION_KINDS),
  targetId: z.string().min(1).max(64).optional().nullable(),
  targetUserId: z.string().min(1).max(64).optional().nullable(),
  pushEnabled: z.boolean().optional(),
  priority: z.enum(['default', 'high']).optional(),
  dnd: z
    .object({
      enabled: z.boolean(),
      startMin: z.number().int().min(0).max(1439),
      endMin: z.number().int().min(0).max(1439),
    })
    .nullable()
    .optional(),
  muteUntil: z.string().datetime().nullable().optional(),
});

export const testPushBody = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  body: z.string().trim().min(1).max(500).optional(),
});
