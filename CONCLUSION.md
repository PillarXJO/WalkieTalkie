# PTT App — Work Done So Far (Conclusion)

## 1. What this project is

A push-to-talk (PTT) application with two parts:

- **Backend** — `backend/` — Node 22 + TypeScript, Fastify 5, Prisma (PostgreSQL via Docker; sqlite in tests), Redis pub/sub, LiveKit rooms, S3Mock for voice media, Expo push notifications, Zod schemas.
- **Client** — Flutter app at the repo root (`pubspec.yaml`, `lib/`) — dark Material 3 UI. Originally mock-data only; an integration layer (`lib/api/`) was added so it can talk to the real backend.

---

## 2. Backend — COMPLETE and VERIFIED

All milestones are done and the full gate is green:

```
npm run verify   =>   tsc --noEmit clean + vitest 12 files / 78 tests, ALL PASS
```

| Milestone | Scope | Tests |
|---|---|---|
| M0 | Scaffold: Fastify app, health/readiness, security, CORS, Docker compose (postgres, redis, s3mock, livekit) | scaffold |
| M1 | Repository layer (Prisma schema, repos per aggregate) | repo |
| M2 | Auth: register/login, JWT access + opaque rotated refresh tokens, sessions, password reset, **2FA (TOTP + backup codes)** | auth |
| M3 | Workspaces, members, roles (`admin`/`dispatcher`/`member`), permissions engine (`src/domain/permissions.ts`) | workspaces |
| M4 | Users, contacts, presence (Redis, WS `presence` events), blocks | users |
| M5 | Channels + invites (QR) | channels |
| M6 | Real-time PTT: WS gateway `/ws` (`?token=`), floor control (Redis TTL), LiveKit token minting, echo bot, `ServerEvent` relay | ptt |
| M7 | Voice history: channel/workspace history, search, signed replay URLs | history |
| M8 | Media storage: S3/S3Mock presigned PUT/GET (`/media/upload-url`, `/media/:key/get-url`) | media |
| M9 | Location pings + emergency alerts (WS live events + audit) | safety |
| M10 | Push notifications (Expo), tokens, DND settings, `POST /notifications/test`, alerts→push wiring (`high` priority bypasses DND) | notifications |
| M11 | Admin dashboard + audit log (`/workspaces/:id/admin/dashboard|audit|audit/stats`, permission `admin.stats`/`admin.audit`), `recordAudit` helper | admin |

Backend key facts a continuing model must know:

- Routes are registered in `backend/src/app.ts` (auth → workspaces → users → channels → history → media → location → alerts → notifications → admin → websocket → ptt).
- Error envelope is always `{ error: { code, message, details } }` (Fastify `errorHandler`).
- Auth decorators: `req.requireAuth()`, `requireWorkspace()`, `hasPermission()`, `requirePermission()`. Access-token actor resolve: `resolveAccessActor(token)` (used by WS).
- `ServerEvent` union in `src/lib/server-events.ts`; WS gateway relays events and re-tags presence events with `type: 'presence'` (presence payloads have **no** `data` wrapper; alert & floor events carry payload inside `data`). `floor.state` data = `{ state }`; alert events put the alert object **directly** in `data`.
- Presence is published without `type` → clients must expect top-level `userId/status/statusMessage` (no `data`).
- Push transport is injectable for tests: `setPushTransport` / `resetPushTransport` in `src/lib/push.ts`.

**Test infra pitfalls:**
- Tests boot `buildApp({ logger: false, docs: false })` + `truncateAll()` from `test/helpers/db.ts`; run per file `npx vitest run test/<file>.test.ts`.
- Docker containers (`ptt-postgres-1`, `ptt-redis-1`, `ptt-s3mock-1`, `ptt-livekit-1`) keep dying in this environment — restart with `docker start ptt-postgres-1 ptt-redis-1 ptt-s3mock-1 ptt-livekit-1`. They were up for the last successful `npm run verify` (78/78).
- **s3mock loses the `ptt-voice` bucket on restart** → recreate after every container restart:
  `curl -X PUT http://localhost:9000/ptt-voice` (must be done or 3 M8/readiness tests fail).

---

## 3. Client — Flutter, integration layer (M12)

### Files added/rewritten
- `lib/api/` (pure Dart, no Flutter imports — fully verifiable standalone):
  - `api_config.dart` — `ApiConfig` via `--dart-define` (`API_BASE_URL`, `WS_BASE_URL`, `USE_BACKEND`, device metadata; defaults point at `10.0.2.2:8080`).
  - `api_exception.dart`, `token_store.dart` (`TokenStore` interface + `PreferencesTokenStore` + `MemoryTokenStore`).
  - `models.dart` — tolerant DTO parsing (`asMap/str/intOf/boolOf/dateOrNull` helpers), `library;`, `PresenceStatus` enum, `AppUser`, `Workspace(Brief)`, `Channel`, `Contact(Presence)`, `FloorState`, `Transmission`, `Alert`, `LocationPing`, `NotificationSetting`, `PushToken`, `Paged<T>`.
  - `api_client.dart` — `ApiClient` with bearer header, device headers, on-401 refresh-one-time-and-retry via `/auth/refresh`, `updateAccess()` for workspace switch, `ApiException` mapping.
  - `realtime_client.dart` — `RealtimeClient` (web_socket_channel), `RealtimeEvent` with typed getters, auto-reconnect w/ capped backoff.
  - `repositories.dart` — `AuthApi`, `UsersApi`, `WorkspacesApi`, `ChannelsApi`, `PttApi`, `HistoryApi`, `MediaApi`, `LocationApi`, `AlertsApi`, `NotificationsApi`, `AdminApi`, `AuthResult`/`LoginResult`/`LiveKitJoin`.
  - `backend.dart` — export barrel.
- `lib/app_state.dart` — `SessionController` (ChangeNotifier; owns ApiClient + RealtimeClient; `bootstrap()` silent refresh; lifecycle; realtime event handling) + `BackendScope` (InheritedNotifier).
- `lib/auth_screens.dart` — `AuthGate`, `LoginScreen` (with MFA), `RegisterScreen`.
- `lib/main.dart` — wires `SessionController`; `USE_BACKEND=false` → mock `InviteScreen`; true → `AuthGate`.
- `lib/screens.dart` — `kUseBackend` flag, backend tabs (contacts/channels from `SessionController`), `TalkScreen(channelId, onTransmit)` pressing/releasing floor over the socket.
- `pubspec.yaml` — added `http`, `web_socket_channel`, `shared_preferences`.
- `README.md` — rewritten to document the integration layer + run modes.

### Bugs found & fixed during verification (M12)
1. `lib/screens.dart` — missing closing `}` on `_HomeShellState` (build method converted to a block body).
2. `lib/api/models.dart` — `ContactPresence` needed `const` constructor (const default value error).
3. `lib/api/models.dart` — `Channel.fromJson` now reads raw Prisma `_count.*` aggregates (workspace-detail returns raw rows, not the DTO's `counts`); `Alert.userId` falls back to `user.id`.
4. `lib/api/realtime_client.dart` — replaced `int.clamp()` (returns `num`) used to index a `List`; presence events (no `data` wrapper → fields at top level) and alert events (alert object sits directly in `data`) are now parsed correctly.

### Verification done on the client
- **Dart-only layer (`lib/api/`)** — analyzed with a real Dart SDK 3.13.5 in a standalone package (fake `shared_preferences` override): **No issues found**.
- **Full project / `flutter analyze`** — passed, no errors (only 2 pre-existing trivials: missing optional `flutter_lints` include in `analysis_options.yaml`, and `withOpacity` deprecation info in the original `lib/widgets.dart`).
- **`flutter build web` (release)** — **succeeded**; web app deployed and served at **http://localhost:8081** (mock mode, since `USE_BACKEND` is unset).

---

## 4. APK build — ATTEMPTED, NOT FINISHED (OOM)

### What was set up (toolchain, all working)
- **Flutter SDK 3.47.7** (stable) at `/var/tmp/opencode/flutter`.
- **JDK 17 (Temurin)** at `/var/tmp/jdk17`.
- **Android command-line tools + SDK** at `/var/tmp/android-sdk` with `platform-tools`, `platforms;android-36`, `build-tools;36.0.0`, licenses accepted (`sdkmanager --licenses`).
- Project copied to a fast-disk build dir **`/var/tmp/ptt_app`** (avoids the slow OneDrive mount): `lib/`, `web/`, `pubspec.yaml`, `pubspec.lock`.
- `flutter create --platforms android .` generated the `android/` scaffold (Gradle Kotlin DSL).
- Env for Android builds:
  ```
  export PUB_CACHE=/var/tmp/.pub-cache
  export GRADLE_USER_HOME=/var/tmp/.gradle
  export JAVA_HOME=/var/tmp/jdk17
  export ANDROID_HOME=/var/tmp/android-sdk
  export PATH="/var/tmp/opencode/flutter/bin:$JAVA_HOME/bin:$PATH"
  ```

### What happened
1. First `flutter build apk --release` run: downloaded Gradle distribution + AGP/Kotlin deps into `/var/tmp/.gradle` (**1.2 GB cached**), then was interrupted.
2. Second run (`nohup` background): `grep` confirmed Gradle daemon started and **Kotlin 2.2.21 was compiling** — but the host has only **3 GB RAM** and Gradle's default daemon spawns with `-Xmx8G`; the build **was OOM-killed** (no Gradle/JVM process remains; log stuck at `Running Gradle task 'assembleRelease'...`). The shared python web server on :8081 was killed too (restarted after).

### How to finish the APK build (recommended fixes for next attempt)
- Shrink the Gradle JVM heap: edit `/var/tmp/ptt_app/android/gradle.properties`:
  ```
  org.gradle.jvmargs=-Xmx1024m -XX:MaxMetaspaceSize=512m
  kotlin.daemon.jvmargs=-Xmx512m
  org.gradle.workers.max=2
  org.gradle.daemon=false
  ```
  (or use `GRADLE_OPTS="-Xmx1024m"` / `org.gradle.jvmargs`). The box has 3 GB total RAM — do **not** let daemons grab 8 GB.
- Re-run: `flutter build apk --release` in `/var/tmp/ptt_app`.
- On success the APK lands at `/var/tmp/ptt_app/build/app/outputs/flutter-apk/app-release.apk`; copy it back into the repo, e.g. `copy it to the project root or a `dist/` folder`. (~30-40 MB.)
- If OOM persists, try `--split-per-abi` (smaller, one ABI at a time).

---

## 5. Environment constraints the next model must respect

- Working repo: `/mnt/c/Users/moham/OneDrive/Desktop/files (1)` — on **Windows OneDrive via a slow mount**; heavy I/O is several× slower than local disk. Prefer staging builds/copies on `/var/tmp/...`.
- Host RAM is only **3 GB** (very tight) — keep JVMs/Gradle daemons small, avoid parallel heavy jobs.
- `/tmp` is a **1.9 GB tmpfs** — DON'T extract large SDKs there (caused ENOSPC). Use `/var/tmp` (on `/`, 938 GB free, fast).
- Docker infra runs in WSL; postgres/redis/s3mock/livekit containers go down and s3mock loses its bucket — see section 2.
- No Flutter/Dart on PATH by default — always prepend `/var/tmp/opencode/flutter/bin`.
- Web build output lives in the repo at `build/web` (served on :8081).

## 6. Quick commands for verification
```bash
# backend full gate
cd "/mnt/c/Users/moham/OneDrive/Desktop/files (1)/backend" && npm run verify

# client
cd "/mnt/c/Users/moham/OneDrive/Desktop/files (1)"
export PATH="/var/tmp/opencode/flutter/bin:$PATH" PUB_CACHE=/var/tmp/.pub-cache
flutter analyze
```