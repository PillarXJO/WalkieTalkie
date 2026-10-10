/// Error raised by the API layer for any non-2xx response or transport failure.
///
/// Mirrors the backend's `{ error: { code, message, details } }` envelope.
class ApiException implements Exception {
  ApiException(this.statusCode, this.code, this.message, [this.details]);

  final int statusCode;
  final String code;
  final String message;
  final Object? details;

  bool get isUnauthorized => statusCode == 401;
  bool get isForbidden => statusCode == 403;
  bool get isNotFound => statusCode == 404;
  bool get isConflict => statusCode == 409;

  /// True for network/timeout failures (no HTTP status).
  bool get isNetwork => statusCode == 0;

  static ApiException network(Object error) =>
      ApiException(0, 'network_error', 'Could not reach the server: $error');

  @override
  String toString() => 'ApiException($statusCode, $code): $message';
}
