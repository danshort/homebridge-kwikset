## Context

`homebridge-ui/server.js` performs the Kwikset login server-side. Two issues (GitHub #12): it relays the raw Cognito error message to the browser (`NotAuthorizedException` vs `UserNotFoundException` → account enumeration), and it holds the awaiting-code login in one process-global `this.pendingClient` (no key, no TTL → concurrent flows collide). The error-mapping in `src/client/cognitoAuth.ts` also has duplicated, untested code (#16).

## Goals / Non-Goals

**Goals:** non-enumerating login errors; per-flow challenge sessions with TTL; deduped + tested error mappers. No happy-path UX change.

**Non-Goals:** rate limiting, CAPTCHAs, or other anti-enumeration beyond message uniformity (the UI is admin-only).

## Decisions

### Decision: generic messages in `mapLoginError`
`mapLoginError` returns a fixed "Invalid email or password." for `NotAuthorizedException`/`UserNotFoundException`/`InvalidParameterException`, a distinct "Incorrect or expired verification code." for `CodeMismatch`/`ExpiredCode`, a connection error for network/timeout, and a generic "Authentication failed." default. It no longer embeds the upstream message for credential failures. Extract `cognitoErrorCode(err)` and `cognitoMessage(err, fallback)` helpers (dedup, #16) and **export** `mapLoginError`/`mapRefreshError` so they're unit-testable.

### Decision: a testable `PendingSessions` store (compiled, required by server.js)
Add `src/ui/pendingSessions.ts` — a small class: `create(client) -> id` (opaque `crypto.randomUUID`), `get(id) -> client | undefined` (peek, expiry-checked, non-destructive), and `remove(id)`, with an injectable `now` and a TTL (default 10 min, ~ the code's lifetime). `server.js` requires the compiled `../dist/ui/pendingSessions` (same pattern it already uses for `../dist/client/kwiksetClient`). This keeps the session logic in TypeScript under vitest rather than in the untestable IPC server. **`get` is a peek, not a one-shot take**, so a mistyped verification code can be retried without restarting from the password step; the session is `remove`d only on success and otherwise lapses via TTL. **Alternative:** key by email — rejected; an opaque id avoids leaking which emails have flows in progress and handles same-account retries.

### Decision: thread `sessionId` through the UI
`/login` returns `{ status: 'code_required', sessionId, email }`; `index.html` stores it and sends it with `/submit-code`. `/submit-code` `get`s the session (and `remove`s it on success), erroring (start over) if missing/expired.

## Risks / Trade-offs

- **A lost session (config-ui restart, expiry) forces restarting the short login flow** → already an accepted property; now also covers TTL expiry with a clear message.
- **Generic credential message is slightly less helpful** → intended; the enumeration resistance is worth the small UX cost, and code/network errors stay specific.

## Open Questions

None blocking.
