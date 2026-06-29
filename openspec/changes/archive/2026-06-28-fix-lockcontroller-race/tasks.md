## 1. Fix (lockController.ts)

- [x] 1.1 `requestTarget` captures the `pending` record it creates; its catch rolls back only if `this.pending === pending`
- [x] 1.2 `onTimeout(pending)` is keyed to its record and no-ops unless `this.pending === pending`

## 2. Tests

- [x] 2.1 Two overlapping commands: the first fails and must NOT clear the second's timer or revert its target
- [x] 2.2 A stale (superseded) timer firing does not revert the current command

## 3. Verify & ship

- [x] 3.1 `npm run build` + `npm run lint` + `npm test` green
- [x] 3.2 Adversarial review panel scoped to lockController.ts; address regressions
- [x] 3.3 Archive (sync spec) and open the stacked PR (no merge)
