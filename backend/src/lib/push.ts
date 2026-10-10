import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export interface PushMessage {
  /** Expo push token (ExponentPushToken[...]) or native device token. */
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  priority?: 'default' | 'normal' | 'high';
  channelId?: string;
  badge?: number;
  /** Native FCM/APNs-specific payload passthrough. */
  extra?: Record<string, unknown>;
}

export interface PushTicket {
  id?: string;
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

export interface PushTransport {
  send(messages: PushMessage[]): Promise<PushTicket[]>;
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Default transport: Expo's push service. Batches ≤100 messages per request. */
class ExpoPushTransport implements PushTransport {
  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    const tickets: PushTicket[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100).map((m) => ({
        to: m.to,
        title: m.title,
        body: m.body,
        data: m.data,
        sound: m.sound === undefined ? 'default' : m.sound,
        priority: m.priority,
        channelId: m.channelId,
        badge: m.badge,
        ...(m.extra ?? {}),
      }));
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'accept-encoding': 'gzip, deflate',
          'content-type': 'application/json',
          ...(env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Expo push failed (${res.status}): ${text.slice(0, 200)}`);
      }
      const json = (await res.json()) as { data?: PushTicket[] };
      tickets.push(...(json.data ?? []));
    }
    return tickets;
  }
}

let transport: PushTransport = new ExpoPushTransport();

/** Swap the transport (tests can inject an in-memory recorder). */
export function setPushTransport(next: PushTransport): void {
  transport = next;
}

export function resetPushTransport(): void {
  transport = new ExpoPushTransport();
}

export function pushEnabled(): boolean {
  return env.PUSH_ENABLED;
}

export interface PushSendResult {
  attempted: number;
  ok: number;
  failed: number;
  errors: Array<{ token: string; error: string }>;
  /** Tokens Expo reported as unregistered — callers should prune them. */
  unregistered: string[];
}

/**
 * Send messages and classify tickets. Never throws: a push outage must not
 * break the request that triggered it.
 */
export async function sendPush(messages: PushMessage[]): Promise<PushSendResult> {
  const result: PushSendResult = { attempted: messages.length, ok: 0, failed: 0, errors: [], unregistered: [] };
  if (!env.PUSH_ENABLED || messages.length === 0) return result;

  try {
    const tickets = await transport.send(messages);
    tickets.forEach((ticket, idx) => {
      const msg = messages[idx];
      if (ticket.status === 'ok') {
        result.ok += 1;
        return;
      }
      result.failed += 1;
      const err = ticket.details?.error ?? ticket.message ?? 'unknown';
      if (msg) result.errors.push({ token: msg.to, error: err });
      if (err === 'DeviceNotRegistered' && msg) result.unregistered.push(msg.to);
    });
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'push send failed');
    result.failed = messages.length;
  }
  return result;
}