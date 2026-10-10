import { z } from 'zod';
import { channelParams } from '../channels/schema.js';

export const floorParams = channelParams;

export const floorRequestBody = z.object({
  priority: z.enum(['normal', 'priority', 'emergency']).optional(),
});

export const pttTokenQuery = z.object({
  // Optional force-refresh for a caller that knows the identity is reusable.
  identity: z.string().trim().min(1).max(64).optional(),
});