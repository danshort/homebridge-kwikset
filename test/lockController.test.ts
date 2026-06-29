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

describe('LockController overlapping commands (#4)', () => {
  it('an earlier command failing does not clobber a newer in-flight command', async () => {
    let timerFn: (() => void) | undefined;
    const sends: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];
    const controller = new LockController({
      timeoutMs: 1000,
      sendCommand: () =>
        new Promise<void>((resolve, reject) => {
          sends.push({ resolve, reject });
        }),
      onChange: () => undefined,
      setTimer: (fn) => {
        timerFn = fn;
        return {};
      },
      clearTimer: () => {
        timerFn = undefined;
      },
    });

    controller.setFromPoll(LockStatus.Locked); // current SECURED
    const first = controller.requestTarget(LockTargetState.UNSECURED); // command A
    const second = controller.requestTarget(LockTargetState.UNSECURED); // command B supersedes A

    sends[0].reject(new Error('send failed')); // A fails while B is still in flight
    await expect(first).rejects.toThrow('send failed');

    // B's optimistic state must be intact — not clobbered by A's failure.
    expect(controller.snapshot.target).toBe(LockTargetState.UNSECURED);
    expect(timerFn).toBeDefined();

    sends[1].resolve();
    await second;
    controller.setFromPoll(LockStatus.Unlocked); // B confirms
    expect(controller.snapshot.current).toBe(LockCurrentState.UNSECURED);
    expect(controller.snapshot.target).toBe(LockTargetState.UNSECURED);
  });

  it('a stale superseded timer does not revert the current command', () => {
    let staleTimer: (() => void) | undefined;
    const controller = new LockController({
      timeoutMs: 1000,
      sendCommand: async () => undefined,
      onChange: () => undefined,
      // Capture the first command's timer; deliberately do not clear timers so
      // the superseded one can still fire.
      setTimer: (fn) => {
        staleTimer ??= fn;
        return {};
      },
      clearTimer: () => undefined,
    });

    controller.setFromPoll(LockStatus.Locked); // SECURED
    void controller.requestTarget(LockTargetState.UNSECURED); // command A → staleTimer
    void controller.requestTarget(LockTargetState.UNSECURED); // command B supersedes A

    staleTimer?.(); // A's stale timeout fires
    expect(controller.snapshot.target).toBe(LockTargetState.UNSECURED); // B not reverted
  });
});
