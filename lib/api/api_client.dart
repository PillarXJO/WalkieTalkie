import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'api_config.dart';
import 'api_exception.dart';
import 'token_store.dart';

/// Holds the short-lived access token plus the long-lived refresh token and
/// notifies the app when the session can no longer be recovered.
class AuthTokens {
  AuthTokens({this.accessToken, this.refreshToken, this.expiresAt});

  String? accessToken;
  String? refreshToken;
  DateTime? expiresAt;

  bool get hasRefresh => refreshToken != null && refreshToken!.isNotEmpty;

  void apply(String access, String refresh, int expiresInSeconds) {
    accessToken = access;
    refreshToken = refresh;
    expiresAt = DateTime.now().add(Duration(seconds: expiresInSeconds));
  }

  void clear() {
    accessToken = null;
    refreshToken = null;
    expiresAt = null;
  }
}

/// Low-level REST client.
///
/// - Attaches `Authorization: Bearer <access>` when available.
/// - Attaches device metadata headers so the backend can identify sessions.
/// - On a 401 with a stored refresh token it refreshes once and retries.
/// - Maps the backend error envelope into [ApiException].
class ApiClient {
  ApiClient({
    ApiConfig? config,
    http.Client? httpClient,
    TokenStore? tokenStore,
    this.onSessionExpired,
  })  : config = config ?? ApiConfig.current,
        _http = httpClient ?? http.Client(),
        _tokenStore = tokenStore ?? MemoryTokenStore(),
        tokens = AuthTokens();

  final ApiConfig config;
  final http.Client _http;
  final TokenStore _tokenStore;
  final AuthTokens tokens;

  /// Invoked when refresh fails and the user must log in again.
  void Function()? onSessionExpired;

  Future<void> _loadStoredRefresh() async {
    if (tokens.hasRefresh) return;
    final stored = await _tokenStore.readRefreshToken();
    if (stored != null) tokens.refreshToken = stored;
  }

  void setTokens({required String access, required String refresh, required int expiresInSeconds}) {
    tokens.apply(access, refresh, expiresInSeconds);
    unawaited(_tokenStore.writeRefreshToken(refresh));
  }

  /// Replace only the access token (e.g. after switching workspace, which mints
  /// a workspace-scoped access token but keeps the same refresh token/session).
  void updateAccess(String access, int expiresInSeconds) {
    tokens.accessToken = access;
    tokens.expiresAt = DateTime.now().add(Duration(seconds: expiresInSeconds));
  }

  Future<void> clearSession() async {
    tokens.clear();
    await _tokenStore.clear();
  }

  Map<String, String> _headers({bool json = true}) => {
        if (json) 'content-type': 'application/json',
        'accept': 'application/json',
        'x-device-id': config.deviceId,
        'x-device-name': config.deviceName,
        'x-device-platform': config.platform,
        'x-app-version': config.appVersion,
        if (tokens.accessToken != null) 'authorization': 'Bearer ${tokens.accessToken}',
      };

  Uri _uri(String path, [Map<String, dynamic>? query]) {
    final base = config.baseUrl.replaceAll(RegExp(r'/$'), '');
    final normalized = path.startsWith('/') ? path : '/$path';
    final uri = Uri.parse('$base$normalized');
    if (query == null || query.isEmpty) return uri;
    final qp = <String, String>{};
    query.forEach((k, v) {
      if (v != null) qp[k] = '$v';
    });
    return uri.replace(queryParameters: {...uri.queryParameters, ...qp});
  }

  Future<dynamic> get(String path, {Map<String, dynamic>? query}) =>
      _send(() => _http.get(_uri(path, query), headers: _headers(json: false)), authenticated: true);

  Future<dynamic> post(String path, {Object? body, Map<String, dynamic>? query, bool authenticated = true}) => _send(
        () => _http.post(_uri(path, query),
            headers: _headers(json: body != null), body: body == null ? null : jsonEncode(body)),
        authenticated: authenticated,
      );

  Future<dynamic> put(String path, {Object? body, bool authenticated = true}) => _send(
        () => _http.put(_uri(path), headers: _headers(json: body != null), body: body == null ? null : jsonEncode(body)),
        authenticated: authenticated,
      );

  Future<dynamic> patch(String path, {Object? body}) => _send(
        () => _http.patch(_uri(path), headers: _headers(json: body != null), body: body == null ? null : jsonEncode(body)),
        authenticated: true,
      );

  Future<dynamic> delete(String path, {Object? body}) => _send(
        () => _http.delete(_uri(path), headers: _headers(json: body != null), body: body == null ? null : jsonEncode(body)),
        authenticated: true,
      );

  Future<dynamic> _send(Future<http.Response> Function() request, {required bool authenticated}) async {
    if (authenticated) await _loadStoredRefresh();
    http.Response response;
    try {
      response = await request().timeout(const Duration(seconds: 20));
    } on TimeoutException catch (e) {
      throw ApiException.network(e);
    } catch (e) {
      throw ApiException.network(e);
    }

    if (response.statusCode == 401 && authenticated && tokens.hasRefresh) {
      final refreshed = await _tryRefresh();
      if (refreshed) {
        try {
          response = await request().timeout(const Duration(seconds: 20));
        } catch (e) {
          throw ApiException.network(e);
        }
      }
    }

    return _decode(response);
  }

  Future<bool> _tryRefresh() async {
    final refresh = tokens.refreshToken;
    if (refresh == null) return false;
    try {
      await _loadStoredRefresh();
      final res = await _http
          .post(
            _uri('/auth/refresh'),
            headers: _headers(),
            body: jsonEncode({'refreshToken': refresh}),
          )
          .timeout(const Duration(seconds: 20));
      if (res.statusCode < 200 || res.statusCode >= 300) {
        await clearSession();
        onSessionExpired?.call();
        return false;
      }
      final body = decodeJsonObject(res.body);
      final access = body['accessToken'] as String?;
      final newRefresh = body['refreshToken'] as String? ?? refresh;
      final expires = (body['expiresInSeconds'] as num?)?.toInt() ?? 300;
      if (access == null) {
        await clearSession();
        onSessionExpired?.call();
        return false;
      }
      setTokens(access: access, refresh: newRefresh, expiresInSeconds: expires);
      return true;
    } catch (_) {
      return false;
    }
  }

  dynamic _decode(http.Response response) {
    final text = response.body.trim();
    dynamic json;
    if (text.isNotEmpty) {
      try {
        json = jsonDecode(text);
      } catch (_) {
        json = null;
      }
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return json;
    }

    String code = 'http_${response.statusCode}';
    String message = 'Request failed (${response.statusCode})';
    Object? details;
    if (json is Map<String, dynamic>) {
      final err = json['error'];
      if (err is Map<String, dynamic>) {
        code = (err['code'] as String?) ?? code;
        message = (err['message'] as String?) ?? message;
        details = err['details'];
      } else if (json['message'] is String) {
        message = json['message'] as String;
      }
    }
    throw ApiException(response.statusCode, code, message, details);
  }

  void close() => _http.close();
}
