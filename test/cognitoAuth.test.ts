import { describe, expect, it } from 'vitest';
import { mapLoginError, mapRefreshError } from '../src/client/cognitoAuth';
import { AuthError, ConnectionError, NeedsReauthError } from '../src/client/errors';

const err = (code: string, message = 'raw upstream message') => ({ code, message });

describe('mapLoginError', () => {
  it('returns a generic AuthError for a wrong password', () => {
    const e = mapLoginError(err('NotAuthorizedException', 'Incorrect username or password.'));
    expect(e).toBeInstanceOf(AuthError);
    expect(e.message).toBe('Invalid email or password.');
  });

  it('does NOT distinguish a missing account from a wrong password (no enumeration)', () => {
    const wrongPw = mapLoginError(err('NotAuthorizedException', 'Incorrect username or password.'));
    const noUser = mapLoginError(err('UserNotFoundException', 'User does not exist.'));
    expect(noUser).toBeInstanceOf(AuthError);
    expect(noUser.message).toBe(wrongPw.message); // identical — cannot tell them apart
  });

  it('gives a distinct (non-enumerating) message for a bad verification code', () => {
    const e = mapLoginError(err('CodeMismatchException', 'Invalid code.'));
    expect(e).toBeInstanceOf(AuthError);
    expect(e.message).toBe('Incorrect or expired verification code.');
  });

  it('maps network/timeout to ConnectionError', () => {
    expect(mapLoginError(err('NetworkError'))).toBeInstanceOf(ConnectionError);
    expect(mapLoginError(err('TimeoutError'))).toBeInstanceOf(ConnectionError);
  });

  it('does not leak the raw upstream message on an unknown error', () => {
    const e = mapLoginError(err('SomethingWeirdException', 'super secret internal detail'));
    expect(e).toBeInstanceOf(AuthError);
    expect(e.message).toBe('Authentication failed.');
    expect(e.message).not.toContain('secret');
  });

  it('reads the error code from `name` when `code` is absent', () => {
    const e = mapLoginError({ name: 'NotAuthorizedException', message: 'x' });
    expect(e.message).toBe('Invalid email or password.');
  });
});

describe('mapRefreshError', () => {
  it('maps network/timeout to ConnectionError', () => {
    expect(mapRefreshError(err('NetworkError'))).toBeInstanceOf(ConnectionError);
  });

  it('maps a rejected refresh token to NeedsReauthError', () => {
    expect(mapRefreshError(err('NotAuthorizedException'))).toBeInstanceOf(NeedsReauthError);
    expect(mapRefreshError(err('AnythingElse'))).toBeInstanceOf(NeedsReauthError);
  });
});
