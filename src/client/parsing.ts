/**
 * Pure parsers from raw cloud JSON into domain types. Separated from the HTTP
 * client so they can be unit-tested against recorded fixtures.
 */

import { Home, KwiksetDevice, LockStatus } from './types';

interface RawEnvelope<T> {
  data?: T[];
  total?: number;
}

/**
 * Parse the cloud `lockstatus` string into a canonical LockStatus,
 * case-insensitively. Unrecognized values become `Unknown`.
 */
export function parseLockStatus(raw: string | undefined | null): LockStatus {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'locked':
      return LockStatus.Locked;
    case 'unlocked':
      return LockStatus.Unlocked;
    case 'jammed':
      return LockStatus.Jammed;
    default:
      return LockStatus.Unknown;
  }
}

/** Interpret the cloud connectivity string as online/offline. */
export function isConnected(rawConnectivity: string | undefined | null): boolean {
  return (rawConnectivity ?? '').trim().toLowerCase() === 'connected';
}

/** Return the first value that is a non-empty (non-whitespace) string. */
function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }
  }
  return undefined;
}

/** Parse the `/users/me/homes` response. */
export function parseHomes(body: unknown): Home[] {
  const data = (body as RawEnvelope<Record<string, unknown>>)?.data ?? [];
  return data
    .filter((h) => typeof h.homeid === 'string')
    .map((h) => ({
      homeId: String(h.homeid),
      homeName: typeof h.homename === 'string' ? h.homename : String(h.homeid),
    }));
}

/** Parse the `/homes/{id}/devices` response into lock devices. */
export function parseDevices(body: unknown): KwiksetDevice[] {
  const data = (body as RawEnvelope<Record<string, unknown>>)?.data ?? [];
  return data
    .map(parseDevice)
    .filter((d): d is KwiksetDevice => d !== null);
}

/** Parse a single device record. Returns null if it lacks an identifier. */
export function parseDevice(raw: Record<string, unknown>): KwiksetDevice | null {
  // Treat empty strings as absent so a blank serialnumber falls back to deviceid.
  const deviceId = firstNonEmptyString(raw.serialnumber, raw.deviceid);
  if (!deviceId) {
    return null;
  }
  const batteryRaw = raw.batterypercentage;
  const battery =
    typeof batteryRaw === 'number'
      ? batteryRaw
      : typeof batteryRaw === 'string' && batteryRaw.trim() !== ''
        ? Number(batteryRaw)
        : undefined;

  const connectivity = raw.deviceconnectivitystatus as string | undefined;

  return {
    deviceId,
    name: typeof raw.devicename === 'string' && raw.devicename ? raw.devicename : deviceId,
    // List endpoint uses `lockstatus`; detail endpoint uses `doorstatus`.
    lockStatus: parseLockStatus(firstNonEmptyString(raw.lockstatus, raw.doorstatus)),
    batteryPercentage: battery !== undefined && !Number.isNaN(battery) ? battery : undefined,
    online: isConnected(connectivity),
    modelNumber: typeof raw.modelnumber === 'string' ? raw.modelnumber : undefined,
    firmwareVersion: typeof raw.firmwareversion === 'string' ? raw.firmwareversion : undefined,
    rawConnectivity: connectivity,
  };
}
