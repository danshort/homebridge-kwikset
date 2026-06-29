## MODIFIED Requirements

### Requirement: Needs-reauthentication signaling

When the refresh token is rejected or no longer valid, the client SHALL enter a distinct "needs re-authentication" state and SHALL surface this to callers rather than retrying indefinitely. Only an HTTP `401` (or a rejected token refresh) SHALL be interpreted as a token rejection; an HTTP `403` (e.g. throttling, WAF, or gateway authorizer hiccup) SHALL NOT be treated as a token rejection and SHALL NOT latch the needs-reauth state.

#### Scenario: Refresh token rejected

- **WHEN** a token renewal fails because the refresh token is invalid or expired
- **THEN** the client reports a "needs re-authentication" condition distinct from transient/connection errors

#### Scenario: Persistent 401 from the cloud

- **WHEN** a request receives `401`, the client renews the token once and retries, and the retry still receives `401`
- **THEN** the client reports "needs re-authentication"

#### Scenario: 403 does not trigger re-authentication

- **WHEN** a request receives `403`
- **THEN** the client surfaces a non-fatal request error and does NOT enter the needs-reauth state, so a subsequent request can succeed without the user signing in again

### Requirement: Transient error handling

The client SHALL distinguish transient failures from authentication failures and from non-retryable request errors, and SHALL retry transient failures a bounded number of times before surfacing a connection/request error, leaving authentication state intact. Transient failures include connection/timeout errors and the HTTP statuses `408`, `429`, `500`, `502`, `503`, and `504`. For `429`, the client SHOULD honor a `Retry-After` header in delta-seconds form (capped). On each attempt (including after a token renewal) the client SHALL compute the `Authorization` header from the current token, so a renewed token is never sent stale.

#### Scenario: Transient network failure

- **WHEN** an API request fails due to a timeout or connection error
- **THEN** the client retries up to a bounded limit and only then surfaces a connection error, leaving authentication state intact

#### Scenario: Retryable server status

- **WHEN** an API request receives a `503` (or other retryable `5xx`/`429`) and a later attempt succeeds
- **THEN** the client returns the successful result without surfacing an error

#### Scenario: Renewed token is used on retry

- **WHEN** a request receives `401`, the client renews the token, and retries
- **THEN** the retry is sent with the freshly renewed token, not the rejected one

#### Scenario: Non-retryable request error

- **WHEN** an API request receives a non-retryable client error (e.g. `403`/`404`)
- **THEN** the client surfaces a request error without retrying indefinitely and without entering needs-reauth
