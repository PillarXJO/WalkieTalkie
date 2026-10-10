import { PrismaClient } from '@prisma/client';
import { registerReadinessCheck } from './health-registry.js';

let client: PrismaClient | undefined;

export function prisma(): PrismaClient {
  if (!client) {
    client = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
    registerReadinessCheck('database', async () => {
      await client!.$queryRaw`SELECT 1`;
      return { ok: true };
    });
  }
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}