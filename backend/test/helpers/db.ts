import { PrismaClient } from '@prisma/client';

let client: PrismaClient | undefined;

export function dbClient(): PrismaClient {
  if (!client) {
    client = new PrismaClient();
  }
  return client;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}

/**
 * Wipe all application tables. Justifiable raw SQL: dynamic TRUNCATE of every
 * table, which Prisma does not expose through its typed API.
 */
export async function truncateAll(): Promise<void> {
  const c = dbClient();
  const tables = await c.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations')`,
  );
  if (tables.length > 0) {
    const names = tables.map((t) => `"${t.tablename}"`).join(', ');
    await c.$executeRawUnsafe(`TRUNCATE TABLE ${names} CASCADE`);
  }
}