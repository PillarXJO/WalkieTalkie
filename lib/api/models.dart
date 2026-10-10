/// Data-transfer models mirroring the backend DTOs.
///
/// Backend responses are plain JSON objects; `createdAt`/`startedAt`/etc. are
/// ISO-8601 strings. These classes are intentionally tolerant of missing fields
/// so a backend rollout can add columns without breaking an older build.
library;

// --- small coercion helpers --------------------------------------------------

Map<String, dynamic> asMap(Object? value) =>
    value is Map<String, dynamic> ? value : const <String, dynamic>{};

List<Map<String, dynamic>> asList(Object? value) => value is List
    ? value.map((e) => e is Map<String, dynamic> ? e : <String, dynamic>{}).toList()
    : const [];

String str(Object? v, {String fallback = ''}) => v is String ? v : fallback;
String? strOrNull(Object? v) => v is String ? v : null;
int intOf(Object? v, {int fallback = 0}) => v is num ? v.toInt() : fallback;
double doubleOf(Object? v, {double fallback = 0}) => v is num ? v.toDouble() : fallback;
bool boolOf(Object? v, {bool fallback = false}) => v is bool ? v : fallback;
DateTime? dateOrNull(Object? v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;

enum PresenceStatus { online, busy, away, offline }

PresenceStatus presenceFrom(Object? v) => switch (str(v)) {
      'online' => PresenceStatus.online,
      'busy' => PresenceStatus.busy,
      'away' => PresenceStatus.away,
      _ => PresenceStatus.offline,
    };

String presenceToJson(PresenceStatus p) => p.name;

/// Public user as returned by `/auth/*` and `/users`.
class AppUser {
  AppUser({
    required this.id,
    required this.email,
    required this.name,
    this.avatarUrl,
    this.phone,
    this.locale = 'en',
    this.status = PresenceStatus.offline,
    this.statusMessage = '',
    this.ghostMode = false,
    this.isBot = false,
    this.totpEnabled = false,
    this.lastSeenAt,
    this.createdAt,
  });

  final String id;
  final String email;
  final String name;
  final String? avatarUrl;
  final String? phone;
  final String locale;
  final PresenceStatus status;
  final String statusMessage;
  final bool ghostMode;
  final bool isBot;
  final bool totpEnabled;
  final DateTime? lastSeenAt;
  final DateTime? createdAt;

  factory AppUser.fromJson(Map<String, dynamic> j) {
    // `/users/me` and `/users/:id` nest presence; `/auth/*` returns it inline.
    final p = asMap(j['presence']);
    return AppUser(
      id: str(j['id']),
      email: str(j['email']),
      name: str(j['name']),
      avatarUrl: strOrNull(j['avatarUrl']),
      phone: strOrNull(j['phone']),
      locale: str(j['locale'], fallback: 'en'),
      status: presenceFrom(j['status'] ?? p['status']),
      statusMessage: str(j['statusMessage'], fallback: str(p['statusMessage'])),
      ghostMode: boolOf(j['ghostMode']),
      isBot: boolOf(j['isBot']),
      totpEnabled: boolOf(j['totpEnabled']),
      lastSeenAt: dateOrNull(j['lastSeenAt']),
      createdAt: dateOrNull(j['createdAt']),
    );
  }
}

class WorkspaceBrief {
  WorkspaceBrief({required this.id, required this.name, required this.role, this.defaultChannelId});

  final String id;
  final String name;
  final String role;
  final String? defaultChannelId;

  factory WorkspaceBrief.fromJson(Map<String, dynamic> j) => WorkspaceBrief(
        id: str(j['id']),
        name: str(j['name']),
        role: str(j['role'], fallback: 'member'),
        defaultChannelId: strOrNull(j['defaultChannelId']),
      );
}

class Workspace {
  Workspace({
    required this.id,
    required this.name,
    this.role,
    this.defaultChannelId,
    this.settings = const {},
    this.createdAt,
  });

  final String id;
  final String name;
  final String? role;
  final String? defaultChannelId;
  final Map<String, dynamic> settings;
  final DateTime? createdAt;

  factory Workspace.fromJson(Map<String, dynamic> j) => Workspace(
        id: str(j['id']),
        name: str(j['name']),
        role: strOrNull(j['role']),
        defaultChannelId: strOrNull(j['defaultChannelId']),
        settings: asMap(j['settings']),
        createdAt: dateOrNull(j['createdAt']),
      );
}

class Channel {
  Channel({
    required this.id,
    required this.workspaceId,
    required this.name,
    this.description,
    this.type = 'channel',
    this.isDefault = false,
    this.memberCount = 0,
    this.transmissionCount = 0,
    this.myRole,
    this.isMuted = false,
    this.lastActivityAt,
  });

  final String id;
  final String workspaceId;
  final String name;
  final String? description;

  /// `channel` | `echo` | `broadcast`.
  final String type;
  final bool isDefault;
  final int memberCount;
  final int transmissionCount;
  final String? myRole;
  final bool isMuted;
  final DateTime? lastActivityAt;

  bool get isEcho => type == 'echo';
  bool get isBroadcast => type == 'broadcast';

  factory Channel.fromJson(Map<String, dynamic> j) {
    // `counts` comes from the channel DTO; workspace-detail returns raw Prisma
    // rows that nest the aggregate under `_count`.
    final counts = asMap(j['counts']);
    final raw = asMap(j['_count']);
    return Channel(
      id: str(j['id']),
      workspaceId: str(j['workspaceId']),
      name: str(j['name']),
      description: strOrNull(j['description']),
      type: str(j['type'], fallback: 'channel'),
      isDefault: boolOf(j['isDefault']),
      memberCount: intOf(counts['members'], fallback: intOf(raw['members'], fallback: intOf(j['memberCount']))),
      transmissionCount: intOf(counts['transmissions'], fallback: intOf(raw['transmissions'], fallback: intOf(j['transmissionCount']))),
      myRole: strOrNull(j['myRole']),
      isMuted: boolOf(j['isMuted']),
      lastActivityAt: dateOrNull(j['lastActivityAt']),
    );
  }
}

class ContactPresence {
  const ContactPresence({required this.status, this.statusMessage = '', this.hiddenByBlock = false});

  final PresenceStatus status;
  final String statusMessage;
  final bool hiddenByBlock;

  factory ContactPresence.fromJson(Map<String, dynamic> j) => ContactPresence(
        status: presenceFrom(j['status']),
        statusMessage: str(j['statusMessage']),
        hiddenByBlock: boolOf(j['hiddenByBlock']),
      );
}

class Contact {
  Contact({
    required this.id,
    required this.userId,
    required this.user,
    this.nickname,
    this.isFavorite = false,
    this.presence = const ContactPresence(status: PresenceStatus.offline),
  });

  final String id;
  final String userId;
  final AppUser user;
  final String? nickname;
  final bool isFavorite;
  final ContactPresence presence;

  String get displayName => (nickname == null || nickname!.isEmpty) ? user.name : nickname!;

  factory Contact.fromJson(Map<String, dynamic> j) => Contact(
        id: str(j['id']),
        userId: str(j['userId'], fallback: str(asMap(j['user'])['id'])),
        user: AppUser.fromJson(asMap(j['user'])),
        nickname: strOrNull(j['nickname']),
        isFavorite: boolOf(j['isFavorite']),
        presence: ContactPresence.fromJson(asMap(j['presence'])),
      );
}

class FloorState {
  FloorState({
    required this.channelId,
    required this.workspaceId,
    required this.speakerId,
    this.priority = 'normal',
    this.emergency = false,
    this.startedAt,
    this.expiresAt,
  });

  final String channelId;
  final String workspaceId;
  final String speakerId;
  final String priority;
  final bool emergency;
  final DateTime? startedAt;
  final DateTime? expiresAt;

  factory FloorState.fromJson(Map<String, dynamic> j) => FloorState(
        channelId: str(j['channelId']),
        workspaceId: str(j['workspaceId']),
        speakerId: str(j['speakerId']),
        priority: str(j['priority'], fallback: 'normal'),
        emergency: boolOf(j['emergency']),
        startedAt: dateOrNull(j['startedAt']),
        expiresAt: dateOrNull(j['expiresAt']),
      );
}

class Transmission {
  Transmission({
    required this.id,
    required this.channelId,
    required this.userId,
    this.user,
    this.audioUrl,
    this.durationMs = 0,
    this.status = 'complete',
    this.startedAt,
    this.endedAt,
  });

  final String id;
  final String channelId;
  final String userId;
  final AppUser? user;
  final String? audioUrl;
  final int durationMs;
  final String status;
  final DateTime? startedAt;
  final DateTime? endedAt;

  factory Transmission.fromJson(Map<String, dynamic> j) => Transmission(
        id: str(j['id']),
        channelId: str(j['channelId']),
        userId: str(j['userId']),
        user: j['user'] is Map<String, dynamic> ? AppUser.fromJson(asMap(j['user'])) : null,
        audioUrl: strOrNull(j['audioUrl']),
        durationMs: intOf(j['durationMs']),
        status: str(j['status'], fallback: 'complete'),
        startedAt: dateOrNull(j['startedAt']),
        endedAt: dateOrNull(j['endedAt']),
      );
}

class Alert {
  Alert({
    required this.id,
    required this.workspaceId,
    required this.userId,
    this.user,
    this.alertType = 'emergency',
    this.status = 'open',
    this.message,
    this.latitude,
    this.longitude,
    this.createdAt,
    this.acknowledgedAt,
    this.resolvedAt,
  });

  final String id;
  final String workspaceId;
  final String userId;
  final AppUser? user;
  final String alertType;
  final String status;
  final String? message;
  final double? latitude;
  final double? longitude;
  final DateTime? createdAt;
  final DateTime? acknowledgedAt;
  final DateTime? resolvedAt;

  bool get isOpen => status == 'open' || status == 'acknowledged';

  factory Alert.fromJson(Map<String, dynamic> j) => Alert(
        id: str(j['id']),
        workspaceId: str(j['workspaceId']),
        userId: str(j['userId'], fallback: strOrNull(asMap(j['user'])['id']) ?? ''),
        user: j['user'] is Map<String, dynamic> ? AppUser.fromJson(asMap(j['user'])) : null,
        alertType: str(j['alertType'], fallback: 'emergency'),
        status: str(j['status'], fallback: 'open'),
        message: strOrNull(j['message']),
        latitude: j['latitude'] is num ? doubleOf(j['latitude']) : null,
        longitude: j['longitude'] is num ? doubleOf(j['longitude']) : null,
        createdAt: dateOrNull(j['createdAt']),
        acknowledgedAt: dateOrNull(j['acknowledgedAt']),
        resolvedAt: dateOrNull(j['resolvedAt']),
      );
}

class LocationPing {
  LocationPing({
    required this.id,
    required this.userId,
    required this.latitude,
    required this.longitude,
    this.workspaceId,
    this.accuracy,
    this.source = 'whileUsing',
    this.at,
  });

  final String id;
  final String userId;
  final double latitude;
  final double longitude;
  final String? workspaceId;
  final double? accuracy;
  final String source;
  final DateTime? at;

  factory LocationPing.fromJson(Map<String, dynamic> j) => LocationPing(
        id: str(j['id']),
        userId: str(j['userId']),
        latitude: doubleOf(j['latitude']),
        longitude: doubleOf(j['longitude']),
        workspaceId: strOrNull(j['workspaceId']),
        accuracy: j['accuracy'] is num ? doubleOf(j['accuracy']) : null,
        source: str(j['source'], fallback: 'whileUsing'),
        at: dateOrNull(j['at']),
      );
}

class NotificationSetting {
  NotificationSetting({
    required this.id,
    required this.kind,
    this.targetId,
    this.pushEnabled = true,
    this.priority = 'default',
    this.dndEnabled = false,
    this.dndStartMin = 1320,
    this.dndEndMin = 420,
    this.muteUntil,
  });

  final String id;
  final String kind;
  final String? targetId;
  final bool pushEnabled;
  final String priority;
  final bool dndEnabled;
  final int dndStartMin;
  final int dndEndMin;
  final DateTime? muteUntil;

  factory NotificationSetting.fromJson(Map<String, dynamic> j) {
    final dnd = asMap(j['dnd']);
    return NotificationSetting(
      id: str(j['id']),
      kind: str(j['kind'], fallback: 'all'),
      targetId: strOrNull(j['targetId']),
      pushEnabled: boolOf(j['pushEnabled'], fallback: true),
      priority: str(j['priority'], fallback: 'default'),
      dndEnabled: boolOf(j['dndEnabled'], fallback: boolOf(dnd['enabled'])),
      dndStartMin: intOf(j['dndStartMin'], fallback: intOf(dnd['startMin'], fallback: 1320)),
      dndEndMin: intOf(j['dndEndMin'], fallback: intOf(dnd['endMin'], fallback: 420)),
      muteUntil: dateOrNull(j['muteUntil']),
    );
  }
}

class PushToken {
  PushToken({required this.token, this.platform = 'android', this.appId, this.createdAt});

  final String token;
  final String platform;
  final String? appId;
  final DateTime? createdAt;

  factory PushToken.fromJson(Map<String, dynamic> j) => PushToken(
        token: str(j['token']),
        platform: str(j['platform'], fallback: 'android'),
        appId: strOrNull(j['appId']),
        createdAt: dateOrNull(j['createdAt']),
      );
}

/// A page of results with an opaque forward cursor.
class Paged<T> {
  Paged(this.items, this.nextCursor);

  final List<T> items;
  final String? nextCursor;

  bool get hasMore => nextCursor != null;

  static Paged<T> fromJson<T>(Map<String, dynamic> j, T Function(Map<String, dynamic>) parse) =>
      Paged<T>(asList(j['items']).map(parse).toList(), strOrNull(j['nextCursor']));
}
