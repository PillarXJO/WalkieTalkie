import 'dart:async';

import 'package:flutter/widgets.dart';

import 'api/backend.dart';

/// Application-level session + data controller.
///
/// Owns the single [ApiClient] (with its token lifecycle) and the WebSocket
/// [RealtimeClient], and exposes the current user / workspace / channels /
/// contacts to the widgets. Screens read it through [BackendScope].
class SessionController extends ChangeNotifier {
  SessionController({
    ApiConfig? config,
    ApiClient? api,
    TokenStore? tokenStore,
  }) : config = config ?? ApiConfig.current {
    client = api ?? ApiClient(config: this.config, tokenStore: tokenStore ?? PreferencesTokenStore());
    client.onSessionExpired = _onSessionExpired;

    realtime = RealtimeClient(config: this.config, api: client);
    auth = AuthApi(client);
    users = UsersApi(client);
    workspaces = WorkspacesApi(client);
    channels = ChannelsApi(client);
    ptt = PttApi(client);
    history = HistoryApi(client);
    media = MediaApi(client);
    location = LocationApi(client);
    alerts = AlertsApi(client);
    notifications = NotificationsApi(client);
    admin = AdminApi(client);

    _eventSub = realtime.events.listen(_onRealtimeEvent);
  }

  final ApiConfig config;
  late final ApiClient client;
  late final RealtimeClient realtime;
  late final AuthApi auth;
  late final UsersApi users;
  late final WorkspacesApi workspaces;
  late final ChannelsApi channels;
  late final PttApi ptt;
  late final HistoryApi history;
  late final MediaApi media;
  late final LocationApi location;
  late final AlertsApi alerts;
  late final NotificationsApi notifications;
  late final AdminApi admin;

  StreamSubscription<RealtimeEvent>? _eventSub;

  // State ---------------------------------------------------------------------
  bool initializing = true;
  bool busy = false;
  String? error;
  AppUser? user;
  WorkspaceBrief? workspace;
  List<WorkspaceBrief> availableWorkspaces = const [];
  List<Channel> channelsForWorkspace = const [];
  List<Contact> contacts = const [];
  final Map<String, FloorState> floors = {};
  final Map<String, ContactPresence> presence = {};
  Alert? latestAlert;

  bool get isAuthenticated => user != null;

  // Lifecycle -----------------------------------------------------------------
  /// Attempt a silent refresh using a stored refresh token; called at startup.
  Future<void> bootstrap() async {
    initializing = true;
    notifyListeners();
    try {
      final me = await users.me();
      user = me;
      await _loadWorkspaceContext();
      realtime.connect();
    } catch (_) {
      user = null;
    } finally {
      initializing = false;
      notifyListeners();
    }
  }

  Future<void> _loadWorkspaceContext() async {
    availableWorkspaces = await workspaces.list().then(
          (rows) => rows.map((w) => WorkspaceBrief(id: w.id, name: w.name, role: w.role ?? 'member', defaultChannelId: w.defaultChannelId)).toList(),
        );
    if (availableWorkspaces.isNotEmpty) {
      workspace = availableWorkspaces.first;
      channelsForWorkspace = await _channelsFor(workspace!);
    }
    contacts = await users.contacts();
  }

  Future<List<Channel>> _channelsFor(WorkspaceBrief ws) async {
    final detail = await workspaces.detail(ws.id);
    return asList(detail['channels']).map(Channel.fromJson).toList();
  }

  Future<void> refreshHome() async {
    if (!isAuthenticated) return;
    busy = true;
    error = null;
    notifyListeners();
    try {
      await _loadWorkspaceContext();
    } on ApiException catch (e) {
      error = e.message;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  // Auth ----------------------------------------------------------------------
  Future<LoginResult> login({required String email, required String password, String? totpCode, String? backupCode}) async {
    final result = await auth.login(email: email, password: password, totpCode: totpCode, backupCode: backupCode);
    if (result.session != null) await _adoptSession(result.session!);
    return result;
  }

  Future<void> verifyMfa({required String mfaToken, required String code}) async {
    final session = await auth.verifyMfa(mfaToken: mfaToken, code: code);
    await _adoptSession(session);
  }

  Future<void> register({required String name, required String email, required String password, String? phone}) async {
    final session = await auth.register(name: name, email: email, password: password, phone: phone);
    await _adoptSession(session);
  }

  Future<void> logout() async {
    await realtime.dispose();
    await auth.logout();
    _reset();
    notifyListeners();
  }

  Future<void> _adoptSession(AuthResult session) async {
    user = session.user;
    availableWorkspaces = session.workspaces;
    workspace = session.workspace ?? (session.workspaces.isNotEmpty ? session.workspaces.first : null);
    channelsForWorkspace = session.channels;
    notifyListeners();
    await refreshHome();
    realtime.connect();
  }

  void _onSessionExpired() {
    _reset();
    notifyListeners();
  }

  void _reset() {
    user = null;
    workspace = null;
    availableWorkspaces = const [];
    channelsForWorkspace = const [];
    contacts = const [];
    floors.clear();
    presence.clear();
    latestAlert = null;
  }

  // Workspace / presence ------------------------------------------------------
  Future<void> switchWorkspace(String workspaceId) async {
    await auth.switchWorkspace(workspaceId);
    await refreshHome();
  }

  Future<void> setPresence(PresenceStatus status, [String message = '']) async {
    await users.setStatus(presenceToJson(status), message);
    realtime.setPresence(presenceToJson(status), message);
    if (user != null) {
      user = AppUser(
        id: user!.id,
        email: user!.email,
        name: user!.name,
        avatarUrl: user!.avatarUrl,
        phone: user!.phone,
        locale: user!.locale,
        status: status,
        statusMessage: message,
        ghostMode: user!.ghostMode,
        isBot: user!.isBot,
        totpEnabled: user!.totpEnabled,
        lastSeenAt: user!.lastSeenAt,
        createdAt: user!.createdAt,
      );
      notifyListeners();
    }
  }

  // PTT -----------------------------------------------------------------------
  /// Fetch a LiveKit join token for a channel; the platform audio plugin then
  /// publishes/subscribes. This only mints credentials.
  Future<LiveKitJoin> joinChannel(String channelId, {String? identity}) => ptt.joinToken(channelId, identity: identity);

  Future<void> pressTalk(String channelId, {String priority = 'normal'}) async {
    realtime.requestFloor(channelId, priority: priority);
  }

  Future<void> releaseTalk(String channelId) async {
    realtime.releaseFloor(channelId);
  }

  void _onRealtimeEvent(RealtimeEvent event) {
    switch (event.type) {
      case 'init':
        break;
      case 'presence':
        if (event.data['userId'] is String) {
          presence[event.data['userId'] as String] = ContactPresence.fromJson(event.data);
        }
        break;
      case 'floor.state':
      case 'floor.granted':
        final f = event.floor;
        if (f != null) floors[f.channelId] = f;
        break;
      case 'floor.released':
        if (event.channelId != null) floors.remove(event.channelId);
        break;
      case 'alert.created':
      case 'alert.acknowledged':
      case 'alert.resolved':
        latestAlert = event.alert ?? latestAlert;
        break;
      default:
        break;
    }
    notifyListeners();
  }

  @override
  void dispose() {
    _eventSub?.cancel();
    realtime.dispose();
    client.close();
    super.dispose();
  }
}

/// Inherited access to the app-wide [SessionController].
class BackendScope extends InheritedNotifier<SessionController> {
  const BackendScope({super.key, required SessionController controller, required super.child}) : super(notifier: controller);

  static SessionController of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<BackendScope>();
    assert(scope != null, 'BackendScope not found in the widget tree');
    return scope!.notifier!;
  }

  static SessionController? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<BackendScope>()?.notifier;
}
