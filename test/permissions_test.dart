import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:ptt_app/screens.dart';

void main() {
  const channel = MethodChannel('flutter.baseflow.com/permissions/methods');

  void mockPermissions(
    WidgetTester tester, {
    required int status,
    required List<MethodCall> calls,
  }) {
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      switch (call.method) {
        case 'checkPermissionStatus':
          return status;
        case 'requestPermissions':
          final ids = (call.arguments as List).cast<int>();
          return {for (final id in ids) id: 1}; // 1 == granted
        case 'openAppSettings':
          return true;
      }
      return null;
    });
    addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, null));
  }

  Future<void> pumpScreen(WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(1200, 2200));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(const MaterialApp(home: PermissionsScreen()));
    await tester.pumpAndSettle();
  }

  testWidgets('tapping a permission requests it from the OS', (tester) async {
    final calls = <MethodCall>[];
    mockPermissions(tester, status: 0, calls: calls); // 0 == denied
    await pumpScreen(tester);

    await tester.tap(find.text('Record Audio'));
    await tester.pumpAndSettle();

    final request = calls.where((c) => c.method == 'requestPermissions').toList();
    expect(request, hasLength(1));
    expect((request.single.arguments as List).cast<int>(), contains(Permission.microphone.value));
    expect(calls.any((c) => c.method == 'openAppSettings'), isFalse);
  });

  testWidgets('tapping an already-granted permission opens app settings', (tester) async {
    final calls = <MethodCall>[];
    mockPermissions(tester, status: 1, calls: calls); // 1 == granted
    await pumpScreen(tester);

    await tester.tap(find.text('Record Audio'));
    await tester.pumpAndSettle();

    expect(calls.any((c) => c.method == 'openAppSettings'), isTrue);
    expect(calls.any((c) => c.method == 'requestPermissions'), isFalse);
  });
}
