import type { Prisma, PrismaClient } from '@prisma/client';

/** A database handle that works both outside and inside interactive transactions. */
export type Db = PrismaClient | Prisma.TransactionClient;

export type Tx = Prisma.TransactionClient;