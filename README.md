# PTT App (Flutter client)

Push-to-talk front-end for the PTT backend (`./backend`). It ships with a
mock-data demo flow **and** a real backend integration layer under `lib/api/`.

## Run modes

Demo (mock data, no backend — the default):

```bash
flutter create . --platforms=android,ios   # first time only
flutter pub get
flutter run
```

Against the backend:

```bash
# Android emulator (10.0.2.2 = host loopback); use your LAN IP for devices.
flutter run \
  --dart-define=USE_BACKEND=true \
  --dart-define=API_BASE_URL=http://10.0.2.2:8080 \
  --dart-define=WS_BASE_URL=ws://10.0.2.2:8080/ws
```

With `USE_BACKEND=true` the app gates behind login/registration
(`lib/auth_screens.dart`) and the home screen loads real contacts, channels,
presence, floor state and alerts.

## Layout

- `lib/api/` — backend integration layer (no Flutter dependency except the HTTP/WS packages):
  - `api_config.dart` — `--dart-define` config (`API_BASE_URL`, `WS_BASE_URL`, `USE_BACKEND`, device metadata).
  - `api_client.dart` — REST client with bearer auth, automatic 401→refresh→retry, and error-envelope mapping.
  - `api_exception.dart` — typed `ApiException` (`code`, `statusCode`, `details`).
  - `models.dart` — DTOs mirroring backend responses (`AppUser`, `Channel`, `Contact`, `FloorState`, `Alert`, …).
  - `repositories.dart` — one API class per backend module (auth, users, workspaces, channels, ptt, history, media, location, alerts, notifications, admin).
  - `realtime_client.dart` — WebSocket control plane (presence, floor request/release, alerts) with auto-reconnect.
  - `token_store.dart` — refresh-token persistence (`SharedPreferences`; swap for secure storage in production).
- `lib/app_state.dart` — `SessionController` (ChangeNotifier) wiring auth + realtime + repositories, exposed to widgets via `BackendScope`.
- `lib/auth_screens.dart` — login / MFA / registration + `AuthGate`.
- `lib/main.dart` — chooses the mock flow or the authed backend flow.
- `lib/screens.dart`, `lib/widgets.dart`, `lib/theme.dart`, `lib/mock_data.dart` — the original UI; `HomeShell`/`TalkScreen` read live data when backend mode is on.

## Not built yet (platform layer)

Audio capture/playback, push (FCM/APNs) registration, location permission
prompts and the Android/iOS PTT foreground service are platform-specific and
belong in the native project. The control plane they need (LiveKit token,
push-token registration, location pings) is already exposed by this layer.

Backend setup and API docs: see `./backend/README.md`.
