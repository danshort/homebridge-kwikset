# Design

## Context

The Homebridge **platform** (long-running, holds the live `KwiksetClient` session) and the **config-UI server** (`homebridge-ui/server.js`, spawned by homebridge-config-ui-x to serve the settings page) are distinct OS processes. The platform already tracks `needsReauth` and auto-recovers via a 60s config recheck, but that state is visible only in the Homebridge log. We need to surface it in the setup UI.

## Decision: a status file in the Homebridge storage directory

The platform writes `kwikset-session-status.json` into the Homebridge storage dir; the UI server reads it on demand.

- Both processes can resolve the same directory: the platform via `api.user.storagePath()` (static `User.storagePath()`), the UI server via the base class's `this.homebridgeStoragePath`. This is the same mechanism homebridge-config-ui-x itself uses to share state across the platform/UI boundary.
- File shape: `{ "needsReauth": boolean, "updatedAt": number }`. No secrets — the email shown in the UI continues to come from the plugin config, not this file. `updatedAt` is for diagnostics only.

### Alternatives considered

- **HTTP/IPC from UI server to platform** — there is no stable in-process channel between the two; homebridge-config-ui-x does not broker one for plugins. Rejected as unavailable.
- **Re-validate the token from the UI server on `/status`** — the UI server could itself call the cloud to test the token. Rejected: it duplicates auth logic in the request path, spends a network round-trip on every settings-page load, and could race the platform's own renew/lockout handling. The platform is the single source of truth for session health.
- **Put health in the plugin config** — the config is owned by the UI write path; having the platform write health into it risks clobbering user edits and muddies "config" vs "runtime state". Rejected.

## Atomicity and failure handling

- **Write**: serialize to a temp file (`…json.tmp`) then `renameSync` over the target. `rename` is atomic on the same filesystem, so a concurrent reader sees either the old or the new file, never a half-written one. All writes are wrapped so a failure logs at debug and never disrupts platform operation.
- **Read**: missing file, unreadable file, or malformed JSON all resolve to `undefined`. The UI treats `undefined` (status unknown) the same as healthy, so an older platform build that never writes the file, or a first run before the file exists, simply preserves today's behavior — no false "expired" warning.

## UI behavior

`refreshSignedInState()` continues to read token+email from config to decide "signed in at all", then additionally requests `/status`:

- token present **and** `status.needsReauth === true` → show the **session-expired warning** (re-auth prompt), not the green badge.
- token present and status healthy/unknown → green "Signed in as …" badge (today's behavior).
- no token → form only (today's behavior).

The warning is informational; the existing sign-in form remains the recovery path, and completing it clears the platform's needs-reauth state (which rewrites the status file to healthy on the next recheck/start).

**Post-sign-in window.** After an in-UI sign-in the platform takes up to its ~60s recheck interval to pick up the new token, so its published status still reads "expired" briefly. The UI skips the `/status` check immediately after sign-in (`assumeHealthy`) and, to also cover a page reload within that window, persists a short-lived `sessionStorage` marker (`signedInRecently()`, ~90s) that optimistically shows healthy. After the window, `/status` is authoritative again — by then the platform has rechecked — so a session that genuinely never recovered will correctly surface as expired.

## State transitions that write the file (platform)

- `start()` — writes current health (covers both "no session at launch" and "healthy" cases).
- `enterNeedsReauth()` — writes `needsReauth: true`.
- `tryRecoverSession()` on success — writes `needsReauth: false`.

`Date.now()` is used for `updatedAt` (ordinary runtime code, not a workflow script).
