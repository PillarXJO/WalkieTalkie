import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ptt_app/app_state.dart';
import 'package:ptt_app/screens.dart';
import 'package:ptt_app/strings.dart';
import 'package:ptt_app/theme.dart';

Widget _app(SessionController session, {Locale locale = const Locale('en')}) => BackendScope(
      controller: session,
      child: MaterialApp(
        locale: locale,
        supportedLocales: const [Locale('en'), Locale('ar')],
        localizationsDelegates: const [
          AppStrings.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        theme: buildTheme(Brightness.dark),
        home: const SettingsScreen(),
      ),
    );

void main() {
  testWidgets('settings screen exposes permissions, theme, language and sign out', (tester) async {
    final session = SessionController()..initializing = false;
    session.setForTestUser();
    addTearDown(session.dispose);

    await tester.pumpWidget(_app(session));
    await tester.pumpAndSettle();

    expect(find.text('Settings'), findsOneWidget);
    expect(find.text('Permissions'), findsOneWidget);
    expect(find.text('Theme'), findsOneWidget);
    expect(find.text('Language'), findsOneWidget);
    expect(find.text('Sign out'), findsOneWidget);
  });

  testWidgets('tapping the theme switch flips the session to light', (tester) async {
    final session = SessionController()..initializing = false;
    session.setForTestUser();
    addTearDown(session.dispose);
    expect(session.themeMode, ThemeMode.dark);

    await tester.pumpWidget(_app(session));
    await tester.tap(find.byType(SwitchListTile));
    await tester.pump();

    expect(session.themeMode, ThemeMode.light);
  });

  testWidgets('tapping language toggles between English and Arabic', (tester) async {
    final session = SessionController()..initializing = false;
    session.setForTestUser();
    addTearDown(session.dispose);
    expect(session.isArabic, isFalse);

    await tester.pumpWidget(_app(session));
    await tester.tap(find.text('Language'));
    await tester.pump();
    expect(session.isArabic, isTrue);

    await tester.tap(find.text('Language'));
    await tester.pump();
    expect(session.isArabic, isFalse);
  });

  testWidgets('Arabic locale renders localized labels and RTL', (tester) async {
    final session = SessionController()..initializing = false;
    session.setForTestUser();
    addTearDown(session.dispose);

    await tester.pumpWidget(_app(session, locale: const Locale('ar')));
    await tester.pumpAndSettle();

    expect(find.text('الإعدادات'), findsOneWidget);
    expect(find.text('المظهر'), findsOneWidget);
    expect(find.text('اللغة'), findsOneWidget);
    expect(find.text('تسجيل الخروج'), findsOneWidget);
    expect(Directionality.of(tester.element(find.text('الإعدادات'))), TextDirection.rtl);
  });

  testWidgets('sign out asks for confirmation and cancel keeps the session', (tester) async {
    final session = SessionController()..initializing = false;
    session.setForTestUser();
    addTearDown(session.dispose);

    await tester.pumpWidget(_app(session));
    await tester.tap(find.text('Sign out'));
    await tester.pumpAndSettle();

    expect(find.text('You will need to sign in again to use the app.'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();

    expect(session.user, isNotNull);
  });

  testWidgets('tapping the name in the home bar opens settings', (tester) async {
    final session = SessionController()..initializing = false;
    session.setForTestUser();
    addTearDown(session.dispose);

    await tester.pumpWidget(BackendScope(
      controller: session,
      child: MaterialApp(theme: buildTheme(Brightness.dark), home: const HomeShell()),
    ));
    await tester.pump();
    await tester.tap(find.text('Test User'));
    await tester.pumpAndSettle();

    expect(find.text('Settings'), findsOneWidget);
    expect(find.text('Sign out'), findsOneWidget);
  });
}
