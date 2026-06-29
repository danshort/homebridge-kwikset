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
  MAX_RETRY_AFTER_MS,
  REST_USER_AGENT,
  RETRYABLE_HTTP_STATUSES,
  RETRY_BASE_DELAY_MS,
  SOURCE_DEVICE,
  SOURCE_NAME_MAX_LEN,
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
    // JWT segments are base64url-encoded.
    const json = Buffer.from(payload, 'base64url').toString('utf8');
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
    this.invalidateIdToken();
  }

  /** Drop the cached ID token so the next request forces a renewal. */
  private invalidateIdToken(): void {
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
    // Invariant (#14): Cognito refresh tokens are non-rotating by default, so
    // this in-memory update is sufficient and the platform need not persist the
    // refresh token on every renewal. `refreshToken` is only present here on the
    // initial login/challenge; a renewal returns the same one. If Kwikset ever
    // enables refresh-token rotation, the platform would need a write-back path.
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
      source: JSON.stringify({ name: sourceName.slice(0, SOURCE_NAME_MAX_LEN), device: SOURCE_DEVICE }),
    };
    await this.request('PATCH', lockCommandUrl(serialNumber), payload);
  }

  private async request(method: string, url: string, body?: unknown): Promise<unknown> {
    const serializedBody = body !== undefined ? JSON.stringify(body) : undefined;
    // The single auth renewal (on a 401) is tracked separately from the transient
    // retry budget, so a 401 never steals a transient slot and a renewed token is
    // always given its retry. `renewedForAuth` makes a persistent 401 terminal.
    let transientAttempts = 0;
    let renewedForAuth = false;
    let lastErr: unknown;

    for (;;) {
      // Recompute the token + header every attempt, so a token renewed mid-loop
      // (after a 401) is never sent stale.
      const idToken = await this.ensureIdToken();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${idToken}`,
        'User-Agent': REST_USER_AGENT,
        'Accept-Encoding': ACCEPT_ENCODING,
      };
      if (serializedBody !== undefined) {
        headers['Content-Type'] = 'application/json';
      }

      let res: Response;
      try {
        res = await this.fetchImpl(url, { method, headers, body: serializedBody });
      } catch (err) {
        // Transport-level failure (timeout, DNS, connection reset): transient.
        lastErr = err;
        if (transientAttempts < MAX_RETRIES) {
          transientAttempts += 1;
          this.log(`Transient error on ${url}, retry ${transientAttempts}/${MAX_RETRIES}`);
          await this.sleep(this.retryDelayMs(transientAttempts));
          continue;
        }
        throw new ConnectionError(`Request to ${url} failed after ${MAX_RETRIES} retries: ${String(lastErr)}`);
      }

      // Only 401 means the token was rejected. Renew once, then retry with the
      // fresh token; a second 401 means the session is genuinely invalid.
      if (res.status === 401) {
        if (!renewedForAuth) {
          renewedForAuth = true;
          this.invalidateIdToken();
          await this.renew(); // throws NeedsReauth (bad refresh) or ConnectionError; both propagate
          continue;
        }
        throw new NeedsReauthError('Authentication rejected by the cloud; please sign in again');
      }

      // Genuinely transient server statuses: retry within the bounded budget.
      if (RETRYABLE_HTTP_STATUSES.has(res.status)) {
        if (transientAttempts < MAX_RETRIES) {
          transientAttempts += 1;
          this.log(`Retryable HTTP ${res.status} on ${url}, retry ${transientAttempts}/${MAX_RETRIES}`);
          await this.sleep(this.retryDelayMs(transientAttempts, res));
          continue;
        }
        throw new ApiError(`Request to ${url} failed with HTTP ${res.status} after ${MAX_RETRIES} retries`, res.status);
      }

      // Any other non-ok status (403, 404, ...) is a non-fatal request error.
      // Crucially, 403 does NOT latch needs-reauth — it self-heals next request.
      if (!res.ok) {
        throw new ApiError(`Request to ${url} failed with HTTP ${res.status}`, res.status);
      }

      return await this.readBody(res, url);
    }
  }

  /** Read a response body as JSON, tolerating an empty body and wrapping parse errors. */
  private async readBody(res: Response, url: string): Promise<unknown> {
    const text = await res.text();
    if (text.trim() === '') {
      // Some endpoints (e.g. the lock command) acknowledge with an empty body.
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new ApiError(`Invalid JSON in response from ${url}`, res.status);
    }
  }

  /**
   * Backoff for the given (1-based) attempt. For a 429 response, honor a numeric
   * `Retry-After` (delta-seconds form only), capped; otherwise linear backoff.
   */
  private retryDelayMs(attempt: number, res?: Response): number {
    if (res?.status === 429) {
      const header = res.headers?.get?.('retry-after');
      const seconds = header !== null && header !== undefined ? Number(header) : NaN;
      if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
      }
    }
    return RETRY_BASE_DELAY_MS * attempt;
  }
}
