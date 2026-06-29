/**
 * homebridge-config-ui-x custom UI server. Performs the Kwikset login
 * server-side using the compiled KwiksetClient, holds each in-progress
 * verification challenge under an opaque session id (with a TTL) between the
 * password and code steps, and returns the resulting refresh token to the
 * browser (which persists it to the plugin config). The password is used once
 * and never stored.
 */
'use strict';

const { HomebridgePluginUiServer, RequestError } = require('@homebridge/plugin-ui-utils');

// Lazy-require so a missing build produces a clear error rather than a crash at load.
function createClient() {
  let KwiksetClient;
  try {
    ({ KwiksetClient } = require('../dist/client/kwiksetClient'));
  } catch (err) {
    throw new RequestError('Plugin is not built yet. Run the plugin build, then retry.', { status: 500 });
  }
  return new KwiksetClient();
}

function createPendingSessions() {
  try {
    const { PendingSessions } = require('../dist/ui/pendingSessions');
    return new PendingSessions();
  } catch (err) {
    // Not built; /login surfaces the build error via createClient first.
    return null;
  }
}

function messageOf(err, fallback) {
  return err && err.message ? err.message : fallback;
}

class KwiksetUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    // In-progress (awaiting-code) logins, keyed by opaque session id with a TTL,
    // so concurrent flows (two tabs / two admins) don't collide.
    this.pending = createPendingSessions();

    this.onRequest('/login', this.handleLogin.bind(this));
    this.onRequest('/submit-code', this.handleSubmitCode.bind(this));
    this.onRequest('/status', this.handleStatus.bind(this));

    this.ready();
  }

  /**
   * Report the running platform's live session health (written by the platform
   * process to a shared status file). Returns `{ needsReauth: false }` whenever
   * the health can't be determined — missing storage path, unbuilt plugin, or
   * missing/unreadable status file — so the UI never shows a false "expired"
   * warning. (The file is trusted as-is; there is no age/TTL check.) Never throws.
   */
  async handleStatus() {
    try {
      const dir = this.homebridgeStoragePath;
      if (!dir) {
        return { needsReauth: false };
      }
      const { readSessionStatus } = require('../dist/sessionStatus');
      const status = readSessionStatus(dir);
      return { needsReauth: !!(status && status.needsReauth) };
    } catch (err) {
      return { needsReauth: false };
    }
  }

  async handleLogin({ email, password } = {}) {
    if (!email || !password) {
      throw new RequestError('Email and password are required.', { status: 400 });
    }
    try {
      const client = createClient();
      const result = await client.loginWithPassword(email, password);
      if (result.status === 'success') {
        return { status: 'success', email, refreshToken: client.getRefreshToken() };
      }
      // Verification code required: stash this flow's client under a session id.
      if (!this.pending) {
        throw new RequestError('Plugin is not built yet. Run the plugin build, then retry.', { status: 500 });
      }
      const sessionId = this.pending.create(client);
      return { status: 'code_required', email, sessionId };
    } catch (err) {
      // Auth failures are mapped to safe, generic messages by cognitoAuth
      // (mapLoginError), so a credential failure never reveals whether the
      // account exists. Always 401; we never surface a distinguishing status.
      throw new RequestError(messageOf(err, 'Login failed.'), { status: 401 });
    }
  }

  async handleSubmitCode({ sessionId, code } = {}) {
    if (!sessionId || !code) {
      throw new RequestError('Verification code is required.', { status: 400 });
    }
    const client = this.pending && this.pending.get(sessionId);
    if (!client) {
      throw new RequestError('Your verification session has expired. Please start over.', { status: 400 });
    }
    try {
      await client.submitCode(code);
    } catch (err) {
      // Wrong/expired code: keep the session so the user can retry the code.
      throw new RequestError(messageOf(err, 'Verification failed.'), { status: 401 });
    }
    this.pending.remove(sessionId);
    return { status: 'success', email: client.getEmail(), refreshToken: client.getRefreshToken() };
  }
}

(() => new KwiksetUiServer())();
