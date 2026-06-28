/**
 * Minimal HAP/Homebridge fakes — just enough surface for the accessory and
 * platform to run under vitest without hap-nodejs or a real Homebridge.
 */
import { vi } from 'vitest';

// Characteristic identities double as map keys and carry their enum constants.
export const Characteristic = {
  Manufacturer: { id: 'Manufacturer' },
  Model: { id: 'Model' },
  SerialNumber: { id: 'SerialNumber' },
  FirmwareRevision: { id: 'FirmwareRevision' },
  Name: { id: 'Name' },
  BatteryLevel: { id: 'BatteryLevel' },
  StatusLowBattery: { id: 'StatusLowBattery', BATTERY_LEVEL_NORMAL: 0, BATTERY_LEVEL_LOW: 1 },
  LockCurrentState: { id: 'LockCurrentState', UNSECURED: 0, SECURED: 1, JAMMED: 2, UNKNOWN: 3 },
  LockTargetState: { id: 'LockTargetState', UNSECURED: 0, SECURED: 1 },
};

export const Service = {
  AccessoryInformation: { id: 'AccessoryInformation' },
  LockMechanism: { id: 'LockMechanism' },
  Battery: { id: 'Battery' },
};

class FakeCharacteristic {
  handler?: (v: unknown) => unknown;
  constructor(public value: unknown = undefined) {}
  onSet(fn: (v: unknown) => unknown) {
    this.handler = fn;
    return this;
  }
}

export class FakeService {
  readonly chars = new Map<object, FakeCharacteristic>();
  constructor(public type: object, public name?: string) {}
  private ch(c: object): FakeCharacteristic {
    let existing = this.chars.get(c);
    if (!existing) {
      existing = new FakeCharacteristic();
      this.chars.set(c, existing);
    }
    return existing;
  }
  setCharacteristic(c: object, v: unknown) {
    this.ch(c).value = v;
    return this;
  }
  updateCharacteristic(c: object, v: unknown) {
    this.ch(c).value = v;
    return this;
  }
  getCharacteristic(c: object) {
    return this.ch(c);
  }
  valueOf(c: object): unknown {
    return this.chars.get(c)?.value;
  }
}

export class FakeAccessory {
  readonly services = new Map<object, FakeService>();
  constructor(public displayName: string, public UUID: string) {
    this.addService(Service.AccessoryInformation);
  }
  getService(type: object): FakeService | undefined {
    return this.services.get(type);
  }
  addService(type: object, name?: string): FakeService {
    const s = new FakeService(type, name);
    this.services.set(type, s);
    return s;
  }
}

export function fakeLog() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
    success: vi.fn(),
  };
}

/** A fake Homebridge `API` sufficient for KwiksetPlatform construction. */
export function fakeApi() {
  const handlers: Record<string, () => void> = {};
  return {
    hap: {
      Service,
      Characteristic,
      uuid: { generate: (s: string) => `uuid-${s}` },
    },
    platformAccessory: FakeAccessory,
    on: (event: string, cb: () => void) => {
      handlers[event] = cb;
    },
    registerPlatformAccessories: vi.fn(),
    unregisterPlatformAccessories: vi.fn(),
    _handlers: handlers,
  };
}
