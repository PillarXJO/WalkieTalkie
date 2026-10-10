import 'dart:async';
import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'api/backend.dart' hide Channel, Contact;
import 'app_state.dart';
import 'mock_data.dart';
import 'theme.dart';
import 'widgets.dart';

/// True when the app was launched with `--dart-define=USE_BACKEND=true`.
final bool kUseBackend = ApiConfig.current.useBackend;

Presence _presenceOf(PresenceStatus s) => switch (s) {
      PresenceStatus.online => Presence.online,
      PresenceStatus.busy => Presence.busy,
      PresenceStatus.away => Presence.away,
      PresenceStatus.offline => Presence.offline,
    };

/// 1. Invite your team (QR + share link).
class InviteScreen extends StatelessWidget {
  const InviteScreen({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(30),
            child: Column(children: [
              const SizedBox(height: 30),
              Container(
                padding: const EdgeInsets.all(28),
                decoration: BoxDecoration(color: const Color(0xFF52606A), borderRadius: BorderRadius.circular(36)),
                // TODO(backend): real workspace invite URL.
                child: QrImageView(
                  data: 'https://example.com/invite/pillarx',
                  size: 220,
                  eyeStyle: const QrEyeStyle(color: Colors.white, eyeShape: QrEyeShape.square),
                  dataModuleStyle: const QrDataModuleStyle(color: Colors.white, dataModuleShape: QrDataModuleShape.square),
                ),
              ),
              const SizedBox(height: 40),
              const Text('Invite your team to your private workspace.',
                  textAlign: TextAlign.center, style: TextStyle(fontSize: 30)),
              const SizedBox(height: 14),
              const Text('You must invite your team for them to join your private workspace.',
                  textAlign: TextAlign.center, style: TextStyle(color: Tk.muted, fontSize: 18)),
              const SizedBox(height: 28),
              FilledButton(onPressed: () {}, child: const Text('SHARE INVITE LINK')),
              TextButton(
                onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const PermissionsScreen())),
                child: const Text('NEXT', style: TextStyle(color: Tk.muted, fontSize: 20, fontWeight: FontWeight.w700)),
              ),
            ]),
          ),
        ),
      );
}

/// 2. Permissions (mic, notifications, bluetooth, background, phone, location, overlay).
class PermissionsScreen extends StatelessWidget {
  const PermissionsScreen({super.key});
  static const items = [
    (Icons.mic_none, 'Record Audio', 'Talk to people via push-to-talk'),
    (Icons.notifications_none, 'Send Notifications', 'Be notified when you receive messages'),
    (Icons.bluetooth, 'Connect via Bluetooth', 'Connect headsets and microphones'),
    (Icons.battery_charging_full, 'Run in Background', 'Receive messages when the screen is off'),
    (Icons.phone_in_talk, 'Make & Manage Phone Calls', 'Prevents voice messages interfering with calls'),
    (Icons.location_on_outlined, 'Location Sharing', 'Live location, emergency alerts, location messages'),
    (Icons.layers_outlined, 'Display Over Other Apps', 'Floating PTT overlay and lock-screen response'),
  ];

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('App Permissions', style: TextStyle(fontSize: 30)),
              const SizedBox(height: 6),
              const Text('We need access to system permissions to work properly.', style: TextStyle(color: Tk.muted, fontSize: 17)),
              const SizedBox(height: 16),
              Expanded(
                child: ListView(children: [
                  for (final i in items)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: Icon(i.$1, color: Tk.muted, size: 30),
                      title: Text(i.$2, style: const TextStyle(fontSize: 18)),
                      subtitle: Text(i.$3, style: const TextStyle(color: Tk.muted)),
                      // TODO: request real permission via permission_handler.
                      trailing: const Icon(Icons.chevron_right, color: Tk.muted),
                    ),
                ]),
              ),
              FilledButton(
                onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const PttTutorialScreen())),
                child: const Text('CONTINUE'),
              ),
            ]),
          ),
        ),
      );
}

/// 3. Press-and-hold practice with the echo bot.
class PttTutorialScreen extends StatelessWidget {
  const PttTutorialScreen({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          actions: [
            TextButton(
              onPressed: () => Navigator.pushAndRemoveUntil(
                  context, MaterialPageRoute(builder: (_) => const HomeShell()), (_) => false),
              child: const Text('SKIP', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
            ),
          ],
        ),
        body: Column(children: [
          const ListTile(
            leading: StatusAvatar('echo', icon: Icons.mic_external_on),
            title: Text('echo  Robot', style: TextStyle(fontSize: 18)),
          ),
          const Spacer(),
          const PttButton(),
          const SizedBox(height: 24),
          Container(
            margin: const EdgeInsets.symmetric(horizontal: 44),
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(6)),
            child: const Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Press and hold to speak', style: TextStyle(color: Colors.black, fontSize: 20, fontWeight: FontWeight.w700)),
              Text("Hold the button while you talk. Let go when you're finished.", style: TextStyle(color: Colors.black87, fontSize: 17)),
            ]),
          ),
          const Spacer(),
          const ListTile(leading: Icon(Icons.volume_up), title: Text('Speaker'), trailing: Icon(Icons.more_vert)),
        ]),
      );
}

/// 4. Main shell: header + 5 tabs + mini-player.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});
  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _tab = 1;
  String _lastWho = 'Mohammad Emran';
  int _secs = 20;
  StreamSubscription<String>? _sub;
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    // The mock ticker/incoming simulator only runs without a backend.
    if (!kUseBackend) {
      _tick = Timer.periodic(const Duration(seconds: 1), (_) => setState(() => _secs++));
      _sub = MockService.incoming().listen((who) => setState(() {
            _lastWho = who;
            _secs = 0;
          }));
    }
  }

  @override
  void dispose() {
    _sub?.cancel();
    _tick?.cancel();
    super.dispose();
  }

  void _openTalk(String name, {IconData? icon, String? channelId}) =>
      Navigator.push(context, MaterialPageRoute(builder: (_) => TalkScreen(name: name, icon: icon, channelId: channelId)));

  Widget _inviteTile() => ListTile(
        contentPadding: const EdgeInsets.all(16),
        leading: const CircleAvatar(radius: 30, backgroundColor: Tk.card, child: Icon(Icons.person_add, color: Tk.orange)),
        title: const Text('Invite your team', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 20)),
        onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const InviteScreen())),
      );

  Widget _contactsTab(SessionController session) {
    if (!kUseBackend) {
      return ListView(children: [
        _inviteTile(),
        for (final c in MockService.contacts)
          ContactTile(c, onTap: () => _openTalk(c.name, icon: c.isBot ? Icons.mic_external_on : null)),
      ]);
    }
    return ListView(children: [
      _inviteTile(),
      for (final c in session.contacts)
        ContactTile(
          Contact(
            c.displayName,
            c.presence.statusMessage.isEmpty ? 'Available' : c.presence.statusMessage,
            _presenceOf(c.presence.status),
            isBot: c.user.isBot,
          ),
          onTap: () => _openTalk(c.displayName, icon: c.user.isBot ? Icons.mic_external_on : null),
        ),
    ]);
  }

  Widget _channelsTab(SessionController session) {
    if (!kUseBackend) {
      return ListView(children: [
        for (final ch in MockService.channels)
          ChannelTile(ch, onToggle: (v) => setState(() => ch.enabled = v), onTap: () => _openTalk(ch.name, icon: Icons.groups)),
      ]);
    }
    return ListView(children: [
      for (final ch in session.channelsForWorkspace)
        ChannelTile(
          Channel(ch.name, ch.isEcho ? 'Echo bot' : '${ch.memberCount} connected', enabled: !ch.isMuted),
          onToggle: (v) => v ? session.channels.unmute(ch.id) : session.channels.mute(ch.id),
          onTap: () => _openTalk(ch.name, icon: ch.isEcho ? Icons.mic_external_on : Icons.groups, channelId: ch.id),
        ),
    ]);
  }

  Widget _body(SessionController session) => switch (_tab) {
        1 => _contactsTab(session),
        2 => _channelsTab(session),
        _ => Center(child: Text(['Recents', '', '', 'Manage', 'Days'][_tab] + ' (coming next)', style: const TextStyle(color: Tk.muted))),
      };

  ({String who, String when}) _nowPlaying(SessionController session) {
    if (!kUseBackend) return (who: _lastWho, when: '${_secs}s ago');
    final floor = session.floors.values.isEmpty ? null : session.floors.values.first;
    if (floor != null) {
      var who = 'Someone';
      for (final c in session.contacts) {
        if (c.userId == floor.speakerId) {
          who = c.displayName;
          break;
        }
      }
      return (who: who, when: floor.emergency ? 'emergency' : 'speaking');
    }
    final alert = session.latestAlert;
    if (alert != null) return (who: alert.user?.name ?? 'Emergency', when: alert.status);
    return (who: _lastWho, when: '${_secs}s ago');
  }

  @override
  Widget build(BuildContext context) {
    final session = BackendScope.of(context);
    final backend = kUseBackend && session.isAuthenticated;
    final now = _nowPlaying(session);
    final title = backend ? (session.user?.name ?? 'mohammad') : 'mohammad';
    final subtitle = backend ? (session.workspace?.name ?? 'workspace') : 'pillarx';
    return Scaffold(
      appBar: AppBar(
        toolbarHeight: 72,
        title: Row(children: [
          StatusAvatar(title, icon: Icons.workspace_premium, size: 48),
          const SizedBox(width: 12),
          Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 20)),
            Text(subtitle, style: const TextStyle(color: Tk.muted, fontSize: 17)),
          ]),
        ]),
        actions: [
          IconButton(icon: const Icon(Icons.assignment), onPressed: () {}),
          IconButton(icon: const Icon(Icons.search), onPressed: () {}),
          IconButton(icon: const Icon(Icons.more_vert), onPressed: () {}),
        ],
      ),
      body: _body(session),
      bottomNavigationBar: Column(mainAxisSize: MainAxisSize.min, children: [
        MiniPlayer(who: now.who, when: now.when),
          NavigationBar(
            selectedIndex: _tab,
            onDestinationSelected: (i) => setState(() => _tab = i),
            destinations: const [
              NavigationDestination(icon: Icon(Icons.access_time), label: 'Recents'),
              NavigationDestination(icon: Icon(Icons.person), label: 'Contacts'),
              NavigationDestination(icon: Icon(Icons.groups), label: 'Channels'),
              NavigationDestination(icon: Icon(Icons.dashboard), label: 'Manage'),
              NavigationDestination(icon: Icon(Icons.calendar_today), label: 'Days'),
            ],
          ),
        ]),
      );
  }
}

/// 5. Talk screen for a contact or channel.
///
/// When [channelId] is set and the app runs against the backend, press-and-hold
/// requests/releases the floor over the realtime socket. Actual audio capture
/// and playback are performed by the platform LiveKit plugin using the token
/// from [SessionController.joinChannel].
class TalkScreen extends StatelessWidget {
  final String name;
  final IconData? icon;
  final String? channelId;
  const TalkScreen({super.key, required this.name, this.icon, this.channelId});

  @override
  Widget build(BuildContext context) {
    final session = BackendScope.of(context);
    final live = kUseBackend && channelId != null;
    final floor = live ? session.floors[channelId!] : null;
    return Scaffold(
      appBar: AppBar(title: Text(name)),
      body: Column(children: [
        ListTile(
          leading: StatusAvatar(name, icon: icon),
          title: Text(name, style: const TextStyle(fontSize: 18)),
          subtitle: floor != null
              ? Text(floor.emergency ? 'EMERGENCY traffic' : 'Floor held', style: const TextStyle(color: Tk.muted))
              : (live ? const Text('Press and hold to talk', style: TextStyle(color: Tk.muted)) : null),
        ),
        const Spacer(),
        PttButton(
          onTransmit: live
              ? (down) => down ? session.pressTalk(channelId!) : session.releaseTalk(channelId!)
              : null,
        ),
        const Spacer(),
        const ListTile(leading: Icon(Icons.volume_up), title: Text('Speaker'), trailing: Icon(Icons.more_vert)),
      ]),
    );
  }
}
