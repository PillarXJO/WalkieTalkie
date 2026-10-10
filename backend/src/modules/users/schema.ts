import { z } from 'zod';
import { PRESENCE, type Presence } from '../../domain/permissions.js';

export const userParams = z.object({ userId: z.string().min(1).max(64) });
export const contactParams = z.object({ contactId: z.string().min(1).max(64) });

export const addContactBody = z.object({
  userId: z.string().min(1).max(64),
  nickname: z.string().trim().max(60).optional().nullable(),
  isFavorite: z.boolean().optional(),
});

export const updateContactBody = z.object({
  nickname: z.string().trim().max(60).optional().nullable(),
  isFavorite: z.boolean().optional(),
});

export const blockBody = z.object({ userId: z.string().min(1).max(64) });

export const updateProfileBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  avatarUrl: z.string().trim().max(500).nullable().optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  locale: z.string().trim().max(10).optional(),
  status: z.enum(PRESENCE).optional(),
  statusMessage: z.string().trim().max(120).optional(),
  ghostMode: z.boolean().optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const publicStatusBody = z.object({
  status: z.enum(PRESENCE),
  statusMessage: z.string().trim().max(120).optional(),
});

export type PresenceStatus = Presence;