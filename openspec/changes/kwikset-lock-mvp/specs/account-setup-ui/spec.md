## ADDED Requirements

### Requirement: Credential entry and server-side login

The plugin SHALL provide a homebridge-config-ui-x custom UI in which the user enters their Kwikset email and password, and the UI's server component SHALL perform the login using the cloud client rather than handling credentials in the browser.

#### Scenario: User submits credentials

- **WHEN** the user enters email and password in the custom UI and submits
- **THEN** the UI server performs the login and the raw password is not persisted anywhere

#### Scenario: Invalid credentials feedback

- **WHEN** login fails because the credentials are invalid
- **THEN** the UI shows a clear error and lets the user try again

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

On successful authentication, the UI server SHALL store the refresh token (and account email) into the plugin's configuration so the running platform can use it, and SHALL NOT store the password.

#### Scenario: Token saved after login

- **WHEN** authentication succeeds in the custom UI
- **THEN** the refresh token and account email are written to the plugin config block and the password is discarded

### Requirement: Re-authentication entry point

The custom UI SHALL allow the user to re-authenticate at any time to replace an invalid or expired refresh token, using the same login flow.

#### Scenario: Re-auth after token expiry

- **WHEN** the stored refresh token is no longer valid and the user opens the custom UI to log in again
- **THEN** completing the flow overwrites the stored refresh token with a fresh one

### Requirement: In-progress challenge session continuity

The UI server SHALL retain the in-progress authentication session between the password submission and the verification-code submission so the challenge can be completed across the two steps.

#### Scenario: Two-step challenge completion

- **WHEN** a code challenge is started on password submission and the code is submitted in a later request
- **THEN** the server uses the retained in-progress session to complete authentication
