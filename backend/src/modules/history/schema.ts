import { z } from 'zod';
import { channelParams, workspaceParams } from '../channels/schema.js';

export const transmissionParams = z.object({ transmissionId: z.string().min(1).max(64) });

export const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  /** Cursor: return transmissions strictly older than this timestamp. */
  after: z.string().datetime().optional(),
  userId: z.string().optional(),
});

export const searchQuery = z.object({
  q: z.string().trim().max(200).optional(),
  channelId: z.string().optional(),
  userId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const workspaceHistoryQuery = historyQuery;

export { channelParams, workspaceParams };