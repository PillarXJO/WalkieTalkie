import { z } from 'zod';

export const emailField = z.string().trim().toLowerCase().email().max(254);
export const passwordField = z.string().min(8).max(200);
export const nameField = z.string().trim().min(1).max(120);

export const registerBody = z.object({
  name: nameField,
  email: emailField,
  password: passwordField,
  phone: z.string().trim().max(32).optional().nullable(),
  locale: z.string().trim().max(10).optional(),
});

export const loginBody = z.object({
  email: emailField,
  password: z.string().min(1).max(200),
  totpCode: z.string().regex(/^\d{6}$/).optional().nullable(),
  backupCode: z.string().trim().min(6).max(64).optional().nullable(),
});

export const verifyMfaBody = z.object({
  mfaToken: z.string().min(10),
  code: z.string().trim().min(6).max(64),
});

export const refreshBody = z.object({ refreshToken: z.string().min(10) });
export const logoutBody = z.object({ refreshToken: z.string().min(10) });

export const changePasswordBody = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordField,
});

export const resetRequestBody = z.object({ email: emailField });
export const resetBody = z.object({ token: z.string().min(10), newPassword: passwordField });
export const deleteAccountBody = z.object({ password: z.string().min(1).max(200) });
export const confirmTotpBody = z.object({ code: z.string().regex(/^\d{6}$/) });
export const disableTotpBody = z.object({ password: z.string().min(1).max(200) });
export const switchWorkspaceBody = z.object({ workspaceId: z.string().min(1).max(64) });
export const sessionParams = z.object({ sessionId: z.string().min(1).max(64) });

/** Device/request metadata captured from headers so sessions are identifiable. */
export function sessionMetaFromReq(req: {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}): {
  deviceId: string | undefined;
  deviceName: string | undefined;
  platform: string | undefined;
  osVersion: string | undefined;
  appVersion: string | undefined;
  ip: string | undefined;
  userAgent: string | undefined;
} {
  const h = req.headers;
  return {
    deviceId: (typeof h['x-device-id'] === 'string' ? h['x-device-id'] : undefined) ?? undefined,
    deviceName: (typeof h['x-device-name'] === 'string' ? h['x-device-name'] : undefined) ?? undefined,
    platform: (typeof h['x-device-platform'] === 'string' ? h['x-device-platform'] : undefined) ?? undefined,
    osVersion: (typeof h['x-device-os-version'] === 'string' ? h['x-device-os-version'] : undefined) ?? undefined,
    appVersion: (typeof h['x-app-version'] === 'string' ? h['x-app-version'] : undefined) ?? undefined,
    ip: req.ip ?? req.socket?.remoteAddress ?? undefined,
    userAgent: (typeof h['user-agent'] === 'string' ? h['user-agent'] : undefined) ?? undefined,
  };
}