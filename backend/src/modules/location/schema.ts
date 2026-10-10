import { z } from 'zod';
import { LOCATION_SOURCES } from '../../domain/permissions.js';

export const locationBody = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(1_000_000).optional().nullable(),
  altitude: z.number().min(-20_000).max(100_000).optional().nullable(),
  speed: z.number().min(0).max(2000).optional().nullable(),
  heading: z.number().min(0).max(360).optional().nullable(),
  source: z.enum(LOCATION_SOURCES).optional(),
  workspaceId: z.string().min(1).max(64).optional(),
  at: z.string().datetime().optional(),
});

export const workspaceLocationQuery = z.object({
  windowMinutes: z.coerce.number().int().min(1).max(10080).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  /** Collapse to the most recent ping per user. */
  latest: z.coerce.boolean().optional(),
  userId: z.string().optional(),
});

export const locationUserParams = z.object({ userId: z.string().min(1).max(64) });
