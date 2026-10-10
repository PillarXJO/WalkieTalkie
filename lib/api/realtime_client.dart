import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

import 'api_config.dart';
import 'api_client.dart';
import 'models.dart';

/// A single server-pushed event. `data`/`channelId`/`workspaceId` are raw; use
/// the typed getters below for the events you care about.
class RealtimeEvent {
  RealtimeEvent({required this.type, this.channelId, this.workspaceId, this.at, this.data = const {}});

  /// `init` | `presence` | `floor.state` | `floor.granted` | `floor.released`
  /// | `transmission.complete` | `transmission.echo` | `alert.created`
  /// | `alert.acknowledged` | `alert.resolved` | `pong` | `error`.
  final String type;
  final String? channelId;
  final String? workspaceId;
  final DateTime? at;
  final Map<String, dynamic> data;

  FloorState? get floor {
    final inner = data['state'] ?? data['floor'];
    return inner is Map<String, dynamic> ? FloorState.fromJson(inner) : null;
  }

  /// Alert events carry the alert fields directly in `data` (optionally nested
  /// under `data.alert` by future backends).
  Alert? get alert {
    if (!type.startsWith('alert.')) return null;
    final inner = data['alert'];
    final src = inner is Map<String, dynamic> ? inner : data;
    return src.isEmpty ? null : Alert.fromJson(src);
  }

  ContactPresence? get presence => type == 'presence' ? ContactPresence.fromJson(data) : null;
  String? get errorMessage => type == 'error' ? strOrNull(data['message']) : null;

  factory RealtimeEvent.fromJson(Map<String, dynamic> j) {
    final type = str(j['type']);
    final raw = j['data'];
    // Presence payloads have no `data` wrapper: the fields sit at the top level.
    final data = raw is Map<String, dynamic>
        ? raw
        : type == 'presence'
            ? j
            : const <String, dynamic>{};
    return RealtimeEvent(
      type: type,
      channelId: strOrNull(j['channelId']),
      workspaceId: strOrNull(j['workspaceId']),
      at: dateOrNull(j['at']),
      data: data,
    );
  }
}

enum RealtimeStatus { disconnected, connecting, connected }

/// WebSocket control-plane client for presence, floor control and alerts.
///
/// Audio itself is carried by LiveKit; this socket only carries signaling.
/// Reconnects automatically with capped exponential backoff.
class RealtimeClient {
  RealtimeClient({ApiConfig? config, ApiClient? api})
      : config = config ?? ApiConfig.current,
        _api = api ?? ApiClient();

  final ApiConfig config;
  final ApiClient _api;

  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _sub;
  Timer? _reconnectTimer;
  int _attempt = 0;
  bool _closedByUser = false;

  final _events = StreamController<RealtimeEvent>.broadcast();
  final _status = StreamController<RealtimeStatus>.broadcast();

  Stream<RealtimeEvent> get events => _events.stream;
  Stream<RealtimeStatus> get status => _status.stream;

  Uri get _endpoint {
    final token = _api.tokens.accessToken ?? '';
    final base = config.wsUrl;
    final uri = Uri.parse(base);
    return uri.replace(queryParameters: {...uri.queryParameters, if (token.isNotEmpty) 'token': token});
  }

  void connect() {
    _closedByUser = false;
    _open();
  }

  void _open() {
    _status.add(RealtimeStatus.connecting);
    try {
      final channel = WebSocketChannel.connect(_endpoint);
      _channel = channel;
      _sub = channel.stream.listen(
        _onMessage,
        onError: (_) => _scheduleReconnect(),
        onDone: _scheduleReconnect,
        cancelOnError: true,
      );
      _status.add(RealtimeStatus.connected);
      _attempt = 0;
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void _onMessage(dynamic raw) {
    if (raw is! String) return;
    late Map<String, dynamic> json;
    try {
      json = jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return;
    }
    final event = RealtimeEvent.fromJson(json);
    if (event.type == 'pong') return;
    _events.add(event);
  }

  void _scheduleReconnect() {
    _status.add(RealtimeStatus.disconnected);
    if (_closedByUser) return;
    _reconnectTimer?.cancel();
    final steps = const [500, 1000, 2000, 4000, 8000];
    final delay = Duration(milliseconds: steps[_attempt < steps.length ? _attempt : steps.length - 1]);
    _attempt++;
    _reconnectTimer = Timer(delay, _open);
  }

  void _send(Map<String, dynamic> message) {
    final channel = _channel;
    if (channel != null) channel.sink.add(jsonEncode(message));
  }

  void setPresence(String status, [String statusMessage = '']) => _send({'type': 'presence:set', 'status': status, 'statusMessage': statusMessage});
  void requestFloor(String channelId, {String priority = 'normal'}) => _send({'type': 'floor:request', 'channelId': channelId, 'priority': priority});
  void releaseFloor(String channelId) => _send({'type': 'floor:release', 'channelId': channelId});
  void ping() => _send({'type': 'ping'});

  Future<void> dispose() async {
    _closedByUser = true;
    _reconnectTimer?.cancel();
    await _sub?.cancel();
    await _channel?.sink.close();
    await _events.close();
    await _status.close();
  }
}
