import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

export async function registerSecurity(app: FastifyInstance): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    // The API is consumed by native apps + the admin SPA, not by framing.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  const allowedOrigins = env.CORS_ORIGINS;
  const wildcard = allowedOrigins.includes('*');

  await app.register(cors, {
    origin(origin, cb) {
      if (!origin || wildcard) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(null, false);
    },
    credentials: !wildcard,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Device-Id'],
    exposedHeaders: ['X-Request-Id', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    maxAge: 600,
  });

  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    // Identifying the caller: authenticated user id when available, else IP.
    keyGenerator: (req) => (req as { user?: { id?: string } }).user?.id ?? req.ip,
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
    errorResponseBuilder: (req, context) => {
      const err = new AppError('rate_limited', `Rate limit exceeded, retry in ${context.after}`);
      return { statusCode: err.statusCode, error: err.code, message: err.message, details: { limit: context.max } };
    },
  });
}

/** Stricter limiter for credential endpoints (login, register, reset, 2FA). */
export const authRateLimitOptions = {
  max: env.AUTH_RATE_LIMIT_MAX,
  timeWindow: '1 minute',
  keyGenerator: (req: { ip: string }) => req.ip,
};
