import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { workspaceParams } from '../channels/schema.js';
import { alertParams, createAlertBody, listAlertsQuery } from './schema.js';
import { alertsService } from './service.js';

export async function alertRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const catalog = { tags: ['alerts'], security: [{ bearerAuth: [] }] as const };

  typed.post('/workspaces/:workspaceId/alerts', { schema: { ...catalog, summary: 'Raise an emergency / panic alert', params: workspaceParams, body: createAlertBody } }, async (req) =>
    alertsService.create(req.requireAuth(), req.params.workspaceId, req.body),
  );

  typed.get('/workspaces/:workspaceId/alerts', { schema: { ...catalog, summary: 'List alerts (open by default)', params: workspaceParams, querystring: listAlertsQuery } }, async (req) =>
    alertsService.list(req.requireAuth(), req.params.workspaceId, { status: req.query.status, limit: req.query.limit }),
  );

  typed.get('/alerts/:alertId', { schema: { ...catalog, summary: 'Alert detail', params: alertParams } }, async (req) =>
    alertsService.get(req.requireAuth(), req.params.alertId),
  );

  typed.post('/alerts/:alertId/acknowledge', { schema: { ...catalog, summary: 'Acknowledge an alert (dispatcher)', params: alertParams } }, async (req) =>
    alertsService.acknowledge(req.requireAuth(), req.params.alertId),
  );

  typed.post('/alerts/:alertId/resolve', { schema: { ...catalog, summary: 'Resolve an alert', params: alertParams } }, async (req) =>
    alertsService.resolve(req.requireAuth(), req.params.alertId),
  );

  return app;
}