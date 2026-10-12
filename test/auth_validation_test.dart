import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ptt_app/app_state.dart';
import 'package:ptt_app/auth_screens.dart';

Widget _wrap(SessionController session, Widget child) =>
    BackendScope(controller: session, child: MaterialApp(home: child));

void main() {
  testWidgets('login rejects a malformed email locally', (tester) async {
    final session = SessionController()..initializing = false;
    addTearDown(session.dispose);

    await tester.pumpWidget(_wrap(session, const LoginScreen()));
    await tester.enterText(find.byType(TextField).at(0), 'devusertest.dev');
    await tester.enterText(find.byType(TextField).at(1), 'Passw0rd!x');
    await tester.tap(find.byType(FilledButton));
    await tester.pump();

    expect(find.text('Enter a valid email address'), findsOneWidget);
  });

  testWidgets('login rejects an empty password locally', (tester) async {
    final session = SessionController()..initializing = false;
    addTearDown(session.dispose);

    await tester.pumpWidget(_wrap(session, const LoginScreen()));
    await tester.enterText(find.byType(TextField).at(0), 'devuser@test.dev');
    await tester.tap(find.byType(FilledButton));
    await tester.pump();

    expect(find.text('Enter your password'), findsOneWidget);
  });

  testWidgets('register requires an 8 character password', (tester) async {
    final session = SessionController()..initializing = false;
    addTearDown(session.dispose);

    await tester.pumpWidget(_wrap(session, const RegisterScreen()));
    await tester.enterText(find.byType(TextField).at(0), 'New User');
    await tester.enterText(find.byType(TextField).at(1), 'new@example.com');
    await tester.enterText(find.byType(TextField).at(2), 'short');
    await tester.tap(find.byType(FilledButton));
    await tester.pump();

    expect(find.text('Password must be at least 8 characters'), findsOneWidget);
  });
}
