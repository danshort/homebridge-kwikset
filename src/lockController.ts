/**
 * The optimistic-state machine for a single lock, kept free of `hap-nodejs`
 * so it can be unit-tested with a fake command sender and an injectable timer.
 *
 * Why this exists: the cloud lock/unlock command is asynchronous — it is
 * acknowledged before the bolt moves and the new state only appears on a later
 * read. So when the user sets a target in HomeKit we send the command, show an
 * in-progress (optimistic) state immediately, and reconcile against the real
 * state on the next poll, reverting if it is not confirmed within a timeout.
 */

import { LockCurrentState, LockTargetState, toHomeKitCurrentState } from './client/stateMapping';
import { LockAction, LockStatus } from './client/types';

export interface LockSnapshot {
  current: LockCurrentState;
  target: LockTargetState;
}

type TimerHandle = unknown;

export interface LockControllerDeps {
  /** Send the lock/unlock command to the cloud. */
  sendCommand: (action: LockAction) => Promise<void>;
  /** Called whenever current/target change, to push values into HomeKit. */
  onChange: (snap: LockSnapshot) => void;
  /** How long to wait for confirmation before reverting the optimistic state. */
  timeoutMs: number;
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  log?: (msg: string) => void;
}

interface PendingCommand {
  target: LockTargetState;
  handle: TimerHandle;
}

export class LockController {
  private current: LockCurrentState = LockCurrentState.UNKNOWN;
  private target: LockTargetState = LockTargetState.SECURED;
  private pending?: PendingCommand;

  private readonly setTimer: (fn: () => void, ms: number) => TimerHandle;
  private readonly clearTimer: (handle: TimerHandle) => void;
  private readonly log: (msg: string) => void;

  constructor(private readonly deps: LockControllerDeps) {
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.log = deps.log ?? (() => undefined);
  }

  get snapshot(): LockSnapshot {
    return { current: this.current, target: this.target };
  }

  /** Update from an authoritative state read (poll or post-command refresh). */
  setFromPoll(status: LockStatus): void {
    this.current = toHomeKitCurrentState(status);

    if (this.pending) {
      if (this.current === (this.pending.target as number)) {
        // Confirmed: the bolt reached the requested state.
        this.target = this.pending.target;
        this.clearPending();
      }
      // If jammed/unknown, keep waiting until the timeout decides.
    } else {
      // No command in flight: keep target in sync with reality so external
      // changes (e.g. the keypad) don't leave HomeKit stuck "transitioning".
      if (this.current === LockCurrentState.SECURED) {
        this.target = LockTargetState.SECURED;
      } else if (this.current === LockCurrentState.UNSECURED) {
        this.target = LockTargetState.UNSECURED;
      }
    }
    this.emit();
  }

  /** Handle a HomeKit target-state set: send the command optimistically. */
  async requestTarget(target: LockTargetState): Promise<void> {
    this.target = target;
    this.emit(); // current still differs → HomeKit shows "Locking…/Unlocking…"

    if (this.pending) {
      this.clearTimer(this.pending.handle);
    }
    // Capture this call's own pending record. A later requestTarget can replace
    // `this.pending`; rollback below must only act if THIS command is still it.
    const pending: PendingCommand = {
      target,
      handle: this.setTimer(() => this.onTimeout(pending), this.deps.timeoutMs),
    };
    this.pending = pending;

    const action: LockAction = target === LockTargetState.SECURED ? 'lock' : 'unlock';
    try {
      await this.deps.sendCommand(action);
    } catch (err) {
      // The command failed to send. Only roll back if a newer command hasn't
      // superseded this one in the meantime.
      if (this.pending === pending) {
        this.clearPending();
        this.target = this.currentAsTarget();
        this.emit();
      }
      throw err;
    }
  }

  private onTimeout(pending: PendingCommand): void {
    // Ignore a stale timer from a command that was confirmed or superseded.
    if (this.pending !== pending) {
      return;
    }
    this.log('Lock command was not confirmed in time; reverting to last known state');
    this.pending = undefined;
    this.target = this.currentAsTarget();
    this.emit();
  }

  private clearPending(): void {
    if (this.pending) {
      this.clearTimer(this.pending.handle);
      this.pending = undefined;
    }
  }

  private currentAsTarget(): LockTargetState {
    return this.current === LockCurrentState.SECURED ? LockTargetState.SECURED : LockTargetState.UNSECURED;
  }

  private emit(): void {
    this.deps.onChange(this.snapshot);
  }
}
