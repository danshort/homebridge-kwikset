## 1. Project scaffolding

- [x] 1.1 Initialize TypeScript Homebridge plugin: `package.json` with `engines.homebridge`, `keywords: ["homebridge-plugin"]`, `main`, scripts (build/watch/lint), and `displayName`/`name` (`homebridge-kwikset`)
- [x] 1.2 Add dependencies: `amazon-cognito-identity-js`, `@homebridge/plugin-ui-utils`; devDeps: `homebridge`, `typescript`, types, linter; set Node 18+ engine
- [x] 1.3 Add `tsconfig.json`, `.eslintrc`, `.gitignore` (ignore `dist/`, `node_modules/`, and the throwaway `spike-auth.js`)
- [x] 1.4 Create source layout: `src/` (platform, accessory, settings), `src/client/` (KwiksetClient core), `homebridge-ui/` (server + public)
- [x] 1.5 Author `config.schema.json` with fields: name, stored email, stored refreshToken (hidden), pollIntervalSeconds (default 30), lowBatteryThreshold; mark it to use the custom UI
- [x] 1.6 Set up the test toolchain: test runner + assertion lib, `fixtures/` dir for recorded API responses, `npm test` (and `test:watch`) scripts, coverage config, and a CI workflow that runs build + lint + test

## 2. Cloud client core (`kwikset-cloud-client`)

- [x] 2.1 Add constants module (Cognito pool/client IDs, region, REST base URL + endpoint templates, app User-Agent strings) sourced from `kwikset-cloud-api-facts`
- [x] 2.2 Implement SRP password login via `amazon-cognito-identity-js` with an in-memory storage shim; return tokens on the direct-success path
- [x] 2.3 Implement the `CUSTOM_CHALLENGE` fallback: detect the challenge, trigger code delivery, expose a "code required" signal, and complete on code submission (isolated from the common path)
- [x] 2.4 Implement session restore from a stored refresh token and automatic ID-token renewal before requests
- [x] 2.5 Implement a distinct needs-reauthentication error when refresh is rejected, separate from transient/connection errors
- [x] 2.6 Implement authenticated REST helper (Bearer id_token, app UA) with bounded retry on timeout/connection errors
- [x] 2.7 Implement discovery: list homes, list devices for a home (parse lockstatus, batterypercentage, deviceconnectivitystatus, serialnumber/deviceid, name, model)
- [x] 2.8 Implement lock/unlock command (`PATCH /devices/{sn}/status` with `{action, source}`); resolve on accepted ack without inferring final state
- [x] 2.9 Unit-test the client against recorded fixtures (login success, challenge branch, refresh, needs-reauth, device parse, command ack)

## 3. Config-UI auth flow (`account-setup-ui`)

- [x] 3.1 Implement `homebridge-ui/server.js` extending the plugin-ui server; expose request handlers for `login`, `submitCode`, and `status`
- [x] 3.2 Wire the server handlers to KwiksetClient; retain the in-progress challenge session in memory between the password and code steps
- [x] 3.3 On success, persist refreshToken + email to plugin config via the UI server; never persist the password
- [x] 3.4 Build `homebridge-ui/public/index.html` with email/password form, a progressively revealed code field (shown only when a challenge is returned), and success/error states
- [x] 3.5 Provide a re-authenticate path in the UI that overwrites the stored refresh token
- [ ] 3.6 Manually verify the full login flow end-to-end in homebridge-config-ui-x against the real account (requires running config-ui-x; not executable here)

## 4. Platform & accessories (`lock-accessories`)

- [x] 4.1 Implement the dynamic platform: register, restore cached accessories (keyed by device id), and read config (token, interval, threshold)
- [x] 4.2 On launch, restore the session from the stored refresh token; if missing/invalid, enter needs-reauth state with clear log guidance (no crash loop)
- [x] 4.3 Discover locks and create/update accessories for each device
- [x] 4.4 Implement the lock accessory: `LockMechanism` service with lockstatus→state mapping (Locked=secured, Unlocked=unsecured, Jammed=jammed, else unknown)
- [x] 4.5 Add the `Battery` service: BatteryLevel from batterypercentage + StatusLowBattery at/below threshold
- [x] 4.6 Implement the polling loop (default 30s, configurable) updating characteristics on change
- [x] 4.7 Implement target-state handler: send command, set optimistic in-progress state, reconcile via follow-up read, revert on timeout
- [x] 4.8 Map `deviceconnectivitystatus` to reachability / No Response, recovering when reconnected
- [x] 4.9 Handle needs-reauth surfaced mid-operation: stop error spam, log re-auth guidance
- [x] 4.10 Unit-test accessory logic in isolation (faked client + injectable clock/timers): lockstatus→HomeKit state mapping incl. unknown values, battery level + low-battery threshold boundary, and the optimistic-state → reconcile-on-read → revert-on-timeout state machine
- [x] 4.11 Unit-test reachability mapping (connected vs offline → No Response and recovery) and the needs-reauth handling (no crash loop / bounded logging)

## 5. Integration & release prep

- [ ] 5.1 Verify end-to-end in a real Homebridge: accessory appears in Apple Home, lock/unlock works, state and battery accurate, reachability reflects connectivity (requires running Homebridge + the physical lock; not executable here)
- [ ] 5.2 Verify the needs-reauth recovery: invalidate the token, confirm clean handling, re-auth via UI restores operation (manual; not executable here)
- [x] 5.3 Write README (setup via custom UI, config options, unofficial-API caveat) and confirm `config.schema.json` renders correctly
- [x] 5.4 Remove or relocate `spike-auth.js` and its ad-hoc deps; ensure a clean `npm run build` and lint pass
