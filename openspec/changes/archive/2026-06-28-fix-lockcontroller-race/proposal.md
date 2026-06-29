## Why

The adversarial review found a race in `LockController` (GitHub #4). When the user issues two lock/unlock commands in quick succession, the first command's `sendCommand` rejection (or its timeout) acts on `this.pending` — which by then belongs to the **second, newer** command. The first's failure handler then clears the second command's timer and reverts its optimistic target, leaving the in-flight second command untracked (no confirmation, no revert) and HomeKit showing the wrong target.

## What Changes

- Each `requestTarget` call captures the `pending` record it created. Its rejection handler and its timeout only roll back if `this.pending` is **still that same record** — a superseding command is left untouched.
- `onTimeout` is keyed to the specific pending record, so a stale timer can never revert a newer command.

## Capabilities

### Modified Capabilities
- `lock-accessories`: make the optimistic lock/unlock state machine correct under rapid, overlapping commands.

## Impact

- Code: `src/lockController.ts` (`requestTarget`, `onTimeout` identity-guarded).
- Tests: a new case for two overlapping commands where the first fails and must not clobber the second.
- No public API or happy-path change.
