## 1. Serialize & isolate discovery (platform.ts)

- [x] 1.1 Add `discovering` + `rerunRequested`; `discoverDevices()` guards/coalesces, delegating to `runDiscoveryOnce()`
- [x] 1.2 `runDiscoveryOnce()`: guard `getHomes`, each `getDevices(home)`, and each `upsertAccessory` separately; non-auth → log+continue, `NeedsReauthError` → escalate + stop
- [x] 1.3 Extract `handleDiscoveryError()` for the log-vs-escalate decision

## 2. Timers & shutdown (platform.ts)

- [x] 2.1 Track quick-refresh timeouts in a `Set`; remove on fire
- [x] 2.2 Factor `startPolling()` / `stopPolling()`
- [x] 2.3 `shutdown` clears poll timer, reauth-recheck timer, and all quick-refresh timers

## 3. Self-recovering needs-reauth (platform.ts)

- [x] 3.1 `enterNeedsReauth`: stop polling, start the reauth-recheck interval, log recover-without-restart guidance
- [x] 3.2 Add injectable `readPersistedSession` (default: read `config.json` via `api.user.configPath()` and find this platform's block)
- [x] 3.3 `tryRecoverSession()`: if the persisted refresh token changed, `restoreSession` + resume polling + stop the recheck
- [x] 3.4 `start()` with no session also starts the reauth-recheck (first sign-in works without restart)

## 4. Tests

- [x] 4.1 Overlapping `discoverDevices()` calls do not run concurrently and coalesce into one follow-up
- [x] 4.2 One home's `getDevices` failure is isolated — other homes still refresh; needs-reauth still escalates and stops the cycle
- [x] 4.3 Needs-reauth stops the poll timer (no spam) and `shutdown` clears all timers
- [x] 4.4 Recovery: with an updated persisted session, the recheck restores the session and resumes; first-run sign-in recovers without restart

## 5. Verify & ship

- [x] 5.1 `npm run build` + `npm run lint` + `npm test` green
- [x] 5.2 Adversarial review panel scoped to platform.ts; address regressions (fixed: vacuous stop-poll test → now asserts the poll handle is cleared; added real config-reader tests; startPolling idempotent; quick-refresh skipped during reauth)
- [x] 5.3 Archive (sync spec) and open the stacked PR (no merge)
