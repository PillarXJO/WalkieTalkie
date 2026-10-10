import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { historyQuery, searchQuery, transmissionParams, workspaceParams } from './schema.js';
import { historyService } from './service.js';
import { channelParams } from '../channels/schema.js';

export async function historyRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const catalog = { tags: ['history'], security: [{ bearerAuth: [] }] as const };

  typed.get('/channels/:channelId/history', { schema: { ...catalog, summary: 'Channel voice history (newest first)', params: channelParams, querystring: historyQuery } }, async (req) =>
    historyService.listChannelHistory(req.requireAuth(), req.params.channelId, {
      limit: req.query.limit,
      after: req.query.after,
      userId: req.query.userId,
    }),
  );

  typed.get('/workspaces/:workspaceId/history', { schema: { ...catalog, summary: 'Workspace voice history', params: workspaceParams, querystring: historyQuery } }, async (req) =>
    historyService.listWorkspaceHistory(req.requireAuth(), req.params.workspaceId, {
      limit: req.query.limit,
      after: req.query.after,
      userId: req.query.userId,
    }),
  );

  typed.get('/workspaces/:workspaceId/history/search', { schema: { ...catalog, summary: 'Search voice history', params: workspaceParams, querystring: searchQuery } }, async (req) =>
    historyService.searchWorkspaceHistory(req.requireAuth(), req.params.workspaceId, {
      q: req.query.q,
      channelId: req.query.channelId,
      userId: req.query.userId,
      from: req.query.from,
      to: req.query.to,
      limit: req.query.limit,
    }),
  );

  typed.get('/history/:transmissionId', { schema: { ...catalog, summary: 'Single transmission', params: transmissionParams } }, async (req) =>
    historyService.getOne(req.requireAuth(), req.params.transmissionId),
  );

  typed.delete('/history/:transmissionId', { schema: { ...catalog, summary: 'Remove a transmission (speaker or admin)', params: transmissionParams } }, async (req) =>
    historyService.remove(req.requireAuth(), req.params.transmissionId),
  );

  return app;
}