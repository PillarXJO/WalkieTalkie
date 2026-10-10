import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { registerReadinessCheck } from './health-registry.js';

let redisClient: Redis | undefined;

export function redis(): Redis {
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      keyPrefix: 'ptt:',
      retryStrategy: (times: number) => Math.min(times * 200, 3000),
    });

    redisClient.on('error', (err) => {
      // Prevent crash loops; liveness handled by the readiness probe.
      process.emitWarning(`redis: ${err.message}`);
    });

    registerReadinessCheck('redis', async () => {
      try {
        const pong = await redisClient!.ping();
        return { ok: pong === 'PONG' };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    });
  }
  return redisClient;
}

export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = undefined;
  }
}

/** A fresh pub/sub client (ioredis forbids mixing pub/sub mode with commands). */
export function pubSubClient(): Redis {
  return new Redis(env.REDIS_URL, { keyPrefix: 'ptt:', lazyConnect: false });
}