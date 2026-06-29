## Why

The adversarial review found two issues in the config-UI auth server (GitHub #12). The login error path relays the raw upstream Cognito message to the browser, and Cognito distinguishes "user does not exist" from "incorrect password" — enabling account enumeration. Separately, the in-progress (awaiting-code) login is held in a single process-global `pendingClient` with no key and no TTL, so two concurrent flows (two browser tabs, or two admins) collide and a `submit-code` can complete the wrong challenge or return the wrong token. This change also folds in the `cognitoAuth` error-mapper cleanup from #16 (extract + test the mappers).

## What Changes

- **Generic credential errors** (#12): password-step failures (`NotAuthorizedException`/`UserNotFoundException`) return a single "Invalid email or password." Code-step (`CodeMismatch`/`ExpiredCode`) and network errors keep their distinct, non-enumerating messages. No raw upstream message is relayed by default.
- **Per-session challenge store** (#12): an in-progress challenge is keyed by an opaque session id returned on `/login` and required on `/submit-code`, with a TTL. Concurrent flows no longer collide, and stale challenges expire.
- **Extracted + tested error mappers** (#16): `cognitoErrorCode`/`cognitoMessage` helpers remove the duplicated incantation, and `mapLoginError`/`mapRefreshError` become exported and unit-tested.

## Capabilities

### Modified Capabilities
- `account-setup-ui`: make login errors non-enumerating and the in-progress challenge session per-flow (keyed + TTL) rather than a single global.

## Impact

- Code: `src/client/cognitoAuth.ts` (generic messages, extracted/exported mappers); new `src/ui/pendingSessions.ts` (keyed challenge store, TTL, testable); `homebridge-ui/server.js` (use the store, return/accept a `sessionId`); `homebridge-ui/public/index.html` (thread `sessionId` from `/login` to `/submit-code`).
- Tests: `cognitoAuth` mappers; `PendingSessions` create/get/remove/expiry.
- No change to the happy-path UX (sign in → token persisted). Impact is bounded (the UI is admin-only), but both are clean correctness/security fixes.
