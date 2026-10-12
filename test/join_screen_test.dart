import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ptt_app/screens.dart';

void main() {
  testWidgets('join screen renders the QR scan action', (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(1200, 2200));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    // Renders without network: handlers only touch the backend once a code is
    // checked or a workspace is joined.
    await tester.pumpWidget(const MaterialApp(home: JoinScreen()));
    await tester.pump();

    expect(find.text('Join a workspace'), findsOneWidget);
    expect(find.text('SCAN QR CODE'), findsOneWidget);
    expect(find.text('JOIN WORKSPACE'), findsOneWidget);
  });
}