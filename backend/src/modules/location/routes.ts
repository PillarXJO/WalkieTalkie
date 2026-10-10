import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { workspaceParams } from '../channels/schema.js';
import { locationBody, locationUserParams, workspaceLocationQuery } from './schema.js';
import { locationService } from './service.js';

export async function locationRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const catalog = { tags: ['location'], security: [{ bearerAuth: [] }] as const };

  typed.post('/location/pings', { schema: { ...catalog, summary: 'Record my current location', body: locationBody } }, async (req) =>
    locationService.record(req.requireAuth(), req.body),
  );

  typed.get('/location/me', { schema: { ...catalog, summary: 'My most recent location' } }, async (req) =>
    locationService.myLatest(req.requireAuth()),
  );

  typed.get('/users/:userId/location', { schema: { ...catalog, summary: "A member's last known location", params: locationUserParams } }, async (req) =>
    locationService.latestForUser(req.requireAuth(), req.params.userId),
  );

  typed.get('/workspaces/:workspaceId/locations', { schema: { ...catalog, summary: 'Workspace location feed / live map', params: workspaceParams, querystring: workspaceLocationQuery } }, async (req) =>
    locationService.listWorkspace(req.requireAuth(), req.params.workspaceId, {
      windowMinutes: req.query.windowMinutes,
      from: req.query.from,
      to: req.query.to,
      limit: req.query.limit,
      latest: req.query.latest,
      userId: req.query.userId,
    }),
  );

  return app;
}