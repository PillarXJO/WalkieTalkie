import 'package:flutter/material.dart';

import 'api/backend.dart';
import 'app_state.dart';
import 'screens.dart';
import 'theme.dart';

/// Chooses the entry point based on backend state:
/// - initializing -> splash
/// - authenticated -> the existing [HomeShell]
/// - otherwise -> [LoginScreen]
///
/// Mock mode (USE_BACKEND=false) never reaches this widget.
class AuthGate extends StatelessWidget {
  const AuthGate({super.key});

  @override
  Widget build(BuildContext context) {
    final session = BackendScope.of(context);
    if (session.initializing) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    return session.isAuthenticated ? const HomeShell() : const LoginScreen();
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
    setState(() {
      _busy = true;
      _error = null;
    });
    final session = BackendScope.of(context);
    try {
      if (_mfaToken != null) {
        await session.verifyMfa(mfaToken: _mfaToken!, code: _code.text.trim());
      } else {
        final result = await session.login(email: _email.text.trim(), password: _password.text);
        if (result.requiresMfa) {
          setState(() => _mfaToken = result.mfaToken);
        }
      }
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (e) {
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final mfa = _mfaToken != null;
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(28),
          children: [
            const SizedBox(height: 40),
            const Text('Welcome back', style: TextStyle(fontSize: 34)),
            const SizedBox(height: 8),
            const Text('Sign in to your PTT account.', style: TextStyle(color: Tk.muted, fontSize: 18)),
            const SizedBox(height: 32),
            if (!mfa) ...[
              TextField(controller: _email, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'Email')),
              const SizedBox(height: 16),
              TextField(controller: _password, obscureText: true, decoration: const InputDecoration(labelText: 'Password')),
            ] else
              TextField(controller: _code, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: '6-digit code or backup code')),
            const SizedBox(height: 24),
            if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(_error!, style: const TextStyle(color: Tk.red))),
            FilledButton(onPressed: _busy ? null : _submit, child: Text(_busy ? 'PLEASE WAIT' : (mfa ? 'VERIFY' : 'SIGN IN'))),
            const SizedBox(height: 12),
            TextButton(
              onPressed: _busy
                  ? null
                  : () => Navigator.push(context, MaterialPageRoute(builder: (_) => const RegisterScreen())),
              child: const Text('Create an account'),
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
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await BackendScope.of(context).register(
        name: _name.text.trim(),
        email: _email.text.trim(),
        password: _password.text,
      );
      if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (e) {
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(28),
            children: [
              const Text('Create your workspace', style: TextStyle(fontSize: 32)),
              const SizedBox(height: 28),
              TextField(controller: _name, decoration: const InputDecoration(labelText: 'Full name')),
              const SizedBox(height: 16),
              TextField(controller: _email, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'Email')),
              const SizedBox(height: 16),
              TextField(controller: _password, obscureText: true, decoration: const InputDecoration(labelText: 'Password (min 8 chars)')),
              const SizedBox(height: 24),
              if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(_error!, style: const TextStyle(color: Tk.red))),
              FilledButton(onPressed: _busy ? null : _submit, child: Text(_busy ? 'PLEASE WAIT' : 'CREATE ACCOUNT')),
            ],
          ),
        ),
      );
}
