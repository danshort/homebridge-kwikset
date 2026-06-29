## Context

`KwiksetPlatform.discoverDevices()` is invoked by the poll `setInterval` and by `requestQuickRefresh()` (three timeouts at 2/5/9s after a command). It is `async` with multiple awaits and no concurrency control, wraps the whole homes/devices loop in one try, schedules untracked timers, and latches needs-reauth without stopping the poll loop or offering recovery. Findings: GitHub #3 (overlap → stale-state overwrite), #6 (partial-failure abort), #7 (untracked timers), #9 (no stop / restart-bound recovery).

## Goals / Non-Goals

**Goals:** concurrency-safe, partial-failure-resilient polling; clean shutdown; a self-recovering needs-reauth state. No change to the accessory/HAP surface.

**Non-Goals:** the UI session-status channel and rotated-token write-back (rest of #14); per-device (vs whole-account) quick refresh (a later optimization).

## Decisions

### Decision: serialize discovery with a coalescing follow-up (#3)
`discoverDevices()` becomes a guard: if a run is in flight, set `rerunRequested` and return; otherwise loop `runDiscoveryOnce()` while `rerunRequested` is set. At most one `runDiscoveryOnce` executes at a time, and bursts (e.g. the three quick-refresh timers) collapse into one extra run. This removes the out-of-order application that could overwrite fresh `Unlocked` with stale `Locked`. **Alternative:** timestamp/sequence each read and drop stale ones — more state; serialization is simpler and sufficient since all reads share one writer.

### Decision: per-home / per-device isolation (#6)
`runDiscoveryOnce()` guards `getHomes`, each `getDevices(home)`, and each `upsertAccessory(device)` separately. Non-auth errors are logged and skipped; `NeedsReauthError` escalates and stops the cycle. One flaky home no longer stalls the rest.

### Decision: track quick-refresh timers; stop everything on shutdown (#7)
Quick-refresh timeouts are held in a `Set` and removed on fire; `shutdown` clears the poll timer, the reauth-recheck timer, and all pending quick-refresh timers. No timer can fire post-teardown.

### Decision: self-recovering needs-reauth via config re-read (#9)
`enterNeedsReauth` stops the poll timer and starts a slow `reauth-recheck` interval. Each tick calls `readPersistedSession()`; if it yields a refresh token different from the client's current one, the platform `restoreSession()`s and resumes polling — no restart. The same recheck is started when the plugin boots with no session, so a first-time sign-in also takes effect without a restart. `readPersistedSession` is an injected dependency (default: read `config.json` via `api.user.configPath()` and find this platform's block) so it is unit-testable. **Alternative:** subscribe to a Homebridge config-change event — there isn't a reliable in-process one for plugins, so a bounded slow re-read is the pragmatic choice.

## Risks / Trade-offs

- **Coalescing can drop at most one intermediate poll** → fine: the follow-up run reads the latest state anyway.
- **Config re-read does disk I/O on a slow interval while latched** → only while in needs-reauth, at a 60s cadence; negligible.
- **`readPersistedSession` parses the whole config.json** → wrapped in try/catch; a parse failure just defers recovery to the next tick.
- **Recovery compares refresh tokens** → a re-auth always rewrites the token, so a change reliably signals "user signed in again."

## Open Questions

None blocking. (UI-side "session expired" indication remains tracked under #14.)
