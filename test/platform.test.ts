import { describe, expect, it } from 'vitest';
import { KwiksetPlatform } from '../src/platform';
import { KwiksetClient } from '../src/client/kwiksetClient';
import { NeedsReauthError } from '../src/client/errors';
import { fakeApi, fakeLog } from './hapStub';

function platformWithClient(client: Partial<KwiksetClient>) {
  const log = fakeLog();
  const api = fakeApi();
  const config = { platform: 'Kwikset', email: 'user@example.com', refreshToken: 'r' };
  const fullClient: Partial<KwiksetClient> = { restoreSession: () => undefined, ...client };
  const platform = new KwiksetPlatform(
    log as never,
    config as never,
    api as never,
    fullClient as KwiksetClient,
  );
  return { platform, log, api };
}

describe('KwiksetPlatform needs-reauth handling', () => {
  it('logs re-auth guidance once across repeated failures (no spam, no crash)', async () => {
    const client: Partial<KwiksetClient> = {
      getHomes: async () => {
        throw new NeedsReauthError('expired');
      },
      getDevices: async () => [],
    };
    const { platform, log } = platformWithClient(client);

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
      getDevices: async () => [],
    };
    const { platform, log } = platformWithClient(client);

    await platform.discoverDevices();
    await platform.discoverDevices();

    expect(log.error).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalled();
    expect(calls).toBe(2); // not latched off — still retrying
  });

  it('does not start polling when no session is configured', () => {
    const log = fakeLog();
    const api = fakeApi();
    const platform = new KwiksetPlatform(log as never, { platform: 'Kwikset' } as never, api as never);
    api._handlers['didFinishLaunching']?.();
    expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/sign in/i));
  });
});
