/**
 * Seeder — demo workspace with echo bot, channels, users, transmissions and
 * location history. Idempotent: safe to run repeatedly (`npm run db:seed`).
 *
 * Works against either Postgres (DATABASE_URL) or SQLite
 * (SQLITE_DATABASE_URL + --schema prisma/sqlite/schema.prisma) because the
 * schema is provider-portable.
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/password.js';
import { serializeJson } from '../src/lib/json.js';

const prisma = new PrismaClient();
const DEMO_PASSWORD = 'DemoPass123!';

interface UserSeed {
  email: string;
  name: string;
  role: 'admin' | 'dispatcher' | 'member';
  status: 'online' | 'busy' | 'away' | 'offline';
  statusMessage?: string;
  isBot?: boolean;
  ghostMode?: boolean;
  lastSeenDaysAgo?: number;
}

const USERS: UserSeed[] = [
  { email: 'admin@ptt.demo', name: 'Ava Controller', role: 'admin', status: 'online', statusMessage: 'Shift lead' },
  { email: 'dispatcher@ptt.demo', name: 'Dana Dispatch', role: 'dispatcher', status: 'busy', statusMessage: 'Handling traffic' },
  { email: 'field@ptt.demo', name: 'Ford Field', role: 'member', status: 'online', statusMessage: 'Out on route 7' },
  { email: 'sam@ptt.demo', name: 'Sam Radio', role: 'member', status: 'away', statusMessage: 'On break till 11' },
  { email: 'jordan@ptt.demo', name: 'Jordan Wave', role: 'member', status: 'online' },
  { email: 'riley@ptt.demo', name: 'Riley Vox', role: 'member', status: 'offline', lastSeenDaysAgo: 1 },
  { email: 'taylor@ptt.demo', name: 'Taylor Mic', role: 'member', status: 'online', statusMessage: 'Unit 42' },
  { email: 'morgan@ptt.demo', name: 'Morgan PTT', role: 'dispatcher', status: 'busy', statusMessage: 'Night dispatch' },
  { email: 'echo@ptt.demo', name: 'Echo Bot', role: 'member', status: 'online', isBot: true },
];

interface ChannelSeed {
  name: string;
  description?: string;
  type: 'channel' | 'echo' | 'broadcast';
  isDefault?: boolean;
}

const CHANNELS: ChannelSeed[] = [
  { name: 'Everyone', description: 'Default channel', type: 'channel', isDefault: true },
  { name: 'Operations', description: 'Day-to-day ops', type: 'channel' },
  { name: 'Emergency Broadcast', description: 'Emergency + panic alerts', type: 'broadcast' },
  { name: 'Echo', description: 'Cross-talk test channel (echo bot replays)', type: 'echo' },
  { name: 'Maintenance', description: 'Facilities and maintenance crew', type: 'channel' },
];

const TALKERS: Array<[channelIndex: number, userIndex: number]> = [
  [0, 0], [0, 2], [0, 4], [0, 7], [0, 6],
  [1, 3], [1, 5], [1, 4], [1, 2],
  [3, 2], [3, 3], [3, 6], [3, 4], [3, 8], [3, 0],
  [4, 5], [4, 3], [4, 6],
];

const LOCATION_PINS: Array<[lat: number, lng: number, label: string]> = [
  [37.7749, -122.4194, 'SF downtown'],
  [37.7915, -122.3929, 'North Beach'],
  [37.7581, -122.4186, 'Mission'],
  [37.7806, -122.3999, 'SOMA'],
  [37.7626, -122.4099, 'Noe Valley'],
];

function daysAgo(days: number, minuteOfDay: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, (minuteOfDay * 7) % 60, 0);
  return d;
}

async function main(): Promise<void> {
  console.log('Seeding PTT demo workspace…');

  // Workspace (idempotent by fixed id).
  const workspace = await prisma.workspace.upsert({
    where: { id: 'ws_demo' },
    create: { id: 'ws_demo', name: 'Demo Dispatch', settings: serializeJson({ retentionDays: 30 }) },
    update: { name: 'Demo Dispatch' },
  });

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const userIds: Record<string, string> = {};
  for (const u of USERS) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      create: {
        email: u.email,
        name: u.name,
        passwordHash,
        status: u.status,
        statusMessage: u.statusMessage ?? '',
        ghostMode: u.ghostMode ?? false,
        isBot: u.isBot ?? false,
        lastSeenAt: u.lastSeenDaysAgo ? daysAgo(u.lastSeenDaysAgo, 480) : new Date(),
      },
      update: { name: u.name, status: u.status, statusMessage: u.statusMessage ?? '', isBot: u.isBot ?? false },
    });
    userIds[u.email] = user.id;
  }

  // Memberships.
  for (const u of USERS) {
    await prisma.membership.upsert({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: userIds[u.email]! } },
      create: { workspaceId: workspace.id, userId: userIds[u.email]!, role: u.role },
      update: { role: u.role },
    });
  }

  for (const u of USERS) {
    if (workspace.ownerId === null && !u.isBot) {
      await prisma.workspace.update({ where: { id: workspace.id }, data: { ownerId: userIds[u.email]! } });
      break;
    }
  }

  // Channels.
  const channelByIndex: string[] = [];
  for (let i = 0; i < CHANNELS.length; i++) {
    const c = CHANNELS[i]!;
    const channel = await prisma.channel.upsert({
      where: { id: `ch_${i}` },
      create: {
        id: `ch_${i}`,
        workspaceId: workspace.id,
        name: c.name,
        description: c.description,
        type: c.type,
        isDefault: c.isDefault ?? false,
        createdById: userIds['admin@ptt.demo'],
      },
      update: { name: c.name },
    });
    channelByIndex[i] = channel.id;
  }

  if (workspace.defaultChannelId === null) {
    await prisma.workspace.update({ where: { id: workspace.id }, data: { defaultChannelId: channelByIndex[0] } });
  }

  // Join every user to default + echo channels; spread users across the rest.
  for (let i = 0; i < USERS.length; i++) {
    const uid = userIds[USERS[i]!.email]!;
    await prisma.channelMember.upsert({
      where: { channelId_userId: { channelId: channelByIndex[0]!, userId: uid } },
      create: { channelId: channelByIndex[0]!, userId: uid },
      update: {},
    });
    if (USERS[i]!.isBot) {
      await prisma.channelMember.upsert({
        where: { channelId_userId: { channelId: channelByIndex[3]!, userId: uid } },
        create: { channelId: channelByIndex[3]!, userId: uid },
        update: {},
      });
    }
    for (let c = 1; c < CHANNELS.length; c++) {
      if (USERS[i]!.isBot) continue;
      if ((i + c) % 3 === 0) {
        await prisma.channelMember.upsert({
          where: { channelId_userId: { channelId: channelByIndex[c]!, userId: uid } },
          create: { channelId: channelByIndex[c]!, userId: uid },
          update: {},
        });
      }
    }
  }

  // Transmissions (mark some with fake audio keys for signed-URL flows).
  const existing = await prisma.transmission.count({ where: { workspaceId: workspace.id } });
  if (existing === 0) {
    let n = 0;
    for (let t = 0; t < 42; t++) {
      const [ci, ui] = TALKERS[t % TALKERS.length]!;
      const channelId = channelByIndex[ci]!;
      const userId = userIds[USERS[ui]!.email]!;
      const startedAt = daysAgo(t % 14, (t * 37) % 1440);
      const durationMs = 4_000 + ((t * 911) % 25_000);
      await prisma.transmission.create({
        data: {
          workspaceId: workspace.id,
          channelId,
          userId,
          startedAt,
          durationMs,
          status: 'complete',
          listeners: 2 + (t % 5),
          // ~1 in 3 carry a recorded clip for replay testing
          audioKey: t % 3 === 0 ? `demo/${workspace.id}/${new Date(startedAt).toISOString().replace(/[:.]/g, '-')}.ogg` : null,
          sizeBytes: t % 3 === 0 ? Math.round(durationMs * 8 * 1024) / 1000 : null,
        },
      });
      n++;
    }
    console.log(`  created ${n} transmissions`);
  }

  // Location history.
  for (let i = 1; i < USERS.length - 1; i++) {
    const uid = userIds[USERS[i]!.email]!;
    const [lat, lng] = LOCATION_PINS[i % LOCATION_PINS.length]!;
    await prisma.locationPing.upsert({
      where: { id: `loc_${i}` },
      create: {
        id: `loc_${i}`,
        userId: uid,
        workspaceId: workspace.id,
        latitude: lat + i * 0.003,
        longitude: lng - i * 0.002,
        accuracy: 12,
        source: 'whileUsing',
        at: new Date(Date.now() - i * 17 * 60_000),
      },
      update: {},
    });
  }

  // A couple of invites.
  await prisma.invite.upsert({
    where: { code: 'pttecho01' },
    create: { code: 'pttecho01', workspaceId: workspace.id, createdById: userIds['admin@ptt.demo'], role: 'member', maxUses: 10 },
    update: {},
  });

  console.log('Seed complete. Demo login: admin@ptt.demo / DemoPass123!');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });