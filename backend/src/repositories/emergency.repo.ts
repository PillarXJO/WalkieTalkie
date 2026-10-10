import { prisma } from '../lib/prisma.js';
import type { Db } from './types.js';

export type AlertType = 'emergency' | 'panic';
export type AlertStatus = 'open' | 'acknowledged' | 'resolved';

export interface NewAlert {
  workspaceId: string;
  userId: string;
  channelId?: string | null;
  alertType?: AlertType;
  latitude?: number | null;
  longitude?: number | null;
  message?: string | null;
}

export const emergencyRepo = {
  async create(data: NewAlert, db: Db = prisma()) {
    return db.emergencyAlert.create({
      data: {
        workspaceId: data.workspaceId,
        userId: data.userId,
        channelId: data.channelId ?? null,
        alertType: data.alertType ?? 'emergency',
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        message: data.message ?? null,
      },
    });
  },

  async findById(id: string, db: Db = prisma()) {
    return db.emergencyAlert.findFirst({
      where: { id },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true, phone: true } },
        ackBy: { select: { id: true, name: true } },
      },
    });
  },

  async listOpenByWorkspace(workspaceId: string, db: Db = prisma()) {
    return db.emergencyAlert.findMany({
      where: { workspaceId, status: { in: ['open', 'acknowledged'] } },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true, phone: true } },
        ackBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  async listByWorkspace(
    workspaceId: string,
    options: { status?: AlertStatus; limit?: number },
    db: Db = prisma(),
  ) {
    return db.emergencyAlert.findMany({
      where: { workspaceId, ...(options.status ? { status: options.status } : {}) },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true, phone: true } },
        ackBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: options.limit ?? 100,
    });
  },

  async listForUser(
    userId: string,
    options: { status?: AlertStatus; limit?: number },
    db: Db = prisma(),
  ) {
    return db.emergencyAlert.findMany({
      where: { userId, ...(options.status ? { status: options.status } : {}) },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true, phone: true } },
        ackBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: options.limit ?? 100,
    });
  },

  async acknowledge(id: string, byUserId: string, db: Db = prisma()) {
    return db.emergencyAlert.update({
      where: { id },
      data: { status: 'acknowledged', acknowledgedById: byUserId, acknowledgedAt: new Date() },
    });
  },

  async resolve(id: string, db: Db = prisma()) {
    return db.emergencyAlert.update({ where: { id }, data: { status: 'resolved', resolvedAt: new Date() } });
  },
};