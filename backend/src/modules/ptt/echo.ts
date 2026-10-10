import { hashPassword } from '../../lib/password.js';
import { prisma } from '../../lib/prisma.js';
import type { Db } from '../../repositories/types.js';

export const ECHO_BOT_EMAIL = 'echo@ptt.local';

/**
 * The echo bot is a system user that "answers" transmissions sent on echo
 * channels (used to test your own audio locally without another participant).
 * It is lazily created on first use and reused across workspaces.
 */
export async function ensureEchoBot(db: Db = prisma()) {
  const existing = await db.user.findFirst({ where: { email: ECHO_BOT_EMAIL } });
  if (existing) return existing;
  const hash = await hashPassword(Math.random().toString(36).slice(2) + Date.now());
  return db.user.create({
    data: {
      email: ECHO_BOT_EMAIL,
      name: 'Echo Bot',
      isBot: true,
      status: 'online',
      statusMessage: 'PTT echo channel',
      passwordHash: hash,
    },
  });
}