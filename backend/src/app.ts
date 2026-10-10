import { randomUUID } from 'node:crypto';
import websocket from '@fastify/websocket';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { pino } from 'pino';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler, notFoundHandler } from './lib/errors.js';
import { authRoutes } from './modules/auth/routes.js';
import { alertRoutes } from './modules/alerts/routes.js';
import { channelRoutes } from './modules/channels/routes.js';
import { healthRoutes } from './modules/health/routes.js';
import { historyRoutes } from './modules/history/routes.js';
import { locationRoutes } from './modules/location/routes.js';
import { mediaRoutes } from './modules/media/routes.js';
import { notificationRoutes } from './modules/notifications/routes.js';
import { adminRoutes } from './modules/admin/routes.js';
import { pttRoutes } from './modules/ptt/routes.js';
import { userRoutes } from './modules/users/routes.js';
import { workspaceRoutes } from './modules/workspaces/routes.js';
import { registerAuthPlugin } from './plugins/auth.js';
import { registerSecurity } from './plugins/security.js';

export interface BuildAppOptions {
  /** Pass `false` in tests to keep output clean. */
  logger?: boolean | FastifyBaseLogger;
  /** Disable swagger UI (used by tests / minimal deployments). */
  docs?: boolean;
}

const silentLogger = pino({ level: 'silent' });

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const appOptions = {
    loggerInstance:
      options.logger === false
        ? silentLogger
        : typeof options.logger === 'object'
          ? options.logger
          : logger,
    genReqId: () => randomUUID(),
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    routerOptions: {
      ignoreTrailingSlash: true,
      caseSensitive: true,
    },
    ajv: { customOptions: { allErrors: true } },
  };

  const app = Fastify(appOptions).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  app.addHook('onSend', async (request, reply, payload) => {
    void reply.header('x-request-id', request.id);
    return payload;
  });

  await registerSecurity(app);
  await registerAuthPlugin(app);

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'PTT API',
        description:
          'Push-to-talk backend: authentication, workspaces, channels, real-time PTT floor control, voice history, location and push.',
        version: process.env.APP_VERSION ?? '0.1.0',
        contact: { name: 'PTT backend', email: 'dev@ptt.example.com' },
        license: { name: 'UNLICENSED' },
      },
      servers: [{ url: env.WEB_BASE_URL.replace(/\/$/, ''), description: env.NODE_ENV }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      tags: [
        { name: 'auth', description: 'Registration, login, 2FA, sessions' },
        { name: 'users', description: 'Profile, presence, contacts, blocks' },
        { name: 'workspaces', description: 'Workspaces, members, roles, permissions' },
        { name: 'channels', description: 'Channels, members, mute, usage stats' },
        { name: 'invites', description: 'Invite links, QR payloads, revocation' },
        { name: 'ptt', description: 'Floor control, LiveKit rooms, echo bot' },
        { name: 'history', description: 'Voice history and signed replay URLs' },
        { name: 'location', description: 'Opt-in location and emergency alerts' },
        { name: 'push', description: 'Push tokens and notification settings' },
        { name: 'admin', description: 'Admin dashboard, audit log, stats' },
        { name: 'ops', description: 'Health, readiness, metrics' },
      ],
    },
    transform: jsonSchemaTransform,
  });

  if (options.docs !== false) {
    await app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: { docExpansion: 'list', deepLinking: true, persistAuthorization: true },
      staticCSP: true,
    });
  }

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(workspaceRoutes);
  await app.register(userRoutes);
  await app.register(channelRoutes);
  await app.register(historyRoutes);
  await app.register(mediaRoutes);
  await app.register(locationRoutes);
  await app.register(alertRoutes);
  await app.register(notificationRoutes);
  await app.register(adminRoutes);
  await app.register(websocket, { options: { maxPayload: env.WS_MAX_PAYLOAD_BYTES } });
  await app.register(pttRoutes);

  return app;
}
