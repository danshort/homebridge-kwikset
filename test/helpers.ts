import { AuthOutcome, CognitoAuthenticator, CodeResume } from '../src/client/cognitoAuth';
import { Tokens } from '../src/client/types';

/** Build a fake (unsigned) JWT whose `exp` is `secondsFromNow` in the future. */
export function fakeJwt(secondsFromNow: number, nowMs = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + secondsFromNow;
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64');
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64');
  return `${header}.${payload}.sig`;
}

export function fakeTokens(secondsFromNow = 3600, nowMs = Date.now()): Tokens {
  return {
    idToken: fakeJwt(secondsFromNow, nowMs),
    accessToken: fakeJwt(secondsFromNow, nowMs),
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
 * A fake fetch that returns queued responses. Each entry is either a
 * `{ status, body }` to return, or a function that throws (transient error).
 */
export function makeFakeFetch(
  responses: Array<{ status: number; body?: unknown } | (() => never)>,
) {
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
    const { status, body } = next as { status: number; body?: unknown };
    return new Response(body !== undefined ? JSON.stringify(body) : '', { status });
  };
  return { fetchImpl, calls };
}
