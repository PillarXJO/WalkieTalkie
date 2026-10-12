import { z } from 'zod';
import { CHANNEL_MEMBER_ROLES, CHANNEL_TYPES } from '../../domain/permissions.js';

export const workspaceParams = z.object({ workspaceId: z.string().min(1).max(64) });

export const createChannelBody = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).optional().nullable(),
  type: z.enum(CHANNEL_TYPES).optional(),
  memberIds: z.array(z.string().min(1).max(64)).max(500).optional(),
});

export const updateChannelBody = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(300).nullable().optional(),
});

export const channelParams = z.object({ channelId: z.string().min(1).max(64) });

export const channelMemberParams = channelParams.extend({ userId: z.string().min(1).max(64) });

export const updateChannelMemberBody = z.object({
  role: z.enum(CHANNEL_MEMBER_ROLES).optional(),
  permissions: z.array(z.string().min(1).max(32)).optional(),
  isMuted: z.boolean().optional(),
  mutedUntil: z.string().datetime().nullable().optional(),
});

export const muteBody = z.object({ until: z.string().datetime().nullable().optional() });

export const statsQuery = z.object({ days: z.coerce.number().int().min(1).max(365).optional() });

export const createInviteBody = z.object({
  role: z.enum(['member', 'dispatcher']).optional(),
  maxUses: z.coerce.number().int().min(1).max(1000).optional(),
  expiresInHours: z.coerce.number().int().min(1).max(8760).optional(),
});

export const inviteParams = z.object({ code: z.string().trim().min(4).max(32).toLowerCase() });

export const redeemBody = z.object({ code: z.string().trim().min(4).max(32).toLowerCase() });