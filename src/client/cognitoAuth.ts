/**
 * Cognito authentication, abstracted behind an interface so the rest of the
 * client can be unit-tested with a fake. The real implementation wraps
 * `amazon-cognito-identity-js` (USER_SRP_AUTH with a CUSTOM_CHALLENGE
 * verification-code fallback), exactly as proven in the auth spike.
 */

import {
  AuthenticationDetails,
  CognitoRefreshToken,
  CognitoUser,
  CognitoUserPool,
  CognitoUserSession,
  ICognitoStorage,
  IAuthenticationCallback,
} from 'amazon-cognito-identity-js';

import { CLIENT_ID, POOL_ID, customChallengeGenerateAnswer } from './constants';
import { AuthError, ConnectionError, NeedsReauthError } from './errors';
import { Tokens } from './types';

/** Opaque handle that lets `submitCode` resume an in-progress challenge. */
export interface CodeResume {
  readonly user: CognitoUser;
}

export type AuthOutcome =
  | { kind: 'tokens'; tokens: Tokens }
  | { kind: 'code_required'; resume: CodeResume };

export interface CognitoAuthenticator {
  /** Perform SRP password login. */
  authenticate(email: string, password: string): Promise<AuthOutcome>;
  /** Complete a CUSTOM_CHALLENGE with the user-supplied verification code. */
  submitCode(resume: CodeResume, code: string): Promise<Tokens>;
  /** Exchange a refresh token for a fresh set of tokens. */
  refresh(email: string, refreshToken: string): Promise<Tokens>;
}

/** In-memory storage so the lib never reaches for browser localStorage. */
function memoryStorage(): ICognitoStorage {
  const store: Record<string, string> = {};
  return {
    setItem: (k, v) => {
      store[k] = v;
    },
    getItem: (k) => (k in store ? store[k] : null),
    removeItem: (k) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) {
        delete store[k];
      }
    },
  };
}

function sessionToTokens(session: CognitoUserSession): Tokens {
  return {
    idToken: session.getIdToken().getJwtToken(),
    accessToken: session.getAccessToken().getJwtToken(),
    refreshToken: session.getRefreshToken().getToken(),
  };
}

/** Map a Cognito error during an interactive login to our taxonomy. */
function mapLoginError(err: unknown): Error {
  const code = (err as { code?: string; name?: string })?.code ?? (err as { name?: string })?.name ?? '';
  switch (code) {
    case 'NotAuthorizedException':
    case 'UserNotFoundException':
    case 'CodeMismatchException':
    case 'ExpiredCodeException':
    case 'InvalidParameterException':
      return new AuthError((err as Error)?.message || 'Invalid credentials');
    case 'NetworkError':
    case 'TimeoutError':
      return new ConnectionError((err as Error)?.message || 'Network error during authentication');
    default:
      return new AuthError((err as Error)?.message || 'Authentication failed');
  }
}

/** Map a Cognito error during a token refresh to our taxonomy. */
function mapRefreshError(err: unknown): Error {
  const code = (err as { code?: string; name?: string })?.code ?? (err as { name?: string })?.name ?? '';
  if (code === 'NetworkError' || code === 'TimeoutError') {
    return new ConnectionError((err as Error)?.message || 'Network error during token refresh');
  }
  // Anything else on a refresh (NotAuthorized, invalid/expired token) means the
  // session can no longer be restored without a fresh login.
  return new NeedsReauthError((err as Error)?.message || 'Session expired; re-authentication required');
}

export class CognitoSrpAuthenticator implements CognitoAuthenticator {
  private pool(): CognitoUserPool {
    return new CognitoUserPool({
      UserPoolId: POOL_ID,
      ClientId: CLIENT_ID,
      Storage: memoryStorage(),
    });
  }

  private makeUser(email: string): CognitoUser {
    const user = new CognitoUser({ Username: email, Pool: this.pool(), Storage: memoryStorage() });
    user.setAuthenticationFlowType('USER_SRP_AUTH');
    return user;
  }

  authenticate(email: string, password: string): Promise<AuthOutcome> {
    const user = this.makeUser(email);
    const authDetails = new AuthenticationDetails({ Username: email, Password: password });

    return new Promise<AuthOutcome>((resolve, reject) => {
      let challengeRound = 0;

      const callbacks: IAuthenticationCallback = {
        onSuccess: (session) => resolve({ kind: 'tokens', tokens: sessionToTokens(session) }),
        onFailure: (err) => reject(mapLoginError(err)),
        customChallenge: () => {
          challengeRound += 1;
          if (challengeRound === 1) {
            // First challenge after SRP: ask the cloud to send a code.
            try {
              user.sendCustomChallengeAnswer(customChallengeGenerateAnswer('email'), callbacks);
            } catch (err) {
              reject(mapLoginError(err));
            }
          } else {
            // Second challenge: the cloud now expects the code, which we don't
            // have yet. Pause and let the caller collect it from the user.
            resolve({ kind: 'code_required', resume: { user } });
          }
        },
      };

      user.authenticateUser(authDetails, callbacks);
    });
  }

  submitCode(resume: CodeResume, code: string): Promise<Tokens> {
    return new Promise<Tokens>((resolve, reject) => {
      const callbacks: IAuthenticationCallback = {
        onSuccess: (session) => resolve(sessionToTokens(session)),
        onFailure: (err) => reject(mapLoginError(err)),
        customChallenge: () => reject(new AuthError('Unexpected additional verification challenge')),
      };
      resume.user.sendCustomChallengeAnswer(code, callbacks);
    });
  }

  refresh(email: string, refreshToken: string): Promise<Tokens> {
    const user = this.makeUser(email);
    return new Promise<Tokens>((resolve, reject) => {
      user.refreshSession(new CognitoRefreshToken({ RefreshToken: refreshToken }), (err, session) => {
        if (err || !session) {
          reject(mapRefreshError(err));
          return;
        }
        resolve(sessionToTokens(session as CognitoUserSession));
      });
    });
  }
}
