## MODIFIED Requirements

### Requirement: Credential entry and server-side login

The plugin SHALL provide a homebridge-config-ui-x custom UI in which the user enters their Kwikset email and password, and the UI's server component SHALL perform the login using the cloud client rather than handling credentials in the browser. Login error messages returned to the browser SHALL NOT distinguish "no such account" from "wrong password" — a credential failure SHALL surface a single generic message — so the UI cannot be used to enumerate accounts. The raw upstream identity-provider message SHALL NOT be relayed for credential failures (distinct messages are reserved for the verification-code and network/connection cases).

#### Scenario: User submits credentials

- **WHEN** the user enters email and password in the custom UI and submits
- **THEN** the UI server performs the login and the raw password is not persisted anywhere

#### Scenario: Invalid credentials feedback

- **WHEN** login fails because the credentials are invalid
- **THEN** the UI shows a single generic "invalid email or password" error (regardless of whether the account exists) and lets the user try again

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
