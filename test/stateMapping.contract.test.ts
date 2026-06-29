import { describe, expect, it } from 'vitest';
import { Characteristic } from 'hap-nodejs';
import { LockCurrentState, LockTargetState } from '../src/client/stateMapping';

/**
 * `stateMapping` re-declares HAP's LockCurrentState/LockTargetState numeric
 * values so the module stays free of a `hap-nodejs` import. That mirroring is
 * the one place a typo or an upstream HAP change would silently make a lock
 * report the WRONG state. This contract test pins the mirrored values to the
 * real hap-nodejs constants so any drift fails loudly here.
 */
describe('stateMapping enums match hap-nodejs (#15)', () => {
  it('LockCurrentState values equal the HAP characteristic constants', () => {
    expect(LockCurrentState.UNSECURED).toBe(Characteristic.LockCurrentState.UNSECURED);
    expect(LockCurrentState.SECURED).toBe(Characteristic.LockCurrentState.SECURED);
    expect(LockCurrentState.JAMMED).toBe(Characteristic.LockCurrentState.JAMMED);
    expect(LockCurrentState.UNKNOWN).toBe(Characteristic.LockCurrentState.UNKNOWN);
  });

  it('LockTargetState values equal the HAP characteristic constants', () => {
    expect(LockTargetState.UNSECURED).toBe(Characteristic.LockTargetState.UNSECURED);
    expect(LockTargetState.SECURED).toBe(Characteristic.LockTargetState.SECURED);
  });
});
