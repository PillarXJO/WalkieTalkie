# Prompt for the Next Agent — Continue the Work

You are continuing an existing codebase and session. Read `CONCLUSION.md` (in the repo root) FIRST for the full history. Below is everything else you need to pick up exactly where the previous agent left off.

## Context
Repo root: `/mnt/c/Users/moham/OneDrive/Desktop/files (1)` — a push-to-talk (PTT) app: Node/TS backend in `backend/` and a Flutter client at the root.

- Backend (M0–M11) is COMPLETE: `npm run verify` = `tsc --noEmit` clean + **78/78 tests passing** (12 files).
- Flutter client integration layer (M12) is DONE and verified: `flutter analyze` passes with no errors, `flutter build web` succeeded, and the web app is live at **http://localhost:8081** (mock mode).
- The **release APK build is the one unfinished task** — it was OOM-killed and needs to be resumed/fixed (details below).

## Current environment facts (do not rediscover the hard way)
- Host: WSL Linux, **only 3 GB RAM**. This caused the last APK build to die — see OOM section.
- Repo is on a slow Windows OneDrive mount. Build fast-disk copies under `/var/tmp`.
- `/tmp` = 1.9 GB tmpfs — do NOT extract SDKs into it. `/var/tmp` is on `/` with ~938 GB free.
- Toolchain already installed (all work):
  - Flutter SDK 3.47.7 → `/var/tmp/opencode/flutter`
  - JDK 17 (Temurin) → `/var/tmp/jdk17`
  - Android SDK → `/var/tmp/android-sdk` (platform-tools, platforms;android-36, build-tools;36.0.0, licenses accepted)
  - Caches: `PUB_CACHE=/var/tmp/.pub-cache`, `GRADLE_USER_HOME=/var/tmp/.gradle` (already has 1.2 GB of downloaded Gradle deps)
  - Build staging copy of the app: `/var/tmp/ptt_app` (lib/, web/, pubspec.yaml/lock + generated `android/` scaffold via `flutter create --platforms android .`)
- Always prefix Flutter commands with: `PATH="/var/tmp/opencode/flutter/bin:$PATH" PUB_CACHE=/var/tmp/.pub-cache`
- For Android builds also need: `JAVA_HOME=/var/tmp/jdk17 ANDROID_HOME=/var/tmp/android-sdk GRADLE_USER_HOME=/var/tmp/.gradle`
- Web server (serves `build/web` at :8081) is a `python3 -m http.server 8081 --bind 0.0.0.0` started with nohup from the repo's `build/web` directory. If it dies, restart it the same way.
- Backend Docker containers (`docker start ptt-postgres-1 ptt-redis-1 ptt-s3mock-1 ptt-livekit-1`) die periodically and **s3mock loses its `ptt-voice` bucket** — recreate it with `curl -X PUT http://localhost:9000/ptt-voice` before running M8/readiness tests.

## Y O U R   T A S K (primary)
Finish the **release APK build**:

1. **Fix the OOM first (this is what killed it):** In `/var/tmp/ptt_app/android/gradle.properties`, lower JVM memory (host has 3 GB total):
   ```
   org.gradle.jvmargs=-Xmx1024m -XX:MaxMetaspaceSize=512m
   kotlin.daemon.jvmargs=-Xmx512m
   org.gradle.workers.max=2
   org.gradle.daemon=false
   ```
2. Re-run the build (nohup + poll if it's long, since the shell tool may time out):
   ```bash
   cd /var/tmp/ptt_app
   export PATH="/var/tmp/opencode/flutter/bin:$PATH" PUB_CACHE=/var/tmp/.pub-cache \
          GRADLE_USER_HOME=/var/tmp/.gradle JAVA_HOME=/var/tmp/jdk17 ANDROID_HOME=/var/tmp/android-sdk
   flutter build apk --release
   ```
3. Verify the APK exists: `ls -lh /var/tmp/ptt_app/build/app/outputs/flutter-apk/app-release.apk`.
4. Copy it back into the repo so it's available to the user, e.g.
   `cp /var/tmp/ptt_app/build/app/outputs/flutter-apk/app-release.apk "/mnt/c/Users/moham/OneDrive/Desktop/files (1)/app-release.apk"`
   (APK is only tens of MB — copying back is fast; do NOT build in the repo, it's too slow).
5. If OOM happens again despite the small heap:
   - Build one ABI at a time: `flutter build apk --release --split-per-abi` (produces app-arm64-v8a-release.apk etc.).
   - Or on a machine with more RAM (any real dev machine): just run `flutter build apk --release` normally.
   - Note: the Gradle dependency download is already cached in `/var/tmp/.gradle`, so subsequent builds are fast on the network side.

## Y O U R   T A S K (secondary — only if smooth)
If the APK builds and you have appetite, also verify the whole stack is still green and leave the user a short message:
- Backend: `cd "/mnt/c/Users/moham/OneDrive/Desktop/files (1)/backend" && npm run verify` (expect 78/78; ensure s3mock bucket + docker containers are up first).
- Client analysis: `cd "/mnt/c/Users/moham/OneDrive/Desktop/files (1)" && flutter analyze` (expect no errors).

## Good-to-know (from the prior session)
- The web app on :8081 runs in MOCK mode because `USE_BACKEND` is unset. To point the client at the live backend in a browser, rebuild with `--dart-define=USE_BACKEND=true` — but first confirm the backend's CORS/websocket settings permit browser origins (check `backend/src/plugins/security.ts` / `@fastify/cors` config, and note the WS gateway reads `?token=`).
- Dart-only layer `lib/api/` can be analyzed standalone (no Flutter imports): copy to a scratch package with `http`, `web_socket_channel` + a stub `shared_preferences` override, or just rely on `flutter analyze`.
- The client parses the backend exactly; if you change backend DTOs later, keep `lib/api/models.dart` parsing tolerant (see CONCLUSION.md §3).

Report back concisely: APK path + size (or the exact failure/output), whether backend 78/78 and `flutter analyze` still pass, and anything you had to change.