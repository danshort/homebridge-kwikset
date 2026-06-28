/**
 * KwiksetPlatform — the dynamic Homebridge platform. Restores a session from
 * the stored refresh token, discovers locks, polls their state, and dispatches
 * lock/unlock commands. Surfaces a clean "needs re-auth" state instead of
 * crash-looping when the stored token is no longer valid.
 */

import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { KwiksetClient } from './client/kwiksetClient';
import { NeedsReauthError } from './client/errors';
import { Home, LockAction } from './client/types';
import { LockAccessory } from './lockAccessory';

interface KwiksetConfig extends PlatformConfig {
  email?: string;
  refreshToken?: string;
  pollIntervalSeconds?: number;
  lowBatteryThreshold?: number;
}

const DEFAULT_POLL_SECONDS = 30;
const MIN_POLL_SECONDS = 15;
const DEFAULT_LOW_BATTERY = 20;
// Comfortably above the ~8s confirmation latency observed against real hardware.
const COMMAND_TIMEOUT_MS = 30_000;
// Quick reconciliation reads after a command, so HomeKit doesn't wait a full poll.
const QUICK_REFRESH_DELAYS_MS = [2_000, 5_000, 9_000];

export class KwiksetPlatform implements DynamicPlatformPlugin {
  public readonly lowBatteryThreshold: number;
  public readonly commandTimeoutMs = COMMAND_TIMEOUT_MS;

  private readonly client: KwiksetClient;
  private readonly pollIntervalMs: number;
  private readonly accessories = new Map<string, PlatformAccessory>();
  private readonly lockAccessories = new Map<string, LockAccessory>();
  private homes: Home[] = [];
  private needsReauth = false;
  private pollTimer?: ReturnType<typeof setInterval>;

  constructor(
    public readonly log: Logging,
    config: PlatformConfig,
    private readonly api: API,
    clientOverride?: KwiksetClient,
  ) {
    const cfg = config as KwiksetConfig;
    this.lowBatteryThreshold = cfg.lowBatteryThreshold ?? DEFAULT_LOW_BATTERY;
    this.pollIntervalMs = Math.max(MIN_POLL_SECONDS, cfg.pollIntervalSeconds ?? DEFAULT_POLL_SECONDS) * 1000;

    this.client = clientOverride ?? new KwiksetClient({ log: (m) => this.log.debug(m) });
    if (cfg.email && cfg.refreshToken) {
      this.client.restoreSession(cfg.email, cfg.refreshToken);
    } else {
      this.needsReauth = true;
    }

    this.api.on('didFinishLaunching', () => this.start());
    this.api.on('shutdown', () => {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
      }
    });
  }

  /** HAP namespace (Service + Characteristic), used by accessories. */
  get hap(): { Service: typeof Service; Characteristic: typeof Characteristic } {
    return this.api.hap;
  }

  /** Restore cached accessories across restarts (called by Homebridge). */
  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.set(accessory.UUID, accessory);
  }

  private start(): void {
    if (this.needsReauth) {
      this.log.warn('No Kwikset session found. Open the plugin settings and sign in to your Kwikset account.');
      return;
    }
    void this.discoverDevices();
    this.pollTimer = setInterval(() => void this.discoverDevices(), this.pollIntervalMs);
  }

  /** Idempotent discovery + state refresh: registers new locks, updates known ones. */
  async discoverDevices(): Promise<void> {
    if (this.needsReauth) {
      return; // Stay quiet until the user re-auths (which requires a restart).
    }
    try {
      this.homes = await this.client.getHomes();
      for (const home of this.homes) {
        const devices = await this.client.getDevices(home.homeId);
        for (const device of devices) {
          this.upsertAccessory(device);
        }
      }
    } catch (err) {
      if (err instanceof NeedsReauthError) {
        this.enterNeedsReauth(err);
      } else {
        this.log.warn(`Could not refresh Kwikset state: ${String(err)}`);
      }
    }
  }

  private upsertAccessory(device: import('./client/types').KwiksetDevice): void {
    const uuid = this.api.hap.uuid.generate(device.deviceId);
    let accessory = this.accessories.get(uuid);

    if (!accessory) {
      accessory = new this.api.platformAccessory(device.name, uuid);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.set(uuid, accessory);
      this.log.info(`Added Kwikset lock: ${device.name}`);
    }

    const existing = this.lockAccessories.get(uuid);
    if (existing) {
      existing.update(device);
    } else {
      this.lockAccessories.set(uuid, new LockAccessory(this, accessory, device));
    }
  }

  /** Called by an accessory after sending a command, to reconcile quickly. */
  requestQuickRefresh(): void {
    for (const delay of QUICK_REFRESH_DELAYS_MS) {
      setTimeout(() => void this.discoverDevices(), delay);
    }
  }

  /** Send a lock/unlock command, mapping a rejected session to needs-reauth. */
  async sendLockCommand(deviceId: string, action: LockAction): Promise<void> {
    try {
      await this.client.setLockState(deviceId, action);
    } catch (err) {
      if (err instanceof NeedsReauthError) {
        this.enterNeedsReauth(err);
      }
      throw err;
    }
  }

  private enterNeedsReauth(err: NeedsReauthError): void {
    if (!this.needsReauth) {
      this.needsReauth = true;
      this.log.error(
        `Kwikset session is no longer valid (${err.message}). Open the plugin settings, sign in again, and restart Homebridge.`,
      );
    }
  }
}
