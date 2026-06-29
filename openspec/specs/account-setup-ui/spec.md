# account-setup-ui Specification

## Purpose

Provide a homebridge-config-ui-x custom UI for Kwikset account setup that performs server-side login, handles progressive verification-code challenges, persists the refresh token to plugin config, and supports re-authentication.

## Requirements

### Requirement: Credential entry and server-side login

The plugin SHALL provide a homebridge-config-ui-x custom UI in which the user enters their Kwikset email and password, and the UI's server component SHALL perform the login using the cloud client rather than handling credentials in the browser. Login error messages returned to the browser SHALL NOT distinguish "no such account" from "wrong password" — a credential failure SHALL surface a single generic message — so the UI cannot be used to enumerate accounts. The raw upstream identity-provider message SHALL NOT be relayed for credential failures (distinct messages are reserved for the verification-code and network/connection cases).

#### Scenario: User submits credentials

- **WHEN** the user enters email and password in the custom UI and submits
- **THEN** the UI server performs the login and the raw password is not persisted anywhere

#### Scenario: Invalid credentials feedback

- **WHEN** login fails because the credentials are invalid
- **THEN** the UI shows a single generic "invalid email or password" error (regardless of whether the account exists) and lets the user try again

### Requirement: Progressive verification-code step

The custom UI SHALL show a verification-code field only when login returns a code challenge, and SHALL complete authentication after the user enters the code.

#### Scenario: Code required

- **WHEN** login returns a verification-code challenge
- **THEN** the UI reveals a code-entry field and indicates the code has been sent

#### Scenario: No code required

- **WHEN** login returns tokens directly without a challenge
- **THEN** the UI proceeds to success without showing a code field

#### Scenario: Code submitted

- **WHEN** the user enters the verification code and submits
- **THEN** the UI server completes the challenge and obtains a refresh token

### Requirement: Persist refresh token to plugin config

On successful authentication, the plugin settings UI SHALL persist the refresh token (and account email) into the plugin's configuration so the running platform can use it, and SHALL NOT persist the password. The UI server performs the login and returns the tokens to the browser; the UI client writes them to the plugin config via the Homebridge config API (the plugin-ui server has no direct config-write access).

#### Scenario: Token saved after login

- **WHEN** authentication succeeds in the custom UI
- **THEN** the refresh token and account email are written to the plugin config block and the password is never persisted

### Requirement: Re-authentication entry point

The custom UI SHALL allow the user to re-authenticate at any time to replace an invalid or expired refresh token, using the same login flow.

#### Scenario: Re-auth after token expiry

- **WHEN** the stored refresh token is no longer valid and the user opens the custom UI to log in again
- **THEN** completing the flow overwrites the stored refresh token with a fresh one

### Requirement: In-progress challenge session continuity

The UI server SHALL retain the in-progress authentication session between the password submission and the verification-code submission so the challenge can be completed across the two steps. Each in-progress challenge SHALL be identified by an opaque session id issued on password submission and required on code submission, so concurrent login flows do not interfere, and SHALL expire after a bounded time.

#### Scenario: Two-step challenge completion

- **WHEN** a code challenge is started on password submission and the code is submitted in a later request with the issued session id
- **THEN** the server uses the matching in-progress session to complete authentication

#### Scenario: Concurrent flows do not interfere

- **WHEN** two login flows are in progress at once
- **THEN** each code submission completes only its own challenge, identified by its session id

#### Scenario: Expired challenge

- **WHEN** a code is submitted for a challenge whose session has expired or is unknown
- **THEN** the server rejects it with guidance to start over, and does not complete a different challenge

### Requirement: Surface live session-expired state in the setup UI

The setup UI SHALL surface the running platform's live session health, so that when the platform's stored session has been rejected (needs re-auth) the UI shows a session-expired indication and prompts the user to sign in again, rather than continuing to show a healthy "signed in" state inferred solely from the presence of a token in config. Because the platform and the UI server are separate processes, the platform SHALL publish its session health to a location the UI server can read, and the UI server SHALL expose that health to the browser. When the platform's session health is unknown or unavailable, the UI SHALL fall back to its token-presence behavior and SHALL NOT show a false session-expired warning.

#### Scenario: Platform session rejected while UI shows signed-in

- **WHEN** the platform has entered its needs-reauth state and the user opens the plugin settings UI while a token is still present in config
- **THEN** the UI shows a "session expired — sign in again" indication (not the plain green "signed in" badge) and keeps the sign-in form available to recover

#### Scenario: Healthy session

- **WHEN** a token is present in config and the platform reports a healthy session
- **THEN** the UI shows the normal "signed in as …" state

#### Scenario: Session health unavailable

- **WHEN** the platform's session health cannot be determined (no status published yet, or it is unreadable)
- **THEN** the UI falls back to its token-presence behavior and does not display a session-expired warning

#### Scenario: Recovery clears the warning

- **WHEN** the user signs in again from the UI and the platform recovers its session
- **THEN** the platform's published health returns to healthy and the UI no longer shows the session-expired indication
