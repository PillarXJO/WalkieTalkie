import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ptt_app/app_state.dart';
import 'package:ptt_app/main.dart';

void main() {
  testWidgets('boots to the sign-in screen (no demo data)', (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(1200, 2200));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    // Fresh session with no stored token -> signed out, not initializing, so
    // AuthGate shows the login screen without any network access.
    final session = SessionController()..initializing = false;

    await tester.pumpWidget(PttApp(session: session));
    await tester.pump();

    expect(find.text('SIGN IN'), findsOneWidget);
    expect(find.text('Welcome back'), findsOneWidget);
  });

  testWidgets('authenticated but not onboarded reaches the permissions screen',
      (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(1200, 2200));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    final session = SessionController()
      ..initializing = false
      ..onboardingComplete = false;
    session.setForTestUser();

    await tester.pumpWidget(PttApp(session: session));
    await tester.pump();

    expect(find.text('App Permissions'), findsOneWidget);
    expect(find.text('CONTINUE'), findsOneWidget);
  });
}