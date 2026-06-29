## Context

`KwiksetClient.request()` is the single HTTP chokepoint for all REST calls. An adversarial review (GitHub #2, #5, #13, #8) found its error handling conflates `401`/`403`, computes the `Authorization` header once before the retry loop (so a renewed token is sent stale), and lets a connection error during renewal re-drive the outer loop. It also doesn't retry `5xx`/`429`, and `parsing.ts` uses `??` (null/undefined-only) for field fallbacks.

## Goals / Non-Goals

**Goals:** make the HTTP layer's error taxonomy correct and a transient `403` non-fatal; never send a stale token after renewal; retry genuine transient statuses; make field fallbacks empty-string-safe. No behavior change on the happy path; no public API change.

**Non-Goals:** platform polling/concurrency (separate change), the rest of #14 (token write-back, UI status), cert pinning.

## Decisions

### Decision: `401` is the only auth signal; `403` is a non-fatal `ApiError`
API Gateway returns `403` for WAF/throttle/resource-policy/"missing authentication token" — not token freshness (that's `401`). So only `401` runs the renew-once→needs-reauth path. `403` falls through to `ApiError` (surfaced as a one-cycle warning that self-heals next poll). **Alternative considered:** retry `403` as transient — rejected; a hard `403` shouldn't be retried, and `ApiError` already avoids the brick, which is the actual bug.

### Decision: restructure `request()` so the header is per-attempt and renew is in the main flow
Loop body each attempt: `ensureIdToken()` → build headers from the *current* token → `fetchImpl`. A `401` (once) sets `invalidateIdToken()`, `await renew()`, then `continue` (next iteration recomputes the header with the fresh token). A connection error from `fetchImpl` is the transient branch; a connection error from `renew()` propagates (not re-driven with a stale token). This fixes both halves of #5 and folds in the `invalidateIdToken()` dedup (#16/L3).

### Decision: explicit retryable-status set
`{408, 429, 500, 502, 503, 504}` retry within the existing bounded backoff; `429` honors `Retry-After` (seconds, capped). Everything else non-`ok` and non-`401` → `ApiError`.

### Decision: empty-string-safe field selection in parsing
Add `firstNonEmptyString(...)` and use it for `lockstatus`/`doorstatus` and `serialnumber`/`deviceid`, so `""` is treated as absent. `parseLockStatus(undefined)` already yields `Unknown`.

### Decision (doc-only, #14): document the non-rotation invariant
Cognito refresh tokens are non-rotating by default, so the platform renewing ID tokens in memory (and only the UI persisting the refresh token) is safe. Documented in code + design; the write-back/UI-status work stays deferred.

## Risks / Trade-offs

- **A genuine authz `403` is now masked as a transient warning** → acceptable: for a single valid account a `403` is almost always WAF/throttle; surfacing `ApiError` (self-healing) is strictly safer than the previous brick.
- **Retrying `5xx` adds latency on a truly-down cloud** → bounded by `MAX_RETRIES` and backoff; no worse than the existing connection-error path.
- **`401`-renew consumes a loop iteration** → `MAX_RETRIES` leaves ample headroom; a second `401` still escalates to needs-reauth.

## Open Questions

None blocking. (Whether to also treat `403` as retryable was considered and rejected above.)
