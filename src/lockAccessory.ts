/**
 * HomeKit adapter for a single Kwikset lock. Owns the HAP services and
 * delegates lock-state decisions to a `LockController`. Battery and
 * reachability are mapped here from the polled device snapshot.
 */

import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { KwiksetPlatform } from './platform';
import { LockController } from './lockController';
import { LockCurrentState, LockTargetState, isLowBattery } from './client/stateMapping';
import { KwiksetDevice } from './client/types';

export class LockAccessory {
  private readonly lockService: Service;
  private readonly batteryService: Service;
  private readonly controller: LockController;
  private readonly C: KwiksetPlatform['hap']['Characteristic'];
  private offline = false;

  constructor(
    private readonly platform: KwiksetPlatform,
    private readonly accessory: PlatformAccessory,
    private device: KwiksetDevice,
  ) {
    const { Service, Characteristic } = this.platform.hap;
    this.C = Characteristic;

    this.accessory.getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'Kwikset')
      .setCharacteristic(Characteristic.Model, device.modelNumber ?? 'Halo')
      .setCharacteristic(Characteristic.SerialNumber, device.deviceId)
      .setCharacteristic(Characteristic.FirmwareRevision, device.firmwareVersion ?? '0.0.0');

    this.lockService =
      this.accessory.getService(Service.LockMechanism) ??
      this.accessory.addService(Service.LockMechanism, device.name);
    this.lockService.setCharacteristic(Characteristic.Name, device.name);

    this.batteryService =
      this.accessory.getService(Service.Battery) ??
      this.accessory.addService(Service.Battery, `${device.name} Battery`);

    this.controller = new LockController({
      timeoutMs: this.platform.commandTimeoutMs,
      sendCommand: (action) => this.platform.sendLockCommand(this.device.deviceId, action),
      onChange: (snap) => this.pushLockState(snap.current, snap.target),
      log: (msg) => this.platform.log.debug(`[${this.device.name}] ${msg}`),
    });

    // The user changing the lock from HomeKit.
    this.lockService.getCharacteristic(Characteristic.LockTargetState).onSet(async (value) => {
      try {
        await this.controller.requestTarget(value as LockTargetState);
        this.platform.requestQuickRefresh();
      } catch (err) {
        this.platform.log.error(`Failed to ${value === LockTargetState.SECURED ? 'lock' : 'unlock'} ${this.device.name}: ${String(err)}`);
        throw err; // surfaces as an error in the Home app
      }
    });

    // Seed initial state.
    this.update(device);
  }

  get uuid(): string {
    return this.accessory.UUID;
  }

  /** Apply a fresh device snapshot from a poll. */
  update(device: KwiksetDevice): void {
    this.device = device;

    if (!device.online) {
      this.markOffline();
      return;
    }
    this.offline = false;

    this.controller.setFromPoll(device.lockStatus);

    if (device.batteryPercentage !== undefined) {
      this.batteryService.updateCharacteristic(this.C.BatteryLevel, device.batteryPercentage);
      this.batteryService.updateCharacteristic(
        this.C.StatusLowBattery,
        isLowBattery(device.batteryPercentage, this.platform.lowBatteryThreshold)
          ? this.C.StatusLowBattery.BATTERY_LEVEL_LOW
          : this.C.StatusLowBattery.BATTERY_LEVEL_NORMAL,
      );
    }
  }

  private pushLockState(current: LockCurrentState, target: LockTargetState): void {
    if (this.offline) {
      return;
    }
    this.lockService.updateCharacteristic(this.C.LockCurrentState, current);
    this.lockService.updateCharacteristic(this.C.LockTargetState, target);
  }

  private markOffline(): void {
    if (this.offline) {
      return;
    }
    this.offline = true;
    // Pushing an Error makes the accessory show "No Response" in the Home app.
    // The double cast is the documented HAP idiom and lives only here.
    const noResponse = new Error('Lock offline') as unknown as CharacteristicValue;
    this.lockService.updateCharacteristic(this.C.LockCurrentState, noResponse);
  }
}
