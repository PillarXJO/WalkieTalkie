import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

/// Persists the opaque refresh token (and cached access token) between launches.
///
/// The refresh token is long-lived and rotated by the server on every refresh;
/// store it in secure storage on production builds (see `SecureTokenStore`).
abstract class TokenStore {
  Future<String?> readRefreshToken();
  Future<void> writeRefreshToken(String token);
  Future<void> clear();
}

/// Default implementation backed by SharedPreferences.
///
/// NOTE: swap for `flutter_secure_storage` before shipping; SharedPreferences is
/// not encrypted. This keeps the integration layer dependency-light.
class PreferencesTokenStore implements TokenStore {
  PreferencesTokenStore({this.key = 'ptt.refresh_token'});

  final String key;

  @override
  Future<String?> readRefreshToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(key);
  }

  @override
  Future<void> writeRefreshToken(String token) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(key, token);
  }

  @override
  Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(key);
  }
}

/// In-memory store used by tests (no SharedPreferences plugin needed).
class MemoryTokenStore implements TokenStore {
  MemoryTokenStore([this._token]);

  String? _token;

  @override
  Future<String?> readRefreshToken() async => _token;

  @override
  Future<void> writeRefreshToken(String token) async => _token = token;

  @override
  Future<void> clear() async => _token = null;
}

/// Helper to encode/decode opaque payloads without a JSON codegen dependency.
Map<String, dynamic> decodeJsonObject(String source) =>
    jsonDecode(source) as Map<String, dynamic>;
