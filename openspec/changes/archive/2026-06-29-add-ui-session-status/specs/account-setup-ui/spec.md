## ADDED Requirements

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
