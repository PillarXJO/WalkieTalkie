import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { serializeJson } from '../lib/json.js';
import type { Db } from './types.js';

export interface NewWorkspace {
  name: string;
  ownerId?: string | null;
  settings?: Record<string, unknown>;
}

export const workspaceRepo = {
  async create(data: NewWorkspace, db: Db = prisma()) {
    return db.workspace.create({
      data: {
        name: data.name,
        ownerId: data.ownerId ?? null,
        settings: serializeJson(data.settings ?? {}),
      },
    });
  },

  async findById(id: string, db: Db = prisma()) {
    return db.workspace.findFirst({ where: { id, deletedAt: null } });
  },

  /** Workspaces the user can see (by membership), with the user's role inside. */
  async listForUser(userId: string, db: Db = prisma()) {
    return db.workspace.findMany({
      where: { deletedAt: null, members: { some: { userId, deletedAt: null } } },
      include: {
        members: { where: { userId, deletedAt: null }, select: { role: true, permissions: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  },

  async update(id: string, data: Prisma.WorkspaceUpdateInput, db: Db = prisma()) {
    return db.workspace.update({ where: { id }, data });
  },

  async softDelete(id: string, db: Db = prisma()) {
    await db.workspace.update({ where: { id }, data: { deletedAt: new Date() } });
  },
};