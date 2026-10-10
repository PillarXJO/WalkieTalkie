import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { publishServerEvent } from '../../lib/server-events.js';
import { auditRepo } from '../../repositories/audit.repo.js';
import { channelRepo } from '../../repositories/channel.repo.js';
import { emergencyRepo, type AlertStatus, type AlertType } from '../../repositories/emergency.repo.js';
import type { Db } from '../../repositories/types.js';
import { membershipPermissions } from '../workspaces/service.js';
import { notificationsService } from '../notifications/service.js';

interface AlertRow {
  id: string;
  workspaceId: string;
  userId: string;
  channelId: string | null;
  alertType: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  message: string | null;
  acknowledgedById: string | null;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  createdAt: Date;
  user?: { id: string; name: string; avatarUrl: string | null; phone: string | null } | null;
  ackBy?: { id: string; name: string } | null;
}

function alertDto(a: AlertRow) {
  return {
    id: a.id,
    workspaceId: a.workspaceId,
    channelId: a.channelId,
    alertType: a.alertType,
    status: a.status,
    latitude: a.latitude,
    longitude: a.longitude,
    message: a.message,
    acknowledgedAt: a.acknowledgedAt,
    resolvedAt: a.resolvedAt,
    createdAt: a.createdAt,
    ...(a.user ? { user: { id: a.user.id, name: a.user.name, avatarUrl: a.user.avatarUrl, phone: a.user.phone } } : {}),
    ...(a.ackBy ? { acknowledgedBy: { id: a.ackBy.id, name: a.ackBy.name } } : {}),
  };
}

async function publishAlert(type: 'alert.created' | 'alert.acknowledged' | 'alert.resolved', alert: AlertRow) {
  await publishServerEvent({
    type,
    workspaceId: alert.workspaceId,
    ...(alert.channelId ? { channelId: alert.channelId } : {}),
    at: new Date().toISOString(),
    data: alertDto(alert),
  });
}

export const alertsService = {
  /** Raise an emergency / panic alert in a workspace. */
  async create(
    actor: { userId: string },
    workspaceId: string,
    input: {
      alertType?: AlertType;
      channelId?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      message?: string | null;
    },
    db: Db = prisma(),
  ) {
    const perms = await membershipPermissions(actor.userId, workspaceId, db);
    if (!perms) throw AppError.forbidden('You are not a member of this workspace');
    if (perms.role !== 'admin' && !perms.permissions.includes('emergency.trigger')) {
      throw AppError.forbidden("Permission 'emergency.trigger' required");
    }

    let channelId: string | null = input.channelId ?? null;
    if (channelId) {
      const channel = await channelRepo.findById(channelId, db);
      if (!channel || channel.workspaceId !== workspaceId) throw AppError.notFound('Channel not found in this workspace');
    }

    const alert = await emergencyRepo.create(
      {
        workspaceId,
        userId: actor.userId,
        channelId,
        alertType: input.alertType,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        message: input.message ?? null,
      },
      db,
    );

    await auditRepo.log(
      {
        action: 'alert.create',
        entityType: 'emergency_alert',
        entityId: alert.id,
        actorId: actor.userId,
        workspaceId,
        data: { alertType: alert.alertType, channelId },
      },
      db,
    );

    const hydrated = await emergencyRepo.findById(alert.id, db);
    const row = hydrated as AlertRow;
    await publishAlert('alert.created', row);

    // Emergency alerts are the highest-priority push; never block the request.
    void notificationsService
      .notifyWorkspace(
        workspaceId,
        actor.userId,
        {
          title: alert.alertType === 'panic' ? 'Panic alert' : 'Emergency alert',
          body: input.message?.trim() || `${row.user?.name ?? 'A member'} needs help`,
          data: { type: 'alert.created', alertId: alert.id, workspaceId, alertType: alert.alertType },
          priority: 'high',
        },
        db,
      )
      .catch(() => undefined);

    return { alert: alertDto(row) };
  },

  /** Open (and optionally all) alerts in a workspace — dispatcher/admin view. */
  async list(actor: { userId: string }, workspaceId: string, options: { status?: AlertStatus | 'all'; limit?: number }, db: Db = prisma()) {
    const perms = await membershipPermissions(actor.userId, workspaceId, db);
    if (!perms) throw AppError.forbidden('You are not a member of this workspace');

    const canMonitor = perms.role === 'admin' || perms.permissions.includes('emergency.ack') || perms.permissions.includes('location.view');
    if (!canMonitor) {
      // Regular members only see their own alerts.
      const rows = await emergencyRepo.listForUser(actor.userId, { status: options.status === 'all' ? undefined : (options.status ?? undefined), limit: options.limit }, db);
      return { alerts: rows.map((r) => alertDto(r as AlertRow)) };
    }

    if (options.status === 'all') {
      const rows = await emergencyRepo.listByWorkspace(workspaceId, { limit: options.limit }, db);
      return { alerts: rows.map((r) => alertDto(r as AlertRow)) };
    }
    const rows = options.status
      ? await emergencyRepo.listByWorkspace(workspaceId, { status: options.status, limit: options.limit }, db)
      : await emergencyRepo.listOpenByWorkspace(workspaceId, db);
    return { alerts: rows.map((r) => alertDto(r as AlertRow)) };
  },

  async get(actor: { userId: string }, alertId: string, db: Db = prisma()) {
    const alert = await emergencyRepo.findById(alertId, db);
    if (!alert) throw AppError.notFound('Alert not found');
    const perms = await membershipPermissions(actor.userId, alert.workspaceId, db);
    if (!perms) throw AppError.forbidden('You are not a member of this workspace');
    const canMonitor = perms.role === 'admin' || perms.permissions.includes('emergency.ack') || perms.permissions.includes('location.view');
    if (!canMonitor && alert.userId !== actor.userId) {
      throw AppError.forbidden('You cannot view this alert');
    }
    return { alert: alertDto(alert as AlertRow) };
  },

  async acknowledge(actor: { userId: string }, alertId: string, db: Db = prisma()) {
    const alert = await emergencyRepo.findById(alertId, db);
    if (!alert) throw AppError.notFound('Alert not found');
    const perms = await membershipPermissions(actor.userId, alert.workspaceId, db);
    if (!perms) throw AppError.forbidden('You are not a member of this workspace');
    if (perms.role !== 'admin' && !perms.permissions.includes('emergency.ack')) {
      throw AppError.forbidden("Permission 'emergency.ack' required");
    }
    if (alert.status === 'resolved') throw AppError.conflict('Alert is already resolved');
    if (alert.status === 'acknowledged') {
      const current = await emergencyRepo.findById(alertId, db);
      return { alert: alertDto(current as AlertRow) };
    }

    await emergencyRepo.acknowledge(alertId, actor.userId, db);
    await auditRepo.log(
      { action: 'alert.acknowledge', entityType: 'emergency_alert', entityId: alertId, actorId: actor.userId, workspaceId: alert.workspaceId },
      db,
    );
    const updated = (await emergencyRepo.findById(alertId, db)) as AlertRow;
    await publishAlert('alert.acknowledged', updated);
    return { alert: alertDto(updated) };
  },

  async resolve(actor: { userId: string }, alertId: string, db: Db = prisma()) {
    const alert = await emergencyRepo.findById(alertId, db);
    if (!alert) throw AppError.notFound('Alert not found');
    const perms = await membershipPermissions(actor.userId, alert.workspaceId, db);
    if (!perms) throw AppError.forbidden('You are not a member of this workspace');
    const canResolve = perms.role === 'admin' || perms.permissions.includes('emergency.ack') || alert.userId === actor.userId;
    if (!canResolve) throw AppError.forbidden('Only the reporter or an emergency dispatcher can resolve this alert');
    if (alert.status === 'resolved') {
      const current = await emergencyRepo.findById(alertId, db);
      return { alert: alertDto(current as AlertRow) };
    }

    await emergencyRepo.resolve(alertId, db);
    await auditRepo.log(
      { action: 'alert.resolve', entityType: 'emergency_alert', entityId: alertId, actorId: actor.userId, workspaceId: alert.workspaceId },
      db,
    );
    const updated = (await emergencyRepo.findById(alertId, db)) as AlertRow;
    await publishAlert('alert.resolved', updated);
    return { alert: alertDto(updated) };
  },
};