import 'package:flutter_test/flutter_test.dart';
import 'package:ptt_app/app_state.dart';

void main() {
  group('SessionController.inviteCodeFrom', () {
    test('parses deep links, web links, and bare codes', () {
      expect(SessionController.inviteCodeFrom('ptt://invite/abcdefgh'), 'abcdefgh');
      expect(SessionController.inviteCodeFrom('ptt://invite/abcd1234'), 'abcd1234');
      expect(SessionController.inviteCodeFrom('https://link.ptt.example.com/i/abcdefgh'), 'abcdefgh');
      expect(SessionController.inviteCodeFrom('https://link.ptt.example.com/invite/abcdefgh'), 'abcdefgh');
      expect(SessionController.inviteCodeFrom('abcdefgh'), 'abcdefgh');
      expect(SessionController.inviteCodeFrom('  ptt://invite/abcdefgh  '), 'abcdefgh');
    });

    test('rejects junk', () {
      expect(SessionController.inviteCodeFrom(''), isNull);
      expect(SessionController.inviteCodeFrom('not a code'), isNull);
      expect(SessionController.inviteCodeFrom('abcdefg'), isNull);
      expect(SessionController.inviteCodeFrom('https://example.com/page/not-an-invite'), isNull);
    });
  });
}