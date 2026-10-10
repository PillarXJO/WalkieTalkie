/// Runtime configuration for the backend integration layer.
///
/// Override at build/run time, e.g.:
///   flutter run --dart-define=API_BASE_URL=http://10.0.2.2:8080 \
///               --dart-define=WS_BASE_URL=ws://10.0.2.2:8080/ws \
///               --dart-define=USE_BACKEND=true
///
/// `10.0.2.2` is the host loopback as seen from the Android emulator. Use the
/// machine's LAN IP for physical devices.
class ApiConfig {
  const ApiConfig({
    this.baseUrl = const String.fromEnvironment('API_BASE_URL', defaultValue: 'http://10.0.2.2:8080'),
    this.wsUrl = const String.fromEnvironment('WS_BASE_URL', defaultValue: 'ws://10.0.2.2:8080/ws'),
    this.useBackend = const bool.fromEnvironment('USE_BACKEND', defaultValue: false),
    this.appVersion = const String.fromEnvironment('APP_VERSION', defaultValue: '0.1.0'),
    this.deviceId = const String.fromEnvironment('DEVICE_ID', defaultValue: 'flutter-dev'),
    this.deviceName = const String.fromEnvironment('DEVICE_NAME', defaultValue: 'Flutter device'),
    this.platform = const String.fromEnvironment('DEVICE_PLATFORM', defaultValue: 'flutter'),
  });

  final String baseUrl;
  final String wsUrl;

  /// When false the app keeps using [MockService]; when true screens talk to
  /// the real backend through this layer.
  final bool useBackend;

  final String appVersion;
  final String deviceId;
  final String deviceName;
  final String platform;

  static const ApiConfig current = ApiConfig();
}
