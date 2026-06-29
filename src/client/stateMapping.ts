/**
 * Pure mapping helpers between Kwikset cloud values and HomeKit semantics.
 * Kept free of `hap-nodejs` imports so they can be unit-tested in isolation;
 * the numeric values match HAP's LockCurrentState / LockTargetState.
 */

import { LockStatus } from './types';

/** Mirrors HAP Characteristic.LockCurrentState. */
export enum LockCurrentState {
  UNSECURED = 0,
  SECURED = 1,
  JAMMED = 2,
  UNKNOWN = 3,
}

/** Mirrors HAP Characteristic.LockTargetState. */
export enum LockTargetState {
  UNSECURED = 0,
  SECURED = 1,
}

/** Map a canonical LockStatus to the HomeKit current-state value. */
export function toHomeKitCurrentState(status: LockStatus): LockCurrentState {
  switch (status) {
    case LockStatus.Locked:
      return LockCurrentState.SECURED;
    case LockStatus.Unlocked:
      return LockCurrentState.UNSECURED;
    case LockStatus.Jammed:
      return LockCurrentState.JAMMED;
    default:
      return LockCurrentState.UNKNOWN;
  }
}

/**
 * Return true when the battery is at or below the low-battery threshold.
 * Missing battery values are not treated as low.
 */
export function isLowBattery(percentage: number | undefined, threshold: number): boolean {
  if (percentage === undefined || Number.isNaN(percentage)) {
    return false;
  }
  return percentage <= threshold;
}
