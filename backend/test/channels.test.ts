import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { closeDb, truncateAll } from './helpers/db.js';

let app: FastifyInstance;
let emailCounter = 0;

const makeEmail = (tag: string) => `ch.${tag}${Date.now()}_${emailCounter++}@test.dev`;
const password = 'Passw0rd!x';

async function register(tag: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: `User ${tag}`, email: makeEmail(tag), password },
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

async function createChannel(admin: any, wid: string, name: string, extra: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: `/workspaces/${wid}/channels`,
    headers: auth(admin.accessToken),
    payload: { name, ...extra },
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

describe('M5 channels & invites', () => {
  it('creates a channel, enforces name uniqueness, and lets the creator update it', async () => {
    const admin = await register('chaine-mgr');
    const ws = await newWorkspace(admin, 'Ops');
    const wid = ws.workspace.id;

    const created = await createChannel(admin, wid, 'Tactical');
    expect(created.name).toBe('Tactical');
    expect(created.type).toBe('channel');

    // Default channel + Echo exist from provisioning
    expect(created.isDefault).toBe(false);

    const clash = await app.inject({
      method: 'POST',
      url: `/workspaces/${wid}/channels`,
      headers: auth(admin.accessToken),
      payload: { name: 'Tactical' },
    });
    expect(clash.statusCode).toBe(409);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/channels/${created.id}`,
      headers: auth(admin.accessToken),
      payload: { name: 'Tactical Ops', description: 'Secure talk' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().name).toBe('Tactical Ops');
    expect(patch.json().description).toBe('Secure talk');

    const detail = await app.inject({
      method: 'GET',
      url: `/channels/${created.id}`,
      headers: auth(admin.accessToken),
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().myRole).toBe('owner');
    expect(detail.json().counts.members).toBe(1);
  });

  it('enforces channel.create permission and workspace membership', async () => {
    const a = await register('perm-a');
    const b = await register('perm-b');
    const c = await register('perm-c');
    const ws = await newWorkspace(a, 'PermCo');
    const wid = ws.workspace.id;

    // b is a dispatcher (has channel.create) -> allowed
    await addMember(a, wid, b.user.id, 'dispatcher');
    const createdByB = await app.inject({
      method: 'POST',
      url: `/workspaces/${wid}/channels`,
      headers: auth(b.accessToken),
      payload: { name: 'Dispatcher Room' },
    });
    expect(createdByB.statusCode).toBe(200);
    expect(createdByB.json().name).toBe('Dispatcher Room');

    // c is a plain member (no channel.create) -> 403
    await addMember(a, wid, c.user.id, 'member');
    const denied = await app.inject({
      method: 'POST',
      url: `/workspaces/${wid}/channels`,
      headers: auth(c.accessToken),
      payload: { name: 'Member Room' },
    });
    expect(denied.statusCode).toBe(403);

    // outsider cannot even view the channel
    const outsider = await register('perm-d');
    const view = await app.inject({
      method: 'GET',
      url: `/channels/${createdByB.json().id}`,
      headers: auth(outsider.accessToken),
    });
    expect(view.statusCode).toBe(403);
  });

  it('joins, leaves, and protects the default channel', async () => {
    const a = await register('join-a');
    const b = await register('join-b');
    const ws = await newWorkspace(a, 'JoinCo');
    const wid = ws.workspace.id;
    await addMember(a, wid, b.user.id, 'member');

    const ch = await createChannel(a, wid, 'Voluntary');

    const join = await app.inject({
      method: 'POST',
      url: `/channels/${ch.id}/join`,
      headers: auth(b.accessToken),
    });
    expect(join.statusCode).toBe(200);

    const leave = await app.inject({
      method: 'POST',
      url: `/channels/${ch.id}/leave`,
      headers: auth(b.accessToken),
    });
    expect(leave.statusCode).toBe(200);

    // Cannot leave a default channel
    const findDefault = await app.inject({
      method: 'GET',
      url: `/workspaces/${wid}`,
      headers: auth(a.accessToken),
    });
    const defaultCh = findDefault.json().workspace.defaultChannelId;
    const leaveDefault = await app.inject({
      method: 'POST',
      url: `/channels/${defaultCh}/leave`,
      headers: auth(a.accessToken),
    });
    expect(leaveDefault.statusCode).toBe(400);
  });

  it('edits per-channel members with owner guards', async () => {
    const a = await register('edit-a');
    const b = await register('edit-b');
    const c = await register('edit-c');
    const ws = await newWorkspace(a, 'EditCo');
    const wid = ws.workspace.id;
    await addMember(a, wid, b.user.id, 'member');
    await addMember(a, wid, c.user.id, 'member');

    const ch = await createChannel(a, wid, 'Secured');
    await app.inject({ method: 'POST', url: `/channels/${ch.id}/join`, headers: auth(b.accessToken) });
    await app.inject({ method: 'POST', url: `/channels/${ch.id}/join`, headers: auth(c.accessToken) });

    // plain member cannot edit members
    const forbidden = await app.inject({
      method: 'PATCH',
      url: `/channels/${ch.id}/members/${b.user.id}`,
      headers: auth(b.accessToken),
      payload: { role: 'moderator' },
    });
    expect(forbidden.statusCode).toBe(403);

    // owner promotes b to moderator with per-channel permissions
    const promote = await app.inject({
      method: 'PATCH',
      url: `/channels/${ch.id}/members/${b.user.id}`,
      headers: auth(a.accessToken),
      payload: { role: 'moderator', permissions: ['channel.broadcast'] },
    });
    expect(promote.statusCode).toBe(200);
    expect(promote.json().role).toBe('moderator');
    expect(promote.json().permissions).toContain('channel.broadcast');

    // unknown per-channel permission rejected before DB writes
    const badPerm = await app.inject({
      method: 'PATCH',
      url: `/channels/${ch.id}/members/${c.user.id}`,
      headers: auth(a.accessToken),
      payload: { permissions: ['channel.broadcast', 'nope.nope'] },
    });
    expect(badPerm.statusCode).toBe(400);

    // moderators cannot edit the owner's row
    const demoteOwner = await app.inject({
      method: 'PATCH',
      url: `/channels/${ch.id}/members/${a.user.id}`,
      headers: auth(b.accessToken),
      payload: { role: 'member' },
    });
    expect(demoteOwner.statusCode).toBe(403);

    // removing the last owner is blocked (409)
    const removeOwner = await app.inject({
      method: 'DELETE',
      url: `/channels/${ch.id}/members/${a.user.id}`,
      headers: auth(a.accessToken),
    });
    expect(removeOwner.statusCode).toBe(409);

    // removing a non-owner works
    const removed = await app.inject({
      method: 'DELETE',
      url: `/channels/${ch.id}/members/${b.user.id}`,
      headers: auth(a.accessToken),
    });
    expect(removed.statusCode).toBe(200);
  });

  it('mutes and unmutes a channel from the member side', async () => {
    const a = await register('mute-a');
    const ws = await newWorkspace(a, 'MuteCo');
    const ch = await createChannel(a, ws.workspace.id, 'Quiet');

    const until = new Date(Date.now() + 3_600_000).toISOString();
    const mute = await app.inject({
      method: 'POST',
      url: `/channels/${ch.id}/mute`,
      headers: auth(a.accessToken),
      payload: { until },
    });
    expect(mute.statusCode).toBe(200);
    expect(mute.json().isMuted).toBe(true);

    const detail = await app.inject({
      method: 'GET',
      url: `/channels/${ch.id}`,
      headers: auth(a.accessToken),
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().isMuted).toBe(true);

    const unmute = await app.inject({
      method: 'DELETE',
      url: `/channels/${ch.id}/mute`,
      headers: auth(a.accessToken),
    });
    expect(unmute.statusCode).toBe(200);
    expect(unmute.json().isMuted).toBe(false);

    const stats = await app.inject({
      method: 'GET',
      url: `/channels/${ch.id}/stats?days=7`,
      headers: auth(a.accessToken),
    });
    expect(stats.statusCode).toBe(200);
    expect(stats.json()).toMatchObject({ transmissionCount: 0, talkTimeMs: 0 });
  });

  it('creates invites, previews them publicly, and redeems via the member flow', async () => {
    const a = await register('inv-a');
    const b = await register('inv-b');
    const joiner = await register('inv-join');

    const ws = await newWorkspace(a, 'InviteCo');
    const wid = ws.workspace.id;
    await addMember(a, wid, b.user.id, 'dispatcher');

    // admin creates a member invite with QR payload
    const create = await app.inject({
      method: 'POST',
      url: `/workspaces/${wid}/invites`,
      headers: auth(a.accessToken),
      payload: { role: 'member', maxUses: 2, expiresInHours: 24 },
    });
    expect(create.statusCode).toBe(200);
    const inv = create.json();
    expect(inv.code).toBeTruthy();
    expect(inv.deepLink).toContain(`ptt://invite/`);
    expect(inv.url).toContain('/i/');
    expect(inv.webUrl).toContain('/i/');
    expect(inv.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(inv.role).toBe('member');

    // dispatcher can also create invites (member.invite)
    const asDispatcher = await app.inject({
      method: 'POST',
      url: `/workspaces/${wid}/invites`,
      headers: auth(b.accessToken),
      payload: { role: 'dispatcher', maxUses: 1, expiresInHours: 24 },
    });
    expect(asDispatcher.statusCode).toBe(200);
    expect(asDispatcher.json().role).toBe('dispatcher');

    // listing shows creator name
    const list = await app.inject({
      method: 'GET',
      url: `/workspaces/${wid}/invites`,
      headers: auth(b.accessToken),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().map((i: any) => i.createdByName)).toEqual(expect.arrayContaining(['User inv-a', 'User inv-b']));

    // public preview works WITHOUT auth
    const peek = await app.inject({ method: 'GET', url: `/invites/${inv.code}` });
    expect(peek.statusCode).toBe(200);
    expect(peek.json().workspaceName).toBe('InviteCo');
    expect(peek.json().role).toBe('member');

    // member (no member.invite) cannot create invites
    const c = await register('inv-c');
    await addMember(a, wid, c.user.id, 'member');
    const denied = await app.inject({
      method: 'POST',
      url: `/workspaces/${wid}/invites`,
      headers: auth(c.accessToken),
      payload: { role: 'member', maxUses: 1 },
    });
    expect(denied.statusCode).toBe(403);

    // redeeming joins the workspace and its channels
    const redeem = await app.inject({
      method: 'POST',
      url: '/invites/redeem',
      headers: auth(joiner.accessToken),
      payload: { code: inv.code },
    });
    expect(redeem.statusCode).toBe(200);
    expect(redeem.json().workspace.name).toBe('InviteCo');
    expect(redeem.json().channels.map((ch: any) => ch.name)).toEqual(expect.arrayContaining(['Everyone', 'Echo']));
    expect(redeem.json().workspaces.map((w: any) => w.id)).toContain(wid);

    // a second fresh user also fits inside maxUses=2
    const joiner2 = await register('inv-join2');
    const redeem2 = await app.inject({
      method: 'POST',
      url: '/invites/redeem',
      headers: auth(joiner2.accessToken),
      payload: { code: inv.code },
    });
    expect(redeem2.statusCode).toBe(200);

    // a third exceed the usage limit -> 410 gone
    const joiner3 = await register('inv-join3');
    const redeem3 = await app.inject({
      method: 'POST',
      url: '/invites/redeem',
      headers: auth(joiner3.accessToken),
      payload: { code: inv.code },
    });
    expect(redeem3.statusCode).toBe(410);

    // revoking breaks both preview and redeeming
    const revoke = await app.inject({
      method: 'DELETE',
      url: `/workspaces/${wid}/invites/${asDispatcher.json().code}`,
      headers: auth(b.accessToken),
    });
    expect(revoke.statusCode).toBe(200);

    const peekRevoked = await app.inject({ method: 'GET', url: `/invites/${asDispatcher.json().code}` });
    expect(peekRevoked.statusCode).toBe(410);
  });
});