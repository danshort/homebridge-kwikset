/**
 * Error taxonomy for the Kwikset cloud client. Callers distinguish these to
 * decide whether to retry, prompt for re-auth, or surface a credential error.
 */

/** Base class for all client errors. */
export class KwiksetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Authentication failed because the credentials (or verification code) were
 * wrong. The user should correct them and try again.
 */
export class AuthError extends KwiksetError {}

/**
 * The stored refresh token is invalid/expired/revoked. The session cannot be
 * restored without the user logging in again. Distinct from a transient error
 * so the platform can enter a stable "needs re-auth" state instead of retrying.
 */
export class NeedsReauthError extends KwiksetError {}

/**
 * A transient transport problem (timeout, DNS, connection reset). Safe to
 * retry; does not invalidate authentication state.
 */
export class ConnectionError extends KwiksetError {}

/** The cloud returned an unexpected response we could not interpret. */
export class ApiError extends KwiksetError {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}
