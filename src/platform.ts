/**
 * KwiksetPlatform — the dynamic Homebridge platform. Restores a session from
 * the stored refresh token, discovers locks, polls their state, and dispatches
 * lock/unlock commands. Surfaces a clean "needs re-auth" state instead of
 * crash-looping when the stored token is no longer valid.
 */

import { readFileSync } from 'fs';

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
import { Home, KwiksetDevice, LockAction } from './client/types';
import { LockAccessory } from './lockAccessory';

interface KwiksetConfig extends PlatformConfig {
  email?: string;
  refreshToken?: string;
  pollIntervalSeconds?: number;
  lowBatteryThreshold?: number;
}

/** The persisted credentials the platform restores a session from. */
interface PersistedSession {
  email?: string;
  refreshToken?: string;
}

/** Test seams; production uses the defaults. */
export interface PlatformDeps {
  /** Re-read the persisted session (defaults to reading config.json). */
  readPersistedSession?: () => PersistedSession | undefined;
}

const DEFAULT_POLL_SECONDS = 30;
const MIN_POLL_SECONDS = 15;
const DEFAULT_LOW_BATTERY = 20;
// Comfortably above the ~8s confirmation latency observed against real hardware.
const COMMAND_TIMEOUT_MS = 30_000;
// Quick reconciliation reads after a command, so HomeKit doesn't wait a full poll.
const QUICK_REFRESH_DELAYS_MS = [2_000, 5_000, 9_000];
// How often, while in needs-reauth, to re-read config and try to recover.
const REAUTH_RECHECK_MS = 60_000;

export class KwiksetPlatform implements DynamicPlatformPlugin {
  public readonly lowBatteryThreshold: number;
  public readonly commandTimeoutMs = COMMAND_TIMEOUT_MS;

  private readonly client: KwiksetClient;
  private readonly pollIntervalMs: number;
  private readonly accessories = new Map<string, PlatformAccessory>();
  private readonly lockAccessories = new Map<string, LockAccessory>();
  private readonly readPersistedSession: () => PersistedSession | undefined;
  private needsReauth = false;
  private pollTimer?: ReturnType<typeof setInterval>;
  private reauthRecheckTimer?: ReturnType<typeof setInterval>;
  private readonly quickRefreshTimers = new Set<ReturnType<typeof setTimeout>>();
  // Discovery serialization: at most one run at a time; bursts coalesce into one.
  private discovering = false;
  private rerunRequested = false;

  constructor(
    public readonly log: Logging,
    config: PlatformConfig,
    private readonly api: API,
    clientOverride?: KwiksetClient,
    deps: PlatformDeps = {},
  ) {
    const cfg = config as KwiksetConfig;
    this.lowBatteryThreshold = cfg.lowBatteryThreshold ?? DEFAULT_LOW_BATTERY;
    this.pollIntervalMs = Math.max(MIN_POLL_SECONDS, cfg.pollIntervalSeconds ?? DEFAULT_POLL_SECONDS) * 1000;
    this.readPersistedSession = deps.readPersistedSession ?? (() => this.readSessionFromConfig());

    this.client = clientOverride ?? new KwiksetClient({ log: (m) => this.log.debug(m) });
    if (cfg.email && cfg.refreshToken) {
      this.client.restoreSession(cfg.email, cfg.refreshToken);
    } else {
      this.needsReauth = true;
    }

    this.api.on('didFinishLaunching', () => this.start());
    this.api.on('shutdown', () => this.stopAllTimers());
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
      this.log.warn(
        'No Kwikset session found. Open the plugin settings and sign in; ' +
          'the plugin will start automatically once you do (no restart needed).',
      );
      this.startReauthRecheck();
      return;
    }
    this.startPolling();
  }

  private startPolling(): void {
    this.stopPolling(); // idempotent: never leave an orphaned interval
    void this.discoverDevices();
    this.pollTimer = setInterval(() => void this.discoverDevices(), this.pollIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  /**
   * Refresh device state. Serialized: if a run is already in flight, the request
   * is coalesced into a single follow-up run so reads are never applied out of
   * order (which could otherwise overwrite fresh state with stale).
   */
  async discoverDevices(): Promise<void> {
    if (this.needsReauth) {
      return;
    }
    if (this.discovering) {
      this.rerunRequested = true;
      return;
    }
    this.discovering = true;
    try {
      do {
        this.rerunRequested = false;
        await this.runDiscoveryOnce();
      } while (this.rerunRequested && !this.needsReauth);
    } finally {
      this.discovering = false;
    }
  }

  /** A single discovery pass, isolating per-home and per-device failures. */
  private async runDiscoveryOnce(): Promise<void> {
    let homes: Home[];
    try {
      homes = await this.client.getHomes();
    } catch (err) {
      this.handleDiscoveryError('list homes', err);
      return;
    }

    for (const home of homes) {
      if (this.needsReauth) {
        return;
      }
      let devices: KwiksetDevice[];
      try {
        devices = await this.client.getDevices(home.homeId);
      } catch (err) {
        this.handleDiscoveryError(`list devices for "${home.homeName}"`, err);
        continue;
      }
      for (const device of devices) {
        try {
          this.upsertAccessory(device);
        } catch (err) {
          this.log.warn(`Failed to update "${device.name}": ${String(err)}`);
        }
      }
    }
  }

  /** Escalate a needs-reauth error; log and continue for anything transient. */
  private handleDiscoveryError(action: string, err: unknown): void {
    if (err instanceof NeedsReauthError) {
      this.enterNeedsReauth(err);
    } else {
      this.log.warn(`Could not ${action}: ${String(err)}`);
    }
  }

  private upsertAccessory(device: KwiksetDevice): void {
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
    if (this.needsReauth) {
      return; // nothing to reconcile against while signed out
    }
    for (const delay of QUICK_REFRESH_DELAYS_MS) {
      const timer = setTimeout(() => {
        this.quickRefreshTimers.delete(timer);
        void this.discoverDevices();
      }, delay);
      this.quickRefreshTimers.add(timer);
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
    if (this.needsReauth) {
      return;
    }
    this.needsReauth = true;
    this.stopPolling();
    this.startReauthRecheck();
    this.log.error(
      `Kwikset session is no longer valid (${err.message}). Open the plugin settings and sign in again; ` +
        'the plugin will recover automatically once you do (no restart needed).',
    );
  }

  /** While in needs-reauth, periodically re-read config and try to recover. */
  private startReauthRecheck(): void {
    if (this.reauthRecheckTimer) {
      return;
    }
    this.reauthRecheckTimer = setInterval(() => this.tryRecoverSession(), REAUTH_RECHECK_MS);
  }

  private stopReauthRecheck(): void {
    if (this.reauthRecheckTimer) {
      clearInterval(this.reauthRecheckTimer);
      this.reauthRecheckTimer = undefined;
    }
  }

  /**
   * If the persisted session now holds a different refresh token (the user has
   * re-authenticated), restore it and resume polling — no Homebridge restart.
   */
  private tryRecoverSession(): void {
    const session = this.readPersistedSession();
    if (!session?.email || !session.refreshToken) {
      return;
    }
    // A re-auth always issues a new refresh token, so a changed token means the
    // user has signed in again. (Relies on the Cognito non-rotation invariant
    // documented in KwiksetClient.setTokens — see #14.)
    if (session.refreshToken === this.client.getRefreshToken()) {
      return; // unchanged — still waiting for the user to sign in
    }
    this.client.restoreSession(session.email, session.refreshToken);
    this.needsReauth = false;
    this.stopReauthRecheck();
    this.log.info('Kwikset session restored from updated configuration; resuming.');
    this.startPolling();
  }

  /**
   * Default `readPersistedSession`: read this platform's block from config.json.
   * The plugin is `singular`, so there is at most one Kwikset platform block.
   */
  private readSessionFromConfig(): PersistedSession | undefined {
    try {
      const raw = JSON.parse(readFileSync(this.api.user.configPath(), 'utf8'));
      const platforms: KwiksetConfig[] = Array.isArray(raw?.platforms) ? raw.platforms : [];
      const block = platforms.find((p) => p?.platform === PLATFORM_NAME);
      if (block?.email && block?.refreshToken) {
        return { email: block.email, refreshToken: block.refreshToken };
      }
    } catch (err) {
      this.log.debug(`Could not re-read config for session recovery: ${String(err)}`);
    }
    return undefined;
  }

  private stopAllTimers(): void {
    this.stopPolling();
    this.stopReauthRecheck();
    for (const timer of this.quickRefreshTimers) {
      clearTimeout(timer);
    }
    this.quickRefreshTimers.clear();
  }
}
