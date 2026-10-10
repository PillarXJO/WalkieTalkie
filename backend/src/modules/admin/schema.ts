import { z } from 'zod';

export const workspaceParams = z.object({ workspaceId: z.string().min(1) });

export const auditQuery = z.object({
  action: z.string().min(1).max(64).optional(),
  actorId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().min(1).optional(),
});

export const statsQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
});
