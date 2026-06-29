/**
 * Plugin entry point. Homebridge calls this exported registration function
 * (a CommonJS `export =` callback) at load, and we register the dynamic
 * platform (`KwiksetPlatform`) under the plugin/platform names. See
 * ARCHITECTURE.md for how the pieces fit together.
 */
import type { API } from 'homebridge';

import { KwiksetPlatform } from './platform';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';

export = (api: API) => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, KwiksetPlatform);
};
