import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { runReadinessChecks } from '../../lib/health-registry.js';

const startedAt = Date.now();

const okSchema = z.object({ status: z.literal('ok'), uptimeSeconds: z.number(), version: z.string() });

const readySchema = z.object({
  status: z.enum(['ok', 'degraded']),
  uptimeSeconds: z.number(),
  checks: z.record(z.object({ ok: z.boolean(), detail: z.string().optional() })),
});

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/healthz',
    {
      schema: {
        tags: ['ops'],
        summary: 'Liveness probe',
        response: { 200: okSchema },
      },
      config: { rateLimit: false },
    },
    async () => ({ status: 'ok' as const, uptimeSeconds: uptime(), version: process.env.APP_VERSION ?? '0.1.0' }),
  );

  app.get(
    '/readyz',
    {
      schema: {
        tags: ['ops'],
        summary: 'Readiness probe (database, redis, object storage)',
        response: { 200: readySchema, 503: readySchema },
      },
      config: { rateLimit: false },
    },
    async (_req, reply) => {
      const result = await runReadinessChecks();
      reply.status(result.ok ? 200 : 503);
      return {
        status: result.ok ? ('ok' as const) : ('degraded' as const),
        uptimeSeconds: uptime(),
        checks: result.checks,
      };
    },
  );

  app.get(
    '/livez',
    {
      schema: {
        tags: ['ops'],
        summary: 'Process liveness',
        response: { 200: okSchema },
      },
      config: { rateLimit: false },
    },
    async () => ({ status: 'ok' as const, uptimeSeconds: uptime(), version: process.env.APP_VERSION ?? '0.1.0' }),
  );

  app.get(
    '/.well-known/security.txt',
    {
      schema: { hide: true },
      config: { rateLimit: false },
    },
    async () => ({
      contact: 'mailto:security@ptt.example.com',
      policy: `${env.WEB_BASE_URL}/.well-known/security.txt`,
      expires: new Date(Date.now() + 31_536_000_000).toISOString(),
    }),
  );
}

function uptime() {
  return Math.round((Date.now() - startedAt) / 1000);
}
