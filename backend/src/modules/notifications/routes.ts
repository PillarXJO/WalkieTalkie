import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { registerPushTokenBody, removePushTokenBody, testPushBody, updateNotificationBody } from './schema.js';
import { notificationsService } from './service.js';

export async function notificationRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const catalog = { tags: ['notifications'], security: [{ bearerAuth: [] }] as const };

  typed.post('/notifications/tokens', { schema: { ...catalog, summary: 'Register a device push token', body: registerPushTokenBody } }, async (req) =>
    notificationsService.registerToken(req.requireAuth(), req.body),
  );

  typed.get('/notifications/tokens', { schema: { ...catalog, summary: 'List my device push tokens' } }, async (req) =>
    notificationsService.listTokens(req.requireAuth()),
  );

  typed.delete('/notifications/tokens', { schema: { ...catalog, summary: 'Remove a device push token', body: removePushTokenBody } }, async (req) =>
    notificationsService.removeToken(req.requireAuth(), req.body.token),
  );

  typed.get('/notifications/settings', { schema: { ...catalog, summary: 'List my notification settings' } }, async (req) =>
    notificationsService.listSettings(req.requireAuth()),
  );

  typed.put('/notifications/settings', { schema: { ...catalog, summary: 'Create / update a notification setting', body: updateNotificationBody } }, async (req) =>
    notificationsService.upsertSetting(req.requireAuth(), req.body),
  );

  typed.post('/notifications/test', { schema: { ...catalog, summary: 'Send a test push to my devices', body: testPushBody } }, async (req) =>
    notificationsService.testPush(req.requireAuth(), req.body),
  );

  return app;
}