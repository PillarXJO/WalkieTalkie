import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { auditQuery, statsQuery, workspaceParams } from './schema.js';
import { adminService } from './service.js';

export async function adminRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const catalog = { tags: ['admin'], security: [{ bearerAuth: [] }] as const };

  typed.get(
    '/workspaces/:workspaceId/admin/dashboard',
    { schema: { ...catalog, summary: 'Workspace dashboard metrics', params: workspaceParams, querystring: statsQuery } },
    async (req) => adminService.dashboard(req.requireAuth(), req.params.workspaceId, req.query.days ?? 7),
  );

  typed.get(
    '/workspaces/:workspaceId/admin/audit',
    { schema: { ...catalog, summary: 'Audit trail (permission: admin.audit)', params: workspaceParams, querystring: auditQuery } },
    async (req) => adminService.listAudit(req.requireAuth(), req.params.workspaceId, req.query),
  );

  typed.get(
    '/workspaces/:workspaceId/admin/audit/stats',
    { schema: { ...catalog, summary: 'Audit event counts by action', params: workspaceParams, querystring: statsQuery } },
    async (req) => adminService.auditStats(req.requireAuth(), req.params.workspaceId, req.query.days ?? 30),
  );

  return app;
}
