import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'app_state.dart';
import 'auth_screens.dart';
import 'strings.dart';
import 'theme.dart';

void main() => runApp(const PttApp());

class PttApp extends StatefulWidget {
  /// Optional session for tests; when null the app creates and bootstraps
  /// its own session against the configured backend.
  const PttApp({super.key, this.session});

  final SessionController? session;

  @override
  State<PttApp> createState() => _PttAppState();
}

class _PttAppState extends State<PttApp> {
  late final SessionController _session = widget.session ?? SessionController();

  @override
  void initState() {
    super.initState();
    // When the app owns the session it bootstraps itself; injected sessions
    // (tests) are set up by the caller.
    if (widget.session == null) _session.bootstrap();
  }

  @override
  void dispose() {
    if (widget.session == null) _session.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return BackendScope(
      controller: _session,
      // Rebuild MaterialApp when the theme/language preference changes.
      child: ListenableBuilder(
        listenable: _session,
        builder: (context, _) => MaterialApp(
          theme: buildTheme(Brightness.light),
          darkTheme: buildTheme(Brightness.dark),
          themeMode: _session.themeMode,
          locale: _session.locale,
          supportedLocales: const [Locale('en'), Locale('ar')],
          localizationsDelegates: const [
            AppStrings.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: const AuthGate(),
        ),
      ),
    );
  }
}
