import type { Redis } from 'ioredis';
import type { FastifyRequest } from 'fastify';
import { WebSocket } from 'ws';
import { AppError } from '../../lib/errors.js';
import { setPresence } from '../../lib/presence.js';
import { pubSubClient } from '../../lib/redis.js';
import { PRESENCE_EVENTS_CHANNEL, SERVER_EVENTS_CHANNEL, type ServerEvent } from '../../lib/server-events.js';
import { channelMemberRepo } from '../../repositories/channel-member.repo.js';
import { workspaceRepo } from '../../repositories/workspace.repo.js';
import { resolveAccessActor } from '../../plugins/auth.js';
import { floorService } from './floor.js';

interface SocketContext {
  socket: WebSocket;
  userId: string;
  channelIds: Set<string>;
  workspaceIds: Set<string>;
}

const contexts = new Map<WebSocket, SocketContext>();

let relay: Promise<void> | null = null;

function send(socket: WebSocket, payload: unknown) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function routeEvent(ctx: SocketContext, event: ServerEvent): boolean {
  if (event.channelId && ctx.channelIds.has(event.channelId)) return true;
  if (event.workspaceId && ctx.workspaceIds.has(event.workspaceId)) return true;
  return false;
}

async function workspaceIdsOf(userId: string): Promise<Set<string>> {
  const rows = await workspaceRepo.listForUser(userId);
  return new Set(rows.map((w) => w.id));
}

async function fanOut(event: ServerEvent) {
  if (event.type === 'presence') {
    const userWorkspaces = await workspaceIdsOf(event.userId);
    for (const ctx of contexts.values()) {
      if (ctx.userId === event.userId) {
        send(ctx.socket, event);
        continue;
      }
      if ([...userWorkspaces].some((id) => ctx.workspaceIds.has(id))) {
        send(ctx.socket, event);
      }
    }
    return;
  }
  for (const ctx of contexts.values()) {
    if (routeEvent(ctx, event)) send(ctx.socket, event);
  }
}

/** Subscribe once per process; every connection funnels into the same relay. */
function ensureRelay(): Promise<void> {
  if (relay) return relay;
  relay = (async () => {
    const sub: Redis = pubSubClient();
    for (const channel of [PRESENCE_EVENTS_CHANNEL, SERVER_EVENTS_CHANNEL]) {
      await sub.subscribe(channel);
    }
    sub.on('message', (channel: string, raw: string) => {
      let event: ServerEvent;
      try {
        event = JSON.parse(raw) as ServerEvent;
      } catch {
        return;
      }
      // Presence payloads are published without a `type` field; tag them so
      // clients can route the event. Non-presence events already carry `type`.
      if (channel === PRESENCE_EVENTS_CHANNEL) {
        event = { ...event, type: 'presence' } as ServerEvent;
      }
      void fanOut(event).catch((err) => {
        process.emitWarning(`ws relay: ${err.message}`);
      });
    });
  })();
  return relay;
}

function errClose(socket: WebSocket, message: string) {
  try {
    socket.close(1008, message);
  } catch {
    // already closing
  }
}

export async function handleSocket(socket: WebSocket, request: FastifyRequest) {
  const token = (request.query as Record<string, string | undefined>)?.token;
  if (!token) return errClose(socket, 'missing token');

  let actor;
  try {
    actor = await resolveAccessActor(token);
  } catch {
    return errClose(socket, 'unauthorized');
  }

  const memberships = await channelMemberRepo.listForUser(actor.userId);
  const channels = memberships
    .filter((m) => m.channelId)
    .map((m) => m.channelId);
  const workspaces = await workspaceIdsOf(actor.userId);

  const ctx: SocketContext = {
    socket,
    userId: actor.userId,
    channelIds: new Set(channels),
    workspaceIds: workspaces,
  };
  contexts.set(socket, ctx);
  await ensureRelay();

  // Initial snapshot: current state of every subscribed channel's floor.
  const snapshots = await Promise.all(
    [...ctx.channelIds].map(async (channelId) => {
      try {
        return { channelId, state: await floorService.get(channelId) };
      } catch {
        return { channelId, state: null };
      }
    }),
  );
  send(socket, { type: 'init', at: new Date().toISOString(), data: { userId: actor.userId, floors: snapshots } });

  socket.on('message', (raw) => {
    void (async () => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        return send(socket, { type: 'error', data: { message: 'invalid JSON' } });
      }

      switch (msg.type) {
        case 'ping':
          return send(socket, { type: 'pong', at: new Date().toISOString() });
        case 'presence:set': {
          const status = msg.status as string;
          const statusMessage = (msg.statusMessage as string | undefined) ?? '';
          try {
            await setPresence(actor.userId, { status: status as never, statusMessage });
          } catch (err) {
            return send(socket, { type: 'error', data: { message: err instanceof Error ? err.message : 'presence failed' } });
          }
          return;
        }
        case 'floor:request': {
          const channelId = msg.channelId as string;
          const priority = (msg.priority as string) || 'normal';
          if (!channelId) return send(socket, { type: 'error', data: { message: 'channelId required' } });
          try {
            const state = await floorService.request(actor, channelId, priority as never);
            return send(socket, { type: 'floor.granted', at: new Date().toISOString(), channelId, data: { state } });
          } catch (err) {
            return send(socket, {
              type: 'error',
              channelId,
              data: { message: err instanceof Error ? err.message : 'floor request failed', code: err instanceof AppError ? err.code : 'internal_error' },
            });
          }
        }
        case 'floor:release': {
          const channelId = msg.channelId as string;
          if (!channelId) return send(socket, { type: 'error', data: { message: 'channelId required' } });
          try {
            await floorService.release(actor, channelId);
            return send(socket, { type: 'floor.released', at: new Date().toISOString(), channelId, data: { ok: true } });
          } catch (err) {
            return send(socket, {
              type: 'error',
              channelId,
              data: { message: err instanceof Error ? err.message : 'floor release failed', code: err instanceof AppError ? err.code : 'internal_error' },
            });
          }
        }
        default:
          return send(socket, { type: 'error', data: { message: `unknown message type: ${String(msg.type ?? '')}` } });
      }
    })().catch((err) => {
      send(socket, { type: 'error', data: { message: err instanceof Error ? err.message : 'handler error' } });
    });
  });

  socket.on('close', () => {
    contexts.delete(socket);
  });
  socket.on('error', () => {
    contexts.delete(socket);
  });
}