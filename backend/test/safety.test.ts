import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildApp } from '../src/app.js';
import { closeDb, truncateAll } from './helpers/db.js';

let app: FastifyInstance;
let emailCounter = 0;

const makeEmail = (tag: string) => `s.${tag}${Date.now()}_${emailCounter++}@test.dev`;
const password = 'Passw0rd!x';

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function register(tag: string, name: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name, email: makeEmail(tag), password },
  });
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

async function createChannel(admin: any, wid: string, name: string) {
  const res = await app.inject({ method: 'POST', url: `/workspaces/${wid}/channels`, headers: auth(admin.accessToken), payload: { name } });
  expect(res.statusCode).toBe(200);
  return res.json() as any;
}

function openSocket(address: string, token: string): Promise<{ socket: WebSocket; stream: { take: (p: (m: any) => boolean) => Promise<any> } }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${address}/ws?token=${token}`);
    const buffer: any[] = [];
    const pending: Array<{ p: (m: any) => boolean; resolve: (m: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }> = [];

    function flush() {
      while (buffer.length > 0 && pending.length > 0) {
        const msg = buffer.shift()!;
        const found = pending.findIndex((entry) => entry.p(msg));
        if (found >= 0) {
          const entry = pending.splice(found, 1)[0]!;
          clearTimeout(entry.timer);
          entry.resolve(msg);
        }
      }
    }

    ws.on('message', (raw: WebSocket.RawData) => {
      try {
        buffer.push(JSON.parse(raw.toString()));
      } catch {
        return;
      }
      flush();
    });

    const stream = {
      take(p: (m: any) => boolean) {
        return new Promise<any>((resolve, reject) => {
          const entry = { p, resolve, reject, timer: setTimeout(() => reject(new Error('timed out waiting for websocket message')), 8000) };
          pending.push(entry);
          flush();
        });
      },
    };

    ws.on('open', () => resolve({ socket: ws, stream }));
    ws.on('error', reject);
  });
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

describe('M9 location pings', () => {
  it('records a ping and returns my latest', async () => {
    const user = await register('loc-a', 'Loc A');
    const ws = await newWorkspace(user, 'LocCo');
    const wid = ws.workspace.id;

    const ping = await app.inject({
      method: 'POST',
      url: '/location/pings',
      headers: auth(user.accessToken),
      payload: { latitude: 51.5074, longitude: -0.1278, accuracy: 12.5, source: 'manual', workspaceId: wid },
    });
    expect(ping.statusCode).toBe(200);
    expect(ping.json().ping.latitude).toBeCloseTo(51.5074);

    const mine = await app.inject({ method: 'GET', url: '/location/me', headers: auth(user.accessToken) });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().ping.longitude).toBeCloseTo(-0.1278);
  });

  it('validates coordinates', async () => {
    const user = await register('loc-b', 'Loc B');
    const bad = await app.inject({
      method: 'POST',
      url: '/location/pings',
      headers: auth(user.accessToken),
      payload: { latitude: 200, longitude: 0 },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('lets dispatchers view a workspace live map but not plain members', async () => {
    const admin = await register('loc-c', 'Loc Admin');
    const dispatcher = await register('loc-d', 'Loc Dispatch');
    const member = await register('loc-e', 'Loc Member');
    const ws = await newWorkspace(admin, 'MapCo');
    const wid = ws.workspace.id;
    await addMember(admin, wid, dispatcher.user.id, 'dispatcher');
    await addMember(admin, wid, member.user.id, 'member');

    for (const u of [admin, dispatcher, member]) {
      await app.inject({
        method: 'POST',
        url: '/location/pings',
        headers: auth(u.accessToken),
        payload: { latitude: 40 + Math.random(), longitude: -70 - Math.random(), workspaceId: wid },
      });
    }

    const feed = await app.inject({ method: 'GET', url: `/workspaces/${wid}/locations?latest=true`, headers: auth(dispatcher.accessToken) });
    expect(feed.statusCode).toBe(200);
    expect(feed.json().pings).toHaveLength(3);
    // newest per user, and all three members represented
    const ids = feed.json().pings.map((p: any) => p.userId).sort();
    expect(ids).toEqual([admin.user.id, dispatcher.user.id, member.user.id].sort());

    const denied = await app.inject({ method: 'GET', url: `/workspaces/${wid}/locations`, headers: auth(member.accessToken) });
    expect(denied.statusCode).toBe(403);
  });

  it('restricts another user\'s last-known location to location.view holders', async () => {
    const admin = await register('loc-f', 'Loc F Admin');
    const member = await register('loc-g', 'Loc G Member');
    const ws = await newWorkspace(admin, 'PrivacyCo');
    const wid = ws.workspace.id;
    await addMember(admin, wid, member.user.id, 'member');

    await app.inject({
      method: 'POST',
      url: '/location/pings',
      headers: auth(admin.accessToken),
      payload: { latitude: 1, longitude: 2, workspaceId: wid },
    });

    // member (no location.view) cannot see admin's location
    const denied = await app.inject({ method: 'GET', url: `/users/${admin.user.id}/location`, headers: auth(member.accessToken) });
    expect(denied.statusCode).toBe(403);

    // self is always allowed
    const self = await app.inject({ method: 'GET', url: `/location/me`, headers: auth(member.accessToken) });
    expect(self.statusCode).toBe(200);
  });
});

describe('M9 emergency alerts', () => {
  it('runs the trigger -> acknowledge -> resolve lifecycle', async () => {
    const admin = await register('alert-a', 'Alert Admin');
    const dispatcher = await register('alert-b', 'Alert Dispatch');
    const member = await register('alert-c', 'Alert Member');
    const ws = await newWorkspace(admin, 'AlertCo');
    const wid = ws.workspace.id;
    await addMember(admin, wid, dispatcher.user.id, 'dispatcher');
    await addMember(admin, wid, member.user.id, 'member');
    const ch = await createChannel(admin, wid, 'Tactical');

    const created = await app.inject({
      method: 'POST',
      url: `/workspaces/${wid}/alerts`,
      headers: auth(member.accessToken),
      payload: { alertType: 'panic', channelId: ch.id, latitude: 48.85, longitude: 2.35, message: 'Need backup' },
    });
    expect(created.statusCode).toBe(200);
    const alert = created.json().alert;
    expect(alert.status).toBe('open');
    expect(alert.alertType).toBe('panic');
    expect(alert.user.id).toBe(member.user.id);

    const open = await app.inject({ method: 'GET', url: `/workspaces/${wid}/alerts`, headers: auth(dispatcher.accessToken) });
    expect(open.statusCode).toBe(200);
    expect(open.json().alerts).toHaveLength(1);

    const ack = await app.inject({ method: 'POST', url: `/alerts/${alert.id}/acknowledge`, headers: auth(dispatcher.accessToken) });
    expect(ack.statusCode).toBe(200);
    expect(ack.json().alert.status).toBe('acknowledged');
    expect(ack.json().alert.acknowledgedBy.id).toBe(dispatcher.user.id);

    const resolved = await app.inject({ method: 'POST', url: `/alerts/${alert.id}/resolve`, headers: auth(dispatcher.accessToken) });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().alert.status).toBe('resolved');

    const openAfter = await app.inject({ method: 'GET', url: `/workspaces/${wid}/alerts`, headers: auth(dispatcher.accessToken) });
    expect(openAfter.json().alerts).toHaveLength(0);

    const all = await app.inject({ method: 'GET', url: `/workspaces/${wid}/alerts?status=all`, headers: auth(admin.accessToken) });
    expect(all.json().alerts).toHaveLength(1);
  });

  it('forbids acknowledgement without emergency.ack', async () => {
    const admin = await register('alert-d', 'Alert D Admin');
    const member = await register('alert-e', 'Alert E Member');
    const ws = await newWorkspace(admin, 'AlertCo2');
    const wid = ws.workspace.id;
    await addMember(admin, wid, member.user.id, 'member');

    const created = await app.inject({
      method: 'POST',
      url: `/workspaces/${wid}/alerts`,
      headers: auth(member.accessToken),
      payload: { alertType: 'emergency', message: 'help' },
    });
    const id = created.json().alert.id;

    const denied = await app.inject({ method: 'POST', url: `/alerts/${id}/acknowledge`, headers: auth(member.accessToken) });
    expect(denied.statusCode).toBe(403);
  });

  it('hides alerts from non-members and hides other members\' alerts from plain members', async () => {
    const admin = await register('alert-f', 'Alert F Admin');
    const member = await register('alert-g', 'Alert G Member');
    const outsider = await register('alert-h', 'Alert H Outsider');
    const ws = await newWorkspace(admin, 'AlertCo3');
    const wid = ws.workspace.id;
    await addMember(admin, wid, member.user.id, 'member');

    const created = await app.inject({
      method: 'POST',
      url: `/workspaces/${wid}/alerts`,
      headers: auth(member.accessToken),
      payload: {},
    });
    const id = created.json().alert.id;

    const outsiderView = await app.inject({ method: 'GET', url: `/alerts/${id}`, headers: auth(outsider.accessToken) });
    expect(outsiderView.statusCode).toBe(403);

    // member cannot trigger in a workspace they are not part of
    const outsiderTrigger = await app.inject({
      method: 'POST',
      url: `/workspaces/${wid}/alerts`,
      headers: auth(outsider.accessToken),
      payload: {},
    });
    expect(outsiderTrigger.statusCode).toBe(403);

    // plain member list only sees own alerts
    const own = await app.inject({ method: 'GET', url: `/workspaces/${wid}/alerts?status=all`, headers: auth(member.accessToken) });
    expect(own.json().alerts).toHaveLength(1);
  });

  it('broadcasts alert.created over the websocket to workspace members', async () => {
    const admin = await register('alert-i', 'Alert I Admin');
    const dispatcher = await register('alert-j', 'Alert J Dispatch');
    const ws = await newWorkspace(admin, 'AlertWs');
    const wid = ws.workspace.id;
    await addMember(admin, wid, dispatcher.user.id, 'dispatcher');

    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const { socket, stream } = await openSocket(address as string, dispatcher.accessToken);
    await stream.take((m) => m.type === 'init');

    const created = await app.inject({
      method: 'POST',
      url: `/workspaces/${wid}/alerts`,
      headers: auth(admin.accessToken),
      payload: { alertType: 'emergency', message: 'fire' },
    });
    expect(created.statusCode).toBe(200);

    const event = await stream.take((m) => m.type === 'alert.created');
    expect(event.workspaceId).toBe(wid);
    expect(event.data.id).toBe(created.json().alert.id);
    socket.close();
  });
});