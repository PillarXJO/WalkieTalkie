import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError } from '../../lib/errors.js';
import { userRepo } from '../../repositories/user.repo.js';
import { channelMemberRepo } from '../../repositories/channel-member.repo.js';
import { channelRepo } from '../../repositories/channel.repo.js';
import { membershipPermissions } from '../workspaces/service.js';
import { floorParams, floorRequestBody, pttTokenQuery } from './schema.js';
import { floorService } from './floor.js';
import { mintLiveKitToken, roomName } from './livekit.js';
import { handleSocket } from './ws.js';

export async function pttRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const catalog = { tags: ['ptt'], security: [{ bearerAuth: [] }] as const };

  // --- LiveKit participant token ------------------------------------------------
  typed.post(
    '/channels/:channelId/ptt-token',
    {
      schema: { ...catalog, summary: 'Mint a LiveKit participant token for a channel room', params: floorParams, querystring: pttTokenQuery },
    },
    async (req) => {
      const actor = req.requireAuth();
      const channel = await channelRepo.findById(req.params.channelId);
      if (!channel) throw AppError.notFound('Channel not found');

      const perms = await membershipPermissions(actor.userId, channel.workspaceId);
      if (!perms) throw AppError.forbidden('You are not a member of this workspace');
      const membership = await channelMemberRepo.findByChannelAndUser(channel.id, actor.userId);
      if (!membership) throw AppError.forbidden('You are not a member of this channel');
      if (membership.isMuted || (membership.mutedUntil && membership.mutedUntil > new Date())) {
        throw AppError.forbidden('You are muted in this channel');
      }

      const user = await userRepo.findById(actor.userId);
      const identity = req.query.identity ?? actor.userId;
      const join = await mintLiveKitToken(identity, roomName(channel.workspaceId, channel.id), {
        userId: actor.userId,
        workspaceId: channel.workspaceId,
        channelId: channel.id,
        name: user?.name ?? 'PTT user',
        workspaceRole: perms.role,
        isEcho: channel.type === 'echo',
      });
      if (!join) throw AppError.unavailable('LiveKit is not enabled on this deployment');
      return join;
    },
  );

  // --- Floor control (HTTP fallback; the gateway handles the WS path) ------------
  typed.get('/channels/:channelId/floor', { schema: { ...catalog, summary: 'Current floor state', params: floorParams } }, async (req) => {
    const actor = req.requireAuth();
    const channel = await channelRepo.findById(req.params.channelId);
    if (!channel) throw AppError.notFound('Channel not found');
    const perms = await membershipPermissions(actor.userId, channel.workspaceId);
    if (!perms) throw AppError.forbidden('You are not a member of this workspace');
    const state = await floorService.get(req.params.channelId);
    return { floor: state };
  });

  typed.post('/channels/:channelId/floor/request', {
    schema: { ...catalog, summary: 'Request (or preempt) the floor', params: floorParams, body: floorRequestBody },
  }, async (req) => {
    const actor = req.requireAuth();
    const state = await floorService.request(actor, req.params.channelId, req.body.priority ?? 'normal');
    return { floor: state };
  });

  typed.post('/channels/:channelId/floor/release', { schema: { ...catalog, summary: 'Release the floor', params: floorParams } }, async (req) => {
    const actor = req.requireAuth();
    return floorService.release(actor, req.params.channelId);
  });

  // --- WebSocket gateway ----------------------------------------------------------
  typed.get('/ws', { websocket: true, schema: { hide: true } }, (socket, request) => {
    void handleSocket(socket, request);
  });

  return app;
}