import 'package:flutter/material.dart';

import 'app_state.dart';
import 'auth_screens.dart';
import 'screens.dart';
import 'theme.dart';

void main() => runApp(const PttApp());

class PttApp extends StatefulWidget {
  const PttApp({super.key});
  @override
  State<PttApp> createState() => _PttAppState();
}

class _PttAppState extends State<PttApp> {
  late final SessionController _session = SessionController();

  @override
  void initState() {
    super.initState();
    // In backend mode, try to restore a session from the stored refresh token.
    if (_session.config.useBackend) _session.bootstrap();
  }

  @override
  void dispose() {
    _session.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => BackendScope(
        controller: _session,
        child: MaterialApp(
          title: 'PTT',
          debugShowCheckedModeBanner: false,
          theme: buildTheme(),
          // Backend mode gates behind auth; otherwise keep the original mock flow.
          home: _session.config.useBackend ? const AuthGate() : const InviteScreen(),
        ),
      );
}
