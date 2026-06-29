## Context

`LockController.requestTarget` sets `this.pending` and awaits `sendCommand`. On rejection it calls `clearPending()` and reverts `target`. `onTimeout` likewise acts on `this.pending`. Both read the *current* `this.pending`, which a later `requestTarget` may have replaced — so an earlier command's failure/timeout corrupts the newer command (GitHub #4).

## Goals / Non-Goals

**Goals:** make rollback (on send-failure and on timeout) affect only the command that is still current. No change to the single-command happy path or the public surface.

**Non-Goals:** queuing/serializing commands (last-write-wins remains the model), changing the optimistic/reconcile design.

## Decisions

### Decision: identity-guard rollback on the captured pending record
`requestTarget` captures the `pending` record it creates in a local `const`. Its catch rolls back only `if (this.pending === pending)`. A superseding command will have replaced `this.pending`, so the stale failure is ignored (just rethrown to HomeKit).

### Decision: key `onTimeout` to its pending record
`onTimeout(pending)` receives the record its timer was armed for and no-ops unless `this.pending === pending`. This is belt-and-suspenders (a superseded command's timer is already cleared when it's superseded), but it makes a stale timer firing — e.g. under injected/fake timers — harmless.

## Risks / Trade-offs

- **Last-write-wins semantics unchanged** → two near-simultaneous opposite commands still resolve to whichever was requested last; that is the intended HomeKit behavior. This fix only stops an *older* command from corrupting the *newer* one.

## Open Questions

None.
