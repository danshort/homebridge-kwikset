import { describe, expect, it } from 'vitest';
import devicesFixture from './fixtures/devices.json';
import { KwiksetClient } from '../src/client/kwiksetClient';
import { ConnectionError, NeedsReauthError } from '../src/client/errors';
import { LockStatus } from '../src/client/types';
import { FakeAuthenticator, fakeTokens, makeFakeFetch } from './helpers';

const noSleep = async () => undefined;

function client(auth: FakeAuthenticator, fetchImpl: ReturnType<typeof makeFakeFetch>['fetchImpl']) {
  return new KwiksetClient({ authenticator: auth, fetchImpl, sleep: noSleep });
}

describe('login', () => {
  it('returns success and stores the refresh token on the direct path', async () => {
    const auth = new FakeAuthenticator();
    auth.authenticateImpl = async () => ({ kind: 'tokens', tokens: fakeTokens() });
    const c = new KwiksetClient({ authenticator: auth, sleep: noSleep });

    const result = await c.loginWithPassword('user@example.com', 'pw');

    expect(result.status).toBe('success');
    expect(c.getRefreshToken()).toBe('refresh-token-abc');
  });

  it('signals code_required and completes via submitCode (challenge branch)', async () => {
    const auth = new FakeAuthenticator();
    auth.authenticateImpl = async () => ({ kind: 'code_required', resume: { user: {} as never } });
    auth.submitCodeImpl = async () => fakeTokens();
    const c = new KwiksetClient({ authenticator: auth, sleep: noSleep });

    const login = await c.loginWithPassword('user@example.com', 'pw');
    expect(login.status).toBe('code_required');

    const tokens = await c.submitCode('123456');
    expect(tokens.refreshToken).toBe('refresh-token-abc');
    expect(c.getRefreshToken()).toBe('refresh-token-abc');
  });
});

describe('token lifecycle', () => {
  it('renews the id token from a restored refresh token before a request', async () => {
    const auth = new FakeAuthenticator();
    const { fetchImpl, calls } = makeFakeFetch([{ status: 200, body: devicesFixture }]);
    const c = new KwiksetClient({ authenticator: auth, fetchImpl, sleep: noSleep });
    c.restoreSession('user@example.com', 'stored-refresh');

    const devices = await c.getDevices('home-1');

    expect(auth.refreshCalls).toBe(1);
    expect(calls[0].headers.Authorization).toMatch(/^Bearer /);
    expect(devices[0].lockStatus).toBe(LockStatus.Locked);
  });

  it('does not renew again while the id token is still fresh', async () => {
    const auth = new FakeAuthenticator();
    const { fetchImpl } = makeFakeFetch([{ status: 200, body: devicesFixture }, { status: 200, body: devicesFixture }]);
    const c = new KwiksetClient({ authenticator: auth, fetchImpl, sleep: noSleep });
    c.restoreSession('user@example.com', 'stored-refresh');

    await c.getDevices('home-1');
    await c.getDevices('home-1');

    expect(auth.refreshCalls).toBe(1);
  });

  it('throws NeedsReauthError when there is no stored session', async () => {
    const c = new KwiksetClient({ authenticator: new FakeAuthenticator(), sleep: noSleep });
    await expect(c.getHomes()).rejects.toBeInstanceOf(NeedsReauthError);
  });

  it('surfaces NeedsReauthError when the refresh is rejected', async () => {
    const auth = new FakeAuthenticator();
    auth.refreshImpl = async () => {
      throw new NeedsReauthError('expired');
    };
    const c = new KwiksetClient({ authenticator: auth, sleep: noSleep });
    c.restoreSession('user@example.com', 'bad-refresh');

    await expect(c.getHomes()).rejects.toBeInstanceOf(NeedsReauthError);
  });
});

describe('REST operations', () => {
  it('sends a lock command with action + source payload and resolves on ack', async () => {
    const auth = new FakeAuthenticator();
    const { fetchImpl, calls } = makeFakeFetch([{ status: 200, body: { data: [{ lastupdatestatus: 1 }], total: 1 } }]);
    const c = client(auth, fetchImpl);
    c.restoreSession('user@example.com', 'r');

    await c.setLockState('SN123', 'unlock', 'HomeKit');

    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].url).toContain('/devices/SN123/status');
    expect(calls[0].body).toEqual({ action: 'unlock', source: JSON.stringify({ name: 'HomeKit', device: 'apikwik' }) });
  });

  it('renews once and retries on a 401, then succeeds', async () => {
    const auth = new FakeAuthenticator();
    const { fetchImpl } = makeFakeFetch([
      { status: 401 },
      { status: 200, body: devicesFixture },
    ]);
    const c = client(auth, fetchImpl);
    c.restoreSession('user@example.com', 'r');

    const devices = await c.getDevices('home-1');
    expect(devices).toHaveLength(1);
    // one renew for the initial ensureIdToken + one forced renew after the 401
    expect(auth.refreshCalls).toBe(2);
  });

  it('throws NeedsReauthError when a 401 persists after renewal', async () => {
    const auth = new FakeAuthenticator();
    const { fetchImpl } = makeFakeFetch([{ status: 401 }, { status: 401 }]);
    const c = client(auth, fetchImpl);
    c.restoreSession('user@example.com', 'r');

    await expect(c.getHomes()).rejects.toBeInstanceOf(NeedsReauthError);
  });

  it('retries transient failures and then gives up with ConnectionError', async () => {
    const auth = new FakeAuthenticator();
    const { fetchImpl } = makeFakeFetch([
      () => {
        throw new Error('ECONNRESET');
      },
    ]);
    const c = client(auth, fetchImpl);
    c.restoreSession('user@example.com', 'r');

    await expect(c.getHomes()).rejects.toBeInstanceOf(ConnectionError);
  });
});
