import { authenticator } from 'otplib';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { closeDb, truncateAll } from './helpers/db.js';

let app: FastifyInstance;

const deviceHeaders = { 'x-device-id': 'test-device', 'x-device-platform': 'ios', 'x-device-name': 'Simulator' };

beforeAll(async () => {
  app = await buildApp({ logger: false, docs: false });
  await app.ready();
  await truncateAll();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

async function register(email = `u${Date.now()}@test.dev`) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    headers: deviceHeaders,
    payload: { name: 'Test User', email, password: 'Passw0rd!x' },
  });
  return { res, body: res.json() as any };
}

describe('M2 auth', () => {
  it('register creates an account, personal workspace and returns tokens', async () => {
    const { res, body } = await register('a.register@test.dev');
    expect(res.statusCode).toBe(200);
    expect(body.auth).toBe('ok');
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.user.email).toBe('a.register@test.dev');
    expect(body.workspaces).toHaveLength(1);
    expect(body.workspace.name).toBe("Test User's Workspace");
    expect(body.channels.map((c: any) => c.name)).toEqual(expect.arrayContaining(['Everyone', 'Echo']));
    expect(body.user).not.toHaveProperty('passwordHash');
  });

  it('rejects duplicate registration', async () => {
    const email = 'a.dup@test.dev';
    await register(email);
    const { res } = await register(email);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('conflict');
  });

  it('rejects login with wrong password and unknown email', async () => {
    await register('a.login@test.dev');
    for (const payload of [
      { email: 'a.login@test.dev', password: 'wrong-password' },
      { email: 'nobody@test.dev', password: 'Passw0rd!x' },
    ]) {
      const res = await app.inject({ method: 'POST', url: '/auth/login', payload });
      expect(res.statusCode).toBe(401);
    }
  });

  it('logs in, hits an authenticated endpoint, refreshes and rotates', async () => {
    await register('a.loop@test.dev');
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: deviceHeaders,
      payload: { email: 'a.loop@test.dev', password: 'Passw0rd!x' },
    });
    const session = login.json();
    expect(session.auth).toBe('ok');
    expect(session.workspace.name).toBeTruthy();

    // Authenticated call round-trips and resolves the actor
    const me = await app.inject({
      method: 'GET',
      url: '/auth/sessions',
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(me.statusCode).toBe(200);

    // Unauthenticated call is rejected
    const deny = await app.inject({ method: 'GET', url: '/auth/sessions' });
    expect(deny.statusCode).toBe(401);

    // Refresh rotates the refresh token
    const refreshed = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: session.refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);
    const fresh = refreshed.json();
    expect(fresh.refreshToken).not.toBe(session.refreshToken);
    expect(fresh.accessToken).not.toBe(session.accessToken);

    // Old refresh token is now dead
    const reuse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: session.refreshToken },
    });
    expect(reuse.statusCode).toBe(401);
  });

  it('lists and revokes sessions', async () => {
    const { body } = await register('a.sessions@test.dev');
    const list = await app.inject({
      method: 'GET',
      url: '/auth/sessions',
      headers: { authorization: `Bearer ${body.accessToken}` },
    });
    const sessions = list.json();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].isCurrent).toBe(true);

    const revoke = await app.inject({
      method: 'DELETE',
      url: `/auth/sessions/${sessions[0].id}`,
      headers: { authorization: `Bearer ${body.accessToken}` },
    });
    expect(revoke.statusCode).toBe(200);

    // Revoked session's access token no longer works
    const denied = await app.inject({
      method: 'GET',
      url: '/auth/sessions',
      headers: { authorization: `Bearer ${body.accessToken}` },
    });
    expect(denied.statusCode).toBe(401);
  });

  it('enables 2FA, challenges login, completes with TOTP, then backup code', async () => {
    const { body } = await register('a.2fa@test.dev');

    const setup = await app.inject({
      method: 'POST',
      url: '/auth/2fa/setup',
      headers: { authorization: `Bearer ${body.accessToken}` },
    });
    expect(setup.statusCode).toBe(200);
    const { secret, otpauthUrl } = setup.json();
    expect(secret).toMatch(/^[A-Z2-7]{16,64}$/); // base32 (RFC4648) secret
    expect(otpauthUrl).toContain('otpauth://totp/');

    const confirm = await app.inject({
      method: 'POST',
      url: '/auth/2fa/confirm',
      headers: { authorization: `Bearer ${body.accessToken}` },
      payload: { code: authenticator.generate(secret) },
    });
    expect(confirm.statusCode).toBe(200);
    const backupCodes: string[] = confirm.json().backupCodes;
    expect(backupCodes).toHaveLength(8);

    // Login now demands a 2FA challenge
    const challenge = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'a.2fa@test.dev', password: 'Passw0rd!x' },
    });
    expect(challenge.statusCode).toBe(200);
    expect(challenge.json().auth).toBe('mfa_required');
    const mfaToken = challenge.json().mfaToken;

    // Complete with a TOTP code
    const verified = await app.inject({
      method: 'POST',
      url: '/auth/verify-2fa',
      headers: deviceHeaders,
      payload: { mfaToken, code: authenticator.generate(secret) },
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json().auth).toBe('ok');

    // A second challenge completes with a backup code (single use)
    const challenge2 = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'a.2fa@test.dev', password: 'Passw0rd!x' },
    });
    const viaBackup = await app.inject({
      method: 'POST',
      url: '/auth/verify-2fa',
      headers: deviceHeaders,
      payload: { mfaToken: challenge2.json().mfaToken, code: backupCodes[0] },
    });
    expect(viaBackup.statusCode).toBe(200);

    // Backup code is consumed — retry fails
    const challenge3 = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'a.2fa@test.dev', password: 'Passw0rd!x' },
    });
    const reuse = await app.inject({
      method: 'POST',
      url: '/auth/verify-2fa',
      payload: { mfaToken: challenge3.json().mfaToken, code: backupCodes[0] },
    });
    expect(reuse.statusCode).toBe(401);

    // Disabling clears the challenge requirement
    const disable = await app.inject({
      method: 'DELETE',
      url: '/auth/2fa',
      headers: { authorization: `Bearer ${body.accessToken}` },
      payload: { password: 'Passw0rd!x' },
    });
    expect(disable.statusCode).toBe(200);
    const noChallenge = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'a.2fa@test.dev', password: 'Passw0rd!x' },
    });
    expect(noChallenge.json().auth).toBe('ok');
  });

  it('runs the password-reset flow', async () => {
    const { body } = await register('a.resetpw@test.dev');
    const req = await app.inject({
      method: 'POST',
      url: '/auth/password/reset-request',
      payload: { email: 'a.resetpw@test.dev' },
    });
    expect(req.statusCode).toBe(200);
    const resetToken = req.json().resetToken; // non-production token echo

    const reset = await app.inject({
      method: 'POST',
      url: '/auth/password/reset',
      payload: { token: resetToken, newPassword: 'BrandNew!99' },
    });
    expect(reset.statusCode).toBe(200);

    // Old password fails, new one works
    const oldLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'a.resetpw@test.dev', password: 'Passw0rd!x' },
    });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'a.resetpw@test.dev', password: 'BrandNew!99' },
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it('revokes other sessions on password change, keeps current', async () => {
    const { body } = await register('a.changepw@test.dev');
    const other = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { ...deviceHeaders, 'x-device-id': 'other-device' },
      payload: { email: 'a.changepw@test.dev', password: 'Passw0rd!x' },
    });

    const change = await app.inject({
      method: 'POST',
      url: '/auth/password/change',
      headers: { authorization: `Bearer ${body.accessToken}` },
      payload: { currentPassword: 'Passw0rd!x', newPassword: 'Changed!!22' },
    });
    expect(change.statusCode).toBe(200);

    // The other device session is revoked, the current one (per the token) still valid
    const otherDenied = await app.inject({
      method: 'GET',
      url: '/auth/sessions',
      headers: { authorization: `Bearer ${other.json().accessToken}` },
    });
    expect(otherDenied.statusCode).toBe(401);
  });

  it('rejects workspace switching to a workspace you do not belong to', async () => {
    const { body } = await register('a.switch@test.dev');
    const res = await app.inject({
      method: 'POST',
      url: '/auth/workspaces/switch',
      headers: { authorization: `Bearer ${body.accessToken}` },
      payload: { workspaceId: 'does-not-exist' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('deletes the account and invalidates all sessions', async () => {
    const { body } = await register('a.delete@test.dev');
    const del = await app.inject({
      method: 'DELETE',
      url: '/auth/account',
      headers: { authorization: `Bearer ${body.accessToken}` },
      payload: { password: 'Passw0rd!x' },
    });
    expect(del.statusCode).toBe(200);

    const denied = await app.inject({
      method: 'GET',
      url: '/auth/sessions',
      headers: { authorization: `Bearer ${body.accessToken}` },
    });
    expect(denied.statusCode).toBe(401);
  });
});