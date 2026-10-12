# PTT App (Flutter client)

Push-to-talk front-end for the PTT backend (`./backend`). The app always
connects to the real backend: it gates behind login/registration
(`lib/auth_screens.dart`), walks through the runtime App Permissions screen,
and loads real contacts, channels, presence, floor state and alerts.

## Run

```bash
flutter pub get
flutter run   # Android emulator: 10.0.2.2 = host loopback
```

Override endpoints at build/run time (defaults point at `http://10.0.2.2:3000`):

```bash
flutter run \
  --dart-define=API_BASE_URL=http://10.0.2.2:3000 \
  --dart-define=WS_BASE_URL=ws://10.0.2.2:3000/ws
```

## Layout

- `lib/api/` — backend integration layer (no Flutter dependency except the HTTP/WS packages):
  - `api_config.dart` — `--dart-define` config (`API_BASE_URL`, `WS_BASE_URL`, device metadata).
  - `api_client.dart` — REST client with bearer auth, automatic 401→refresh→retry, and error-envelope mapping.
  - `api_exception.dart` — typed `ApiException` (`code`, `statusCode`, `details`).
  - `models.dart` — DTOs mirroring backend responses (`AppUser`, `Channel`, `Contact`, `FloorState`, `Alert`, …).
  - `repositories.dart` — one API class per backend module (auth, users, workspaces, channels, ptt, history, media, location, alerts, notifications, admin).
  - `realtime_client.dart` — WebSocket control plane (presence, floor request/release, alerts) with auto-reconnect.
  - `token_store.dart` — refresh-token persistence (`SharedPreferences`; swap for secure storage in production).
- `lib/app_state.dart` — `SessionController` (ChangeNotifier) wiring auth + realtime + repositories, exposed to widgets via `BackendScope`.
- `lib/auth_screens.dart` — login / MFA / registration + `AuthGate`.
- `lib/main.dart` — app entry; always starts at `AuthGate`.
- `lib/screens.dart` — `InviteScreen`, per-OS `PermissionsScreen`, `HomeShell`, `TalkScreen`.
- `lib/widgets.dart` — shared UI widgets (`StatusAvatar`, `PttButton`, `ContactTile`, `ChannelTile`, `MiniPlayer`).
- `lib/ui_models.dart` — presentation-only view models (`Presence`, `Contact`, `Channel`).

## Not built yet (platform layer)

Audio capture/playback, push (FCM/APNs) registration, location permission
prompts and the Android/iOS PTT foreground service are platform-specific and
belong in the native project. The control plane they need (LiveKit token,
push-token registration, location pings) is already exposed by this layer.

Backend setup and API docs: see `./backend/README.md`.