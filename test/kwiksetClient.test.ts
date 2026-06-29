import { describe, expect, it } from 'vitest';
import devicesFixture from './fixtures/devices.json';
import { KwiksetClient } from '../src/client/kwiksetClient';
import { ApiError, ConnectionError, NeedsReauthError } from '../src/client/errors';
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

describe('hardened error handling (#2 403, #5 fresh token, #13 retryable)', () => {
  it('surfaces 403 as a non-fatal ApiError, does NOT renew, and does NOT latch needs-reauth', async () => {
    const auth = new FakeAuthenticator();
    // First request 403s; a later request to the same client still succeeds.
    const { fetchImpl } = makeFakeFetch([
      { status: 403 },
      { status: 200, body: { data: [], total: 0 } },
    ]);
    const c = client(auth, fetchImpl);
    c.restoreSession('user@example.com', 'r');

    await expect(c.getHomes()).rejects.toBeInstanceOf(ApiError);
    // 403 must not have triggered a token renewal...
    expect(auth.refreshCalls).toBe(1); // only the initial ensureIdToken renew
    // ...and the plugin is not bricked: the next request succeeds.
    await expect(c.getHomes()).resolves.toEqual([]);
  });

  it('on a 401, renews and retries with the FRESH token (not the rejected one)', async () => {
    const auth = new FakeAuthenticator();
    let nonce = 0;
    let lastRenewedIdToken = '';
    auth.refreshImpl = async () => {
      const t = fakeTokens(3600, Date.now(), (nonce += 1)); // distinct token each renew
      lastRenewedIdToken = t.idToken;
      return t;
    };
    const { fetchImpl, calls } = makeFakeFetch([
      { status: 401 },
      { status: 200, body: devicesFixture },
    ]);
    const c = client(auth, fetchImpl);
    c.restoreSession('user@example.com', 'r');

    const devices = await c.getDevices('home-1');

    expect(devices).toHaveLength(1);
    expect(auth.refreshCalls).toBe(2); // initial + one forced renewal after the 401
    // The retry must carry the freshly renewed token, not the rejected one.
    expect(calls[0].headers.Authorization).not.toBe(calls[1].headers.Authorization);
    expect(calls[1].headers.Authorization).toBe(`Bearer ${lastRenewedIdToken}`);
  });

  it('tolerates an empty acknowledgement body (e.g. the lock command)', async () => {
    const auth = new FakeAuthenticator();
    const { fetchImpl } = makeFakeFetch([{ status: 200 }]); // empty body
    const c = client(auth, fetchImpl);
    c.restoreSession('user@example.com', 'r');

    await expect(c.setLockState('SN1', 'unlock')).resolves.toBeUndefined();
  });

  it('surfaces a malformed JSON body as ApiError (not a raw SyntaxError)', async () => {
    const auth = new FakeAuthenticator();
    const { fetchImpl } = makeFakeFetch([{ status: 200, rawBody: '{ not valid json' }]);
    const c = client(auth, fetchImpl);
    c.restoreSession('user@example.com', 'r');

    await expect(c.getHomes()).rejects.toBeInstanceOf(ApiError);
  });

  it('retries a 503 then succeeds', async () => {
    const auth = new FakeAuthenticator();
    const { fetchImpl } = makeFakeFetch([
      { status: 503 },
      { status: 200, body: devicesFixture },
    ]);
    const c = client(auth, fetchImpl);
    c.restoreSession('user@example.com', 'r');

    await expect(c.getDevices('home-1')).resolves.toHaveLength(1);
    expect(auth.refreshCalls).toBe(1); // a 5xx must not trigger a token renewal
  });

  it('gives up with ApiError when a retryable status persists', async () => {
    const auth = new FakeAuthenticator();
    const { fetchImpl } = makeFakeFetch([{ status: 503 }]); // repeats
    const c = client(auth, fetchImpl);
    c.restoreSession('user@example.com', 'r');

    await expect(c.getHomes()).rejects.toBeInstanceOf(ApiError);
  });

  it('honors Retry-After on a 429', async () => {
    const auth = new FakeAuthenticator();
    const sleeps: number[] = [];
    const { fetchImpl } = makeFakeFetch([
      { status: 429, headers: { 'retry-after': '2' } },
      { status: 200, body: devicesFixture },
    ]);
    const c = new KwiksetClient({
      authenticator: auth,
      fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    c.restoreSession('user@example.com', 'r');

    await expect(c.getDevices('home-1')).resolves.toHaveLength(1);
    expect(sleeps).toContain(2000); // waited the Retry-After interval, not the default backoff
  });
});

describe('token lifecycle edge cases (#17)', () => {
  it('rejects submitCode when no verification challenge is in progress', async () => {
    const c = new KwiksetClient({ authenticator: new FakeAuthenticator(), sleep: noSleep });
    await expect(c.submitCode('123456')).rejects.toBeInstanceOf(ApiError);
  });

  it('renews the token once it is within the expiry skew window', async () => {
    const auth = new FakeAuthenticator();
    let t = 0;
    auth.refreshImpl = async () => fakeTokens(3600, t); // exp ≈ t + 3600s
    const { fetchImpl } = makeFakeFetch([{ status: 200, body: { data: [] } }]);
    const c = new KwiksetClient({ authenticator: auth, fetchImpl, now: () => t, sleep: noSleep });
    c.restoreSession('user@example.com', 'r');

    await c.getHomes();
    expect(auth.refreshCalls).toBe(1); // initial renewal
    await c.getHomes();
    expect(auth.refreshCalls).toBe(1); // still fresh — no renewal

    t = 3_300_001; // within the 5-minute skew of the ~3600s expiry
    await c.getHomes();
    expect(auth.refreshCalls).toBe(2); // renewed proactively
  });

  it('treats a token with an undecodable exp as expired (renews each request)', async () => {
    const auth = new FakeAuthenticator();
    auth.refreshImpl = async () => ({ idToken: 'not-a-jwt', accessToken: 'x', refreshToken: 'r' });
    const { fetchImpl } = makeFakeFetch([{ status: 200, body: { data: [] } }]);
    const c = new KwiksetClient({ authenticator: auth, fetchImpl, now: () => 1000, sleep: noSleep });
    c.restoreSession('user@example.com', 'r');

    await c.getHomes();
    await c.getHomes();
    expect(auth.refreshCalls).toBe(2); // exp decodes to 0 → always "expired"
  });
});
