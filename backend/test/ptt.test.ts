import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildApp } from '../src/app.js';
import { closeDb, dbClient, truncateAll } from './helpers/db.js';

let app: FastifyInstance;
let emailCounter = 0;

const makeEmail = (tag: string) => `ptt.${tag}${Date.now()}_${emailCounter++}@test.dev`;
const password = 'Passw0rd!x';

async function register(tag: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: `PTT ${tag}`, email: makeEmail(tag), password },
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

async function joinChannel(user: any, channelId: string) {
  const res = await app.inject({ method: 'POST', url: `/channels/${channelId}/join`, headers: auth(user.accessToken) });
  expect(res.statusCode).toBe(200);
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

    ws.once('open', () => resolve({ socket: ws, stream }));
    ws.once('error', reject);
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

describe('M6 real-time PTT', () => {
  it('mints LiveKit room tokens for channel members only', async () => {
    const admin = await register('token-admin');
    const outsider = await register('token-outsider');
    const ws = await newWorkspace(admin, 'Radio');
    const ch = await createChannel(admin, ws.workspace.id, 'Ops Room');

    const ok = await app.inject({
      method: 'POST',
      url: `/channels/${ch.id}/ptt-token`,
      headers: auth(admin.accessToken),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().room).toContain('ptt-');
    expect(ok.json().participant).toBe(admin.user.id);
    expect(ok.json().url).toContain('ws://');
    expect(typeof ok.json().token).toBe('string');
    expect(ok.json().token.length).toBeGreaterThan(40);

    const denied = await app.inject({
      method: 'POST',
      url: `/channels/${ch.id}/ptt-token`,
      headers: auth(outsider.accessToken),
    });
    expect(denied.statusCode).toBe(403);
  });

  it('refuses a LiveKit token while muted', async () => {
    const admin = await register('mute-admin');
    const member = await register('mute-member');
    const ws = await newWorkspace(admin, 'MutedCo');
    const wid = ws.workspace.id;
    await addMember(admin, wid, member.user.id, 'member');
    const ch = await createChannel(admin, wid, 'Quiet Room');
    await joinChannel(member, ch.id);

    // owner mutes the member
    const mute = await app.inject({
      method: 'PATCH',
      url: `/channels/${ch.id}/members/${member.user.id}`,
      headers: auth(admin.accessToken),
      payload: { isMuted: true, mutedUntil: new Date(Date.now() + 3_600_000).toISOString() },
    });
    expect(mute.statusCode).toBe(200);

    const denied = await app.inject({
      method: 'POST',
      url: `/channels/${ch.id}/ptt-token`,
      headers: auth(member.accessToken),
    });
    expect(denied.statusCode).toBe(403);
  });

  it('grants, renews, preempts and releases the floor', async () => {
    const admin = await register('floor-admin');
    const member = await register('floor-member');
    const ws = await newWorkspace(admin, 'FloorCo');
    const wid = ws.workspace.id;
    // member joins as a dispatcher so they can request priority
    await addMember(admin, wid, member.user.id, 'dispatcher');
    const ch = await createChannel(admin, wid, 'Channel A');
    await joinChannel(member, ch.id);

    // 1. normal grant
    const first = await app.inject({
      method: 'POST',
      url: `/channels/${ch.id}/floor/request`,
      headers: auth(admin.accessToken),
      payload: { priority: 'normal' },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().floor.speakerId).toBe(admin.user.id);
    expect(first.json().floor.priority).toBe('normal');
    const firstExpiry = Date.parse(first.json().floor.expiresAt);

    // 2. renewal extends the window (sliding), startedAt stays
    const renew = await app.inject({
      method: 'POST',
      url: `/channels/${ch.id}/floor/request`,
      headers: auth(admin.accessToken),
      payload: { priority: 'normal' },
    });
    expect(renew.statusCode).toBe(200);
    expect(renew.json().floor.startedAt).toBe(first.json().floor.startedAt);
    expect(Date.parse(renew.json().floor.expiresAt)).toBeGreaterThan(firstExpiry);

    // 3. same-level request from another user -> busy
    const busy = await app.inject({
      method: 'POST',
      url: `/channels/${ch.id}/floor/request`,
      headers: auth(member.accessToken),
      payload: { priority: 'normal' },
    });
    expect(busy.statusCode).toBe(409);
    expect(busy.json().error.details.current.speakerId).toBe(admin.user.id);

    // 4. priority preempts the normal speaker
    const priority = await app.inject({
      method: 'POST',
      url: `/channels/${ch.id}/floor/request`,
      headers: auth(member.accessToken),
      payload: { priority: 'priority' },
    });
    expect(priority.statusCode).toBe(200);
    expect(priority.json().floor.speakerId).toBe(member.user.id);
    expect(priority.json().floor.priority).toBe('priority');

    // 5. emergency always preempts
    const emergency = await app.inject({
      method: 'POST',
      url: `/channels/${ch.id}/floor/request`,
      headers: auth(admin.accessToken),
      payload: { priority: 'emergency' },
    });
    expect(emergency.statusCode).toBe(200);
    expect(emergency.json().floor.speakerId).toBe(admin.user.id);
    expect(emergency.json().floor.emergency).toBe(true);

    // 6. quiet release
    const release = await app.inject({
      method: 'POST',
      url: `/channels/${ch.id}/floor/release`,
      headers: auth(admin.accessToken),
    });
    expect(release.statusCode).toBe(200);

    const idle = await app.inject({ method: 'GET', url: `/channels/${ch.id}/floor`, headers: auth(admin.accessToken) });
    expect(idle.statusCode).toBe(200);
    expect(idle.json().floor).toBeNull();

    // Each finished segment is recorded for history/analytics.
    const count = await dbClient().transmission.count({ where: { channelId: ch.id } });
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('cannot be released by a bystander', async () => {
    const admin = await register('rel-admin');
    const member = await register('rel-member');
    const ws = await newWorkspace(admin, 'RelCo');
    const wid = ws.workspace.id;
    await addMember(admin, wid, member.user.id, 'member');
    const ch = await createChannel(admin, wid, 'Guarded');
    await joinChannel(member, ch.id);

    await app.inject({
      method: 'POST',
      url: `/channels/${ch.id}/floor/request`,
      headers: auth(admin.accessToken),
      payload: { priority: 'normal' },
    });

    const denied = await app.inject({
      method: 'POST',
      url: `/channels/${ch.id}/floor/release`,
      headers: auth(member.accessToken),
    });
    expect(denied.statusCode).toBe(403);
  });

  it('records talk time and mirrors it back on echo channels', async () => {
    const admin = await register('echo-admin');
    const ws = await newWorkspace(admin, 'EchoCo');
    const echoRes = await app.inject({
      method: 'POST',
      url: `/workspaces/${ws.workspace.id}/channels`,
      headers: auth(admin.accessToken),
      payload: { name: 'Echo', type: 'echo' },
    });
    expect(echoRes.statusCode).toBe(200);
    const echo = echoRes.json();
    expect(echo.type).toBe('echo');

    const request = await app.inject({
      method: 'POST',
      url: `/channels/${echo.id}/floor/request`,
      headers: auth(admin.accessToken),
      payload: { priority: 'normal' },
    });
    expect(request.statusCode).toBe(200);

    const release = await app.inject({
      method: 'POST',
      url: `/channels/${echo.id}/floor/release`,
      headers: auth(admin.accessToken),
    });
    expect(release.statusCode).toBe(200);

    const txs = await dbClient().transmission.findMany({
      where: { channelId: echo.id },
      include: { user: { select: { id: true, name: true, isBot: true } } },
    });
    expect(txs.length).toBeGreaterThanOrEqual(2);
    const mine = txs.find((t) => t.userId === admin.user.id);
    const echoed = txs.find((t) => t.user.isBot);
    expect(mine).toBeTruthy();
    expect(echoed).toBeTruthy();
    expect(echoed!.user.name).toBe('Echo Bot');
  });

  it('exposes a websocket gateway for floor + presence events', async () => {
    const admin = await register('ws-admin');
    const ws = await newWorkspace(admin, 'WsCo');
    const echoRes = await app.inject({
      method: 'POST',
      url: `/workspaces/${ws.workspace.id}/channels`,
      headers: auth(admin.accessToken),
      payload: { name: 'Echo', type: 'echo' },
    });
    expect(echoRes.statusCode).toBe(200);
    const echo = echoRes.json();

    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const { socket, stream } = await openSocket(address, admin.accessToken);

      // init snapshot arrives right after connect
      const init = await stream.take((m: any) => m.type === 'init');
      expect(init.data.userId).toBe(admin.user.id);

      // floor:request over ws grants and the relay confirms to members
      socket.send(JSON.stringify({ type: 'floor:request', channelId: echo.id, priority: 'normal' }));
      const granted = await stream.take((m: any) => m.type === 'floor.granted');
      expect(granted.channelId).toBe(echo.id);
      expect(granted.data.state.speakerId).toBe(admin.user.id);

      // releasing over HTTP is reported back to the open socket
      const release = await app.inject({
        method: 'POST',
        url: `/channels/${echo.id}/floor/release`,
        headers: auth(admin.accessToken),
      });
      expect(release.statusCode).toBe(200);
      const floordown = await stream.take((m: any) => m.type === 'floor.state' && m.data.state === null);
      expect(floordown.channelId).toBe(echo.id);

      // presence changes fan back to the acting user
      socket.send(JSON.stringify({ type: 'presence:set', status: 'busy', statusMessage: 'On the radio' }));
      const presence = await stream.take((m: any) => m.type === 'presence' && m.userId === admin.user.id);
      expect(presence.status).toBe('busy');

      socket.close();
    } finally {
      await app.close();
    }
  });
});