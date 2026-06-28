/**
 * homebridge-config-ui-x custom UI server. Performs the Kwikset login
 * server-side using the compiled KwiksetClient, holds the in-progress
 * verification challenge between requests, and returns the resulting refresh
 * token to the browser (which persists it to the plugin config). The password
 * is used once and never stored.
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

class KwiksetUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    /** Retains the in-progress login across the password → code steps. */
    this.pendingClient = null;

    this.onRequest('/login', this.handleLogin.bind(this));
    this.onRequest('/submit-code', this.handleSubmitCode.bind(this));

    this.ready();
  }

  async handleLogin({ email, password } = {}) {
    if (!email || !password) {
      throw new RequestError('Email and password are required.', { status: 400 });
    }
    let client;
    try {
      client = createClient();
      const result = await client.loginWithPassword(email, password);
      if (result.status === 'success') {
        this.pendingClient = null;
        return { status: 'success', email, refreshToken: client.getRefreshToken() };
      }
      // Verification code required: keep the client to complete the challenge.
      this.pendingClient = client;
      return { status: 'code_required', email };
    } catch (err) {
      this.pendingClient = null;
      throw new RequestError(err && err.message ? err.message : 'Login failed.', { status: 401 });
    }
  }

  async handleSubmitCode({ code } = {}) {
    if (!this.pendingClient) {
      throw new RequestError('No verification is in progress. Start over.', { status: 400 });
    }
    if (!code) {
      throw new RequestError('Verification code is required.', { status: 400 });
    }
    try {
      await this.pendingClient.submitCode(code);
      const email = this.pendingClient.getEmail();
      const refreshToken = this.pendingClient.getRefreshToken();
      this.pendingClient = null;
      return { status: 'success', email, refreshToken };
    } catch (err) {
      throw new RequestError(err && err.message ? err.message : 'Verification failed.', { status: 401 });
    }
  }
}

(() => new KwiksetUiServer())();
