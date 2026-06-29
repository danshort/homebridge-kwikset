import { AuthOutcome, CognitoAuthenticator, CodeResume } from '../src/client/cognitoAuth';
import { Tokens } from '../src/client/types';

/**
 * Build a fake (unsigned) JWT whose `exp` is `secondsFromNow` in the future.
 * An optional `nonce` makes the token string unique (e.g. to prove a renewed
 * token is actually used on a retry).
 */
export function fakeJwt(secondsFromNow: number, nowMs = Date.now(), nonce?: number): string {
  const exp = Math.floor(nowMs / 1000) + secondsFromNow;
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64');
  const payload = Buffer.from(JSON.stringify(nonce === undefined ? { exp } : { exp, nonce })).toString('base64');
  return `${header}.${payload}.sig`;
}

export function fakeTokens(secondsFromNow = 3600, nowMs = Date.now(), nonce?: number): Tokens {
  return {
    idToken: fakeJwt(secondsFromNow, nowMs, nonce),
    accessToken: fakeJwt(secondsFromNow, nowMs, nonce),
    refreshToken: 'refresh-token-abc',
  };
}

/** A scriptable authenticator for client tests. */
export class FakeAuthenticator implements CognitoAuthenticator {
  authenticateImpl: (email: string, password: string) => Promise<AuthOutcome> = async () => ({
    kind: 'tokens',
    tokens: fakeTokens(),
  });
  submitCodeImpl: (resume: CodeResume, code: string) => Promise<Tokens> = async () => fakeTokens();
  refreshImpl: (email: string, refreshToken: string) => Promise<Tokens> = async () => fakeTokens();

  refreshCalls = 0;

  authenticate(email: string, password: string): Promise<AuthOutcome> {
    return this.authenticateImpl(email, password);
  }
  submitCode(resume: CodeResume, code: string): Promise<Tokens> {
    return this.submitCodeImpl(resume, code);
  }
  refresh(email: string, refreshToken: string): Promise<Tokens> {
    this.refreshCalls += 1;
    return this.refreshImpl(email, refreshToken);
  }
}

/** Record of one fetch call. */
export interface RecordedRequest {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body?: unknown;
}

/**
 * A queued fake response: a status (+ optional JSON `body`, verbatim `rawBody`,
 * or `headers`), or a thrower. `rawBody` is sent as-is (e.g. to simulate an
 * empty or malformed body) and takes precedence over `body`.
 */
export type FakeResponse =
  | { status: number; body?: unknown; rawBody?: string; headers?: Record<string, string> }
  | (() => never);

/**
 * A fake fetch that returns queued responses (the last entry repeats once the
 * queue is exhausted). Each entry is either a `{ status, body, headers }` to
 * return, or a function that throws (a transport error).
 */
export function makeFakeFetch(responses: FakeResponse[]) {
  const calls: RecordedRequest[] = [];
  let i = 0;
  const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({
      url,
      method: init.method,
      headers,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (typeof next === 'function') {
      next();
    }
    const { status, body, rawBody, headers: resHeaders } = next as Exclude<FakeResponse, () => never>;
    const payload = rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : '';
    return new Response(payload, { status, headers: resHeaders });
  };
  return { fetchImpl, calls };
}
