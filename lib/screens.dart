import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'api/backend.dart' hide Channel, Contact;
import 'app_state.dart';
import 'strings.dart';
import 'theme.dart';
import 'ui_models.dart';
import 'widgets.dart';

Presence _presenceOf(PresenceStatus s) => switch (s) {
      PresenceStatus.online => Presence.online,
      PresenceStatus.busy => Presence.busy,
      PresenceStatus.away => Presence.away,
      PresenceStatus.offline => Presence.offline,
    };

/// 1. Invite your team (QR + share link).
///
/// Fetches a real invite from the backend for the current workspace and renders
/// the `ptt://invite/<code>` deep link as a QR code. Scanning that QR (or
/// opening the link) lets another user redeem it and join the workspace.
class InviteScreen extends StatefulWidget {
  const InviteScreen({super.key});
  @override
  State<InviteScreen> createState() => _InviteScreenState();
}

class _InviteScreenState extends State<InviteScreen> {
  bool _loading = true;
  bool _working = false;
  String? _error;
  Map<String, dynamic>? _invite;
  bool _started = false;

  /// True when an existing invite can still be handed out (not used up and not
  /// expired). Lets us reuse a live code instead of minting a new one each time
  /// the screen is opened.
  bool _usable(Map<String, dynamic> inv) {
    final uses = (inv['useCount'] as num?)?.toInt() ?? 0;
    final max = (inv['maxUses'] as num?)?.toInt() ?? 1;
    if (uses >= max) return false;
    final exp = inv['expiresAt'];
    if (exp is String && exp.isNotEmpty) {
      final dt = DateTime.tryParse(exp);
      if (dt != null && dt.isBefore(DateTime.now())) return false;
    }
    return true;
  }

  Future<void> _load({bool fresh = false}) async {
    final t = AppStrings.of(context);
    setState(() {
      _loading = true;
      _error = null;
    });
    final session = BackendScope.of(context);
    final ws = session.workspace;
    if (ws == null) {
      setState(() {
        _loading = false;
        _error = t.notInWorkspace;
      });
      return;
    }
    try {
      Map<String, dynamic>? invite;
      // Reuse a still-valid invite so reopening the page is instant and does
      // not leave a trail of unused codes. Fall back to creating one.
      if (!fresh) {
        try {
          final existing = await session.channels.invites(ws.id);
          for (final inv in existing) {
            if (_usable(inv)) {
              invite = inv;
              break;
            }
          }
        } on ApiException {
          invite = null;
        }
      }
      invite ??= await session.channels.createInvite(ws.id);
      if (!mounted) return;
      setState(() {
        _invite = invite;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.message;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = '${t.couldNotCreateInvite}: $e';
      });
    }
  }

  /// Revokes the current code (if any) and mints a fresh one.
  Future<void> _newCode() async {
    if (_working) return;
    final session = BackendScope.of(context);
    final ws = session.workspace;
    final invite = _invite;
    setState(() => _working = true);
    try {
      if (ws != null && invite != null && invite['code'] is String) {
        await session.channels.revokeInvite(ws.id, invite['code'] as String);
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _working = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      return;
    }
    if (!mounted) return;
    setState(() => _working = false);
    await _load(fresh: true);
  }

  Future<void> _shareLink() async {
    final link = _invite?['url'] as String? ?? _invite?['deepLink'] as String?;
    if (link == null) return;
    await Clipboard.setData(ClipboardData(text: link));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(AppStrings.of(context).linkCopied)));
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // BackendScope.of(context) must not be touched during initState, so kick off
    // the first load here (guarded to run once).
    if (!_started) {
      _started = true;
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppStrings.of(context);
    final tk = Tk.of(context);
    final invite = _invite;
    final deepLink = invite?['deepLink'] as String?;
    final url = invite?['url'] as String?;
    final role = invite?['role'] as String?;
    final maxUses = invite?['maxUses'] as int? ?? 1;
    return Scaffold(
      appBar: AppBar(title: Text(t.inviteYourTeam), backgroundColor: Colors.transparent),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(30),
          child: Column(children: [
            const SizedBox(height: 16),
            if (_loading)
              const Padding(padding: EdgeInsets.all(40), child: CircularProgressIndicator())
            else if (_error != null)
              Column(children: [
                Icon(Icons.error_outline, color: tk.red, size: 56),
                const SizedBox(height: 16),
                Text(_error!, textAlign: TextAlign.center, style: const TextStyle(fontSize: 18)),
                const SizedBox(height: 24),
                FilledButton(onPressed: _load, child: Text(t.retry)),
              ])
            else if (deepLink != null) ...[
              Container(
                padding: const EdgeInsets.all(28),
                decoration: BoxDecoration(color: const Color(0xFF52606A), borderRadius: BorderRadius.circular(36)),
                child: QrImageView(
                  data: deepLink,
                  size: 220,
                  eyeStyle: const QrEyeStyle(color: Colors.white, eyeShape: QrEyeShape.square),
                  dataModuleStyle: const QrDataModuleStyle(color: Colors.white, dataModuleShape: QrDataModuleShape.square),
                ),
              ),
              const SizedBox(height: 16),
              if (invite!['code'] is String)
                Text('${t.codeLabel}  ${(invite['code'] as String).toUpperCase()}',
                    style: const TextStyle(letterSpacing: 4, fontWeight: FontWeight.w700, fontSize: 20)),
              if (url != null) ...[
                const SizedBox(height: 8),
                Text(url, textAlign: TextAlign.center, style: TextStyle(color: tk.muted, fontSize: 14)),
              ],
              const SizedBox(height: 28),
              Text(t.inviteToWorkspace, textAlign: TextAlign.center, style: const TextStyle(fontSize: 30)),
              const SizedBox(height: 14),
              Text(
                t.inviteRole(role ?? 'member', maxUses),
                textAlign: TextAlign.center,
                style: TextStyle(color: tk.muted, fontSize: 16),
              ),
              const SizedBox(height: 28),
              FilledButton.icon(
                onPressed: _shareLink,
                icon: const Icon(Icons.copy),
                label: Text(t.copyInviteLink),
              ),
              const SizedBox(height: 10),
              TextButton(
                onPressed: _working ? null : _newCode,
                child: Text(t.createNewCode, style: TextStyle(color: tk.muted, fontWeight: FontWeight.w700)),
              ),
            ],
          ]),
        ),
      ),
    );
  }
}

/// Join a workspace by redeeming an invite code (scanned from a QR or pasted
/// from a link). Redeeming grants membership — the "permission" to join.
class JoinScreen extends StatefulWidget {
  const JoinScreen({super.key});
  @override
  State<JoinScreen> createState() => _JoinScreenState();
}

class _JoinScreenState extends State<JoinScreen> {
  final _code = TextEditingController();
  bool _busy = false;
  bool _checking = false;
  String? _error;
  Map<String, dynamic>? _preview;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _paste() async {
    final data = await Clipboard.getData('text/plain');
    if (data?.text == null) return;
    setState(() {
      _code.text = data!.text!.trim();
      _preview = null;
    });
  }

  /// Open the camera, let the user point it at an invite QR code, and fill the
  /// code field (plus run a preview) with whatever was scanned.
  Future<void> _scan() async {
    final raw = await Navigator.push<String>(
      context,
      MaterialPageRoute(builder: (_) => const QrScannerScreen()),
    );
    if (raw == null || raw.trim().isEmpty || !mounted) return;
    setState(() {
      _code.text = raw.trim();
      _preview = null;
      _error = null;
    });
    _previewCode();
  }

  Future<void> _previewCode() async {
    final t = AppStrings.of(context);
    final session = BackendScope.of(context);
    final code = SessionController.inviteCodeFrom(_code.text);
    if (code == null) {
      setState(() {
        _preview = null;
        _error = t.enterInviteHint;
      });
      return;
    }
    setState(() {
      _checking = true;
      _error = null;
    });
    try {
      final preview = await session.channels.peekInvite(code);
      if (!mounted) return;
      setState(() {
        _preview = preview;
        _checking = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _preview = null;
        _error = e.message;
        _checking = false;
      });
    }
  }

  Future<void> _join() async {
    final t = AppStrings.of(context);
    final session = BackendScope.of(context);
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await session.joinWorkspace(_code.text);
      if (!mounted) return;
      Navigator.pop(context);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(t.youJoined(session.workspace?.name ?? t.joinAWorkspace))));
    } on ArgumentError catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = e.message;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = e.message;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = t.couldNotJoin(e);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppStrings.of(context);
    final tk = Tk.of(context);
    final previewName = _preview?['workspaceName'] as String?;
    final previewRole = _preview?['role'] as String?;
    return Scaffold(
      appBar: AppBar(title: Text(t.joinAWorkspace), backgroundColor: Colors.transparent),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(30),
          children: [
            const SizedBox(height: 12),
            Icon(Icons.qr_code_scanner, size: 64, color: tk.orange),
            const SizedBox(height: 20),
            Text(t.enterInviteCode, textAlign: TextAlign.center, style: const TextStyle(fontSize: 30)),
            const SizedBox(height: 12),
            Text(t.joinIntro,
                textAlign: TextAlign.center, style: TextStyle(color: tk.muted, fontSize: 17)),
            const SizedBox(height: 24),
            TextField(
              controller: _code,
              autofocus: true,
              textCapitalization: TextCapitalization.none,
              onSubmitted: (_) => _join(),
              decoration: InputDecoration(
                labelText: t.inviteCodeOrLink,
                hintText: t.inviteCodeHint,
                suffixIcon: IconButton(
                  icon: const Icon(Icons.content_paste),
                  onPressed: _paste,
                  tooltip: t.pasteFromClipboard,
                ),
              ),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: _scan,
              icon: const Icon(Icons.qr_code_scanner),
              label: Text(t.scanQrCode),
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(52)),
            ),
            const SizedBox(height: 8),
            if (_checking)
              const LinearProgressIndicator()
            else
              TextButton(
                onPressed: _busy ? null : _previewCode,
                child: Text(t.checkTheCode),
              ),
            if (previewName != null)
              Container(
                margin: const EdgeInsets.symmetric(vertical: 8),
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(color: tk.card, borderRadius: BorderRadius.circular(14)),
                child: Row(children: [
                  Icon(Icons.workspaces, color: tk.orange),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(t.joinAs(previewName, previewRole ?? 'member'),
                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17)),
                  ),
                ]),
              ),
            if (_error != null)
              Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Text(_error!, style: TextStyle(color: tk.red))),
            const SizedBox(height: 24),
            FilledButton(onPressed: _busy ? null : _join, child: Text(_busy ? t.joining : t.joinWorkspace)),
          ],
        ),
      ),
    );
  }
}

/// Full-screen camera QR scanner used by [JoinScreen]. Pops with the raw value
/// of the first barcode it recognizes.
class QrScannerScreen extends StatefulWidget {
  const QrScannerScreen({super.key});
  @override
  State<QrScannerScreen> createState() => _QrScannerScreenState();
}

class _QrScannerScreenState extends State<QrScannerScreen> {
  MobileScannerController? _controller;
  bool _done = false;

  @override
  void initState() {
    super.initState();
    _controller = MobileScannerController(
      detectionSpeed: DetectionSpeed.normal,
      formats: const [BarcodeFormat.qrCode],
    );
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  void _onDetect(BarcodeCapture capture) {
    if (_done) return;
    final raw = capture.barcodes
        .map((b) => b.rawValue)
        .cast<String?>()
        .firstWhere((v) => v != null && v.isNotEmpty, orElse: () => null);
    if (raw == null) return;
    _done = true;
    Navigator.of(context).pop(raw);
  }

  @override
  Widget build(BuildContext context) {
    final t = AppStrings.of(context);
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(title: Text(t.scanInviteCode), backgroundColor: Colors.black),
      body: SafeArea(
        child: Stack(children: [
          Positioned.fill(child: MobileScanner(controller: _controller, onDetect: _onDetect)),
          Positioned(
            left: 0,
            right: 0,
            bottom: 40,
            child: Center(
              child: Container(
                margin: const EdgeInsets.symmetric(horizontal: 32),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.55), borderRadius: BorderRadius.circular(12)),
                child: Text(
                  AppStrings.of(context).pointCamera,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white),
                ),
              ),
            ),
          ),
        ]),
      ),
    );
  }
}

/// A single row on the permissions screen and the OS permission it maps to.
class _PermissionItem {
  const _PermissionItem(this.icon, this.title, this.subtitle, this.permission);
  final IconData icon;
  final String Function(AppStrings) title;
  final String Function(AppStrings) subtitle;
  final Permission permission;
}

/// 2. Permissions (mic, notifications, bluetooth, background, phone, location, overlay).
///
/// Tapping a row asks the OS for that permission; if the user has already
/// answered (or permanently denied) it, we open the app's system settings
/// page instead so it can still be changed.
class PermissionsScreen extends StatefulWidget {
  const PermissionsScreen({super.key});
  @override
  State<PermissionsScreen> createState() => _PermissionsScreenState();
}

class _PermissionsScreenState extends State<PermissionsScreen> with WidgetsBindingObserver {
  static final items = <_PermissionItem>[
    _PermissionItem(Icons.mic_none, (t) => t.permRecordAudio, (t) => t.permRecordAudioSub, Permission.microphone),
    _PermissionItem(Icons.notifications_none, (t) => t.permNotifications, (t) => t.permNotificationsSub, Permission.notification),
    _PermissionItem(Icons.bluetooth, (t) => t.permBluetooth, (t) => t.permBluetoothSub, Permission.bluetoothConnect),
    _PermissionItem(Icons.battery_charging_full, (t) => t.permBackground, (t) => t.permBackgroundSub, Permission.ignoreBatteryOptimizations),
    _PermissionItem(Icons.phone_in_talk, (t) => t.permPhone, (t) => t.permPhoneSub, Permission.phone),
    _PermissionItem(Icons.location_on_outlined, (t) => t.permLocation, (t) => t.permLocationSub, Permission.location),
    _PermissionItem(Icons.layers_outlined, (t) => t.permOverlay, (t) => t.permOverlaySub, Permission.systemAlertWindow),
  ];

  final Map<Permission, PermissionStatus> _statuses = {};
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refresh();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Re-check when returning from the OS permission dialog / settings page.
    if (state == AppLifecycleState.resumed) _refresh();
  }

  Future<void> _refresh() async {
    final next = <Permission, PermissionStatus>{};
    for (final i in items) {
      next[i.permission] = await i.permission.status;
    }
    if (mounted) setState(() => _statuses..clear()..addAll(next));
  }

  Future<void> _handleTap(Permission permission) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      var status = await permission.status;
      if (status.isGranted || status.isLimited) {
        // Already decided: take the user to the system settings page.
        await openAppSettings();
      } else {
        status = await permission.request();
        if (status.isPermanentlyDenied || status.isRestricted) {
          await openAppSettings();
        }
      }
    } finally {
      if (mounted) setState(() => _busy = false);
      await _refresh();
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppStrings.of(context);
    final tk = Tk.of(context);
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(t.appPermissions, style: const TextStyle(fontSize: 30)),
            const SizedBox(height: 6),
            Text(t.permissionsSubtitle, style: TextStyle(color: tk.muted, fontSize: 17)),
            const SizedBox(height: 16),
            Expanded(
              child: ListView(children: [
                for (final i in items)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(i.icon, color: tk.muted, size: 30),
                    title: Text(i.title(t), style: const TextStyle(fontSize: 18)),
                    subtitle: Text(i.subtitle(t), style: TextStyle(color: tk.muted)),
                    trailing: _statusIcon(tk, _statuses[i.permission]),
                    onTap: () => _handleTap(i.permission),
                  ),
              ]),
            ),
            FilledButton(
              onPressed: () {
                // Finishing onboarding flips [AuthGate] to the home shell.
                BackendScope.of(context).completeOnboarding();
                final nav = Navigator.of(context);
                if (nav.canPop()) nav.pop();
              },
              child: Text(t.continueBtn),
            ),
          ]),
        ),
      ),
    );
  }

  Widget _statusIcon(Tk tk, PermissionStatus? status) {
    if (status == null) {
      return const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2));
    }
    final granted = status.isGranted || status.isLimited;
    return Icon(granted ? Icons.check_circle : Icons.chevron_right, color: granted ? tk.orange : tk.muted);
  }
}

/// 3. Press-and-hold practice with the echo bot.
class PttTutorialScreen extends StatelessWidget {
  const PttTutorialScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final t = AppStrings.of(context);
    return Scaffold(
      appBar: AppBar(
        actions: [
          TextButton(
            onPressed: () => Navigator.pushAndRemoveUntil(
                context, MaterialPageRoute(builder: (_) => const HomeShell()), (_) => false),
            child: Text(t.skip, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
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
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(t.pressAndHoldToSpeak, style: const TextStyle(color: Colors.black, fontSize: 20, fontWeight: FontWeight.w700)),
            Text(t.pressAndHoldToSpeakBody, style: const TextStyle(color: Colors.black87, fontSize: 17)),
          ]),
        ),
        const Spacer(),
        ListTile(leading: const Icon(Icons.volume_up), title: Text(t.speaker), trailing: const Icon(Icons.more_vert)),
      ]),
    );
  }
}

/// Create a channel, pick the workspace members to include, and become its
/// admin (the creator is added as the channel owner server-side).
class CreateChannelScreen extends StatefulWidget {
  const CreateChannelScreen({super.key});
  @override
  State<CreateChannelScreen> createState() => _CreateChannelScreenState();
}

class _CreateChannelScreenState extends State<CreateChannelScreen> {
  final _name = TextEditingController();
  final Set<String> _selected = {};
  bool _loading = true;
  bool _busy = false;
  bool _started = false;
  String? _error;
  List<Map<String, dynamic>> _members = const [];

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_started) {
      _started = true;
      _load();
    }
  }

  Future<void> _load() async {
    final session = BackendScope.of(context);
    final ws = session.workspace;
    if (ws == null) {
      setState(() => _loading = false);
      return;
    }
    try {
      final rows = await session.workspaces.members(ws.id);
      final self = session.user?.id;
      if (!mounted) return;
      setState(() {
        _members = rows.where((m) => m['userId'] != self).toList();
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loading = false);
    }
  }

  String _nameOf(Map<String, dynamic> m) {
    final nick = m['nickname'];
    if (nick is String && nick.isNotEmpty) return nick;
    final u = (m['user'] as Map?)?.cast<String, dynamic>();
    final n = u?['name'];
    return n is String && n.isNotEmpty ? n : 'User';
  }

  Future<void> _create() async {
    final t = AppStrings.of(context);
    final session = BackendScope.of(context);
    final name = _name.text.trim();
    if (name.isEmpty) {
      setState(() => _error = t.channelNameRequired);
      return;
    }
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await session.createChannel(name: name, memberIds: _selected.toList());
      if (!mounted) return;
      Navigator.pop(context);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t.channelCreated(name))));
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = e.message;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = t.couldNotCreateChannel(e);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppStrings.of(context);
    final tk = Tk.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(t.createChannelTitle), backgroundColor: Colors.transparent),
      body: SafeArea(
        child: Column(children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(24),
              children: [
                TextField(
                  controller: _name,
                  autofocus: true,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: InputDecoration(labelText: t.channelName),
                ),
                const SizedBox(height: 12),
                Row(children: [
                  Icon(Icons.workspace_premium, color: tk.orange, size: 20),
                  const SizedBox(width: 8),
                  Expanded(child: Text(t.youWillBeAdmin, style: TextStyle(color: tk.muted, fontSize: 15))),
                ]),
                const SizedBox(height: 24),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(t.selectMembers, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
                    if (_selected.isNotEmpty) Text(t.membersSelected(_selected.length), style: TextStyle(color: tk.muted)),
                  ],
                ),
                const SizedBox(height: 8),
                if (_loading)
                  const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()))
                else if (_members.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    child: Text(t.noMembersToAdd, style: TextStyle(color: tk.muted)),
                  )
                else
                  for (final m in _members)
                    CheckboxListTile(
                      value: _selected.contains(m['userId']),
                      onChanged: (v) => setState(() {
                        final uid = m['userId'] as String;
                        if (v == true) {
                          _selected.add(uid);
                        } else {
                          _selected.remove(uid);
                        }
                      }),
                      title: Text(_nameOf(m)),
                      secondary: StatusAvatar(_nameOf(m), size: 44),
                      controlAffinity: ListTileControlAffinity.trailing,
                    ),
                if (_error != null)
                  Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Text(_error!, style: TextStyle(color: tk.red))),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(24),
            child: FilledButton(
              onPressed: _busy ? null : _create,
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
              child: Text(_busy ? t.pleaseWait : t.createChannelBtn),
            ),
          ),
        ]),
      ),
    );
  }
}

/// 4. Main shell: header + 5 tabs + mini-player.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});
  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _tab = 1;

  void _openTalk(String name, {IconData? icon, String? channelId}) =>
      Navigator.push(context, MaterialPageRoute(builder: (_) => TalkScreen(name: name, icon: icon, channelId: channelId)));

  void _openSettings() =>
      Navigator.push(context, MaterialPageRoute(builder: (_) => const SettingsScreen()));

  Widget _inviteTile(AppStrings t, Tk tk) => ListTile(
        contentPadding: const EdgeInsets.all(16),
        leading: CircleAvatar(radius: 30, backgroundColor: tk.card, child: Icon(Icons.person_add, color: tk.orange)),
        title: Text(t.inviteYourTeam, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 20)),
        onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const InviteScreen())),
      );

  Widget _joinTile(AppStrings t, Tk tk) => ListTile(
        contentPadding: const EdgeInsets.all(16),
        leading: CircleAvatar(radius: 30, backgroundColor: tk.card, child: Icon(Icons.qr_code_scanner, color: tk.orange)),
        title: Text(t.joinWithInviteCode, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 20)),
        subtitle: Text(t.redeemQrSubtitle, style: TextStyle(color: tk.muted)),
        onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const JoinScreen())),
      );

  Widget _newChannelTile(AppStrings t, Tk tk) => ListTile(
        contentPadding: const EdgeInsets.all(16),
        leading: CircleAvatar(radius: 30, backgroundColor: tk.card, child: Icon(Icons.add, color: tk.orange)),
        title: Text(t.newChannel, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 20)),
        subtitle: Text(t.selectMembers, style: TextStyle(color: tk.muted)),
        onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const CreateChannelScreen())),
      );

  Widget _contactsTab(SessionController session, AppStrings t, Tk tk) => ListView(children: [
        _inviteTile(t, tk),
        _joinTile(t, tk),
        for (final c in session.contacts)
          ContactTile(
            Contact(
              c.displayName,
              c.presence.statusMessage.isEmpty ? t.available : c.presence.statusMessage,
              _presenceOf(c.presence.status),
              isBot: c.user.isBot,
            ),
            onTap: () => _openTalk(c.displayName, icon: c.user.isBot ? Icons.mic_external_on : null),
          ),
      ]);

  Widget _channelsTab(SessionController session, AppStrings t, Tk tk) => ListView(children: [
        _newChannelTile(t, tk),
        for (final ch in session.channelsForWorkspace)
          ChannelTile(
            Channel(
              ch.name,
              ch.isEcho
                  ? t.echoBot
                  : ((ch.myRole == 'owner' || (ch.createdById != null && ch.createdById == session.user?.id))
                      ? '${t.admin} • ${t.connected(ch.memberCount)}'
                      : t.connected(ch.memberCount)),
              enabled: !ch.isMuted,
            ),
            onToggle: (v) => v ? session.channels.unmute(ch.id) : session.channels.mute(ch.id),
            onTap: () => _openTalk(ch.name, icon: ch.isEcho ? Icons.mic_external_on : Icons.groups, channelId: ch.id),
          ),
      ]);

  Widget _body(SessionController session, AppStrings t, Tk tk) => switch (_tab) {
        1 => _contactsTab(session, t, tk),
        2 => _channelsTab(session, t, tk),
        _ => Center(child: Text('${t.tabRecents} ${t.comingNext}', style: TextStyle(color: tk.muted))),
      };

  @override
  Widget build(BuildContext context) {
    final session = BackendScope.of(context);
    final t = AppStrings.of(context);
    final tk = Tk.of(context);
    final title = session.user?.name ?? t.you;
    final subtitle = session.workspace?.name ?? t.noWorkspace;
    return Scaffold(
      appBar: AppBar(
        toolbarHeight: 72,
        title: InkWell(
          onTap: _openSettings,
          borderRadius: BorderRadius.circular(12),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(children: [
              StatusAvatar(title, icon: Icons.workspace_premium, size: 48, heroTag: 'home-avatar'),
              const SizedBox(width: 12),
              Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 20)),
                Text(subtitle, style: TextStyle(color: tk.muted, fontSize: 17)),
              ]),
            ]),
          ),
        ),
        actions: [
          IconButton(icon: const Icon(Icons.settings), onPressed: _openSettings, tooltip: t.settings),
        ],
      ),
      body: _body(session, t, tk),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: [
          NavigationDestination(icon: const Icon(Icons.access_time), label: t.tabRecents),
          NavigationDestination(icon: const Icon(Icons.person), label: t.tabContacts),
          NavigationDestination(icon: const Icon(Icons.groups), label: t.tabChannels),
        ],
      ),
    );
  }
}

/// Account & app settings, opened by tapping the user's name in [HomeShell].
///
/// Offers permissions, theme (light/dark), language (English/Arabic) and sign out.
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  Future<void> _confirmSignOut(BuildContext context) async {
    final t = AppStrings.of(context);
    final session = BackendScope.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(t.signOut),
        content: Text(t.signOutConfirmBody),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(t.cancel)),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(t.signOut)),
        ],
      ),
    );
    if (ok == true) {
      await session.logout();
      if (context.mounted) Navigator.of(context).popUntil((r) => r.isFirst);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppStrings.of(context);
    final tk = Tk.of(context);
    final session = BackendScope.of(context);
    final name = session.user?.name ?? t.you;
    final email = session.user?.email ?? '';
    final isDark = session.themeMode == ThemeMode.dark;
    return Scaffold(
      appBar: AppBar(
        title: Text(t.settings),
        actions: [IconButton(icon: const Icon(Icons.settings), onPressed: () {}, tooltip: t.settings)],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Row(children: [
              StatusAvatar(name, icon: Icons.workspace_premium, size: 64, heroTag: 'settings-avatar'),
              const SizedBox(width: 16),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                  Text(name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 22)),
                  if (email.isNotEmpty) Text(email, style: TextStyle(color: tk.muted, fontSize: 16)),
                ]),
              ),
            ]),
            const SizedBox(height: 24),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(Icons.admin_panel_settings, color: tk.muted, size: 30),
              title: Text(t.permissions, style: const TextStyle(fontSize: 18)),
              subtitle: Text(t.permissionsSubtitleShort, style: TextStyle(color: tk.muted)),
              trailing: Icon(Icons.chevron_right, color: tk.muted),
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const PermissionsScreen())),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              secondary: Icon(isDark ? Icons.dark_mode : Icons.light_mode, color: tk.muted, size: 30),
              title: Text(t.theme, style: const TextStyle(fontSize: 18)),
              subtitle: Text(isDark ? t.dark : t.light, style: TextStyle(color: tk.muted)),
              value: isDark,
              onChanged: (dark) => session.setThemeMode(dark ? ThemeMode.dark : ThemeMode.light),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(Icons.language, color: tk.muted, size: 30),
              title: Text(t.language, style: const TextStyle(fontSize: 18)),
              subtitle: Text(session.isArabic ? t.arabic : t.english, style: TextStyle(color: tk.muted)),
              trailing: const Icon(Icons.translate),
              onTap: () => session.setLocale(session.isArabic ? const Locale('en') : const Locale('ar')),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(Icons.logout, color: tk.red, size: 30),
              title: Text(t.signOut, style: TextStyle(fontSize: 18, color: tk.red)),
              onTap: () => _confirmSignOut(context),
            ),
          ],
        ),
      ),
    );
  }
}

/// 5. Talk screen for a contact or channel.
///
/// When [channelId] is set, press-and-hold requests/releases the floor over the
/// realtime socket. Actual audio capture and playback are performed by the
/// platform LiveKit plugin using the token from [SessionController.joinChannel].
class TalkScreen extends StatelessWidget {
  final String name;
  final IconData? icon;
  final String? channelId;
  const TalkScreen({super.key, required this.name, this.icon, this.channelId});

  @override
  Widget build(BuildContext context) {
    final session = BackendScope.of(context);
    final t = AppStrings.of(context);
    final tk = Tk.of(context);
    final live = channelId != null;
    final floor = live ? session.floors[channelId!] : null;
    return Scaffold(
      appBar: AppBar(title: Text(name)),
      body: Column(children: [
        ListTile(
          leading: StatusAvatar(name, icon: icon),
          title: Text(name, style: const TextStyle(fontSize: 18)),
          subtitle: floor != null
              ? Text(floor.emergency ? t.emergencyTraffic : t.floorHeld, style: TextStyle(color: tk.muted))
              : (live ? Text(t.pressAndHoldToTalk, style: TextStyle(color: tk.muted)) : null),
        ),
        const Spacer(),
        PttButton(
          onTransmit: live
              ? (down) => down ? session.pressTalk(channelId!) : session.releaseTalk(channelId!)
              : null,
        ),
        const Spacer(),
        ListTile(leading: const Icon(Icons.volume_up), title: Text(t.speaker), trailing: const Icon(Icons.more_vert)),
      ]),
    );
  }
}
