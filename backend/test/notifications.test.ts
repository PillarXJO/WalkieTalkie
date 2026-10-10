import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { resetPushTransport, setPushTransport, type PushMessage, type PushTicket } from '../src/lib/push.js';
import { closeDb, truncateAll } from './helpers/db.js';

let app: FastifyInstance;
let emailCounter = 0;

const makeEmail = (tag: string) => `n.${tag}${Date.now()}_${emailCounter++}@test.dev`;
const password = 'Passw0rd!x';

interface SentRecord {
  messages: PushMessage[];
  tickets: PushTicket[];
}

let sent: SentRecord;

function installRecorder(): void {
  sent = { messages: [], tickets: [] };
  setPushTransport({
    async send(messages) {
      sent.messages.push(...messages);
      const tickets = messages.map((m) => ({
        id: `ticket-${m.to}`,
        status: m.to.includes('bad') ? ('error' as const) : ('ok' as const),
        ...(m.to.includes('bad') ? { details: { error: 'DeviceNotRegistered' } } : {}),
      }));
      sent.tickets.push(...tickets);
      return tickets;
    },
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

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

beforeEach(() => {
  installRecorder();
});

afterAll(async () => {
  resetPushTransport();
  await app.close();
  await closeDb();
});

describe('M10 push notifications', () => {
  it('registers, lists and removes a device token', async () => {
    const user = await register('push-a', 'Push A');
    const reg = await app.inject({
      method: 'POST',
      url: '/notifications/tokens',
      headers: auth(user.accessToken),
      payload: { token: 'ExponentPushToken[device-aaa]', platform: 'android', appId: 'dev.ptt' },
    });
    expect(reg.statusCode).toBe(200);
    expect(reg.json().platform).toBe('android');

    const list = await app.inject({ method: 'GET', url: '/notifications/tokens', headers: auth(user.accessToken) });
    expect(list.json().tokens).toHaveLength(1);

    const del = await app.inject({
      method: 'DELETE',
      url: '/notifications/tokens',
      headers: auth(user.accessToken),
      payload: { token: 'ExponentPushToken[device-aaa]' },
    });
    expect(del.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/notifications/tokens', headers: auth(user.accessToken) });
    expect(after.json().tokens).toHaveLength(0);
  });

  it('validates token registration input', async () => {
    const user = await register('push-b', 'Push B');
    const bad = await app.inject({
      method: 'POST',
      url: '/notifications/tokens',
      headers: auth(user.accessToken),
      payload: { token: 'x', platform: 'blackberry' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('sends a test push to the caller\'s devices', async () => {
    const user = await register('push-c', 'Push C');
    await app.inject({
      method: 'POST',
      url: '/notifications/tokens',
      headers: auth(user.accessToken),
      payload: { token: 'ExponentPushToken[test-c]', platform: 'ios' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/notifications/test',
      headers: auth(user.accessToken),
      payload: { title: 'Hello', body: 'World' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().attempted).toBe(1);
    expect(res.json().ok).toBe(1);
    expect(sent.messages[0]!.title).toBe('Hello');
  });

  it('fails a test push when no tokens are registered', async () => {
    const user = await register('push-d', 'Push D');
    const res = await app.inject({ method: 'POST', url: '/notifications/test', headers: auth(user.accessToken), payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('pushes emergency alerts to workspace members on their devices', async () => {
    const admin = await register('push-e', 'Push E Admin');
    const member = await register('push-f', 'Push F Member');
    const ws = await newWorkspace(admin, 'PushCo');
    const wid = ws.workspace.id;
    await addMember(admin, wid, member.user.id, 'member');

    for (const u of [admin, member]) {
      await app.inject({
        method: 'POST',
        url: '/notifications/tokens',
        headers: auth(u.accessToken),
        payload: { token: `ExponentPushToken[${u.user.id}]`, platform: 'android' },
      });
    }

    const res = await app.inject({
      method: 'POST',
      url: `/workspaces/${wid}/alerts`,
      headers: auth(member.accessToken),
      payload: { alertType: 'panic', message: 'Officer down' },
    });
    expect(res.statusCode).toBe(200);

    await waitFor(() => sent.messages.length > 0);
    // The reporter (member) is excluded; only the admin receives the push.
    expect(sent.messages).toHaveLength(1);
    expect(sent.messages[0]!.to).toBe(`ExponentPushToken[${admin.user.id}]`);
    expect(sent.messages[0]!.priority).toBe('high');
    expect(sent.messages[0]!.body).toBe('Officer down');
    expect(sent.messages[0]!.data?.type).toBe('alert.created');
  });

  it('honours a disabled channel setting and DND quiet hours', async () => {
    const admin = await register('push-g', 'Push G Admin');
    const member = await register('push-h', 'Push H Member');
    const ws = await newWorkspace(admin, 'QuietCo');
    const wid = ws.workspace.id;
    await addMember(admin, wid, member.user.id, 'member');

    await app.inject({
      method: 'POST',
      url: '/notifications/tokens',
      headers: auth(member.accessToken),
      payload: { token: `ExponentPushToken[${member.user.id}]`, platform: 'ios' },
    });

    // Member opts out of the catch-all.
    const setAll = await app.inject({
      method: 'PUT',
      url: '/notifications/settings',
      headers: auth(member.accessToken),
      payload: { kind: 'all', pushEnabled: false },
    });
    expect(setAll.statusCode).toBe(200);

    const settings = await app.inject({ method: 'GET', url: '/notifications/settings', headers: auth(member.accessToken) });
    expect(settings.json().settings[0].pushEnabled).toBe(false);

    sent.messages.length = 0;
    await app.inject({
      method: 'POST',
      url: `/workspaces/${wid}/alerts`,
      headers: auth(admin.accessToken),
      payload: { alertType: 'emergency', message: 'drill' },
    });
    // Give the fire-and-forget notify a moment; assert nothing was sent.
    await new Promise((r) => setTimeout(r, 200));
    expect(sent.messages).toHaveLength(0);

    // Re-enable but silence via full-day DND (high priority still bypasses it).
    await app.inject({
      method: 'PUT',
      url: '/notifications/settings',
      headers: auth(member.accessToken),
      payload: { kind: 'all', pushEnabled: true, dnd: { enabled: true, startMin: 0, endMin: 1439 } },
    });
    sent.messages.length = 0;
    await app.inject({
      method: 'POST',
      url: `/workspaces/${wid}/alerts`,
      headers: auth(admin.accessToken),
      payload: { alertType: 'emergency', message: 'night drill' },
    });
    await waitFor(() => sent.messages.length > 0);
    expect(sent.messages[0]!.priority).toBe('high');
  });

  it('prunes tokens reported as unregistered', async () => {
    const user = await register('push-i', 'Push I');
    await app.inject({
      method: 'POST',
      url: '/notifications/tokens',
      headers: auth(user.accessToken),
      payload: { token: 'ExponentPushToken[bad-device]', platform: 'android' },
    });

    const res = await app.inject({ method: 'POST', url: '/notifications/test', headers: auth(user.accessToken), payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().failed).toBe(1);
    expect(res.json().unregistered).toContain('ExponentPushToken[bad-device]');

    const list = await app.inject({ method: 'GET', url: '/notifications/tokens', headers: auth(user.accessToken) });
    expect(list.json().tokens).toHaveLength(0);
  });
});