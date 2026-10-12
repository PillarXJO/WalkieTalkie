import 'api_client.dart';
import 'models.dart';

Map<String, dynamic> _obj(Object? v) => asMap(v);

/// Result of a successful login/register/refresh.
class AuthResult {
  AuthResult({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresInSeconds,
    required this.user,
    required this.workspaces,
    this.workspace,
    this.channels = const [],
  });

  final String accessToken;
  final String refreshToken;
  final int expiresInSeconds;
  final AppUser user;
  final List<WorkspaceBrief> workspaces;
  final WorkspaceBrief? workspace;
  final List<Channel> channels;

  factory AuthResult.fromJson(Map<String, dynamic> j) => AuthResult(
        accessToken: str(j['accessToken']),
        refreshToken: str(j['refreshToken']),
        expiresInSeconds: intOf(j['expiresInSeconds'], fallback: 300),
        user: AppUser.fromJson(asMap(j['user'])),
        workspaces: asList(j['workspaces']).map(WorkspaceBrief.fromJson).toList(),
        workspace: j['workspace'] is Map<String, dynamic> ? WorkspaceBrief.fromJson(asMap(j['workspace'])) : null,
        channels: asList(j['channels']).map(Channel.fromJson).toList(),
      );
}

/// Login may return either an [AuthResult] or an MFA challenge.
class LoginResult {
  LoginResult({this.session, this.mfaToken, this.mfaExpiresInSeconds});

  final AuthResult? session;
  final String? mfaToken;
  final int? mfaExpiresInSeconds;

  bool get requiresMfa => session == null && mfaToken != null;
}

class LiveKitJoin {
  LiveKitJoin({required this.token, required this.url, required this.room, required this.participant, this.ttlSeconds = 0});

  final String token;
  final String url;
  final String room;
  final String participant;
  final int ttlSeconds;

  factory LiveKitJoin.fromJson(Map<String, dynamic> j) => LiveKitJoin(
        token: str(j['token']),
        url: str(j['url']),
        room: str(j['room']),
        participant: str(j['participant']),
        ttlSeconds: intOf(j['ttlSeconds']),
      );
}

String _queryString(Map<String, dynamic> params) {
  final parts = <String>[];
  params.forEach((k, v) {
    if (v == null) return;
    parts.add('${Uri.encodeQueryComponent(k)}=${Uri.encodeQueryComponent('$v')}');
  });
  return parts.isEmpty ? '' : '?${parts.join('&')}';
}

// --- Auth ---------------------------------------------------------------------

class AuthApi {
  AuthApi(this._c);
  final ApiClient _c;

  Future<AuthResult> register({required String name, required String email, required String password, String? phone, String? locale}) async {
    final j = _obj(await _c.post('/auth/register', authenticated: false, body: {
      'name': name,
      'email': email,
      'password': password,
      if (phone != null) 'phone': phone,
      if (locale != null) 'locale': locale,
    }));
    final result = AuthResult.fromJson(j);
    _adopt(result);
    return result;
  }

  Future<LoginResult> login({required String email, required String password, String? totpCode, String? backupCode}) async {
    final j = _obj(await _c.post('/auth/login', authenticated: false, body: {
      'email': email,
      'password': password,
      if (totpCode != null) 'totpCode': totpCode,
      if (backupCode != null) 'backupCode': backupCode,
    }));
    if (j['auth'] == 'mfa_required') {
      return LoginResult(mfaToken: str(j['mfaToken']), mfaExpiresInSeconds: intOf(j['expiresInSeconds']));
    }
    final result = AuthResult.fromJson(j);
    _adopt(result);
    return LoginResult(session: result);
  }

  Future<AuthResult> verifyMfa({required String mfaToken, required String code}) async {
    final j = _obj(await _c.post('/auth/verify-2fa', authenticated: false, body: {'mfaToken': mfaToken, 'code': code}));
    final result = AuthResult.fromJson(j);
    _adopt(result);
    return result;
  }

  Future<void> logout() async {
    final refresh = _c.tokens.refreshToken;
    if (refresh != null) {
      await _c.post('/auth/logout', body: {'refreshToken': refresh});
    }
    await _c.clearSession();
  }

  Future<void> deleteAccount(String password) async {
    await _c.delete('/auth/account', body: {'password': password});
    await _c.clearSession();
  }

  Future<List<Map<String, dynamic>>> sessions() async => asList(await _c.get('/auth/sessions'));
  Future<void> revokeSession(String sessionId) => _c.delete('/auth/sessions/$sessionId');

  Future<void> changePassword({required String currentPassword, required String newPassword}) =>
      _c.post('/auth/password/change', body: {'currentPassword': currentPassword, 'newPassword': newPassword});

  Future<void> requestPasswordReset(String email) => _c.post('/auth/password/reset-request', authenticated: false, body: {'email': email});

  Future<void> resetPassword({required String token, required String newPassword}) =>
      _c.post('/auth/password/reset', authenticated: false, body: {'token': token, 'newPassword': newPassword});

  Future<Map<String, dynamic>> setupTwoFactor() async => _obj(await _c.post('/auth/2fa/setup'));

  Future<List<String>> confirmTwoFactor(String code) async {
    final j = _obj(await _c.post('/auth/2fa/confirm', body: {'code': code}));
    return (j['backupCodes'] as List?)?.map((e) => '$e').toList() ?? const [];
  }

  Future<void> disableTwoFactor(String password) => _c.delete('/auth/2fa', body: {'password': password});

  /// Number of unused backup codes remaining.
  Future<int> backupCodeCount() async => intOf(_obj(await _c.get('/auth/2fa/backup-codes'))['count']);

  Future<List<String>> regenerateBackupCodes() async {
    final j = _obj(await _c.post('/auth/2fa/backup-codes/regenerate'));
    return (j['backupCodes'] as List?)?.map((e) => '$e').toList() ?? const [];
  }

  /// Mints a workspace-scoped access token. Does NOT rotate the refresh token,
  /// so only the access token is replaced.
  Future<List<WorkspaceBrief>> switchWorkspace(String workspaceId) async {
    final j = _obj(await _c.post('/auth/workspaces/switch', body: {'workspaceId': workspaceId}));
    _c.updateAccess(str(j['accessToken']), intOf(j['expiresInSeconds'], fallback: 300));
    return asList(j['workspaces']).map(WorkspaceBrief.fromJson).toList();
  }

  void _adopt(AuthResult r) => _c.setTokens(access: r.accessToken, refresh: r.refreshToken, expiresInSeconds: r.expiresInSeconds);
}

// --- Users / contacts ---------------------------------------------------------

class UsersApi {
  UsersApi(this._c);
  final ApiClient _c;

  Future<AppUser> me() async => AppUser.fromJson(_obj(await _c.get('/users/me')));
  Future<AppUser> updateMe(Map<String, dynamic> fields) async => AppUser.fromJson(_obj(await _c.patch('/users/me', body: fields)));

  /// Returns the stored `{ status, statusMessage }`; callers usually just
  /// update local state afterwards.
  Future<void> setStatus(String status, [String statusMessage = '']) =>
      _c.patch('/users/me/status', body: {'status': status, 'statusMessage': statusMessage});

  Future<AppUser> getUser(String userId) async => AppUser.fromJson(_obj(await _c.get('/users/$userId')));

  Future<List<Contact>> contacts() async => asList(await _c.get('/contacts')).map(Contact.fromJson).toList();

  Future<Map<String, dynamic>> addContact({required String userId, String? nickname, bool? isFavorite}) async =>
      _obj(await _c.post('/contacts', body: {
        'userId': userId,
        if (nickname != null) 'nickname': nickname,
        if (isFavorite != null) 'isFavorite': isFavorite,
      }));

  Future<void> updateContact(String contactId, {String? nickname, bool? isFavorite}) => _c.patch('/contacts/$contactId', body: {
        if (nickname != null) 'nickname': nickname,
        if (isFavorite != null) 'isFavorite': isFavorite,
      });

  Future<void> removeContact(String contactId) => _c.delete('/contacts/$contactId');
  Future<List<Map<String, dynamic>>> blocks() async => asList(await _c.get('/blocks'));
  Future<void> block(String userId) => _c.post('/blocks', body: {'userId': userId});
  Future<void> unblock(String userId) => _c.delete('/blocks/$userId');
}

// --- Workspaces ---------------------------------------------------------------

class WorkspacesApi {
  WorkspacesApi(this._c);
  final ApiClient _c;

  Future<List<Workspace>> list() async =>
      asList(await _c.get('/workspaces')).map(Workspace.fromJson).toList();

  Future<Map<String, dynamic>> create(String name) async => _obj(await _c.post('/workspaces', body: {'name': name}));

  Future<Map<String, dynamic>> detail(String workspaceId) async => _obj(await _c.get('/workspaces/$workspaceId'));

  Future<Workspace> update(String workspaceId, Map<String, dynamic> fields) async =>
      Workspace.fromJson(_obj(await _c.patch('/workspaces/$workspaceId', body: fields)));

  Future<void> delete(String workspaceId) => _c.delete('/workspaces/$workspaceId');

  Future<List<Map<String, dynamic>>> members(String workspaceId) async => asList(await _c.get('/workspaces/$workspaceId/members'));

  Future<void> addMember(String workspaceId, Map<String, dynamic> body) => _c.post('/workspaces/$workspaceId/members', body: body);

  Future<void> updateMember(String workspaceId, String userId, Map<String, dynamic> body) =>
      _c.patch('/workspaces/$workspaceId/members/$userId', body: body);

  Future<void> removeMember(String workspaceId, String userId) => _c.delete('/workspaces/$workspaceId/members/$userId');

  Future<Map<String, dynamic>> stats(String workspaceId, {int days = 7}) async =>
      _obj(await _c.get('/workspaces/$workspaceId/stats', query: {'days': days}));
}

// --- Channels & invites -------------------------------------------------------

class ChannelsApi {
  ChannelsApi(this._c);
  final ApiClient _c;

  Future<Channel> create(String workspaceId, {required String name, String? description, String? type, List<String> memberIds = const []}) async =>
      Channel.fromJson(_obj(await _c.post('/workspaces/$workspaceId/channels', body: {
        'name': name,
        if (description != null) 'description': description,
        if (type != null) 'type': type,
        if (memberIds.isNotEmpty) 'memberIds': memberIds,
      })));

  Future<Channel> get(String channelId) async => Channel.fromJson(_obj(await _c.get('/channels/$channelId')));
  Future<Channel> update(String channelId, {String? name, String? description}) async =>
      Channel.fromJson(_obj(await _c.patch('/channels/$channelId', body: {
        if (name != null) 'name': name,
        if (description != null) 'description': description,
      })));

  Future<void> delete(String channelId) => _c.delete('/channels/$channelId');
  Future<void> join(String channelId) => _c.post('/channels/$channelId/join');
  Future<void> leave(String channelId) => _c.post('/channels/$channelId/leave');

  Future<void> mute(String channelId, {DateTime? until}) =>
      _c.post('/channels/$channelId/mute', body: until == null ? null : {'until': until.toUtc().toIso8601String()});

  Future<void> unmute(String channelId) => _c.delete('/channels/$channelId/mute');
  Future<Map<String, dynamic>> stats(String channelId, {int days = 7}) async =>
      _obj(await _c.get('/channels/$channelId/stats', query: {'days': days}));

  Future<List<Map<String, dynamic>>> members(String channelId) async => asList(await _c.get('/channels/$channelId/members'));

  Future<void> updateMember(String channelId, String userId, Map<String, dynamic> body) =>
      _c.patch('/channels/$channelId/members/$userId', body: body);

  Future<void> removeMember(String channelId, String userId) => _c.delete('/channels/$channelId/members/$userId');

  // Invites
  Future<Map<String, dynamic>> createInvite(String workspaceId, {String? role, int? maxUses, int? expiresInHours}) async =>
      _obj(await _c.post('/workspaces/$workspaceId/invites', body: {
        if (role != null) 'role': role,
        if (maxUses != null) 'maxUses': maxUses,
        if (expiresInHours != null) 'expiresInHours': expiresInHours,
      }));

  Future<List<Map<String, dynamic>>> invites(String workspaceId) async => asList(await _c.get('/workspaces/$workspaceId/invites'));
  Future<void> revokeInvite(String workspaceId, String code) => _c.delete('/workspaces/$workspaceId/invites/$code');
  Future<Map<String, dynamic>> peekInvite(String code) async => _obj(await _c.get('/invites/$code', query: null));
  Future<Map<String, dynamic>> redeemInvite(String code) async => _obj(await _c.post('/invites/redeem', body: {'code': code}));
}

// --- PTT (floor control + LiveKit) --------------------------------------------

class PttApi {
  PttApi(this._c);
  final ApiClient _c;

  Future<LiveKitJoin> joinToken(String channelId, {String? identity}) async =>
      LiveKitJoin.fromJson(_obj(await _c.post('/channels/$channelId/ptt-token${_queryString({'identity': identity})}')));

  Future<FloorState?> floor(String channelId) async {
    final j = _obj(await _c.get('/channels/$channelId/floor'));
    final f = j['floor'];
    return f is Map<String, dynamic> ? FloorState.fromJson(f) : null;
  }

  Future<FloorState?> requestFloor(String channelId, {String priority = 'normal'}) async {
    final j = _obj(await _c.post('/channels/$channelId/floor/request', body: {'priority': priority}));
    final f = j['floor'];
    return f is Map<String, dynamic> ? FloorState.fromJson(f) : null;
  }

  Future<void> releaseFloor(String channelId) => _c.post('/channels/$channelId/floor/release');
}

// --- History ------------------------------------------------------------------

class HistoryApi {
  HistoryApi(this._c);
  final ApiClient _c;

  Future<Map<String, dynamic>> channelHistory(String channelId, {int? limit, String? cursor}) async =>
      _obj(await _c.get('/channels/$channelId/history', query: {'limit': limit, 'cursor': cursor}));

  Future<Map<String, dynamic>> workspaceHistory(String workspaceId, {int? limit, String? cursor, String? from, String? to}) async =>
      _obj(await _c.get('/workspaces/$workspaceId/history', query: {'limit': limit, 'cursor': cursor, 'from': from, 'to': to}));

  Future<Map<String, dynamic>> search(String workspaceId, String q, {int? limit}) async =>
      _obj(await _c.get('/workspaces/$workspaceId/history/search', query: {'q': q, 'limit': limit}));

  Future<Transmission> get(String transmissionId) async =>
      Transmission.fromJson(asMap(_obj(await _c.get('/history/$transmissionId'))['transmission']));

  Future<void> delete(String transmissionId) => _c.delete('/history/$transmissionId');
}

// --- Media --------------------------------------------------------------------

class MediaApi {
  MediaApi(this._c);
  final ApiClient _c;

  Future<Map<String, dynamic>> uploadUrl({String? type, String? prefix, String? contentType, String? extension, int? expiresInSeconds}) async =>
      _obj(await _c.get('/media/upload-url', query: {
        'type': type,
        'prefix': prefix,
        'contentType': contentType,
        'extension': extension,
        'expiresInSeconds': expiresInSeconds,
      }));

  Future<Map<String, dynamic>> getUrl(String key, {int? expiresInSeconds, String? responseContentType}) async =>
      _obj(await _c.get('/media/$key/get-url', query: {
        'expiresInSeconds': expiresInSeconds,
        'responseContentType': responseContentType,
      }));
}

// --- Location -----------------------------------------------------------------

class LocationApi {
  LocationApi(this._c);
  final ApiClient _c;

  Future<LocationPing> record({required double latitude, required double longitude, double? accuracy, String? source, String? workspaceId}) async {
    final j = _obj(await _c.post('/location/pings', body: {
      'latitude': latitude,
      'longitude': longitude,
      if (accuracy != null) 'accuracy': accuracy,
      if (source != null) 'source': source,
      if (workspaceId != null) 'workspaceId': workspaceId,
    }));
    return LocationPing.fromJson(asMap(j['ping']));
  }

  Future<LocationPing?> myLatest() async {
    final j = _obj(await _c.get('/location/me'));
    final p = j['ping'];
    return p is Map<String, dynamic> ? LocationPing.fromJson(p) : null;
  }

  Future<LocationPing?> latestForUser(String userId) async {
    final j = _obj(await _c.get('/users/$userId/location'));
    final p = j['ping'];
    return p is Map<String, dynamic> ? LocationPing.fromJson(p) : null;
  }

  Future<List<LocationPing>> workspacePings(String workspaceId, {int? windowMinutes, bool? latest, int? limit, String? userId}) async {
    final j = _obj(await _c.get('/workspaces/$workspaceId/locations', query: {
      'windowMinutes': windowMinutes,
      'latest': latest,
      'limit': limit,
      'userId': userId,
    }));
    return asList(j['pings']).map(LocationPing.fromJson).toList();
  }
}

// --- Alerts -------------------------------------------------------------------

class AlertsApi {
  AlertsApi(this._c);
  final ApiClient _c;

  Future<Alert> create(String workspaceId, {String? alertType, String? message, double? latitude, double? longitude, String? channelId}) async {
    final j = _obj(await _c.post('/workspaces/$workspaceId/alerts', body: {
      if (alertType != null) 'alertType': alertType,
      if (message != null) 'message': message,
      if (latitude != null) 'latitude': latitude,
      if (longitude != null) 'longitude': longitude,
      if (channelId != null) 'channelId': channelId,
    }));
    return Alert.fromJson(asMap(j['alert']));
  }

  Future<List<Alert>> list(String workspaceId, {String? status, int? limit}) async {
    final j = _obj(await _c.get('/workspaces/$workspaceId/alerts', query: {'status': status, 'limit': limit}));
    return asList(j['alerts']).map(Alert.fromJson).toList();
  }

  Future<Alert> get(String alertId) async => Alert.fromJson(asMap(_obj(await _c.get('/alerts/$alertId'))['alert']));
  Future<Alert> acknowledge(String alertId) async => Alert.fromJson(asMap(_obj(await _c.post('/alerts/$alertId/acknowledge'))['alert']));
  Future<Alert> resolve(String alertId) async => Alert.fromJson(asMap(_obj(await _c.post('/alerts/$alertId/resolve'))['alert']));
}

// --- Notifications ------------------------------------------------------------

class NotificationsApi {
  NotificationsApi(this._c);
  final ApiClient _c;

  Future<void> registerToken({required String token, required String platform, String? appId}) =>
      _c.post('/notifications/tokens', body: {'token': token, 'platform': platform, if (appId != null) 'appId': appId});

  Future<List<PushToken>> listTokens() async =>
      asList(asMap(await _c.get('/notifications/tokens'))['tokens']).map(PushToken.fromJson).toList();

  Future<void> removeToken(String token) => _c.delete('/notifications/tokens', body: {'token': token});

  Future<List<NotificationSetting>> settings() async =>
      asList(asMap(await _c.get('/notifications/settings'))['settings']).map(NotificationSetting.fromJson).toList();

  Future<NotificationSetting> updateSetting(Map<String, dynamic> body) async =>
      NotificationSetting.fromJson(asMap(_obj(await _c.put('/notifications/settings', body: body))['setting']));

  Future<Map<String, dynamic>> testPush({String? title, String? body}) async =>
      _obj(await _c.post('/notifications/test', body: {
        if (title != null) 'title': title,
        if (body != null) 'body': body,
      }));
}

// --- Admin --------------------------------------------------------------------

class AdminApi {
  AdminApi(this._c);
  final ApiClient _c;

  Future<Map<String, dynamic>> dashboard(String workspaceId, {int days = 7}) async =>
      _obj(await _c.get('/workspaces/$workspaceId/admin/dashboard', query: {'days': days}));

  Future<Paged<Map<String, dynamic>>> audit(String workspaceId, {String? action, String? actorId, int? limit, String? cursor}) async {
    final j = _obj(await _c.get('/workspaces/$workspaceId/admin/audit', query: {
      'action': action,
      'actorId': actorId,
      'limit': limit,
      'cursor': cursor,
    }));
    return Paged<Map<String, dynamic>>(asList(j['items']), strOrNull(j['nextCursor']));
  }

  Future<Map<String, dynamic>> auditStats(String workspaceId, {int days = 30}) async =>
      _obj(await _c.get('/workspaces/$workspaceId/admin/audit/stats', query: {'days': days}));
}
