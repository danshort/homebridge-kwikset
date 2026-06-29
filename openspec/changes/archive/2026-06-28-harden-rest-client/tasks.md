## 1. REST request layer (kwiksetClient.ts)

- [x] 1.1 Add `invalidateIdToken()` helper; use it in `restoreSession` and the 401 path (dedup)
- [x] 1.2 Restructure `request()`: per-attempt `ensureIdToken()` + header rebuild from the current token
- [x] 1.3 Treat only `401` as auth: renew once → `continue`; second `401` → `NeedsReauthError`. Renew runs in the main flow (a connection error in renew propagates, not re-driven stale)
- [x] 1.4 Add a retryable-status set `{408,429,500,502,503,504}`; retry within bounded backoff; honor `Retry-After` for `429`
- [x] 1.5 `403` and other non-ok statuses → `ApiError` (non-fatal, no needs-reauth)
- [x] 1.6 Document the Cognito non-rotation invariant in code (`setTokens`/`restoreSession`) — partial of #14

## 2. Parsing (parsing.ts)

- [x] 2.1 Add `firstNonEmptyString(...)`; use for `lockstatus`/`doorstatus` and `serialnumber`/`deviceid`

## 3. Tests

- [x] 3.1 `403` → `ApiError`, NOT `NeedsReauthError`, and a subsequent request succeeds (no latch)
- [x] 3.2 `401` → renew once and the retry carries the *fresh* token (assert the Authorization header changed); persistent `401` → `NeedsReauthError`
- [x] 3.3 Retryable `5xx`/`429` retried then succeeds; persistent retryable → surfaced error
- [x] 3.4 Parsing: empty-string `lockstatus` falls back to `doorstatus`; empty `serialnumber` falls back to `deviceid`

## 4. Verify & ship

- [x] 4.1 `npm run build` + `npm run lint` + `npm test` green
- [x] 4.2 Adversarial review panel scoped to the changed modules; address regressions (fixed: empty/malformed JSON body regression, weak fresh-token test, backoff dedup)
- [ ] 4.3 Archive the change (sync spec) and open the PR (no merge)
