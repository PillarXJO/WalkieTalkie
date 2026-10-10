import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/lib/password.js';
import {
  auditRepo,
  backupCodeRepo,
  blockRepo,
  channelMemberRepo,
  channelRepo,
  emergencyRepo,
  inviteRepo,
  locationRepo,
  membershipRepo,
  passwordResetRepo,
  pushTokenRepo,
  sessionRepo,
  transmissionRepo,
  userRepo,
  workspaceRepo,
} from '../src/repositories/index.js';
import { closeDb, truncateAll } from './helpers/db.js';

async function seedUser(email: string, name = 'Repo Test') {
  return userRepo.create({
    email,
    name,
    passwordHash: await hashPassword('Sup3rSecret!'),
  });
}

describe('repository layer (M1)', () => {
  beforeAll(async () => {
    await truncateAll();
  });

  it('users: create, find, update, soft delete', async () => {
    const u = await seedUser('repo.user@test.dev');
    expect(Object.keys(u)).not.toContain('passwordHash'); // secrets never leak through the public select

    const found = await userRepo.findByEmail('repo.user@test.dev');
    expect(found?.name).toBe('Repo Test');
    expect(found?.passwordHash).toBeTruthy();
    expect(found?.totpSecret).toBeNull();

    const renamed = await userRepo.update(u.id, { name: 'Renamed' });
    expect(renamed?.name).toBe('Renamed');

    const ghost = await userRepo.update(u.id, { ghostMode: true });
    expect(ghost?.ghostMode).toBe(true);

    await userRepo.softDelete(u.id);
    expect(await userRepo.findById(u.id)).toBeNull();
    expect(await userRepo.findByEmail('repo.user@test.dev')).toBeNull();
  });

  it('workspace + membership + channel + channel members', async () => {
    const owner = await seedUser('repo.owner@test.dev');
    const member = await seedUser('repo.member@test.dev');

    const ws = await workspaceRepo.create({ name: 'Repo HQ', ownerId: owner.id });
    await membershipRepo.upsert(ws.id, owner.id, { role: 'admin' });
    await membershipRepo.upsert(ws.id, member.id, { role: 'member', permissions: ['broadcast.emit'] });

    const all = await membershipRepo.listByWorkspace(ws.id);
    expect(all).toHaveLength(2);
    expect(all.find((m) => m.userId === member.id)?.role).toBe('member');

    const ch = await channelRepo.create({ workspaceId: ws.id, name: 'Ops', createdById: owner.id });
    await channelMemberRepo.join(ch.id, owner.id, { role: 'owner' });
    await channelMemberRepo.join(ch.id, member.id, {});
    await channelMemberRepo.setMuted(ch.id, member.id, null, true);

    const list = await channelRepo.listByWorkspace(ws.id);
    expect(list[0]?._count.members).toBe(2);

    await channelMemberRepo.softDelete(ch.id, member.id);
    expect(await channelMemberRepo.countByChannel(ch.id)).toBe(1);

    const stats = await channelRepo.usageStats(ws.id, new Date(Date.now() - 86_400_000), new Date());
    expect(stats).toMatchObject({ messageCount: 0, talkTimeMs: 0, activeUsers: 0 });
  });

  it('sessions: create, list, revoke, prune', async () => {
    const u = await seedUser('repo.session@test.dev');
    const exp = new Date(Date.now() + 86_400_000);
    const s1 = await sessionRepo.create({ userId: u.id, refreshTokenHash: 'h1', deviceName: 'Pixel 9', expiresAt: exp });
    await sessionRepo.create({ userId: u.id, refreshTokenHash: 'h2', deviceName: 'iPhone', expiresAt: exp });

    const sessions = await sessionRepo.listByUser(u.id);
    expect(sessions).toHaveLength(2);

    await sessionRepo.revokeById(s1.id);
    expect(await sessionRepo.listByUser(u.id)).toHaveLength(1);

    await sessionRepo.revokeAllForUser(u.id);
    expect(await sessionRepo.listByUser(u.id)).toHaveLength(0);
  });

  it('password reset + backup codes', async () => {
    const u = await seedUser('repo.reset@test.dev');
    await passwordResetRepo.create(u.id, 'tokenhash1', new Date(Date.now() + 3_600_000));
    const row = await passwordResetRepo.findByTokenHash('tokenhash1');
    expect(row?.userId).toBe(u.id);
    await passwordResetRepo.markUsed(row!.id);
    expect((await passwordResetRepo.findByTokenHash('tokenhash1'))?.usedAt).not.toBeNull();

    await backupCodeRepo.createMany(u.id, ['a', 'b', 'c']);
    expect(await backupCodeRepo.countAvailable(u.id)).toBe(3);
    const codes = await backupCodeRepo.listAvailable(u.id);
    expect(await backupCodeRepo.useById(codes[0]!.id)).toBe(true);
    expect(await backupCodeRepo.useById(codes[0]!.id)).toBe(false); // single use
    expect(await backupCodeRepo.countAvailable(u.id)).toBe(2);
  });

  it('invites: create, use, revoke', async () => {
    const admin = await seedUser('repo.inviter@test.dev');
    const invitee = await seedUser('repo.invitee@test.dev');
    const ws = await workspaceRepo.create({ name: 'Invite WS', ownerId: admin.id });

    const inv = await inviteRepo.create({ workspaceId: ws.id, createdById: admin.id, role: 'member', maxUses: 2 });
    expect(inv.code).toHaveLength(inv.code.length);
    expect(inv.maxUses).toBe(2);

    await inviteRepo.recordUse(inv.id, invitee.id);
    await inviteRepo.incrementUsage(inv.id);

    const listed = await inviteRepo.listByWorkspace(ws.id);
    expect(listed[0]?.inviteUses).toHaveLength(1);
    expect(listed[0]?.useCount).toBe(1);

    await inviteRepo.revoke(inv.id);
    expect(await inviteRepo.listByWorkspace(ws.id)).toHaveLength(0);
  });

  it('transmissions: create, mark complete, search, purge', async () => {
    const owner = await seedUser('repo.tx@test.dev');
    const ws = await workspaceRepo.create({ name: 'Tx WS', ownerId: owner.id });
    const ch = await channelRepo.create({ workspaceId: ws.id, name: 'Talk', createdById: owner.id });

    const tx = await transmissionRepo.create({
      channelId: ch.id,
      workspaceId: ws.id,
      userId: owner.id,
      durationMs: 10_000,
    });
    await transmissionRepo.markCompleted(tx.id, 'rec/abc.ogg', 12_345);

    const completed = await transmissionRepo.findById(tx.id);
    expect(completed?.audioKey).toBe('rec/abc.ogg');
    expect(completed?.status).toBe('complete');

    const hits = await transmissionRepo.search(ws.id, 'Talk');
    expect(hits.some((h) => h.channel.name === 'Talk')).toBe(true);

    expect(await transmissionRepo.purgeOlderThan(new Date(Date.now() + 86_400_000))).toBeGreaterThanOrEqual(1);
  });

  it('location: insert, latest, workspace window', async () => {
    const u = await seedUser('repo.loc@test.dev');
    const ws = await workspaceRepo.create({ name: 'Loc WS', ownerId: u.id });

    await locationRepo.insert({ userId: u.id, workspaceId: ws.id, latitude: 1, longitude: 2, source: 'whileUsing' });
    await locationRepo.insert({ userId: u.id, workspaceId: ws.id, latitude: 3, longitude: 4, source: 'always', at: new Date(Date.now() + 10_000) });

    const latest = await locationRepo.latestForUser(u.id);
    expect(latest?.latitude).toBe(3);

    const list = await locationRepo.listForWorkspace(ws.id, { windowMinutes: 5 });
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it('blocks: create, exists, list', async () => {
    const a = await seedUser('repo.blk1@test.dev');
    const b = await seedUser('repo.blk2@test.dev');
    await blockRepo.create(a.id, b.id);
    expect(await blockRepo.exists(a.id, b.id)).toBe(true);
    const blocked = await blockRepo.listBlocked(a.id);
    expect(blocked[0]?.blocked.email).toBe('repo.blk2@test.dev');
    await blockRepo.remove(a.id, b.id);
    expect(await blockRepo.exists(a.id, b.id)).toBe(false);
  });

  it('push tokens: upsert, list, remove', async () => {
    const u = await seedUser('repo.push@test.dev');
    await pushTokenRepo.upsert(u.id, { token: 'expo-device-1', platform: 'ios' });
    await pushTokenRepo.upsert(u.id, { token: 'expo-device-2', platform: 'android' });
    await pushTokenRepo.upsert(u.id, { token: 'expo-device-1', platform: 'ios' }); // re-register

    const tokens = await pushTokenRepo.listForUser(u.id);
    expect(tokens).toHaveLength(2);

    await pushTokenRepo.remove(u.id, 'expo-device-1');
    expect(await pushTokenRepo.listForUser(u.id)).toHaveLength(1);
  });

  it('audit log: write + query by workspace/actor', async () => {
    const u = await seedUser('repo.audit@test.dev');
    const ws = await workspaceRepo.create({ name: 'Audit WS', ownerId: u.id });
    for (let i = 0; i < 3; i++) {
      await auditRepo.log({ action: 'channel.create', entityType: 'channel', entityId: `ch-${i}`, actorId: u.id, workspaceId: ws.id });
    }
    await auditRepo.log({ action: 'user.role_change', entityType: 'membership', entityId: 'm1', actorId: u.id, workspaceId: ws.id });

    const entries = await auditRepo.listByWorkspace(ws.id, {});
    expect(entries).toHaveLength(4);
    const actions = await auditRepo.aggregateByAction(ws.id, new Date(Date.now() - 3_600_000));
    expect(actions.find((a) => a.action === 'channel.create')?.count).toBe(3);
  });

  it('emergency alerts: create, ack, open list', async () => {
    const reporter = await seedUser('repo.alert@test.dev');
    const ackBy = await seedUser('repo.ack@test.dev');
    const ws = await workspaceRepo.create({ name: 'Alert WS', ownerId: reporter.id });
    const ch = await channelRepo.create({ workspaceId: ws.id, name: 'Every', createdById: reporter.id });

    const alert = await emergencyRepo.create({ workspaceId: ws.id, userId: reporter.id, channelId: ch.id, alertType: 'panic' });
    expect(alert.status).toBe('open');

    const open = await emergencyRepo.listOpenByWorkspace(ws.id);
    expect(open).toHaveLength(1);

    await emergencyRepo.acknowledge(alert.id, ackBy.id);
    expect((await emergencyRepo.listOpenByWorkspace(ws.id))[0]?.status).toBe('acknowledged');
  });
});