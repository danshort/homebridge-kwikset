# lock-accessories Specification

## Purpose

Discover Kwikset locks via the cloud client and expose them as HomeKit accessories with lock state, battery, periodic polling, optimistic lock/unlock with reconciliation, reachability, and graceful handling of needs-reauthentication.

## Requirements

### Requirement: Lock discovery and registration

The platform SHALL discover the account's locks via the cloud client and register each as a HomeKit accessory, restoring cached accessories across restarts and keeping them stable by device identifier.

#### Scenario: Discover and register locks

- **WHEN** the platform starts with a valid stored session
- **THEN** it lists the homes and devices and registers each lock as a HomeKit accessory keyed by its device identifier

#### Scenario: Stable accessories across restart

- **WHEN** the platform restarts
- **THEN** previously registered locks are restored without duplication and continue to map to the same devices

### Requirement: Lock state exposed via LockMechanism

Each lock SHALL expose a HomeKit `LockMechanism` service whose current and target states are derived from the device `lockstatus`, mapping Locked to secured, Unlocked to unsecured, Jammed to jammed, and any unrecognized value to unknown.

#### Scenario: Locked state

- **WHEN** the device reports `lockstatus` "Locked"
- **THEN** the LockMechanism current state reads as secured

#### Scenario: Unlocked state

- **WHEN** the device reports `lockstatus` "Unlocked"
- **THEN** the LockMechanism current state reads as unsecured

#### Scenario: Jammed state

- **WHEN** the device reports `lockstatus` "Jammed"
- **THEN** the LockMechanism current state reads as jammed

#### Scenario: Unrecognized state

- **WHEN** the device reports a `lockstatus` value the plugin does not recognize
- **THEN** the LockMechanism current state reads as unknown

### Requirement: Battery service

Each lock SHALL expose a HomeKit `Battery` service reporting battery level from `batterypercentage` and a low-battery status when the level falls at or below a defined threshold.

#### Scenario: Battery level reported

- **WHEN** the device reports a battery percentage
- **THEN** the Battery service reports that level

#### Scenario: Low battery

- **WHEN** the battery percentage is at or below the low-battery threshold
- **THEN** the Battery service reports a low-battery status

### Requirement: Periodic state polling

The platform SHALL poll device state on a configurable interval (defaulting to 30 seconds) and SHALL update the HomeKit characteristics when state changes.

#### Scenario: State refreshed on interval

- **WHEN** the polling interval elapses
- **THEN** the platform reads current device state and updates the corresponding HomeKit characteristics

#### Scenario: Configurable interval

- **WHEN** the user configures a polling interval
- **THEN** the platform uses that interval instead of the default

### Requirement: Lock/unlock with optimistic state and reconciliation

When the user sets the target lock state in HomeKit, the platform SHALL send the corresponding command, SHALL immediately reflect an in-progress/optimistic state, and SHALL reconcile the actual state via a follow-up read, reverting the optimistic state if the command is not confirmed within a timeout.

#### Scenario: Unlock from HomeKit

- **WHEN** the user sets the target state to unsecured
- **THEN** the platform sends the unlock command and immediately shows an optimistic unsecuring state

#### Scenario: Reconcile confirmed change

- **WHEN** a follow-up state read after a command shows the new state
- **THEN** the platform sets the current state to the confirmed value

#### Scenario: Command not confirmed in time

- **WHEN** the optimistic state is not confirmed by a state read within the timeout
- **THEN** the platform reverts to the last known actual state

### Requirement: Reachability from connectivity

The platform SHALL reflect device connectivity in HomeKit, marking a lock as not responding when `deviceconnectivitystatus` indicates it is offline.

#### Scenario: Device offline

- **WHEN** a device reports a non-connected connectivity status
- **THEN** the corresponding accessory is presented as not responding in HomeKit

#### Scenario: Device back online

- **WHEN** a previously offline device reports connected again
- **THEN** the accessory resumes normal reporting

### Requirement: Graceful handling of needs-reauthentication

When the cloud client reports a needs-reauthentication condition, the platform SHALL stop polling-induced error spam, log clear guidance to re-authenticate in the custom UI, and avoid crash-looping.

#### Scenario: Session invalid during operation

- **WHEN** the cloud client reports that re-authentication is required
- **THEN** the platform logs a clear message directing the user to re-authenticate and does not repeatedly crash or flood logs
