import { AccessToken } from 'livekit-server-sdk';
import { env } from '../../config/env.js';

export interface LiveKitJoinInfo {
  token: string;
  url: string;
  room: string;
  participant: string;
  ttlSeconds: number;
}

export interface FastRoomMeta {
  userId: string;
  workspaceId: string;
  channelId: string;
  name: string;
  workspaceRole: string;
  isEcho: boolean;
}

export const LIVEKIT_TTL_SECONDS = 6 * 3600;

/** LiveKit room names allow `-`, `_` and alphanumerics only. */
export function roomName(workspaceId: string, channelId: string): string {
  return `ptt-${workspaceId}-${channelId}`.replace(/[^a-zA-Z0-9_-]/g, '-');
}

/**
 * Mint a participant token for a channel room.
 * Returns `null` when LiveKit is disabled by configuration.
 */
export async function mintLiveKitToken(identity: string, room: string, meta: FastRoomMeta): Promise<LiveKitJoinInfo | null> {
  if (!env.LIVEKIT_ENABLED) return null;
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, { identity, ttl: `${LIVEKIT_TTL_SECONDS}s` });
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: false });
  at.metadata = JSON.stringify(meta);
  return {
    token: await at.toJwt(),
    url: env.LIVEKIT_URL,
    room,
    participant: identity,
    ttlSeconds: LIVEKIT_TTL_SECONDS,
  };
}