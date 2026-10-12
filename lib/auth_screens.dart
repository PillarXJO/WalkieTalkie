import 'package:flutter/material.dart';

import 'api/backend.dart';
import 'app_state.dart';
import 'screens.dart';
import 'strings.dart';
import 'theme.dart';

final _emailRe = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');
bool _isEmail(String s) => _emailRe.hasMatch(s);
String _describeError(ApiException e, AppStrings t) =>
    e.code == 'validation_failed' ? t.validationFailed : e.message;

/// Routes between the onboarding screens based on the session state.
class AuthGate extends StatelessWidget {
  const AuthGate({super.key});

  @override
  Widget build(BuildContext context) {
    final session = BackendScope.of(context);
    if (session.initializing) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (!session.isAuthenticated) return const LoginScreen();
    if (!session.onboardingComplete) return const PermissionsScreen();
    return const HomeShell();
  }
}

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _code = TextEditingController();
  String? _mfaToken;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final t = AppStrings.of(context);
    final email = _email.text.trim();
    if (_mfaToken == null) {
      if (email.isEmpty || !_isEmail(email)) {
        setState(() => _error = t.enterValidEmail);
        return;
      }
      if (_password.text.isEmpty) {
        setState(() => _error = t.enterPassword);
        return;
      }
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final session = BackendScope.of(context);
    try {
      if (_mfaToken != null) {
        await session.verifyMfa(mfaToken: _mfaToken!, code: _code.text.trim());
      } else {
        final result = await session.login(email: email, password: _password.text);
        if (result.requiresMfa) {
          setState(() => _mfaToken = result.mfaToken);
        }
      }
    } on ApiException catch (e) {
      setState(() => _error = _describeError(e, t));
    } catch (e) {
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppStrings.of(context);
    final tk = Tk.of(context);
    final mfa = _mfaToken != null;
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(28),
          children: [
            const SizedBox(height: 40),
            Text(t.welcomeBack, style: const TextStyle(fontSize: 34)),
            const SizedBox(height: 8),
            Text(t.signInSubtitle, style: TextStyle(color: tk.muted, fontSize: 18)),
            const SizedBox(height: 32),
            if (!mfa) ...[
              TextField(controller: _email, keyboardType: TextInputType.emailAddress, decoration: InputDecoration(labelText: t.email)),
              const SizedBox(height: 16),
              TextField(controller: _password, obscureText: true, decoration: InputDecoration(labelText: t.password)),
            ] else
              TextField(controller: _code, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: t.mfaCodeLabel)),
            const SizedBox(height: 24),
            if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(_error!, style: TextStyle(color: tk.red))),
            FilledButton(onPressed: _busy ? null : _submit, child: Text(_busy ? t.pleaseWait : (mfa ? t.verify : t.signIn))),
            const SizedBox(height: 12),
            TextButton(
              onPressed: _busy
                  ? null
                  : () => Navigator.push(context, MaterialPageRoute(builder: (_) => const RegisterScreen())),
              child: Text(t.createAnAccount),
            ),
          ],
        ),
      ),
    );
  }
}

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});
  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final t = AppStrings.of(context);
    final name = _name.text.trim();
    final email = _email.text.trim();
    if (name.isEmpty) {
      setState(() => _error = t.enterName);
      return;
    }
    if (email.isEmpty || !_isEmail(email)) {
      setState(() => _error = t.enterValidEmail);
      return;
    }
    if (_password.text.length < 8) {
      setState(() => _error = t.passwordTooShort);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await BackendScope.of(context).register(name: name, email: email, password: _password.text);
      if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
    } on ApiException catch (e) {
      setState(() => _error = _describeError(e, t));
    } catch (e) {
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppStrings.of(context);
    final tk = Tk.of(context);
    return Scaffold(
      appBar: AppBar(),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(28),
          children: [
            Text(t.createYourWorkspace, style: const TextStyle(fontSize: 32)),
            const SizedBox(height: 28),
            TextField(controller: _name, decoration: InputDecoration(labelText: t.fullName)),
            const SizedBox(height: 16),
            TextField(controller: _email, keyboardType: TextInputType.emailAddress, decoration: InputDecoration(labelText: t.email)),
            const SizedBox(height: 16),
            TextField(controller: _password, obscureText: true, decoration: InputDecoration(labelText: t.passwordMinChars)),
            const SizedBox(height: 24),
            if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(_error!, style: TextStyle(color: tk.red))),
            FilledButton(onPressed: _busy ? null : _submit, child: Text(_busy ? t.pleaseWait : t.createAccount)),
          ],
        ),
      ),
    );
  }
}
