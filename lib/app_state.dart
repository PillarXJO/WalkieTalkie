import 'dart:async';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

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

  /// Cleared after sign-in/registration until the user has been through the
  /// permissions onboarding screen.
  bool onboardingComplete = false;
  AppUser? user;
  WorkspaceBrief? workspace;
  List<WorkspaceBrief> availableWorkspaces = const [];
  List<Channel> channelsForWorkspace = const [];
  List<Contact> contacts = const [];
  final Map<String, FloorState> floors = {};
  final Map<String, ContactPresence> presence = {};
  Alert? latestAlert;

  // Preferences ---------------------------------------------------------------
  static const _themeKey = 'ptt.theme_mode';
  static const _localeKey = 'ptt.locale';

  /// Persisted light/dark preference (defaults to dark).
  ThemeMode themeMode = ThemeMode.dark;

  /// Persisted UI language (defaults to English). Arabic selects RTL layout.
  Locale locale = const Locale('en');

  bool get isArabic => locale.languageCode == 'ar';

  bool get isAuthenticated => user != null;

  /// Test-only: mark the user as authenticated so AuthGate routing can be
  /// exercised without touching the network.
  void setForTestUser() {
    user = AppUser(id: 'test', name: 'Test User', email: 'test@example.com');
    onboardingComplete = false;
    notifyListeners();
  }

  // Preferences ---------------------------------------------------------------
  /// Load persisted theme/language. Best-effort: preferences are unavailable in
  /// some test environments, so failures are swallowed.
  Future<void> loadSettings() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final theme = prefs.getString(_themeKey);
      themeMode = switch (theme) {
        'light' => ThemeMode.light,
        'system' => ThemeMode.system,
        _ => ThemeMode.dark,
      };
      final lang = prefs.getString(_localeKey);
      if (lang == 'ar') {
        locale = const Locale('ar');
      } else if (lang == 'en') {
        locale = const Locale('en');
      }
    } catch (_) {
      // Keep defaults.
    }
    notifyListeners();
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    themeMode = mode;
    notifyListeners();
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_themeKey, switch (mode) {
        ThemeMode.light => 'light',
        ThemeMode.dark => 'dark',
        ThemeMode.system => 'system',
      });
    } catch (_) {}
  }

  Future<void> setLocale(Locale value) async {
    locale = locale.languageCode == value.languageCode ? locale : Locale(value.languageCode);
    notifyListeners();
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_localeKey, locale.languageCode);
    } catch (_) {}
  }

  // Lifecycle -----------------------------------------------------------------
  /// Attempt a silent refresh using a stored refresh token; called at startup.
  Future<void> bootstrap() async {
    initializing = true;
    notifyListeners();
    await loadSettings();
    try {
      final me = await users.me();
      user = me;
      await _loadWorkspaceContext();
      realtime.connect();
      onboardingComplete = true;
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
    onboardingComplete = false;
    notifyListeners();
    await refreshHome();
    realtime.connect();
  }

  /// Called by the permissions onboarding screen once the user continues.
  void completeOnboarding() {
    onboardingComplete = true;
    notifyListeners();
  }

  void _onSessionExpired() {
    _reset();
    notifyListeners();
  }

  void _reset() {
    user = null;
    workspace = null;
    onboardingComplete = false;
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

  /// Extract the invite code from `ptt://invite/<code>`, `https://…/i/<code>`,
  /// `…/invite/<code>`, or a bare code.
  static String? inviteCodeFrom(String input) {
    final s = input.trim();
    final deep = RegExp(r'^[a-z][a-z0-9+.-]*://invite/([a-z0-9]{8,})$', caseSensitive: false);
    final path = RegExp(r'/(?:i|invite)/([a-z0-9]{8,})$', caseSensitive: false);
    for (final re in [deep, path]) {
      final m = re.firstMatch(s);
      if (m != null) return m.group(1);
    }
    return RegExp(r'^[a-z0-9]{8,}$').hasMatch(s) ? s : null;
  }

  /// Join a workspace using an invite link or bare code. Redeeming the invite
  /// grants the member role (that is the "permission" to join), then the home
  /// feed is refreshed with the new workspace/contacts/channels.
  Future<Map<String, dynamic>> joinWorkspace(String codeOrLink) async {
    final code = inviteCodeFrom(codeOrLink);
    if (code == null) {
      throw ArgumentError('That does not look like a valid invite code or link.');
    }
    final result = await channels.redeemInvite(code);
    await refreshHome();
    return result;
  }

  /// Build the shareable personal contact code embedded in a user's QR.
  static String userCode(String userId) => 'ptt://user/$userId';

  /// Extract a user id from `ptt://user/<id>` or a bare id/code. Returns null
  /// when the input is neither.
  static String? userIdFrom(String input) {
    final s = input.trim();
    final deep = RegExp(r'^[a-z][a-z0-9+.-]*://user/([A-Za-z0-9_-]{6,64})$', caseSensitive: false);
    final m = deep.firstMatch(s);
    if (m != null) return m.group(1);
    return RegExp(r'^[A-Za-z0-9_-]{6,64}$').hasMatch(s) ? s : null;
  }

  /// Public profile lookup used to preview a scanned contact before adding.
  Future<AppUser> lookupUser(String userId) => users.getUser(userId);

  /// Add [userId] to the current user's contacts, then refresh the list.
  Future<void> addContactById(String userId, {String? nickname}) async {
    await users.addContact(userId: userId, nickname: nickname);
    contacts = await users.contacts();
    notifyListeners();
  }

  /// Create a channel in the active workspace and add the chosen members. The
  /// creator becomes the channel owner (admin).
  Future<void> createChannel({required String name, String? description, List<String> memberIds = const []}) async {
    final ws = workspace;
    if (ws == null) throw StateError('No active workspace');
    await channels.create(ws.id, name: name, description: description, memberIds: memberIds);
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
