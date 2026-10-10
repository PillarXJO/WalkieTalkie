import { pubSubClient } from './redis.js';

export const SERVER_EVENTS_CHANNEL = 'ws';
export const PRESENCE_EVENTS_CHANNEL = 'presence';

interface ChannelEvent {
  at: string;
  /** Channels whose member connections should receive this event. */
  channelId?: string;
  /** Workspace whose connections should receive this event. */
  workspaceId?: string;
  data: unknown;
}

export type ServerEvent =
  | ({ type: 'presence'; userId: string; status: string; statusMessage: string } & ChannelEvent)
  | ({ type: 'floor.state' | 'transmission.complete' | 'transmission.echo' } & ChannelEvent)
  | ({ type: 'alert.created' | 'alert.acknowledged' | 'alert.resolved' } & ChannelEvent);

/**
 * Publish a server event onto the shared Redis channel. The WebSocket
 * gateway subscribes to this channel and routes events to the connected
 * sockets of members of the target channel/workspace.
 */
export async function publishServerEvent(event: Extract<ServerEvent, { type: Exclude<ServerEvent['type'], 'presence'> }>): Promise<void> {
  const pub = pubSubClient();
  try {
    await pub.publish(SERVER_EVENTS_CHANNEL, JSON.stringify(event));
  } finally {
    pub.disconnect();
  }
}