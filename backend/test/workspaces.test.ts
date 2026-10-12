import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { closeDb, truncateAll } from './helpers/db.js';

let app: FastifyInstance;
let emailCounter = 0;

const makeAdmin = () => `ws.admin${Date.now()}_${emailCounter++}@test.dev`;
const makeMember = () => `ws.member${Date.now()}_${emailCounter++}@test.dev`;
const password = 'Passw0rd!x';

async function register(email: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'User', email, password },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as any;
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function newWorkspace(admin: any, name: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/workspaces',
    headers: auth(admin.accessToken),
    payload: { name },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as any;
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

describe('M3 workspaces, roles, permissions', () => {
  it('creates a second workspace and lists memberships', async () => {
    const admin = await register(makeAdmin());
    const ws = await newWorkspace(admin, 'Ops');
    expect(ws.workspace.name).toBe('Ops');
    expect(ws.workspace.role).toBe('admin');
    expect(ws.channels).toEqual([]);

    const list = await app.inject({ method: 'GET', url: '/workspaces', headers: auth(admin.accessToken) });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(2); // personal + Ops
    expect(list.json()[0].channelCount).toBe(0);
  });

  it('denies non-members and shows 403 on a foreign workspace', async () => {
    const a = await register(makeAdmin());
    const b = await register(makeMember());
    const ws = await newWorkspace(a, 'Private');

    const deny = await app.inject({
      method: 'GET',
      url: `/workspaces/${ws.workspace.id}`,
      headers: auth(b.accessToken),
    });
    expect(deny.statusCode).toBe(403);
  });

  it('adds a member with a role via the member editor', async () => {
    const a = await register(makeAdmin());
    const b = await register(makeMember());
    const ws = await newWorkspace(a, 'Team');

    // Admin adds b, then promotes to dispatcher with a permission override
    const add = await app.inject({
      method: 'POST',
      url: `/workspaces/${ws.workspace.id}/members`,
      headers: auth(a.accessToken),
      payload: { userId: b.user.id, role: 'member' },
    });
    expect(add.statusCode).toBe(200);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/workspaces/${ws.workspace.id}/members/${b.user.id}`,
      headers: auth(a.accessToken),
      payload: { role: 'dispatcher', permissions: ['location.view'] },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().role).toBe('dispatcher');
    expect(patch.json().permissions).toContain('location.view');

    // b can now fetch the workspace
    const get = await app.inject({
      method: 'GET',
      url: `/workspaces/${ws.workspace.id}`,
      headers: auth(b.accessToken),
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().role).toBe('dispatcher');
    expect(get.json().permissions).toEqual(expect.arrayContaining(['channel.create', 'location.view']));

    // Only admins may edit roles
    const forbidden = await app.inject({
      method: 'PATCH',
      url: `/workspaces/${ws.workspace.id}/members/${a.user.id}`,
      headers: auth(b.accessToken),
      payload: { role: 'member' },
    });
    expect(forbidden.statusCode).toBe(403);

    // Unknown permissions are rejected by the contract validator
    const badPerm = await app.inject({
      method: 'PATCH',
      url: `/workspaces/${ws.workspace.id}/members/${b.user.id}`,
      headers: auth(a.accessToken),
      payload: { permissions: ['location.view', 'totally.fake'] },
    });
    expect(badPerm.statusCode).toBe(400);
  });

  it('rejects unknown permission tokens before touching the DB', async () => {
    const a = await register(makeAdmin());
    const ws = await newWorkspace(a, 'PermGuard');
    const res = await app.inject({
      method: 'PATCH',
      url: `/workspaces/${ws.workspace.id}/members/${a.user.id}`,
      headers: auth(a.accessToken),
      payload: { permissions: ['not.a.permission'] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_failed');
  });

  it('removes a member and prevents headless admin removal', async () => {
    const a = await register(makeAdmin());
    const b = await register(makeMember());
    const ws = await newWorkspace(a, 'Hive');

    await app.inject({
      method: 'POST',
      url: `/workspaces/${ws.workspace.id}/members`,
      headers: auth(a.accessToken),
      payload: { userId: b.user.id, role: 'member' },
    });

    // Cannot remove the last (only) admin
    const selfRemove = await app.inject({
      method: 'DELETE',
      url: `/workspaces/${ws.workspace.id}/members/${a.user.id}`,
      headers: auth(a.accessToken),
    });
    expect(selfRemove.statusCode).toBe(409);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/workspaces/${ws.workspace.id}/members/${b.user.id}`,
      headers: auth(a.accessToken),
    });
    expect(remove.statusCode).toBe(200);

    const denied = await app.inject({
      method: 'GET',
      url: `/workspaces/${ws.workspace.id}`,
      headers: auth(b.accessToken),
    });
    expect(denied.statusCode).toBe(403);
  });

  it('updates workspace settings and soft-deletes it', async () => {
    const a = await register(makeAdmin());
    const ws = await newWorkspace(a, 'Settings');
    const wid = ws.workspace.id;

    const patch = await app.inject({
      method: 'PATCH',
      url: `/workspaces/${wid}`,
      headers: auth(a.accessToken),
      payload: { name: 'Settings Renamed', settings: { retentionDays: 7, guestsAllowed: true } },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().name).toBe('Settings Renamed');
    expect(patch.json().settings).toMatchObject({ retentionDays: 7 });

    const statsRes = await app.inject({
      method: 'GET',
      url: `/workspaces/${wid}/stats?days=7`,
      headers: auth(a.accessToken),
    });
    expect(statsRes.statusCode).toBe(200);
    expect(statsRes.json().memberCount).toBe(1);

    const del = await app.inject({ method: 'DELETE', url: `/workspaces/${wid}`, headers: auth(a.accessToken) });
    expect(del.statusCode).toBe(200);

    const gone = await app.inject({ method: 'GET', url: `/workspaces/${wid}`, headers: auth(a.accessToken) });
    expect(gone.statusCode).toBe(404);
  });

  it('non-admins cannot create/delete workspaces belonging to others (member gate)', async () => {
    const a = await register(makeAdmin());
    const b = await register(makeMember());
    const ws = await newWorkspace(a, 'Gated');
    await app.inject({
      method: 'POST',
      url: `/workspaces/${ws.workspace.id}/members`,
      headers: auth(a.accessToken),
      payload: { userId: b.user.id, role: 'member' },
    });

    const deniedDelete = await app.inject({
      method: 'DELETE',
      url: `/workspaces/${ws.workspace.id}`,
      headers: auth(b.accessToken),
    });
    expect(deniedDelete.statusCode).toBe(403);
  });
});