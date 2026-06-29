# Tasks

## 1. Shared session-status module
- [x] 1.1 Add `src/sessionStatus.ts`: `SessionStatus` type `{ needsReauth: boolean; updatedAt: number }`, `STATUS_FILENAME`, `statusFilePath(storageDir)`, `writeSessionStatus(storageDir, status)` (atomic temp-write + rename), `readSessionStatus(storageDir)` (returns `undefined` on missing/unreadable/malformed).

## 2. Platform publishes session health
- [x] 2.1 In `src/platform.ts`, add a `writeStatus()` helper that writes current `needsReauth` to the storage dir via `api.user.storagePath()`, wrapped so failures only `log.debug`.
- [x] 2.2 Call `writeStatus()` in `start()` (both branches), in `enterNeedsReauth()`, and in `tryRecoverSession()` on success.

## 3. UI server `/status` endpoint
- [x] 3.1 In `homebridge-ui/server.js`, register `/status` returning `{ needsReauth }` read from the status file at `this.homebridgeStoragePath`; default to `{ needsReauth: false }` when the path or file is unavailable. Never throw.

## 4. UI surfaces the warning
- [x] 4.1 In `homebridge-ui/public/index.html`, add a session-expired warning element + style.
- [x] 4.2 Update `refreshSignedInState()` to request `/status` and show the warning (instead of the green badge) when a token is present and `needsReauth` is true; otherwise behave as today.

## 5. Tests & verification
- [x] 5.1 Add `test/sessionStatus.test.ts`: round-trip write/read, atomic overwrite, missing file → undefined, malformed JSON → undefined.
- [x] 5.2 `npm run build && npm run lint && npm test` all green.
- [x] 5.3 Adversarial verification pass (cross-process correctness, atomicity, no false warnings, no secret leakage).
