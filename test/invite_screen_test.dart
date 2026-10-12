import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:ptt_app/api/backend.dart';
import 'package:ptt_app/app_state.dart';
import 'package:ptt_app/screens.dart';

void main() {
  testWidgets('invite screen mounts without reading BackendScope in initState',
      (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(1200, 2200));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    // Signed-out session has no workspace, so the screen reports guidance
    // instead of hitting the network. Regression: this used to throw
    // "dependOnInheritedWidgetOfExactType was called before initState completed"
    // and left the page stuck on a spinner forever.
    final session = SessionController()..initializing = false;

    await tester.pumpWidget(BackendScope(
      controller: session,
      child: const MaterialApp(home: InviteScreen()),
    ));
    await tester.pump(); // didChangeDependencies -> _load (no workspace)
    await tester.pump();

    expect(tester.takeException(), isNull);
    expect(find.text('Invite your team'), findsOneWidget);
    expect(find.textContaining('not in a workspace'), findsOneWidget);
  });

  testWidgets('CREATE A NEW CODE ignores extra taps while revoking', (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(1200, 2200));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    var revokes = 0;
    final client = MockClient((req) async {
      // Delay so the request stays in flight between the two taps.
      await Future<void>.delayed(const Duration(milliseconds: 50));
      final path = req.url.path;
      if (req.method == 'GET' && path.endsWith('/invites')) {
        return http.Response(
          jsonEncode([
            {
              'code': 'oldcode1',
              'role': 'member',
              'maxUses': 1,
              'useCount': 0,
              'expiresAt': null,
              'deepLink': 'ptt://invite/oldcode1',
              'url': 'https://example.test/i/oldcode1',
            }
          ]),
          200,
          headers: {'content-type': 'application/json'},
        );
      }
      if (req.method == 'DELETE') {
        revokes++;
        return http.Response('', 204);
      }
      return http.Response(
        jsonEncode({
          'code': 'newcode1',
          'role': 'member',
          'maxUses': 1,
          'useCount': 0,
          'expiresAt': null,
          'deepLink': 'ptt://invite/newcode1',
          'url': 'https://example.test/i/newcode1',
        }),
        200,
        headers: {'content-type': 'application/json'},
      );
    });

    final session = SessionController(
      api: ApiClient(config: const ApiConfig(baseUrl: 'http://example.test'), httpClient: client),
    )..initializing = false;
    session.workspace = WorkspaceBrief(id: 'ws1', name: 'Dev Workspace', role: 'owner');
    addTearDown(session.dispose);

    await tester.pumpWidget(BackendScope(
      controller: session,
      child: const MaterialApp(home: InviteScreen()),
    ));
    await tester.pump(); // kick off _load
    await tester.pump(const Duration(milliseconds: 200)); // resolve listing

    expect(find.text('CREATE A NEW CODE'), findsOneWidget);

    // Two taps land before the first revoke completes.
    await tester.tap(find.text('CREATE A NEW CODE'));
    await tester.tap(find.text('CREATE A NEW CODE'));
    await tester.pump(const Duration(seconds: 1));

    expect(tester.takeException(), isNull);
    expect(revokes, 1);
    expect(find.textContaining('NEWCODE1'), findsOneWidget);
  });
}