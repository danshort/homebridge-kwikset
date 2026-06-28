## Why

Kwikset Halo Wi-Fi locks have no native HomeKit support and the lock is too old for Matter, so it cannot be controlled from Apple Home or Siri. Kwikset exposes a cloud API (the backend of its official app) that we have now proven works end-to-end from Node against real hardware — authenticate, read lock/battery state, and lock/unlock. A Homebridge plugin can bridge that cloud API into HomeKit.

## What Changes

- New Homebridge dynamic platform plugin `homebridge-kwikset` that exposes each Kwikset lock as a HomeKit accessory.
- A reusable cloud client that performs AWS Cognito SRP authentication (with a progressive verification-code fallback), refreshes tokens automatically, and calls the Kwikset REST API for discovery, state, and lock/unlock commands.
- A homebridge-config-ui-x **custom UI** for account setup: the user enters email + password, the plugin logs in server-side and persists the resulting refresh token into the plugin config. The same UI is used to re-authenticate if the token later becomes invalid.
- Each lock surfaces a HomeKit `LockMechanism` service (state mapped from `lockstatus`) and a `Battery` service (from `batterypercentage`), with reachability derived from `deviceconnectivitystatus`.
- Lock/unlock uses optimistic HomeKit state with poll-based reconciliation and a timeout guard, because the cloud command is asynchronous (it returns before the bolt has moved).
- A clean "needs re-authentication" state when the refresh token is rejected — surfaced to the user without crash-looping.

## Capabilities

### New Capabilities
- `kwikset-cloud-client`: Authenticates to the Kwikset cloud (Cognito SRP + verification-code fallback), maintains the token lifecycle (refresh, needs-reauth), and provides typed read/write operations against the REST API (list homes, list devices, lock/unlock).
- `account-setup-ui`: A homebridge-config-ui-x custom UI that bootstraps and re-establishes authentication by capturing credentials, completing login server-side, and persisting the refresh token to plugin config.
- `lock-accessories`: A dynamic platform that discovers locks, polls their state on an interval, and exposes them to HomeKit as LockMechanism + Battery accessories with optimistic lock/unlock and reachability handling.

### Modified Capabilities
<!-- None — greenfield project, no existing specs. -->

## Impact

- **New project scaffolding**: TypeScript Homebridge plugin (`package.json` with `homebridge` engine + `keywords: homebridge-plugin`, `config.schema.json`, build tooling), and a `homebridge-ui/` directory for the custom UI.
- **Dependencies**: `amazon-cognito-identity-js` (SRP auth, proven in the spike), `@homebridge/plugin-ui-utils` (custom UI server), `homebridge` (peer/dev). Node 18+ for global `fetch`.
- **External API**: depends on Kwikset's undocumented cloud API (Cognito pool/client IDs, `execute-api` REST endpoints). Unofficial and subject to change without notice; documented in project memory `kwikset-cloud-api-facts`.
- **Security/secrets**: a Kwikset refresh token is stored in plaintext in the Homebridge config JSON — acceptable here because Homebridge runs on a trusted internal network with no external access.
- **Throwaway**: `spike-auth.js` at the repo root and its ad-hoc deps are exploratory; to be removed or relocated before publishing.
- **Out of scope (later phases)**: AppSync WebSocket push for instant state, access-code management, autolock/LED/audio/secure-screen toggles, door-position contact sensor, multi-account.
