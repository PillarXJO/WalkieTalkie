import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { closeDb, truncateAll } from './helpers/db.js';

let app: FastifyInstance;
let emailCounter = 0;
const password = 'Passw0rd!x';
const makeEmail = (tag: string) => `a.${tag}${Date.now()}_${emailCounter++}@test.dev`;
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function register(tag: string, name: string) {
  const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { name, email: makeEmail(tag), password } });
  expect(res.statusCode).toBe(200);
  return res.json() as any;
}

async function newWorkspace(admin: any, name: string) {
  const res = await app.inject({ method: 'POST', url: '/workspaces', headers: auth(admin.accessToken), payload: { name } });
  expect(res.statusCode).toBe(200);
  return res.json() as any;
}

async function addMember(admin: any, wid: string, userId: string, role: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/workspaces/${wid}/members`,
    headers: auth(admin.accessToken),
    payload: { userId, role },
  });
  expect(res.statusCode).toBe(200);
}

beforeAll(async () => {
  app = await buildApp({ logger: false, docs: false });
  await app.ready();
  await truncateAll();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

describe('M11 admin dashboard & audit log', () => {
  it('records audit entries for workspace/channel/member actions', async () => {
    const admin = await register('ad1', 'Admin One');
    const ws = await newWorkspace(admin, 'AuditCo');
    const wid = ws.workspace.id;

    const ch = await app.inject({
      method: 'POST',
      url: `/workspaces/${wid}/channels`,
      headers: auth(admin.accessToken),
      payload: { name: 'Dispatch', type: 'channel' },
    });
    expect(ch.statusCode).toBe(200);

    const member = await register('ad2', 'Member Two');
    await addMember(admin, wid, member.user.id, 'member');

    const res = await app.inject({ method: 'GET', url: `/workspaces/${wid}/admin/audit`, headers: auth(admin.accessToken) });
    expect(res.statusCode).toBe(200);
    const actions = res.json().items.map((i: any) => i.action);
    expect(actions).toContain('workspace.create');
    expect(actions).toContain('channel.create');
    expect(actions).toContain('member.add');

    const created = res.json().items.find((i: any) => i.action === 'channel.create');
    expect(created.actor?.id).toBe(admin.user.id);
    expect(created.entityType).toBe('channel');
  });

  it('filters the audit trail by action', async () => {
    const admin = await register('ad3', 'Admin Three');
    const ws = await newWorkspace(admin, 'FilterCo');
    const wid = ws.workspace.id;
    await app.inject({ method: 'POST', url: `/workspaces/${wid}/channels`, headers: auth(admin.accessToken), payload: { name: 'Alpha' } });
    await app.inject({ method: 'POST', url: `/workspaces/${wid}/channels`, headers: auth(admin.accessToken), payload: { name: 'Bravo' } });

    const res = await app.inject({ method: 'GET', url: `/workspaces/${wid}/admin/audit?action=channel.create&limit=1`, headers: auth(admin.accessToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(1);
    expect(res.json().items[0].action).toBe('channel.create');
    expect(res.json().nextCursor).toBeTruthy();
  });

  it('aggregates audit events by action', async () => {
    const admin = await register('ad4', 'Admin Four');
    const ws = await newWorkspace(admin, 'StatsCo');
    const wid = ws.workspace.id;
    await app.inject({ method: 'POST', url: `/workspaces/${wid}/channels`, headers: auth(admin.accessToken), payload: { name: 'A' } });
    await app.inject({ method: 'POST', url: `/workspaces/${wid}/channels`, headers: auth(admin.accessToken), payload: { name: 'B' } });

    const res = await app.inject({ method: 'GET', url: `/workspaces/${wid}/admin/audit/stats?days=7`, headers: auth(admin.accessToken) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBeGreaterThanOrEqual(3);
    const channelCreates = body.byAction.find((r: any) => r.action === 'channel.create');
    expect(channelCreates.count).toBe(2);
  });

  it('returns a dashboard snapshot for admins', async () => {
    const admin = await register('ad5', 'Admin Five');
    const member = await register('ad6', 'Member Six');
    const ws = await newWorkspace(admin, 'DashCo');
    const wid = ws.workspace.id;
    await addMember(admin, wid, member.user.id, 'member');

    const res = await app.inject({ method: 'GET', url: `/workspaces/${wid}/admin/dashboard?days=30`, headers: auth(admin.accessToken) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.members.total).toBe(2);
    expect(body.channels.total).toBe(2);
    expect(body.transmissions.count).toBe(0);
    expect(body.alerts.open).toBe(0);
    expect(Array.isArray(body.recentActivity)).toBe(true);
    expect(body.recentActivity.length).toBeGreaterThan(0);
  });

  it('enforces admin.stats for the dashboard and admin.audit for the audit trail', async () => {
    const admin = await register('ad7', 'Admin Seven');
    const dispatcher = await register('ad8', 'Dispatch Eight');
    const member = await register('ad9', 'Member Nine');
    const ws = await newWorkspace(admin, 'PermCo');
    const wid = ws.workspace.id;
    await addMember(admin, wid, dispatcher.user.id, 'dispatcher');
    await addMember(admin, wid, member.user.id, 'member');

    // Dispatcher: has admin.stats, lacks admin.audit.
    const dash = await app.inject({ method: 'GET', url: `/workspaces/${wid}/admin/dashboard`, headers: auth(dispatcher.accessToken) });
    expect(dash.statusCode).toBe(200);
    const audit = await app.inject({ method: 'GET', url: `/workspaces/${wid}/admin/audit`, headers: auth(dispatcher.accessToken) });
    expect(audit.statusCode).toBe(403);

    // Plain member: neither.
    const dashForbidden = await app.inject({ method: 'GET', url: `/workspaces/${wid}/admin/dashboard`, headers: auth(member.accessToken) });
    expect(dashForbidden.statusCode).toBe(403);
    const auditForbidden = await app.inject({ method: 'GET', url: `/workspaces/${wid}/admin/audit`, headers: auth(member.accessToken) });
    expect(auditForbidden.statusCode).toBe(403);

    // Outsider: not a member at all.
    const outsider = await register('ad10', 'Outsider Ten');
    const outside = await app.inject({ method: 'GET', url: `/workspaces/${wid}/admin/dashboard`, headers: auth(outsider.accessToken) });
    expect(outside.statusCode).toBe(403);
  });
});
