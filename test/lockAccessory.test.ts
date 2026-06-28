import { describe, expect, it, vi } from 'vitest';
import { LockAccessory } from '../src/lockAccessory';
import { KwiksetDevice, LockStatus } from '../src/client/types';
import { Characteristic, FakeAccessory, Service, fakeLog } from './hapStub';

function device(overrides: Partial<KwiksetDevice> = {}): KwiksetDevice {
  return {
    deviceId: 'SN1',
    name: 'Front Door',
    lockStatus: LockStatus.Locked,
    batteryPercentage: 100,
    online: true,
    modelNumber: 'HALO-01',
    firmwareVersion: '02.09.10.10',
    ...overrides,
  };
}

function makePlatform() {
  return {
    hap: { Service, Characteristic },
    commandTimeoutMs: 1000,
    lowBatteryThreshold: 20,
    log: fakeLog(),
    sendLockCommand: vi.fn(async () => undefined),
    requestQuickRefresh: vi.fn(),
  };
}

function build(dev: KwiksetDevice, platform = makePlatform()) {
  const accessory = new FakeAccessory(dev.name, `uuid-${dev.deviceId}`);
  const lock = new LockAccessory(platform as never, accessory as never, dev);
  return { platform, accessory, lock };
}

describe('LockAccessory state + battery mapping', () => {
  it('reflects a locked device as SECURED', () => {
    const { accessory } = build(device({ lockStatus: LockStatus.Locked }));
    const svc = accessory.getService(Service.LockMechanism)!;
    expect(svc.valueOf(Characteristic.LockCurrentState)).toBe(Characteristic.LockCurrentState.SECURED);
  });

  it('maps an unrecognized status to UNKNOWN', () => {
    const { lock, accessory } = build(device({ lockStatus: LockStatus.Unknown }));
    lock.update(device({ lockStatus: LockStatus.Unknown }));
    const svc = accessory.getService(Service.LockMechanism)!;
    expect(svc.valueOf(Characteristic.LockCurrentState)).toBe(Characteristic.LockCurrentState.UNKNOWN);
  });

  it('reports battery level and normal status above the threshold', () => {
    const { accessory } = build(device({ batteryPercentage: 50 }));
    const batt = accessory.getService(Service.Battery)!;
    expect(batt.valueOf(Characteristic.BatteryLevel)).toBe(50);
    expect(batt.valueOf(Characteristic.StatusLowBattery)).toBe(Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
  });

  it('flags low battery exactly at the threshold boundary', () => {
    const { accessory } = build(device({ batteryPercentage: 20 }));
    const batt = accessory.getService(Service.Battery)!;
    expect(batt.valueOf(Characteristic.StatusLowBattery)).toBe(Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
  });

  it('does not flag low battery just above the threshold', () => {
    const { accessory } = build(device({ batteryPercentage: 21 }));
    const batt = accessory.getService(Service.Battery)!;
    expect(batt.valueOf(Characteristic.StatusLowBattery)).toBe(Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
  });
});

describe('LockAccessory commands', () => {
  it('dispatches an unlock command and requests a quick refresh', async () => {
    const { platform, accessory } = build(device());
    const svc = accessory.getService(Service.LockMechanism)!;
    const handler = svc.getCharacteristic(Characteristic.LockTargetState).handler!;

    await handler(Characteristic.LockTargetState.UNSECURED);

    expect(platform.sendLockCommand).toHaveBeenCalledWith('SN1', 'unlock');
    expect(platform.requestQuickRefresh).toHaveBeenCalled();
  });
});

describe('LockAccessory reachability', () => {
  it('marks the lock No Response when offline', () => {
    const { lock, accessory } = build(device());
    lock.update(device({ online: false }));
    const svc = accessory.getService(Service.LockMechanism)!;
    expect(svc.valueOf(Characteristic.LockCurrentState)).toBeInstanceOf(Error);
  });

  it('recovers to a real state when the device comes back online', () => {
    const { lock, accessory } = build(device());
    lock.update(device({ online: false }));
    lock.update(device({ online: true, lockStatus: LockStatus.Unlocked }));
    const svc = accessory.getService(Service.LockMechanism)!;
    expect(svc.valueOf(Characteristic.LockCurrentState)).toBe(Characteristic.LockCurrentState.UNSECURED);
  });
});
