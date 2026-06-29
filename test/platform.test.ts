import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KwiksetPlatform } from '../src/platform';
import { KwiksetClient } from '../src/client/kwiksetClient';
import { NeedsReauthError } from '../src/client/errors';
import { KwiksetDevice, LockStatus } from '../src/client/types';
import { readSessionStatus } from '../src/sessionStatus';
import { fakeApi, fakeLog } from './hapStub';

// Fake timers keep the platform's setInterval/setTimeout under control and avoid
// leaking real intervals (the reauth re-check) across tests.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Flush several microtask ticks (for async chains that don't involve timers). */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    await Promise.resolve();
  }
}

function device(over: Partial<KwiksetDevice> = {}): KwiksetDevice {
  return { deviceId: 'SN1', name: 'Front Door', lockStatus: LockStatus.Locked, batteryPercentage: 100, online: true, ...over };
}

function makePlatform(
  client: Partial<KwiksetClient>,
  opts: {
    config?: Record<string, unknown>;
    readPersistedSession?: () => { email?: string; refreshToken?: string } | undefined;
    configPath?: string;
  } = {},
) {
  const log = fakeLog();
  const api = fakeApi(opts.configPath);
  const config = { platform: 'Kwikset', ...(opts.config ?? { email: 'u@e', refreshToken: 'r' }) };
  const full: Partial<KwiksetClient> = { restoreSession: () => undefined, getRefreshToken: () => 'r', ...client };
  // Inject a fake reader by default; with `configPath` set, exercise the real
  // config.json reader instead.
  const deps: { readPersistedSession?: () => { email?: string; refreshToken?: string } | undefined } = {};
  if (opts.readPersistedSession) {
    deps.readPersistedSession = opts.readPersistedSession;
  } else if (!opts.configPath) {
    deps.readPersistedSession = () => undefined;
  }
  const platform = new KwiksetPlatform(log as never, config as never, api as never, full as KwiksetClient, deps);
  return { platform, log, api };
}

describe('needs-reauth handling', () => {
  it('logs guidance once across repeated failures and stops polling (no spam/crash)', async () => {
    const client: Partial<KwiksetClient> = {
      getHomes: async () => {
        throw new NeedsReauthError('expired');
      },
    };
    const { platform, log } = makePlatform(client);

    await platform.discoverDevices();
    await platform.discoverDevices();
    await platform.discoverDevices();

    expect(log.error).toHaveBeenCalledTimes(1);
    expect(String(log.error.mock.calls[0][0])).toMatch(/sign in/i);
  });

  it('warns (not errors) on a transient failure and keeps trying', async () => {
    let calls = 0;
    const client: Partial<KwiksetClient> = {
      getHomes: async () => {
        calls += 1;
        throw new Error('ECONNRESET');
      },
    };
    const { platform, log } = makePlatform(client);

    await platform.discoverDevices();
    await platform.discoverDevices();

    expect(log.error).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalled();
    expect(calls).toBe(2);
  });

  it('clears the poll timer when it enters needs-reauth (#9)', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const getHomes = vi.fn(async () => {
      throw new NeedsReauthError('expired');
    });
    const { api } = makePlatform({ getHomes });

    api._handlers['didFinishLaunching']?.(); // start → startPolling (poll interval created) → reauth
    await vi.advanceTimersByTimeAsync(0);

    // The poll interval (the first setInterval) must have been cleared.
    const pollTimerHandle = setIntervalSpy.mock.results[0].value;
    expect(clearIntervalSpy).toHaveBeenCalledWith(pollTimerHandle);
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it('does not start polling when no session is configured, but warns', () => {
    const { log, api } = makePlatform({}, { config: { platform: 'Kwikset' } });
    api._handlers['didFinishLaunching']?.();
    expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/sign in/i));
  });
});

describe('session-status file for the UI (#14)', () => {
  it('publishes healthy on a normal start and flips to needs-reauth on rejection', async () => {
    const getHomes = vi.fn(async () => {
      throw new NeedsReauthError('expired');
    });
    const { api } = makePlatform({ getHomes });

    api._handlers['didFinishLaunching']?.(); // start() writes healthy, then polls
    expect(readSessionStatus(api._storagePath)).toMatchObject({ needsReauth: false });

    await vi.advanceTimersByTimeAsync(0); // discovery rejects → enterNeedsReauth writes true
    expect(readSessionStatus(api._storagePath)).toMatchObject({ needsReauth: true });
  });

  it('writes needs-reauth at start when no session is configured', () => {
    const { api } = makePlatform({}, { config: { platform: 'Kwikset' } });
    api._handlers['didFinishLaunching']?.();
    expect(readSessionStatus(api._storagePath)).toMatchObject({ needsReauth: true });
  });

  it('flips back to healthy when the session recovers', async () => {
    const session: { current: { email?: string; refreshToken?: string } | undefined } = { current: undefined };
    const { api } = makePlatform(
      { restoreSession: vi.fn(), getHomes: vi.fn(async () => []), getRefreshToken: () => undefined },
      { config: { platform: 'Kwikset' }, readPersistedSession: () => session.current },
    );

    api._handlers['didFinishLaunching']?.();
    expect(readSessionStatus(api._storagePath)).toMatchObject({ needsReauth: true });

    session.current = { email: 'u@e', refreshToken: 'fresh-token' };
    await vi.advanceTimersByTimeAsync(60_000); // recheck recovers → writes healthy
    expect(readSessionStatus(api._storagePath)).toMatchObject({ needsReauth: false });
  });
});

describe('serialized discovery (#3)', () => {
  it('does not run discovery concurrently and coalesces a burst into one follow-up', async () => {
    const deferreds: Array<(v: unknown) => void> = [];
    const getHomes = vi.fn(
      () =>
        new Promise((resolve) => {
          deferreds.push(resolve);
        }),
    );
    const { platform } = makePlatform({ getHomes: getHomes as never, getDevices: async () => [] });

    const run1 = platform.discoverDevices(); // starts run, awaits getHomes #1
    const burst2 = platform.discoverDevices(); // in-flight → coalesced
    const burst3 = platform.discoverDevices(); // in-flight → coalesced
    await burst2;
    await burst3;
    expect(getHomes).toHaveBeenCalledTimes(1); // only the first run is executing

    deferreds[0]([]); // run #1 completes → one coalesced follow-up run begins
    await flushMicrotasks();
    expect(getHomes).toHaveBeenCalledTimes(2); // exactly one follow-up, not three

    deferreds[1]([]); // follow-up completes
    await run1;
    expect(getHomes).toHaveBeenCalledTimes(2);
  });
});

describe('per-home failure isolation (#6)', () => {
  it('refreshes other homes when one home fails to list devices', async () => {
    const client: Partial<KwiksetClient> = {
      getHomes: async () => [
        { homeId: 'A', homeName: 'Home A' },
        { homeId: 'B', homeName: 'Home B' },
      ],
      getDevices: async (homeId: string) => {
        if (homeId === 'A') {
          throw new Error('flaky home');
        }
        return [device({ deviceId: 'B1', name: 'Back Door' })];
      },
    };
    const { platform, log, api } = makePlatform(client);

    await platform.discoverDevices();

    expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/Home A/));
    // Home B's device was still registered despite Home A failing.
    expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(1);
  });
});

describe('shutdown timer cleanup (#7)', () => {
  it('clears pending quick-refresh timers so they do not fire after shutdown', async () => {
    const getHomes = vi.fn(async () => []);
    const { platform, api } = makePlatform({ getHomes, getDevices: async () => [] });

    platform.requestQuickRefresh(); // schedules timeouts at 2/5/9s
    api._handlers['shutdown']?.();
    getHomes.mockClear();

    await vi.advanceTimersByTimeAsync(20_000);
    expect(getHomes).not.toHaveBeenCalled();
  });
});

describe('automatic recovery without restart (#9)', () => {
  it('recovers and resumes polling when the persisted session changes', async () => {
    const restoreSession = vi.fn();
    const getHomes = vi.fn(async () => []);
    const session: { current: { email?: string; refreshToken?: string } | undefined } = { current: undefined };
    const { api } = makePlatform(
      { restoreSession, getHomes, getRefreshToken: () => undefined },
      { config: { platform: 'Kwikset' }, readPersistedSession: () => session.current },
    );

    api._handlers['didFinishLaunching']?.(); // no session → warn + start reauth re-check
    await vi.advanceTimersByTimeAsync(60_000);
    expect(restoreSession).not.toHaveBeenCalled(); // nothing persisted yet

    session.current = { email: 'u@e', refreshToken: 'fresh-token' }; // user signs in via UI
    await vi.advanceTimersByTimeAsync(60_000);

    expect(restoreSession).toHaveBeenCalledWith('u@e', 'fresh-token');
    expect(getHomes).toHaveBeenCalled(); // polling resumed, no restart
  });

  it('recovers using the real config.json reader (default readPersistedSession)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kwikset-test-'));
    const configPath = join(dir, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({ platforms: [{ platform: 'Kwikset', email: 'u@e', refreshToken: 'fresh' }] }),
    );
    const restoreSession = vi.fn();
    const getHomes = vi.fn(async () => []);
    const { api } = makePlatform(
      { restoreSession, getHomes, getRefreshToken: () => undefined },
      { config: { platform: 'Kwikset' }, configPath }, // no injected reader → real readSessionFromConfig
    );

    api._handlers['didFinishLaunching']?.();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(restoreSession).toHaveBeenCalledWith('u@e', 'fresh');
    expect(getHomes).toHaveBeenCalled();
  });

  it('ignores a malformed config.json without throwing (default reader)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kwikset-test-'));
    const configPath = join(dir, 'config.json');
    writeFileSync(configPath, '{ not valid json');
    const restoreSession = vi.fn();
    const { api } = makePlatform(
      { restoreSession, getHomes: async () => [], getRefreshToken: () => undefined },
      { config: { platform: 'Kwikset' }, configPath },
    );

    api._handlers['didFinishLaunching']?.();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(restoreSession).not.toHaveBeenCalled();
  });
});
