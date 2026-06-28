import type { API } from 'homebridge';

import { KwiksetPlatform } from './platform';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';

export = (api: API) => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, KwiksetPlatform);
};
