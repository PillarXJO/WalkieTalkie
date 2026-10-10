import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError } from '../../lib/errors.js';
import { ROLE_PERMISSIONS, type Permission, type Role } from '../../domain/permissions.js';
import {
  addMemberBody,
  createWorkspaceBody,
  memberParams,
  statsParams,
  updateMemberBody,
  updateWorkspaceBody,
  workspaceParams,
} from './schema.js';
import { workspaceService } from './service.js';

export async function workspaceRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  const catalog = {
    tags: ['workspaces'],
    security: [{ bearerAuth: [] }] as const,
  };

  typed.post(
    '/workspaces',
    {
      schema: { ...catalog, summary: 'Create a workspace (creator becomes admin)', body: createWorkspaceBody },
    },
    async (req) => workspaceService.create(req.requireAuth(), req.body.name),
  );

  typed.get('/workspaces', { schema: { ...catalog, summary: 'List my workspaces with member/channel counts' } }, async (req) =>
    workspaceService.listForUser(req.requireAuth().userId),
  );

  typed.get('/workspaces/:workspaceId', { schema: { ...catalog, summary: 'Workspace detail', params: workspaceParams } }, async (req) =>
    workspaceService.get(req.requireAuth(), req.params.workspaceId),
  );

  typed.patch('/workspaces/:workspaceId', { schema: { ...catalog, summary: 'Rename / update settings (admin)', params: workspaceParams, body: updateWorkspaceBody } }, async (req) => {
    const actor = req.requireAuth();
    const my = await workspaceService.assertAdmin(actor, req.params.workspaceId);
    return workspaceService.update(actor, req.params.workspaceId, req.body);
  });

  typed.delete('/workspaces/:workspaceId', { schema: { ...catalog, summary: 'Soft-delete a workspace (admin)', params: workspaceParams } }, async (req) => {
    const actor = req.requireAuth();
    await workspaceService.assertAdmin(actor, req.params.workspaceId);
    return workspaceService.remove(actor, req.params.workspaceId);
  });

  // --- Members & roles --------------------------------------------------------
  typed.get('/workspaces/:workspaceId/members', { schema: { ...catalog, summary: 'List members', params: workspaceParams } }, async (req) =>
    workspaceService.listMembers(req.requireAuth(), req.params.workspaceId),
  );

  typed.post('/workspaces/:workspaceId/members', { schema: { ...catalog, summary: 'Add a member directly (admin)', params: workspaceParams, body: addMemberBody } }, async (req) => {
    const actor = req.requireAuth();
    await workspaceService.assertAdmin(actor, req.params.workspaceId);
    return workspaceService.addMember(actor, req.params.workspaceId, req.body);
  });

  typed.patch('/workspaces/:workspaceId/members/:userId', { schema: { ...catalog, summary: 'Set role / nickname / extra permissions (admin)', params: memberParams, body: updateMemberBody } }, async (req) => {
    const actor = req.requireAuth();
    const my = await workspaceService.assertAdmin(actor, req.params.workspaceId);
    return workspaceService.updateMember(actor, req.params.workspaceId, req.params.userId, req.body);
  });

  typed.delete('/workspaces/:workspaceId/members/:userId', { schema: { ...catalog, summary: 'Remove a member (admin)', params: memberParams } }, async (req) => {
    const actor = req.requireAuth();
    const my = await workspaceService.assertAdmin(actor, req.params.workspaceId);
    return workspaceService.removeMember(actor, req.params.workspaceId, req.params.userId);
  });

  typed.get('/workspaces/:workspaceId/stats', { schema: { ...catalog, summary: 'Usage stats (admin)', params: statsParams } }, async (req) => {
    const actor = req.requireAuth();
    const my = await workspaceService.assertAdmin(actor, req.params.workspaceId);
    return workspaceService.stats(req.params.workspaceId, req.params.days ?? 7);
  });

  typed.get('/auth/workspaces', { schema: { tags: ['auth'], summary: 'My workspaces (alias of GET /workspaces)' } }, async (req) =>
    workspaceService.listForUser(req.requireAuth().userId),
  );

  typed.get('/roles', {
    schema: {
      tags: ['workspaces'],
      summary: 'Roles and the permission catalog',
      security: [{ bearerAuth: [] }] as const,
    },
  }, async (req) => {
    req.requireAuth();
    return { roles: ROLE_PERMISSIONS };
  });

  return app;
}