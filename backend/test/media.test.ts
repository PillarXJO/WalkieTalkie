import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { closeDb, truncateAll } from './helpers/db.js';

let app: FastifyInstance;
let emailCounter = 0;

const makeEmail = (tag: string) => `m.${tag}${Date.now()}_${emailCounter++}@test.dev`;
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

beforeAll(async () => {
  app = await buildApp({ logger: false, docs: false });
  await app.ready();
  await truncateAll();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

describe('M8 media storage & signed URLs', () => {
  it('requires authentication for media endpoints', async () => {
    const denied = await app.inject({ method: 'GET', url: '/media/upload-url' });
    expect(denied.statusCode).toBe(401);
    const deniedGet = await app.inject({ method: 'GET', url: '/media/somekey/get-url' });
    expect(deniedGet.statusCode).toBe(401);
  });

  it('mints a presigned PUT, uploads to s3mock, then reads it back via a presigned GET', async () => {
    const user = await register('media-a', 'Media User');

    const upload = await app.inject({
      method: 'GET',
      url: '/media/upload-url?type=transmissions&extension=webm&contentType=audio%2Fwebm',
      headers: auth(user.accessToken),
    });
    expect(upload.statusCode).toBe(200);
    const uploadBody = upload.json();
    expect(uploadBody.method).toBe('PUT');
    expect(uploadBody.key).toMatch(/^transmissions\/users\//);
    expect(uploadBody.key).toContain('.webm');
    expect(uploadBody.uploadUrl).toContain(uploadBody.key);
    expect(new Date(uploadBody.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const payload = Buffer.from('fake-opus-bytes');
    const put = await fetch(uploadBody.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'audio/webm' },
      body: payload,
    });
    expect(put.status).toBeLessThan(300);

    const download = await app.inject({
      method: 'GET',
      url: `/media/${encodeURIComponent(uploadBody.key)}/get-url`,
      headers: auth(user.accessToken),
    });
    expect(download.statusCode).toBe(200);
    const downloadBody = download.json();
    expect(downloadBody.method).toBe('GET');
    expect(new Date(downloadBody.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const get = await fetch(downloadBody.downloadUrl);
    expect(get.status).toBe(200);
    const bytes = Buffer.from(await get.arrayBuffer());
    expect(bytes.equals(payload)).toBe(true);
  });

  it('rejects an invalid upload request', async () => {
    const user = await register('media-b', 'Media Invalid');
    const bad = await app.inject({
      method: 'GET',
      url: '/media/upload-url?expiresInSeconds=99999',
      headers: auth(user.accessToken),
    });
    expect(bad.statusCode).toBe(400);
  });

  it('exposes an object-storage readiness check', async () => {
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.checks).toHaveProperty('object-storage');
    expect(body.checks['object-storage'].ok).toBe(true);
  });

  it('signs audioUrl on stored history transmissions', async () => {
    const user = await register('media-c', 'Media History');

    // seed a transmission directly with an audioKey (no floor round-trip needed)
    const { prisma } = await import('../src/lib/prisma.js');
    const db = prisma();
    const workspace = await db.workspace.create({
      data: {
        name: `AudioCo-${Date.now()}`,
        ownerId: user.user.id,
        members: { create: { userId: user.user.id, role: 'admin' } },
      },
    });
    const channel = await db.channel.create({
      data: {
        workspaceId: workspace.id,
        name: 'HQ',
        type: 'channel',
        createdById: user.user.id,
      },
    });
    const transmission = await db.transmission.create({
      data: {
        workspaceId: workspace.id,
        channelId: channel.id,
        userId: user.user.id,
        status: 'complete',
        startedAt: new Date(),
        durationMs: 1234,
        audioKey: 'recordings/hq/clip.webm',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/history/${transmission.id}`,
      headers: auth(user.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const item = res.json().transmission;
    expect(item.audioKey).toBe('recordings/hq/clip.webm');
    expect(item.audioUrl).toContain('recordings/hq/clip.webm');
    expect(item.audioUrl).toContain('X-Amz-Signature');
  });
});
