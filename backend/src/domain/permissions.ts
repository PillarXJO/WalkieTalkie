/**
 * Domain constants shared by repository layer, services and API contracts.
 * Role strings + permission flags are stored in the database as strings/JSON
 * so the portable (Postgres/SQLite) schema stays free of enums.
 */

export const ROLES = ['admin', 'dispatcher', 'member'] as const;
export type Role = (typeof ROLES)[number];

export const PRESENCE = ['online', 'busy', 'away', 'offline'] as const;
export type Presence = (typeof PRESENCE)[number];

export const CHANNEL_TYPES = ['channel', 'echo', 'broadcast'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const PERMISSIONS = [
  'channel.create',
  'channel.manage',
  'channel.delete',
  'channel.broadcast',
  'channel.session_expire',
  'channel.view_history',
  'member.invite',
  'member.manage',
  'member.remove',
  'location.view',
  'broadcast.emit',
  'emergency.trigger',
  'emergency.ack',
  'admin.stats',
  'admin.audit',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Role → default permission set. Workspace admins are granted everything. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,
  dispatcher: [
    'channel.create',
    'channel.broadcast',
    'channel.session_expire',
    'channel.view_history',
    'member.invite',
    'location.view',
    'broadcast.emit',
    'emergency.trigger',
    'emergency.ack',
    'admin.stats',
  ],
  member: ['channel.view_history', 'broadcast.emit', 'emergency.trigger'],
};

export const ROLE_RANK: Record<Role, number> = { member: 0, dispatcher: 1, admin: 2 };

export const CHANNEL_MEMBER_ROLES = ['owner', 'moderator', 'member'] as const;
export type ChannelMemberRole = (typeof CHANNEL_MEMBER_ROLES)[number];

export const INVITE_ROLES: readonly Role[] = ['member', 'dispatcher'];

export const ALERT_TYPES = ['emergency', 'panic'] as const;
export const ALERT_STATUSES = ['open', 'acknowledged', 'resolved'] as const;

export const TRANSMISSION_STATUSES = ['live', 'complete', 'failed'] as const;

export const LOCATION_SOURCES = ['always', 'whileUsing', 'manual'] as const;

export const NOTIFICATION_KINDS = ['all', 'workspace', 'channel', 'contact', 'echo'] as const;