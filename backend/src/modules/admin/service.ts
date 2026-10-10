import { AppError } from '../../lib/errors.js';
import { auditRepo } from '../../repositories/audit.repo.js';
import { channelRepo } from '../../repositories/channel.repo.js';
import { membershipRepo } from '../../repositories/membership.repo.js';
import type { Db } from '../../repositories/types.js';
import { prisma } from '../../lib/prisma.js';
import type { Permission } from '../../domain/permissions.js';
import { membershipPermissions } from '../workspaces/service.js';

async function requirePermission(
  actor: { userId: string },
  workspaceId: string,
  permission: Permission,
  db: Db,
) {
  const perms = await membershipPermissions(actor.userId, workspaceId, db);
  if (!perms) throw AppError.forbidden('You are not a member of this workspace');
  if (perms.role !== 'admin' && !perms.permissions.includes(permission)) {
    throw AppError.forbidden(`Permission '${permission}' required`);
  }
  return perms;
}

export const adminService = {
  /** Paginated, filterable audit trail for a workspace. */
  async listAudit(
    actor: { userId: string },
    workspaceId: string,
    query: { action?: string; actorId?: string; limit?: number; cursor?: string },
    db: Db = prisma(),
  ) {
    await requirePermission(actor, workspaceId, 'admin.audit', db);
    const rows = await auditRepo.listByWorkspace(
      workspaceId,
      { limit: query.limit, ...(query.action ? { action: query.action } : {}), ...(query.cursor ? { cursor: query.cursor } : {}) },
      db,
    );
    const items = rows
      .filter((r) => (query.actorId ? r.actorId === query.actorId : true))
      .map((r) => ({
        id: r.id,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        data: r.data,
        ip: r.ip,
        createdAt: r.createdAt,
        actor: r.actor ? { id: r.actor.id, name: r.actor.name, email: r.actor.email } : null,
      }));
    const nextCursor = rows.length === (query.limit ?? 100) ? rows[rows.length - 1]?.id ?? null : null;
    return { items, nextCursor };
  },

  /** Counts of audit events grouped by action over a window. */
  async auditStats(actor: { userId: string }, workspaceId: string, days: number, db: Db = prisma()) {
    await requirePermission(actor, workspaceId, 'admin.audit', db);
    const from = new Date(Date.now() - days * 86_400_000);
    const byAction = await auditRepo.aggregateByAction(workspaceId, from, db);
    const total = byAction.reduce((sum, r) => sum + r.count, 0);
    return { from, days, total, byAction: byAction.sort((a, b) => b.count - a.count) };
  },

  /** Workspace health/usage snapshot for the admin dashboard. */
  async dashboard(actor: { userId: string }, workspaceId: string, days: number, db: Db = prisma()) {
    await requirePermission(actor, workspaceId, 'admin.stats', db);
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);

    const [
      memberCount,
      onlineCount,
      channelCount,
      usage,
      alertOpen,
      alertWindow,
      pingCount,
      recentAudit,
    ] = await Promise.all([
      membershipRepo.countByWorkspace(workspaceId, db),
      db.membership.count({ where: { workspaceId, deletedAt: null, user: { status: 'online', deletedAt: null } } }),
      db.channel.count({ where: { workspaceId, deletedAt: null } }),
      channelRepo.usageStats(workspaceId, from, to, db),
      db.emergencyAlert.count({ where: { workspaceId, status: { in: ['open', 'acknowledged'] } } }),
      db.emergencyAlert.count({ where: { workspaceId, createdAt: { gte: from, lt: to } } }),
      db.locationPing.count({ where: { workspaceId, createdAt: { gte: from, lt: to } } }),
      auditRepo.listByWorkspace(workspaceId, { limit: 10 }, db),
    ]);

    return {
      from,
      to,
      days,
      members: { total: memberCount, online: onlineCount },
      channels: { total: channelCount },
      transmissions: { count: usage.messageCount, talkTimeMs: usage.talkTimeMs, activeUsers: usage.activeUsers },
      alerts: { open: alertOpen, inWindow: alertWindow },
      locationPings: pingCount,
      recentActivity: recentAudit.map((r) => ({
        id: r.id,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        createdAt: r.createdAt,
        actor: r.actor ? { id: r.actor.id, name: r.actor.name } : null,
      })),
    };
  },
};
