/**
 * Pure parsers from raw cloud JSON into domain types. Separated from the HTTP
 * client so they can be unit-tested against recorded fixtures.
 */

import { Home, KwiksetDevice } from './types';
import { isConnected, parseLockStatus } from './stateMapping';

interface RawEnvelope<T> {
  data?: T[];
  total?: number;
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
  const deviceId = (raw.serialnumber ?? raw.deviceid) as string | undefined;
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
    deviceId: String(deviceId),
    name: typeof raw.devicename === 'string' && raw.devicename ? raw.devicename : String(deviceId),
    // List endpoint uses `lockstatus`; detail endpoint uses `doorstatus`.
    lockStatus: parseLockStatus((raw.lockstatus ?? raw.doorstatus) as string | undefined),
    batteryPercentage: battery !== undefined && !Number.isNaN(battery) ? battery : undefined,
    online: isConnected(connectivity),
    modelNumber: typeof raw.modelnumber === 'string' ? raw.modelnumber : undefined,
    firmwareVersion: typeof raw.firmwareversion === 'string' ? raw.firmwareversion : undefined,
    rawConnectivity: connectivity,
  };
}
