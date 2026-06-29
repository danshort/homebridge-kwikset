## MODIFIED Requirements

### Requirement: Periodic state polling

The platform SHALL poll device state on a configurable interval (defaulting to 30 seconds) and SHALL update the HomeKit characteristics when state changes. Discovery runs SHALL be serialized — at most one runs at a time, and a run requested while another is in flight SHALL coalesce into a single follow-up run — so state reads are never applied out of order. A failure fetching one home's devices (or updating one device) SHALL be isolated and SHALL NOT prevent the remaining homes/devices from being refreshed in the same cycle; a `NeedsReauthError` SHALL still escalate.

#### Scenario: State refreshed on interval

- **WHEN** the polling interval elapses
- **THEN** the platform reads current device state and updates the corresponding HomeKit characteristics

#### Scenario: Configurable interval

- **WHEN** the user configures a polling interval
- **THEN** the platform uses that interval instead of the default

#### Scenario: Discovery runs do not overlap

- **WHEN** a second discovery is requested while one is already in progress
- **THEN** the second does not run concurrently; it is coalesced into a single follow-up run after the current one completes

#### Scenario: One home's failure is isolated

- **WHEN** fetching devices for one home fails with a non-auth error
- **THEN** the platform logs it and still refreshes the other homes' devices in that cycle

### Requirement: Graceful handling of needs-reauthentication

When the cloud client reports a needs-reauthentication condition, the platform SHALL stop polling (ending the polling-induced error spam), log clear guidance to re-authenticate in the custom UI, and avoid crash-looping. While in the needs-reauth state the platform SHALL periodically re-read the persisted session and, when the stored refresh token changes (the user has re-authenticated), SHALL restore the session and resume polling automatically without requiring a Homebridge restart.

#### Scenario: Session invalid during operation

- **WHEN** the cloud client reports that re-authentication is required
- **THEN** the platform stops its poll timer, logs a clear message directing the user to re-authenticate, and does not repeatedly crash or flood logs

#### Scenario: Automatic recovery after re-authentication

- **WHEN** the platform is in the needs-reauth state and the persisted session is updated with a new refresh token
- **THEN** on the next re-check the platform restores the session and resumes polling, without a restart

#### Scenario: First-run sign-in without restart

- **WHEN** the platform starts with no stored session and the user later signs in via the custom UI
- **THEN** the platform picks up the new session on a re-check and begins polling, without a restart
