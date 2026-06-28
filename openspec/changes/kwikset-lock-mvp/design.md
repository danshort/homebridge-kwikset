## Context

`homebridge-kwikset` bridges Kwikset Halo Wi-Fi locks into HomeKit via Kwikset's undocumented cloud API (the backend of its official app). The lock predates Matter, so a cloud bridge is the only path. The API surface, auth flow, and device JSON shape have been verified live against real hardware (HALO-01 "Front Door") with a throwaway spike (`spike-auth.js`); the exact constants and field names are recorded in project memory (`kwikset-cloud-api-facts`).

Key proven facts that shape the design:
- Auth is AWS Cognito SRP. On the common path, SRP password login returns ID/access/refresh tokens directly — no MFA code — even with app-level 2FA enabled. A Cognito `CUSTOM_CHALLENGE` (email/SMS code) can still occur for some accounts, so it must be handled but is not the default path.
- REST is a plain `execute-api` gateway authorized with `Authorization: Bearer <id_token>`. Polling `GET /homes/{homeId}/devices` returns everything needed (lockstatus, batterypercentage, deviceconnectivitystatus, identifiers, model) in one call.
- Lock/unlock is `PATCH /devices/{serialnumber}/status` with `{action, source}`. It is **asynchronous**: the response carries only a timestamp, not the resulting state, which only appears on a later read (~8s in testing).

Constraints: Homebridge plugin (Node/TypeScript). The chosen auth UX (config-ui custom UI) runs in the homebridge-config-ui-x process, which is separate from the homebridge runtime process. Deployment is a trusted internal network with no external access.

## Goals / Non-Goals

**Goals:**
- Reliable lock/unlock and accurate lock + battery state in Apple Home for Kwikset Halo locks.
- A first-class in-UI login and re-auth experience (no manual token wrangling).
- A token lifecycle that, once set up, runs indefinitely without user intervention until the refresh token is invalidated.
- A shared client core usable by both runtime processes, so auth/REST logic exists once.

**Non-Goals:**
- Instant push state (AppSync WebSocket) — deferred to a later phase; MVP uses polling.
- Access-code management, autolock/LED/audio/secure-screen toggles, door-position sensor.
- Multi-account support, local (non-cloud) control, encrypted secret storage.

## Decisions

### Decision: Two processes, one shared core (`KwiksetClient`)
Choosing the config-ui custom UI for auth (option B) means login runs inside homebridge-config-ui-x, not the homebridge runtime. Both need SRP, custom-challenge, token refresh, and REST. So auth/REST live in a single `KwiksetClient` core module consumed by (a) `homebridge-ui/server.js` and (b) the platform. **Alternative considered:** put auth only in the platform and have the UI poke it — rejected because the UI server can't reach into the running homebridge process cleanly, and login must happen where the user is.

### Decision: `amazon-cognito-identity-js` for SRP
Proven in the spike on Node 24. Its `authenticateUser` (USER_SRP_AUTH) fires a `customChallenge` callback when Cognito returns a challenge, which natively handles Kwikset's flow — cleaner than the Python lib, which had to bypass `pycognito`. **Alternative:** AWS SDK v3 + hand-rolled SRP — more work, kept only as a fallback if the chosen lib regresses. Use an in-memory storage shim so the lib doesn't reach for browser `localStorage` under Node.

### Decision: Persist only the refresh token (plaintext config)
After login we store the refresh token + email in the plugin config block; the password is never persisted. The platform restores the session from the refresh token and auto-renews the ID token. Plaintext is accepted given the trusted-network deployment. **Alternative:** OS keychain / encrypted store — rejected as over-engineering for this environment, and config-ui-x already round-trips plugin config as plaintext JSON.

### Decision: Poll the home-devices list endpoint
`GET /homes/{homeId}/devices` returns all required fields for every lock in one request, so it is the polling source of truth (default 30s, configurable). The `/devices_v2/{id}` detail endpoint (which renames the field to `doorstatus`) is unnecessary for MVP. **Alternative:** per-device detail polling — more calls, no benefit.

### Decision: Optimistic state + reconciliation for commands
Because the command is async and returns no state, on a HomeKit target-state set we send the command, immediately present an in-progress/optimistic current state, then confirm via a follow-up read (and the regular poll), reverting to last-known actual state if unconfirmed within a timeout. This mirrors the HA `lock.py` pattern. **Alternative:** block until a read confirms — rejected; it would freeze the HomeKit callback for many seconds.

### Decision: Explicit needs-reauth state
Token-refresh rejection is surfaced as a distinct condition (separate from transient/connection errors). The platform stops error-spamming, logs clear guidance to re-auth in the UI, and avoids crash-looping; the user fixes it by re-running the login flow in the custom UI, which overwrites the stored token.

### Decision: Stable accessories keyed by device id
Use a dynamic platform with cached accessory restoration, keyed by the device id (== serial number), so locks survive restarts without duplication.

## Risks / Trade-offs

- **Undocumented API changes break the plugin** → Centralize all endpoints/constants in the client core; keep them mirrored in `kwikset-cloud-api-facts` memory; fail with clear errors. Accept that breakage is possible and outside our control.
- **Spoofed app identity (User-Agent) gray area** → Replicate the official app UA strings as the spike did; document that this is required for parity and is the unofficial-API risk, not a security mechanism we rely on.
- **30s polling staleness + async command lag** → Optimistic state hides command lag; staleness from external (keypad) changes remains until next poll. Documented as the primary motivation for the deferred AppSync phase.
- **Custom-challenge path under-tested** → The owner's account doesn't trigger it, so the code-entry branch is built from the HA reference and cannot be verified on this hardware; isolate it so a regression there doesn't affect the common path, and log clearly if it activates.
- **Refresh-token rotation/expiry locks out the platform** → Needs-reauth state + in-UI re-auth provides a clean recovery without restarts or config editing.
- **In-progress challenge session lost if config-ui restarts mid-login** → Acceptable; the user simply restarts the short login flow.

## Open Questions

- Exact low-battery threshold (e.g., ≤15% or ≤20%) — pick a sensible default, optionally configurable.
- Optimistic-command timeout duration — needs a value comfortably above the observed ~8s confirmation latency (e.g., 20–30s).
- Whether a config-change after token write requires a homebridge restart to take effect, or whether config-ui-x applies it live — confirm during implementation.
- Whether to offer email-vs-phone medium choice in the code-challenge UI, or default to email only (defer unless the challenge path proves common).
