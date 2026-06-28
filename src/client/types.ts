/**
 * Domain types for the Kwikset cloud client. Field names mirror the cloud API
 * payloads (confirmed live); see project memory `kwikset-cloud-api-facts`.
 */

/** A set of Cognito tokens for an authenticated session. */
export interface Tokens {
  idToken: string;
  accessToken: string;
  refreshToken: string;
}

/** Result of a password login attempt. */
export type LoginResult =
  | { status: 'success'; tokens: Tokens }
  | { status: 'code_required' };

/** A home (account location) returned by the cloud. */
export interface Home {
  homeId: string;
  homeName: string;
}

/** Canonical lock states (independent of HomeKit). */
export enum LockStatus {
  Locked = 'Locked',
  Unlocked = 'Unlocked',
  Jammed = 'Jammed',
  Unknown = 'Unknown',
}

/** A lock device with the fields the plugin consumes. */
export interface KwiksetDevice {
  /** Device id == serial number; used in command URLs. */
  deviceId: string;
  name: string;
  lockStatus: LockStatus;
  /** 0–100, or undefined if absent. */
  batteryPercentage?: number;
  /** True when the device reports a connected status. */
  online: boolean;
  modelNumber?: string;
  firmwareVersion?: string;
  /** Raw connectivity string as reported by the cloud. */
  rawConnectivity?: string;
}

/** Lock command actions. */
export type LockAction = 'lock' | 'unlock';
