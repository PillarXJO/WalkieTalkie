import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { AppError } from '../src/lib/errors.js';

describe('M0 scaffold', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false, docs: false });
    app.get('/boom', async () => {
      throw AppError.forbidden('nope');
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves liveness probes', async () => {
    for (const path of ['/healthz', '/livez']) {
      const res = await app.inject({ method: 'GET', url: path });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'ok' });
    }
  });

  it('reports readiness with no failing checks yet', async () => {
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('returns a structured 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatchObject({ code: 'not_found' });
    expect(res.json().error.requestId).toBeTruthy();
  });

  it('sets security headers and request id', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('maps AppError to its status code', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatchObject({ code: 'forbidden', message: 'nope' });
  });

  it('returns JSON for unknown routes with a request id', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json().error.requestId).toBe(res.headers['x-request-id']);
  });
});
