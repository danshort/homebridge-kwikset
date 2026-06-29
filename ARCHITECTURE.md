# Architecture

Orientation for anyone (human or agent) working on `homebridge-kwikset`. It explains how the pieces fit so you can find the right file fast. Pair it with the per-module header comments (every `src/` file starts with one) and the OpenSpec specs under `openspec/specs/`.

## What this plugin does

It bridges **Kwikset Halo** Wi-Fi locks into Apple HomeKit by talking to Kwikset's **cloud** API (the same backend the Kwikset app uses — unofficial, undocumented; see `src/client/constants.ts`). There is no local control; everything goes through the cloud.

## The two runtime processes

The plugin runs in **two separate Node processes** that share one core module. This split is the single most important thing to understand.

```
┌─ homebridge process ───────────────┐     ┌─ homebridge-config-ui-x process ──┐
│  src/platform.ts  (the platform)   │     │  homebridge-ui/server.js          │
│   • restore session from config    │     │   • email+password login          │
│   • poll devices, map to HomeKit   │     │   • holds the code challenge      │
│   • dispatch lock/unlock commands  │     │   • returns the refresh token     │
│  src/lockAccessory.ts (per lock)   │     │  homebridge-ui/public/index.html  │
│  src/lockController.ts (state m/c)  │     │   • the sign-in UI; writes the    │
│                                    │     │     token into plugin config      │
└───────────────┬────────────────────┘     └───────────────┬───────────────────┘
                │            both consume the same core      │
                └──────────────┬──────────────┬─────────────┘
                               ▼              ▼
                     src/client/  (KwiksetClient + Cognito auth + REST + parsing)
```

- The **config-UI server** does the interactive login (it's the only place that can prompt for a password / verification code) and persists the resulting **refresh token** into the plugin config. It never runs the lock logic.
- The **platform** never logs in interactively. It restores a session from the stored refresh token and runs all the runtime behavior (polling, commands).
- They don't talk to each other directly. The only channels are the **config file** (UI writes the token, platform reads it) and the **Homebridge log**. When the token dies, the platform re-reads config on an interval and recovers automatically (no restart) — see "Needs-reauth recovery" below.

`src/ui/pendingSessions.ts` is TypeScript (compiled to `dist/`) so the config-UI server's session logic can be unit-tested instead of being stranded in the IPC server; `server.js` `require`s it from `../dist/ui/...` just like it requires the client.

## Module map

| File | Responsibility |
| --- | --- |
| `src/index.ts` | Plugin entry point — registers the platform with Homebridge. |
| `src/settings.ts` | `PLATFORM_NAME` / `PLUGIN_NAME` constants (must match `config.schema.json` + `package.json`). |
| `src/platform.ts` | Dynamic platform: session restore, **serialized** discovery + polling, command dispatch, needs-reauth recovery. |
| `src/lockAccessory.ts` | HAP adapter for one lock: LockMechanism + Battery services, reachability, wires HomeKit ⇆ `LockController`. |
| `src/lockController.ts` | Pure optimistic-state machine for one lock (no `hap-nodejs`); the heart of command handling. |
| `src/client/kwiksetClient.ts` | The shared core: auth, token lifecycle, the single REST `request()` with retry/error taxonomy, discovery + commands. |
| `src/client/cognitoAuth.ts` | Cognito SRP login + CUSTOM_CHALLENGE fallback, behind a `CognitoAuthenticator` interface (fakeable in tests). |
| `src/client/parsing.ts` | Pure parsers: cloud JSON → domain types, plus the `lockstatus`/connectivity string normalizers. |
| `src/client/stateMapping.ts` | Pure domain → HomeKit mapping (lock-state + battery), plus the mirrored HAP enum values. |
| `src/client/errors.ts` | The error taxonomy (see below). |
| `src/client/constants.ts` | Cloud endpoints, Cognito IDs, tuning knobs (retry, skew, source identity). |
| `src/client/types.ts` | Domain types (field names mirror the cloud payloads). |
| `src/ui/pendingSessions.ts` | Keyed + TTL store for in-progress code challenges (used by `server.js`). |
| `homebridge-ui/server.js` | config-UI server: `/login` + `/submit-code` handlers. |
| `homebridge-ui/public/index.html` | The sign-in UI. |

## Key data flows

### Authentication & token lifecycle
1. **Login (config-UI only):** SRP password auth via `cognitoAuth.ts`. On the common path it returns tokens directly; some accounts get a CUSTOM_CHALLENGE (email code), handled as a progressive second step. The browser persists the **refresh token** to config.
2. **Restore (platform):** `KwiksetClient.restoreSession(email, refreshToken)` — no password needed.
3. **Auto-renew:** `ensureIdToken()` renews the short-lived ID token from the refresh token when it's missing or within a skew window of expiry. Concurrent renewals collapse into one in-flight refresh. **Invariant:** Cognito refresh tokens don't rotate, so the platform holding the refresh token in memory is sufficient (documented in `setTokens`).

### REST requests (`KwiksetClient.request`)
One loop is the chokepoint for every cloud call. Per attempt it rebuilds the auth header from the *current* token (so a renewed token is never sent stale), then classifies the response:
- `401` → renew once and retry; a second `401` → `NeedsReauthError`.
- `408/429/500/502/503/504` or a transport throw → retry within a bounded budget (429 honors `Retry-After`).
- `403`/other 4xx → `ApiError` (non-fatal; **does not** latch needs-reauth — it self-heals next poll).

### Discovery & polling
`platform.discoverDevices()` is **serialized**: at most one run at a time, and a burst (the poll tick + the post-command quick-refresh reads) coalesces into a single follow-up — so a stale read can never overwrite a fresh one. Per-home and per-device failures are isolated; a `NeedsReauthError` escalates.

### Lock/unlock (the optimistic-state machine)
The cloud command is **asynchronous** — it's acknowledged before the bolt moves; the new state only appears on a later read. So `LockController`:
1. On a HomeKit target set, sends the command and shows an optimistic in-progress state immediately.
2. Reconciles against the real state on a follow-up read (the platform schedules quick-refresh reads at 2/5/9s, plus the regular poll).
3. Reverts if it isn't confirmed within a timeout.
Each command captures its own `pending` record, so a rapid second command can't be clobbered by an earlier one's failure/timeout.

### Needs-reauth recovery (no restart)
When the refresh token is rejected, the platform stops polling, logs guidance, and starts a slow **re-check** that re-reads `config.json`. When the user re-signs-in (rewriting the token), the platform restores the session and resumes — no Homebridge restart. The same mechanism lets a first-run-with-no-config plugin start as soon as the user signs in.

## Error taxonomy (`src/client/errors.ts`)

The error class drives the caller's decision:

| Error | Meaning | Caller behavior |
| --- | --- | --- |
| `AuthError` | Bad credentials / verification code | Show "invalid…", let the user retry (UI surfaces a **generic, non-enumerating** message). |
| `NeedsReauthError` | Refresh token invalid/rejected | Platform stops polling, recovers via config re-read; UI prompts re-auth. |
| `ConnectionError` | Transient transport failure (after retries) | Logged as a warning; next poll retries. |
| `ApiError` | Residual HTTP/body error: 403/404, a retryable status that exhausted its retries, or invalid JSON | Surfaced; **not** treated as auth failure. |

## Testing approach

Logic is isolated behind injectable seams so it's testable without a real cloud, real HAP, or a real Homebridge:
- `KwiksetClient` takes an `authenticator`, `fetchImpl`, `now`, and `sleep`.
- `LockController` takes `sendCommand`, `setTimer`/`clearTimer`, `onChange`.
- `KwiksetPlatform` takes an optional client + `readPersistedSession`.
- `test/hapStub.ts` fakes the HAP namespace and Homebridge API.
- `test/stateMapping.contract.test.ts` pins the mirrored HAP enum values to the **real** `hap-nodejs` constants — the one place a wrong value would make a lock report the wrong state.

Run `npm test` (vitest), `npm run build` (tsc), `npm run lint`.

## Where to look for X

- **"How does login work / why two steps?"** → `cognitoAuth.ts`, `homebridge-ui/server.js`, `src/ui/pendingSessions.ts`.
- **"Why is my lock state wrong/stale?"** → `lockController.ts` (optimistic/reconcile) + `platform.ts` (serialized polling).
- **"What cloud endpoints / IDs?"** → `src/client/constants.ts` (and the `kwikset-cloud-api-facts` project memory).
- **"How are errors handled / retried?"** → `KwiksetClient.request` + `errors.ts`.
- **"How does a release happen?"** → `CONTRIBUTING.md` + `.github/workflows/release.yml`.
- **"What's the intended behavior (the contract)?"** → `openspec/specs/{kwikset-cloud-client,account-setup-ui,lock-accessories,release-automation}/spec.md`.

## Deferred / out of scope (tracked)

AppSync WebSocket push (instant state instead of polling), access-code management, autolock/LED/audio toggles, door-position sensor, and a UI session-status indicator + rotated-token write-back are intentionally not implemented yet.
