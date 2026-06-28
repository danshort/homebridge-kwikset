/**
 * KwiksetClient — the shared core used by both the config-UI auth server and
 * the Homebridge platform. Owns authentication, the token lifecycle (restore
 * from a refresh token, auto-renew before requests, surface needs-reauth), and
 * typed REST operations (discovery, lock/unlock).
 */

import {
  ACCEPT_ENCODING,
  GET_HOMES_URL,
  MAX_RETRIES,
  REST_USER_AGENT,
  RETRY_BASE_DELAY_MS,
  TOKEN_RENEW_SKEW_MS,
  getHomeDevicesUrl,
  lockCommandUrl,
} from './constants';
import { CognitoAuthenticator, CognitoSrpAuthenticator, CodeResume } from './cognitoAuth';
import { ApiError, ConnectionError, NeedsReauthError } from './errors';
import { parseDevices, parseHomes } from './parsing';
import { Home, KwiksetDevice, LoginResult, LockAction, Tokens } from './types';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface KwiksetClientOptions {
  /** Override the Cognito authenticator (tests inject a fake). */
  authenticator?: CognitoAuthenticator;
  /** Override fetch (defaults to global fetch). */
  fetchImpl?: FetchLike;
  /** Override the clock (defaults to Date.now), for token-expiry tests. */
  now?: () => number;
  /** Restore an existing session. */
  email?: string;
  refreshToken?: string;
  /** Optional debug logger. */
  log?: (msg: string) => void;
  /** Sleep function (tests inject a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Decode a JWT's `exp` (seconds) without verifying the signature. */
function decodeJwtExpMs(jwt: string): number {
  try {
    const payload = jwt.split('.')[1];
    const json = Buffer.from(payload, 'base64').toString('utf8');
    const exp = JSON.parse(json).exp;
    return typeof exp === 'number' ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

export class KwiksetClient {
  private readonly auth: CognitoAuthenticator;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (msg: string) => void;

  private email?: string;
  private idToken?: string;
  private refreshToken?: string;
  private idTokenExpMs = 0;
  private pendingResume?: CodeResume;
  private refreshing?: Promise<void>;

  constructor(opts: KwiksetClientOptions = {}) {
    this.auth = opts.authenticator ?? new CognitoSrpAuthenticator();
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.now = opts.now ?? (() => Date.now());
    this.sleep = opts.sleep ?? defaultSleep;
    this.log = opts.log ?? (() => undefined);
    this.email = opts.email;
    this.refreshToken = opts.refreshToken;
  }

  // --- Authentication ---

  /** Log in with email + password. May require a verification code. */
  async loginWithPassword(email: string, password: string): Promise<LoginResult> {
    this.email = email;
    const outcome = await this.auth.authenticate(email, password);
    if (outcome.kind === 'tokens') {
      this.setTokens(outcome.tokens);
      return { status: 'success', tokens: outcome.tokens };
    }
    this.pendingResume = outcome.resume;
    return { status: 'code_required' };
  }

  /** Submit the verification code for an in-progress challenge. */
  async submitCode(code: string): Promise<Tokens> {
    if (!this.pendingResume) {
      throw new ApiError('No verification challenge is in progress');
    }
    const tokens = await this.auth.submitCode(this.pendingResume, code);
    this.pendingResume = undefined;
    this.setTokens(tokens);
    return tokens;
  }

  /** Restore a session from a stored refresh token (and account email). */
  restoreSession(email: string, refreshToken: string): void {
    this.email = email;
    this.refreshToken = refreshToken;
    this.idToken = undefined;
    this.idTokenExpMs = 0;
  }

  getRefreshToken(): string | undefined {
    return this.refreshToken;
  }

  getEmail(): string | undefined {
    return this.email;
  }

  /** Return a valid ID token, renewing via the refresh token if needed. */
  async ensureIdToken(): Promise<string> {
    if (!this.refreshToken || !this.email) {
      throw new NeedsReauthError('No stored session; sign in via the plugin settings UI');
    }
    if (this.idToken && this.now() < this.idTokenExpMs - TOKEN_RENEW_SKEW_MS) {
      return this.idToken;
    }
    await this.renew();
    return this.idToken as string;
  }

  private async renew(): Promise<void> {
    // Collapse concurrent renewals into a single in-flight refresh.
    if (!this.refreshing) {
      this.refreshing = (async () => {
        const tokens = await this.auth.refresh(this.email as string, this.refreshToken as string);
        this.setTokens(tokens);
      })().finally(() => {
        this.refreshing = undefined;
      });
    }
    return this.refreshing;
  }

  private setTokens(tokens: Tokens): void {
    this.idToken = tokens.idToken;
    if (tokens.refreshToken) {
      this.refreshToken = tokens.refreshToken;
    }
    this.idTokenExpMs = decodeJwtExpMs(tokens.idToken);
  }

  // --- REST ---

  async getHomes(): Promise<Home[]> {
    return parseHomes(await this.request('GET', GET_HOMES_URL));
  }

  async getDevices(homeId: string): Promise<KwiksetDevice[]> {
    return parseDevices(await this.request('GET', getHomeDevicesUrl(homeId)));
  }

  /**
   * Send a lock/unlock command. Resolves when the cloud accepts it; the
   * response carries only a timestamp, not the resulting state, so callers
   * must read state separately to confirm.
   */
  async setLockState(serialNumber: string, action: LockAction, sourceName = 'HomeKit'): Promise<void> {
    const payload = {
      action,
      source: JSON.stringify({ name: sourceName.slice(0, 7), device: 'apikwik' }),
    };
    await this.request('PATCH', lockCommandUrl(serialNumber), payload);
  }

  private async request(method: string, url: string, body?: unknown, isRetryAfterReauth = false): Promise<unknown> {
    const idToken = await this.ensureIdToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${idToken}`,
      'User-Agent': REST_USER_AGENT,
      'Accept-Encoding': ACCEPT_ENCODING,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await this.fetchImpl(url, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });

        if (res.status === 401 || res.status === 403) {
          // Token was rejected. Force one renewal + retry; if it still fails,
          // the session is no longer valid.
          if (!isRetryAfterReauth) {
            this.idToken = undefined;
            this.idTokenExpMs = 0;
            await this.renew();
            return this.request(method, url, body, true);
          }
          throw new NeedsReauthError('Authentication rejected by the cloud; please sign in again');
        }

        if (!res.ok) {
          throw new ApiError(`Request to ${url} failed with HTTP ${res.status}`, res.status);
        }

        return await res.json();
      } catch (err) {
        if (err instanceof NeedsReauthError || err instanceof ApiError) {
          throw err;
        }
        // Treat anything else (timeouts, connection resets) as transient.
        lastErr = err;
        if (attempt < MAX_RETRIES) {
          this.log(`Transient error on ${url}, retry ${attempt + 1}/${MAX_RETRIES}`);
          await this.sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
          continue;
        }
      }
    }
    throw new ConnectionError(`Request to ${url} failed after ${MAX_RETRIES} retries: ${String(lastErr)}`);
  }
}
