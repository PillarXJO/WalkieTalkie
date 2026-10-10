import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { env } from '../../config/env.js';
import {
  changePasswordBody,
  confirmTotpBody,
  deleteAccountBody,
  disableTotpBody,
  loginBody,
  logoutBody,
  refreshBody,
  registerBody,
  resetBody,
  resetRequestBody,
  sessionMetaFromReq,
  sessionParams,
  switchWorkspaceBody,
  verifyMfaBody,
} from './schema.js';
import { authService } from './service.js';

type AuthRequest = FastifyRequest;
function meta(req: AuthRequest) {
  return sessionMetaFromReq(req);
}

export async function authRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/auth/health',
    {
      schema: { tags: ['auth'], summary: 'Auth module liveness' },
    },
    async () => ({ status: 'ok' }),
  );

  typed.post(
    '/auth/register',
    {
      config: { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' } },
      schema: { tags: ['auth'], summary: 'Create account and personal workspace', body: registerBody },
    },
    async (req) => authService.register(req.body, meta(req)),
  );

  typed.post(
    '/auth/login',
    {
      config: { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' } },
      schema: { tags: ['auth'], summary: 'Login (returns a 2FA challenge when required)', body: loginBody },
    },
    async (req) => authService.login(req.body, meta(req)),
  );

  typed.post(
    '/auth/verify-2fa',
    {
      config: { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' } },
      schema: { tags: ['auth'], summary: 'Complete login with TOTP or backup code', body: verifyMfaBody },
    },
    async (req) => authService.verifyMfa(req.body, meta(req)),
  );

  typed.post(
    '/auth/refresh',
    {
      schema: { tags: ['auth'], summary: 'Rotate the refresh token and mint a new access token', body: refreshBody },
    },
    async (req) => authService.refresh(req.body, meta(req)),
  );

  typed.post(
    '/auth/logout',
    { schema: { tags: ['auth'], summary: 'Revoke the session behind a refresh token', body: logoutBody } },
    async (req) => authService.logout(req.body.refreshToken),
  );

  // --- Authenticated session management -------------------------------------
  typed.get('/auth/sessions', { schema: { tags: ['auth'], security: [{ bearerAuth: [] }] } }, async (req) =>
    authService.listSessions(req.requireAuth().userId, req.requireAuth().sessionId),
  );

  typed.delete('/auth/sessions/:sessionId', { schema: { tags: ['auth'], params: sessionParams } }, async (req) => {
    const actor = req.requireAuth();
    return authService.revokeSession(actor.userId, req.params.sessionId);
  });

  typed.post('/auth/password/change', { schema: { tags: ['auth'], body: changePasswordBody } }, async (req) =>
    authService.changePassword(req.requireAuth().userId, req.body.currentPassword, req.body.newPassword),
  );

  // --- Password reset --------------------------------------------------------
  typed.post(
    '/auth/password/reset-request',
    { config: { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' } }, schema: { tags: ['auth'], body: resetRequestBody } },
    async (req) => authService.requestPasswordReset(req.body.email),
  );

  typed.post('/auth/password/reset', { schema: { tags: ['auth'], body: resetBody } }, async (req) =>
    authService.resetPassword(req.body.token, req.body.newPassword),
  );

  // --- 2FA -------------------------------------------------------------------
  typed.post('/auth/2fa/setup', { schema: { tags: ['auth'] } }, async (req) =>
    authService.setupTotp(req.requireAuth().userId),
  );

  typed.post('/auth/2fa/confirm', { schema: { tags: ['auth'], body: confirmTotpBody } }, async (req) =>
    authService.confirmTotp(req.requireAuth().userId, req.body.code),
  );

  typed.delete('/auth/2fa', { schema: { tags: ['auth'], body: disableTotpBody } }, async (req) =>
    authService.disableTotp(req.requireAuth().userId, req.body.password),
  );

  typed.post('/auth/2fa/backup-codes/regenerate', { schema: { tags: ['auth'] } }, async (req) =>
    authService.regenerateBackupCodes(req.requireAuth().userId),
  );

  typed.get('/auth/2fa/backup-codes', { schema: { tags: ['auth'] } }, async (req) =>
    authService.backupCodeCount(req.requireAuth().userId),
  );

  // --- Workspace switching ----------------------------------------------------
  typed.post('/auth/workspaces/switch', { schema: { tags: ['auth'], body: switchWorkspaceBody } }, async (req) => {
    const actor = req.requireAuth();
    return authService.switchWorkspace(actor.userId, actor.sessionId, req.body.workspaceId);
  });

  // --- Account ----------------------------------------------------------------
  typed.delete('/auth/account', { schema: { tags: ['auth'], body: deleteAccountBody } }, async (req) => {
    const actor = req.requireAuth();
    return authService.deleteAccount(actor.userId, req.body.password);
  });

  return app;
}