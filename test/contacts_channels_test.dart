import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ptt_app/app_state.dart';
import 'package:ptt_app/screens.dart';
import 'package:ptt_app/strings.dart';
import 'package:ptt_app/theme.dart';

Widget _app(SessionController session, Widget home) => BackendScope(
      controller: session,
      child: MaterialApp(
        supportedLocales: const [Locale('en'), Locale('ar')],
        localizationsDelegates: const [
          AppStrings.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        theme: buildTheme(Brightness.dark),
        home: home,
      ),
    );

void main() {
  group('userIdFrom', () {
    test('parses a ptt user deep link', () {
      expect(SessionController.userIdFrom('ptt://user/abc123XYZ'), 'abc123XYZ');
    });

    test('parses a bare id', () {
      expect(SessionController.userIdFrom('  user_12345  '), 'user_12345');
    });

    test('rejects an invite link and junk', () {
      expect(SessionController.userIdFrom('ptt://invite/abcdefgh'), isNull);
      expect(SessionController.userIdFrom('not a code!!'), isNull);
      expect(SessionController.userIdFrom('short'), isNull);
    });

    test('userCode round-trips', () {
      expect(SessionController.userIdFrom(SessionController.userCode('clx98765')), 'clx98765');
    });
  });

  testWidgets('home tabs expose invite/join and new-channel entries', (tester) async {
    final session = SessionController()..initializing = false;
    session.setForTestUser();
    addTearDown(session.dispose);

    await tester.pumpWidget(_app(session, const HomeShell()));
    await tester.pumpAndSettle();

    expect(find.text('Invite your team'), findsOneWidget);
    expect(find.text('Join with invite code'), findsOneWidget);

    await tester.tap(find.widgetWithText(NavigationDestination, 'Channels'));
    await tester.pumpAndSettle();

    expect(find.text('New channel'), findsOneWidget);
  });
}
