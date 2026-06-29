# kwikset-cloud-client Specification

## Purpose

Provide an authenticated client for the Kwikset cloud that handles Cognito SRP login, verification-code challenges, token lifecycle/refresh, device discovery, lock/unlock commands, and transient error handling.

## Requirements

### Requirement: Password authentication via Cognito SRP

The client SHALL authenticate to the Kwikset cloud using the account email and password via the AWS Cognito SRP flow, and on success SHALL obtain and retain an ID token, access token, and refresh token.

#### Scenario: Successful password login

- **WHEN** the client is given a valid email and password and performs login
- **THEN** it completes the SRP flow and returns/retains an ID token, access token, and refresh token

#### Scenario: Invalid credentials

- **WHEN** login is attempted with an incorrect email or password
- **THEN** the client raises a distinct authentication error that the caller can present as "invalid credentials" (not a generic crash)

### Requirement: Verification-code challenge fallback

When Cognito responds to login with a custom verification-code challenge instead of returning tokens directly, the client SHALL surface that a code is required, SHALL trigger delivery of the code, and SHALL complete authentication once the caller supplies the code.

#### Scenario: Code challenge is requested

- **WHEN** a login returns a Cognito `CUSTOM_CHALLENGE` rather than tokens
- **THEN** the client signals that a verification code is required and triggers the code to be sent to the account's delivery medium

#### Scenario: Code is submitted

- **WHEN** the caller submits the verification code for an in-progress challenge
- **THEN** the client completes the challenge and retains the resulting ID, access, and refresh tokens

#### Scenario: Common path requires no code

- **WHEN** Cognito returns tokens directly from the SRP login (no challenge)
- **THEN** the client completes authentication without prompting for a code

### Requirement: Token lifecycle and refresh

The client SHALL be able to restore a session from a stored refresh token and SHALL automatically renew the ID token before making API calls when it is missing or expired, without requiring the user to log in again.

#### Scenario: Restore from stored refresh token

- **WHEN** the client is initialized with a previously stored refresh token
- **THEN** it can obtain a valid ID token and make authenticated API calls without a password

#### Scenario: Automatic renewal before a request

- **WHEN** an API call is made and the current ID token is missing or expired
- **THEN** the client renews the ID token using the refresh token and proceeds with the call

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

### Requirement: Discovery of homes and devices

The client SHALL retrieve the account's homes and, for a given home, the list of devices with their current state fields (lock status, battery percentage, connectivity status, identifiers, and model metadata).

#### Scenario: List homes

- **WHEN** an authenticated client requests the account's homes
- **THEN** it returns each home's identifier and name

#### Scenario: List devices for a home

- **WHEN** an authenticated client requests devices for a home identifier
- **THEN** it returns each device's serial number/device id, name, lock status, battery percentage, connectivity status, and model metadata

### Requirement: Lock and unlock commands

The client SHALL send lock and unlock commands for a device and SHALL treat the command as accepted when the cloud acknowledges it, recognizing that the acknowledgement does not include the resulting lock state.

#### Scenario: Send unlock command

- **WHEN** the caller issues an unlock command for a device serial number
- **THEN** the client sends the command with the required action and source payload and resolves successfully on an accepted acknowledgement

#### Scenario: Command acknowledgement excludes final state

- **WHEN** a lock or unlock command is acknowledged by the cloud
- **THEN** the client does not assume the new lock state from the response and relies on a subsequent state read to confirm

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
