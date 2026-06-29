## Why

The adversarial review found several defects in the platform's discovery/polling lifecycle. The most serious (GitHub #3) is lock-safety relevant: `discoverDevices()` has no in-flight guard, so the poll interval and the post-command quick-refresh burst can run concurrently and apply results out of order — a stale `Locked` can overwrite a fresh `Unlocked`, showing the door **Secured when it is actually Unsecured**. A single failing home aborts the whole discovery cycle (#6), quick-refresh timers are untracked and fire after shutdown (#7), and the needs-reauth state leaves the poll timer spinning and can only be recovered by restarting Homebridge (#9).

## What Changes

- **Serialize discovery** (#3): only one discovery runs at a time; a request that arrives while one is in flight coalesces into a single follow-up run. Results can no longer be applied out of order.
- **Isolate per-home failures** (#6): each home's device fetch and each device update is independently guarded, so one flaky home (or device) no longer stalls state for the others. `NeedsReauthError` still escalates.
- **Track quick-refresh timers** (#7): the post-command reconciliation timeouts are tracked and cleared on shutdown, so they cannot fire after teardown.
- **Needs-reauth recovery without restart** (#9): on needs-reauth the poll timer is stopped (no more no-op spam), and a slow re-check re-reads the plugin config; when the user signs in again (rewriting the token) the platform restores the session and resumes polling automatically — no Homebridge restart. The same re-check lets a first-run-with-no-config plugin start working as soon as the user signs in.

## Capabilities

### Modified Capabilities
- `lock-accessories`: make periodic polling concurrency-safe and resilient to partial failures, and make the needs-reauth state self-recovering rather than restart-bound.

## Impact

- Code: `src/platform.ts` (serialized `discoverDevices` + `runDiscoveryOnce`, per-home/per-device guards, tracked quick-refresh timers, reauth-recheck timer, config re-read).
- New optional constructor dependency `readPersistedSession` (defaults to reading `config.json` via the Homebridge API) for testability.
- Tests: serialized discovery, per-home isolation, shutdown timer cleanup, and reauth stop+recover.
- Out of scope: the UI session-status channel and rotated-token write-back (the rest of #14).
