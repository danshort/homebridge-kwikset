## MODIFIED Requirements

### Requirement: Lock/unlock with optimistic state and reconciliation

When the user sets the target lock state in HomeKit, the platform SHALL send the corresponding command, SHALL immediately reflect an in-progress/optimistic state, and SHALL reconcile the actual state via a follow-up read, reverting the optimistic state if the command is not confirmed within a timeout. When commands overlap (a new target is set while a previous command is still in flight), a failure or timeout of the earlier command SHALL NOT disturb the newer command's optimistic state or its confirmation/timeout — only the command that is still current may roll itself back.

#### Scenario: Unlock from HomeKit

- **WHEN** the user sets the target state to unsecured
- **THEN** the platform sends the unlock command and immediately shows an optimistic unsecuring state

#### Scenario: Reconcile confirmed change

- **WHEN** a follow-up state read after a command shows the new state
- **THEN** the platform sets the current state to the confirmed value

#### Scenario: Command not confirmed in time

- **WHEN** the optimistic state is not confirmed by a state read within the timeout
- **THEN** the platform reverts to the last known actual state

#### Scenario: An earlier command's failure does not disturb a newer one

- **WHEN** a second target is set while the first command is still in flight, and the first command then fails or times out
- **THEN** the second command's optimistic target, timer, and confirmation are left intact (the stale failure/timeout is ignored)
