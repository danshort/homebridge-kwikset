import { describe, expect, it, vi } from 'vitest';
import { LockController, LockSnapshot } from '../src/lockController';
import { LockCurrentState, LockTargetState } from '../src/client/stateMapping';
import { LockStatus, LockAction } from '../src/client/types';

interface Harness {
  controller: LockController;
  snapshots: LockSnapshot[];
  commands: LockAction[];
  fireTimer: () => void;
  hasTimer: () => boolean;
}

function harness(opts: { sendCommand?: (a: LockAction) => Promise<void> } = {}): Harness {
  const snapshots: LockSnapshot[] = [];
  const commands: LockAction[] = [];
  let timerFn: (() => void) | undefined;

  const controller = new LockController({
    timeoutMs: 1000,
    sendCommand: opts.sendCommand ?? (async (a) => {
      commands.push(a);
    }),
    onChange: (snap) => snapshots.push({ ...snap }),
    setTimer: (fn) => {
      timerFn = fn;
      return 1;
    },
    clearTimer: () => {
      timerFn = undefined;
    },
  });

  return {
    controller,
    snapshots,
    commands,
    fireTimer: () => timerFn?.(),
    hasTimer: () => timerFn !== undefined,
  };
}

describe('LockController state mapping from polls', () => {
  it('maps Locked/Unlocked/Jammed/unknown to HomeKit current states', () => {
    const h = harness();
    h.controller.setFromPoll(LockStatus.Locked);
    expect(h.controller.snapshot.current).toBe(LockCurrentState.SECURED);
    h.controller.setFromPoll(LockStatus.Unlocked);
    expect(h.controller.snapshot.current).toBe(LockCurrentState.UNSECURED);
    h.controller.setFromPoll(LockStatus.Jammed);
    expect(h.controller.snapshot.current).toBe(LockCurrentState.JAMMED);
    h.controller.setFromPoll(LockStatus.Unknown);
    expect(h.controller.snapshot.current).toBe(LockCurrentState.UNKNOWN);
  });

  it('keeps target in sync with external changes when no command is pending', () => {
    const h = harness();
    h.controller.setFromPoll(LockStatus.Unlocked);
    expect(h.controller.snapshot.target).toBe(LockTargetState.UNSECURED);
    h.controller.setFromPoll(LockStatus.Locked);
    expect(h.controller.snapshot.target).toBe(LockTargetState.SECURED);
  });
});

describe('LockController optimistic command flow', () => {
  it('sends the command and shows optimistic target immediately', async () => {
    const h = harness();
    h.controller.setFromPoll(LockStatus.Locked); // current SECURED

    await h.controller.requestTarget(LockTargetState.UNSECURED);

    expect(h.commands).toEqual(['unlock']);
    expect(h.controller.snapshot.target).toBe(LockTargetState.UNSECURED);
    // current still secured → HomeKit shows "Unlocking…"
    expect(h.controller.snapshot.current).toBe(LockCurrentState.SECURED);
    expect(h.hasTimer()).toBe(true);
  });

  it('reconciles to confirmed state on a follow-up poll and cancels the timer', async () => {
    const h = harness();
    h.controller.setFromPoll(LockStatus.Locked);
    await h.controller.requestTarget(LockTargetState.UNSECURED);

    h.controller.setFromPoll(LockStatus.Unlocked); // bolt actually moved

    expect(h.controller.snapshot.current).toBe(LockCurrentState.UNSECURED);
    expect(h.controller.snapshot.target).toBe(LockTargetState.UNSECURED);
    expect(h.hasTimer()).toBe(false); // confirmed → timer cleared
  });

  it('reverts the optimistic target when the command is not confirmed in time', async () => {
    const h = harness();
    h.controller.setFromPoll(LockStatus.Locked);
    await h.controller.requestTarget(LockTargetState.UNSECURED);

    h.fireTimer(); // timeout with no confirming poll

    expect(h.controller.snapshot.target).toBe(LockTargetState.SECURED); // reverted to actual
    expect(h.controller.snapshot.current).toBe(LockCurrentState.SECURED);
  });

  it('does not revert if a confirming poll arrived before the timeout', async () => {
    const h = harness();
    h.controller.setFromPoll(LockStatus.Locked);
    await h.controller.requestTarget(LockTargetState.UNSECURED);
    h.controller.setFromPoll(LockStatus.Unlocked); // confirmed, clears timer
    h.fireTimer(); // stale timer firing should be a no-op

    expect(h.controller.snapshot.target).toBe(LockTargetState.UNSECURED);
  });

  it('drops the optimistic state if the command fails to send', async () => {
    const sendCommand = vi.fn(async () => {
      throw new Error('network down');
    });
    const h = harness({ sendCommand });
    h.controller.setFromPoll(LockStatus.Locked);

    await expect(h.controller.requestTarget(LockTargetState.UNSECURED)).rejects.toThrow('network down');
    expect(h.controller.snapshot.target).toBe(LockTargetState.SECURED); // reverted
    expect(h.hasTimer()).toBe(false);
  });
});
