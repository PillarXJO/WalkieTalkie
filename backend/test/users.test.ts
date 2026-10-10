import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { closeDb, truncateAll } from './helpers/db.js';

let app: FastifyInstance;
let n = 0;
const pw = 'Passw0rd!x';

async function register(tag: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: tag, email: `${tag}.${Date.now()}_${n++}@test.dev`, password: pw },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as any;
}

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

beforeAll(async () => {
  app = await buildApp({ logger: false, docs: false });
  await app.ready();
  await truncateAll();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

describe('M4 users, contacts, presence, blocks', () => {
  it('updates status and profile, ghosts stay offline to others', async () => {
    const alice = await register('alice');

    const status = await app.inject({
      method: 'PATCH',
      url: '/users/me/status',
      headers: auth(alice.accessToken),
      payload: { status: 'busy', statusMessage: 'On a call' },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().status).toBe('busy');

    const bob = await register('bob');
    const bobViews = await app.inject({
      method: 'GET',
      url: `/users/${alice.user.id}`,
      headers: auth(bob.accessToken),
    });
    expect(bobViews.json().presence.status).toBe('busy');

    // Alice goes ghost — everyone else sees offline
    await app.inject({
      method: 'PATCH',
      url: '/users/me',
      headers: auth(alice.accessToken),
      payload: { ghostMode: true },
    });
    const ghost = await app.inject({
      method: 'GET',
      url: `/users/${alice.user.id}`,
      headers: auth(bob.accessToken),
    });
    expect(ghost.json().presence.status).toBe('offline');
    // Alice still sees her own real status
    const self = await app.inject({ method: 'GET', url: '/users/me', headers: auth(alice.accessToken) });
    expect(self.json().presence.status).toBe('busy');
  });

  it('manages contacts end to end', async () => {
    const alice = await register('c_alice');
    const bob = await register('c_bob');

    const add = await app.inject({
      method: 'POST',
      url: '/contacts',
      headers: auth(alice.accessToken),
      payload: { userId: bob.user.id, nickname: 'Bobby', isFavorite: true },
    });
    expect(add.statusCode).toBe(200);

    // Duplicate add conflicts
    const dup = await app.inject({
      method: 'POST',
      url: '/contacts',
      headers: auth(alice.accessToken),
      payload: { userId: bob.user.id },
    });
    expect(dup.statusCode).toBe(409);

    const list = await app.inject({ method: 'GET', url: '/contacts', headers: auth(alice.accessToken) });
    expect(list.statusCode).toBe(200);
    const contacts = list.json();
    expect(contacts).toHaveLength(1);
    expect(contacts[0].nickname).toBe('Bobby');
    expect(contacts[0].user.email).toBe(bob.user.email);
    expect(contacts[0]).toHaveProperty('presence');

    const edit = await app.inject({
      method: 'PATCH',
      url: `/contacts/${contacts[0].id}`,
      headers: auth(alice.accessToken),
      payload: { nickname: 'Bob Bob', isFavorite: false },
    });
    expect(edit.json().nickname).toBe('Bob Bob');

    const del = await app.inject({
      method: 'DELETE',
      url: `/contacts/${contacts[0].id}`,
      headers: auth(alice.accessToken),
    });
    expect(del.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/contacts', headers: auth(alice.accessToken) })).json()).toHaveLength(0);
  });

  it('blocks hide the offending user from presence and profiles', async () => {
    const alice = await register('b_alice');
    const bob = await register('b_bob');

    const block = await app.inject({
      method: 'POST',
      url: '/blocks',
      headers: auth(alice.accessToken),
      payload: { userId: bob.user.id },
    });
    expect(block.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/blocks', headers: auth(alice.accessToken) });
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0].user.id).toBe(bob.user.id);

    // bob's profile 404s for alice (and returns neutral presence before block rules apply)
    const profile = await app.inject({
      method: 'GET',
      url: `/users/${bob.user.id}`,
      headers: auth(alice.accessToken),
    });
    expect(profile.statusCode).toBe(404);

    // blocks are two-way in effect: bob cannot see alice either
    const reverse = await app.inject({
      method: 'GET',
      url: `/users/${alice.user.id}`,
      headers: auth(bob.accessToken),
    });
    expect(reverse.statusCode).toBe(404);

    const unblock = await app.inject({
      method: 'DELETE',
      url: `/blocks/${bob.user.id}`,
      headers: auth(alice.accessToken),
    });
    expect(unblock.statusCode).toBe(200);
  });

  it('cannot block or contact yourself', async () => {
    const me = await register('self');
    const selfBlock = await app.inject({
      method: 'POST',
      url: '/blocks',
      headers: auth(me.accessToken),
      payload: { userId: me.user.id },
    });
    expect(selfBlock.statusCode).toBe(400);
    const selfContact = await app.inject({
      method: 'POST',
      url: '/contacts',
      headers: auth(me.accessToken),
      payload: { userId: me.user.id },
    });
    expect(selfContact.statusCode).toBe(400);
  });
});