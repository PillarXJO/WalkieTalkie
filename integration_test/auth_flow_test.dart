import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:ptt_app/api/backend.dart';

/// Runs ON the Android emulator and talks to the backend on the host
/// (`10.0.2.2:3000`), proving the register ("create account") request path
/// works end to end after the API port fix.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('create account succeeds against the live backend', (tester) async {
    final client = ApiClient(config: ApiConfig.current);
    final auth = AuthApi(client);
    final email = 'it${DateTime.now().millisecondsSinceEpoch}@test.dev';

    final result = await auth.register(name: 'IT User', email: email, password: 'Passw0rd!x');

    expect(result.accessToken, isNotEmpty);
    expect(result.user.email, email);
    expect(result.workspaces, isNotEmpty);

    await auth.logout();
    client.close();
  });
}
