import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { closeDb, truncateAll } from './helpers/db.js';

let app: FastifyInstance;
let emailCounter = 0;

const makeEmail = (tag: string) => `h.${tag}${Date.now()}_${emailCounter++}@test.dev`;
const password = 'Passw0rd!x';

async function register(tag: string, name: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name, email: makeEmail(tag), password },
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

async function addMember(admin: any, wid: string, userId: string, role: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/workspaces/${wid}/members`,
    headers: auth(admin.accessToken),
    payload: { userId, role },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as any;
}

async function createChannel(admin: any, wid: string, name: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/workspaces/${wid}/channels`,
    headers: auth(admin.accessToken),
    payload: { name },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as any;
}

async function talk(user: any, channelId: string) {
  const req = await app.inject({
    method: 'POST',
    url: `/channels/${channelId}/floor/request`,
    headers: auth(user.accessToken),
    payload: { priority: 'normal' },
  });
  expect(req.statusCode).toBe(200);
  const rel = await app.inject({
    method: 'POST',
    url: `/channels/${channelId}/floor/release`,
    headers: auth(user.accessToken),
  });
  expect(rel.statusCode).toBe(200);
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

describe('M7 voice history', () => {
  it('lists channel history from recorded talk segments', async () => {
    const admin = await register('hist-a', 'Hist A Lead');
    const member = await register('hist-b', 'Hist B Field');
    const ws = await newWorkspace(admin, 'HistCo');
    const wid = ws.workspace.id;
    await addMember(admin, wid, member.user.id, 'member');
    const ch = await createChannel(admin, wid, 'Ops');

    await app.inject({ method: 'POST', url: `/channels/${ch.id}/join`, headers: auth(member.accessToken) });

    await talk(admin, ch.id);
    await talk(member, ch.id);

    const list = await app.inject({
      method: 'GET',
      url: `/channels/${ch.id}/history`,
      headers: auth(admin.accessToken),
    });
    expect(list.statusCode).toBe(200);
    const res = list.json();
    expect(res.items).toHaveLength(2);
    // newest first: member talked last
    expect(res.items[0].user.id).toBe(member.user.id);
    expect(res.items[1].user.id).toBe(admin.user.id);
    expect(res.hasMore).toBe(false);
    expect(res.items[0].channel.name).toBe('Ops');
    expect(res.items[0].status).toBe('complete');
    expect(typeof res.items[0].durationMs).toBe('number');

    // pagination cursor by `after` + limit
    const page = await app.inject({
      method: 'GET',
      url: `/channels/${ch.id}/history?limit=1`,
      headers: auth(admin.accessToken),
    });
    expect(page.statusCode).toBe(200);
    expect(page.json().items).toHaveLength(1);
    expect(page.json().hasMore).toBe(true);
  });

  it('returns a single transmission and removes it (speaker/admin only)', async () => {
    const admin = await register('hist-c', 'Hist C Admin');
    const member = await register('hist-d', 'Hist D Member');
    const other = await register('hist-e', 'Hist E Outsider');
    const ws = await newWorkspace(admin, 'HistCo2');
    const wid = ws.workspace.id;
    await addMember(admin, wid, member.user.id, 'member');
    const ch = await createChannel(admin, wid, 'HQ');
    await app.inject({ method: 'POST', url: `/channels/${ch.id}/join`, headers: auth(member.accessToken) });

    await talk(admin, ch.id);
    await talk(member, ch.id);

    const list = await app.inject({ method: 'GET', url: `/channels/${ch.id}/history`, headers: auth(admin.accessToken) });
    const items = list.json().items as any[];
    const mine = items.find((t: any) => t.user.id === admin.user.id);

    const one = await app.inject({
      method: 'GET',
      url: `/history/${mine.id}`,
      headers: auth(member.accessToken),
    });
    expect(one.statusCode).toBe(200);
    expect(one.json().transmission.id).toBe(mine.id);

    // outsiders cannot see history at all
    const denied = await app.inject({ method: 'GET', url: `/history/${mine.id}`, headers: auth(other.accessToken) });
    expect(denied.statusCode).toBe(403);

    // a non-speaker member cannot delete it
    const deniedDelete = await app.inject({ method: 'DELETE', url: `/history/${mine.id}`, headers: auth(member.accessToken) });
    expect(deniedDelete.statusCode).toBe(403);

    // the speaker can
    const deleted = await app.inject({ method: 'DELETE', url: `/history/${mine.id}`, headers: auth(admin.accessToken) });
    expect(deleted.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: `/history/${mine.id}`, headers: auth(admin.accessToken) });
    expect(after.statusCode).toBe(404);

    const listAfter = await app.inject({ method: 'GET', url: `/channels/${ch.id}/history`, headers: auth(admin.accessToken) });
    expect(listAfter.json().items).toHaveLength(1);
  });

  it('searches workspace history across channels and users', async () => {
    const admin = await register('hist-f', 'Search Boss');
    const member = await register('hist-g', 'Search Agent');
    const ws = await newWorkspace(admin, 'SearchCo');
    const wid = ws.workspace.id;
    await addMember(admin, wid, member.user.id, 'member');
    const ch = await createChannel(admin, wid, 'Patrol');
    await app.inject({ method: 'POST', url: `/channels/${ch.id}/join`, headers: auth(member.accessToken) });

    await talk(admin, ch.id);
    await talk(member, ch.id);
    await talk(member, ch.id);

    const all = await app.inject({
      method: 'GET',
      url: `/workspaces/${wid}/history`,
      headers: auth(member.accessToken),
    });
    expect(all.statusCode).toBe(200);
    expect(all.json().items).toHaveLength(3);

    const byUser = await app.inject({
      method: 'GET',
      url: `/workspaces/${wid}/history?userId=${member.user.id}`,
      headers: auth(member.accessToken),
    });
    expect(byUser.json().items).toHaveLength(2);
    expect(byUser.json().items.every((t: any) => t.user.id === member.user.id)).toBe(true);

    const search = await app.inject({
      method: 'GET',
      url: `/workspaces/${wid}/history/search?q=${encodeURIComponent('Search Agent')}`,
      headers: auth(member.accessToken),
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().items.length).toBeGreaterThanOrEqual(2);
    expect(search.json().items.every((t: any) => t.user.name === 'Search Agent')).toBe(true);

    const filterChannel = await app.inject({
      method: 'GET',
      url: `/workspaces/${wid}/history/search?channelId=${ch.id}&userId=${admin.user.id}`,
      headers: auth(member.accessToken),
    });
    expect(filterChannel.json().items).toHaveLength(1);
    expect(filterChannel.json().items[0].user.id).toBe(admin.user.id);
  });
});