import { z } from 'zod';
import { PERMISSIONS, ROLES, type Permission, type Role } from '../../domain/permissions.js';
import { AppError } from '../../lib/errors.js';

export const createWorkspaceBody = z.object({
  name: z.string().trim().min(1).max(80),
});

export const updateWorkspaceBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  settings: z.object({}).passthrough().optional(),
});

export const workspaceParams = z.object({ workspaceId: z.string().min(1).max(64) });

export const memberParams = workspaceParams.extend({ userId: z.string().min(1).max(64) });

/** Direct (admin) add — the invite flow in M5 is the self-service alternative. */
export const addMemberBody = z.object({
  userId: z.string().min(1).max(64),
  role: z.enum(ROLES).optional(),
  nickname: z.string().trim().max(60).nullable().optional(),
  permissions: z.array(z.enum(PERMISSIONS)).optional(),
});

export const updateMemberBody = z.object({
  role: z.enum(ROLES).optional(),
  nickname: z.string().trim().max(60).nullable().optional(),
  permissions: z.array(z.enum(PERMISSIONS)).optional(),
  /** append: true merges with the current overrides; false replaces. */
  merge: z.boolean().optional(),
});

export const statsParams = workspaceParams.extend({ days: z.coerce.number().int().min(1).max(365).optional() });

export const allowedRoles: Role[] = [...ROLES];

export function assertValidPermissions(permissions: string[]): asserts permissions is Permission[] {
  const known = new Set<string>(PERMISSIONS);
  const unknown = permissions.filter((p) => !known.has(p));
  if (unknown.length > 0) {
    throw AppError.badRequest(`Unknown permission(s): ${unknown.join(', ')}`);
  }
}

export type UpdateMemberBody = z.infer<typeof updateMemberBody>;