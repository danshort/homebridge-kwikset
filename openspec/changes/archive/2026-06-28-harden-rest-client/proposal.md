## Why

An adversarial review found several correctness bugs in the cloud client's HTTP layer that can brick the plugin or report wrong lock state. Most urgent: a single `403` from Kwikset's API Gateway (throttling/WAF/authorizer hiccup — not a bad token) is treated as a token rejection and permanently latches the plugin into needs-reauth (GitHub #2). The 401-retry path also reuses a stale `Authorization` header and mis-routes connection errors into a refresh storm (#5), transient `5xx`/`429` responses aren't retried (#13), and an empty-string `lockstatus` skips the `doorstatus` fallback and parses as `Unknown` (#8).

## What Changes

- **Only `401`** triggers token re-validation (renew-once → needs-reauth). `403` and other client errors surface as a non-fatal `ApiError` that self-heals on the next poll — they no longer latch needs-reauth. (#2)
- The REST request loop recomputes the `Authorization` header from the current token on **every** attempt, and the renew/retry control flow no longer lets a connection error during renewal re-drive the loop with a stale token. (#5)
- Transient HTTP responses (`408/429/500/502/503/504`) are retried within the existing bounded backoff, honoring `Retry-After` for `429`. (#13)
- Parsing treats empty/whitespace strings as absent, so `lockstatus: ""` falls back to `doorstatus` (and an empty `serialnumber` falls back to `deviceid`). (#8)
- Document the load-bearing invariant that Cognito refresh tokens are non-rotating, so the platform's in-memory-only renewal is safe (partial of #14; the write-back/UI-status work stays deferred).

## Capabilities

### Modified Capabilities
- `kwikset-cloud-client`: tighten the error taxonomy at the HTTP layer — distinguish `401` (auth) from `403`/other (non-fatal) and from transient `5xx`/`429` (retryable); make token re-validation header-correct; broaden transient retry coverage.

## Impact

- Code: `src/client/kwiksetClient.ts` (`request()` restructure, `invalidateIdToken()` helper), `src/client/parsing.ts` (empty-string-safe field selection).
- Tests: new/extended unit tests for 403-non-fatal, 401-renew-uses-fresh-token, 5xx/429 retry, and empty-string parsing fallbacks.
- Behavior: a transient `403` no longer requires a Homebridge restart to recover; no change to the happy path or the public client API.
- Out of scope: platform-side token write-back and UI session-status (the rest of #14), and platform polling/concurrency (separate change).
