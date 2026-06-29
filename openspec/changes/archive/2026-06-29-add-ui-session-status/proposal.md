## Why

When the running platform's stored refresh token is rejected by the cloud, the platform enters a "needs re-auth" state (it stops polling and logs a warning). But the setup UI has no idea: `refreshSignedInState()` derives the green "Signed in as …" badge purely from the presence of a token in config, so it keeps showing a healthy, signed-in state even while the locks are actually offline and the user must sign in again. The only signal today is a line in the Homebridge log, which most users never see. This is the remaining half of issue #14 (the rotated-token half was resolved by documenting the Cognito non-rotation invariant).

The platform and the config-UI server run in **separate processes**, so the platform cannot call into the UI directly — it needs a channel the UI can read.

## What Changes

- The platform writes a small **session-status file** to the Homebridge storage directory whenever its session health changes (healthy ↔ needs-reauth), written atomically so the reader never sees a partial file.
- The config-UI server gains a **`/status` request handler** that reads that file and reports `{ needsReauth }` to the browser (defaulting to healthy/unknown when the file is absent or unreadable).
- The setup UI queries `/status` and, when the platform reports needs-reauth **and** a token is present in config, shows a **"session expired — sign in again"** warning instead of the green "Signed in" badge. The sign-in form stays available so the user can recover in place.

## Capabilities

### Modified Capabilities
- `account-setup-ui`: adds a requirement that the setup UI surface the platform's live session-expired / needs-reauth state, via a cross-process status channel, rather than inferring health solely from token presence.

## Impact

- New shared module `src/sessionStatus.ts` (status file path + shape + atomic write / tolerant read).
- `src/platform.ts`: write status on start, on entering needs-reauth, and on recovery.
- `homebridge-ui/server.js`: new `/status` handler reading the status file from `homebridgeStoragePath`.
- `homebridge-ui/public/index.html`: query `/status`; render a session-expired warning state.
- No new dependencies; no change to the cloud client or auth flow.
