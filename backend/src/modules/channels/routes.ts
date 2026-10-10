import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  channelMemberParams,
  channelParams,
  createChannelBody,
  createInviteBody,
  inviteParams,
  muteBody,
  redeemBody,
  statsQuery,
  updateChannelBody,
  updateChannelMemberBody,
  workspaceParams,
} from './schema.js';
import { channelsService } from './service.js';

export async function channelRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const catalog = { tags: ['channels'], security: [{ bearerAuth: [] }] as const };
  const inviteCatalog = { tags: ['invites'], security: [{ bearerAuth: [] }] as const };

  // --- Channels ---------------------------------------------------------------
  typed.post('/workspaces/:workspaceId/channels', { schema: { ...catalog, summary: 'Create a channel', params: workspaceParams, body: createChannelBody } }, async (req) =>
    channelsService.createChannel(req.requireAuth(), req.params.workspaceId, req.body),
  );

  typed.get('/channels/:channelId', { schema: { ...catalog, summary: 'Channel detail', params: channelParams } }, async (req) =>
    channelsService.getChannel(req.requireAuth(), req.params.channelId),
  );

  typed.patch('/channels/:channelId', { schema: { ...catalog, summary: 'Rename / describe', params: channelParams, body: updateChannelBody } }, async (req) =>
    channelsService.updateChannel(req.requireAuth(), req.params.channelId, req.body),
  );

  typed.delete('/channels/:channelId', { schema: { ...catalog, summary: 'Delete a channel', params: channelParams } }, async (req) =>
    channelsService.deleteChannel(req.requireAuth(), req.params.channelId),
  );

  typed.post('/channels/:channelId/join', { schema: { ...catalog, summary: 'Join a channel', params: channelParams } }, async (req) =>
    channelsService.joinChannel(req.requireAuth(), req.params.channelId),
  );

  typed.post('/channels/:channelId/leave', { schema: { ...catalog, summary: 'Leave a channel', params: channelParams } }, async (req) =>
    channelsService.leaveChannel(req.requireAuth(), req.params.channelId),
  );

  typed.post('/channels/:channelId/mute', { schema: { ...catalog, summary: 'Mute this channel (until+tomorrow default)', params: channelParams, body: muteBody } }, async (req) => {
    const actor = req.requireAuth();
    const until = req.body.until ? new Date(req.body.until) : new Date(Date.now() + 86_400_000);
    return channelsService.muteSelf(actor.userId, req.params.channelId, until);
  });

  typed.delete('/channels/:channelId/mute', { schema: { ...catalog, summary: 'Unmute this channel', params: channelParams } }, async (req) => {
    const actor = req.requireAuth();
    return channelsService.muteSelf(actor.userId, req.params.channelId, null);
  });

  typed.get('/channels/:channelId/stats', { schema: { ...catalog, summary: 'Channel usage stats', params: channelParams, querystring: statsQuery } }, async (req) =>
    channelsService.channelStats(req.requireAuth(), req.params.channelId, req.query.days ?? 7),
  );

  // --- Channel members ----------------------------------------------------------
  typed.get('/channels/:channelId/members', { schema: { ...catalog, summary: 'Channel members', params: channelParams } }, async (req) =>
    channelsService.listMembers(req.requireAuth(), req.params.channelId),
  );

  typed.patch('/channels/:channelId/members/:userId', { schema: { ...catalog, summary: 'Role / per-channel permissions / mute (owner)', params: channelMemberParams, body: updateChannelMemberBody } }, async (req) => {
    const actor = req.requireAuth();
    const mutedUntil =
      req.body.mutedUntil === undefined ? undefined : req.body.mutedUntil === null ? null : new Date(req.body.mutedUntil);
    const input = { ...req.body, mutedUntil };
    return channelsService.updateMember(actor, req.params.channelId, req.params.userId, input);
  });

  typed.delete('/channels/:channelId/members/:userId', { schema: { ...catalog, summary: 'Remove from channel (owner)', params: channelMemberParams } }, async (req) =>
    channelsService.removeMember(req.requireAuth(), req.params.channelId, req.params.userId),
  );

  // --- Invites -------------------------------------------------------------------
  typed.post('/workspaces/:workspaceId/invites', { schema: { ...inviteCatalog, summary: 'Create an invite link with QR', params: workspaceParams, body: createInviteBody } }, async (req) =>
    channelsService.createInvite(req.requireAuth(), req.params.workspaceId, req.body),
  );

  typed.get('/workspaces/:workspaceId/invites', { schema: { ...inviteCatalog, summary: 'List active invites', params: workspaceParams } }, async (req) =>
    channelsService.listInvites(req.requireAuth(), req.params.workspaceId),
  );

  typed.delete('/workspaces/:workspaceId/invites/:code', { schema: { ...inviteCatalog, summary: 'Revoke an invite', params: workspaceParams.extend({ code: inviteParams.shape.code }) } }, async (req) =>
    channelsService.revokeInvite(req.requireAuth(), req.params.workspaceId, req.params.code),
  );

  typed.get('/invites/:code', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: { tags: ['invites'], summary: 'Public invite preview (no auth), deep-link target', params: inviteParams },
  }, async (req) => channelsService.peekInvite(req.params.code));

  typed.post('/invites/redeem', { schema: { ...inviteCatalog, summary: 'Join a workspace with an invite code', body: redeemBody } }, async (req) =>
    channelsService.redeemInvite(req.requireAuth(), req.body.code),
  );

  // Deep-link friendly alias: ptt://invite/<code> -> GET /invites/<code>?via=...
  typed.get('/i/:code', { schema: { tags: ['invites'], summary: 'Web deep link for invites', params: inviteParams } }, async (req) => {
    const info = await channelsService.peekInvite(req.params.code);
    return info;
  });

  return app;
}