# homebridge-kwikset

[![npm version](https://img.shields.io/npm/v/homebridge-kwikset.svg)](https://www.npmjs.com/package/homebridge-kwikset)
[![npm downloads](https://img.shields.io/npm/dt/homebridge-kwikset.svg)](https://www.npmjs.com/package/homebridge-kwikset)
[![CI](https://github.com/danshort/homebridge-kwikset/actions/workflows/ci.yml/badge.svg)](https://github.com/danshort/homebridge-kwikset/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/homebridge-kwikset.svg)](https://github.com/danshort/homebridge-kwikset/blob/main/LICENSE)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-support-FFDD00?logo=buymeacoffee&logoColor=black)](https://www.buymeacoffee.com/danshort)

A [Homebridge](https://homebridge.io) plugin that brings **Kwikset Halo** Wi-Fi smart locks into Apple HomeKit, using Kwikset's cloud API.

It exposes each lock as a HomeKit **Lock** with **battery** reporting, so you can lock/unlock and check battery from the Home app and Siri.

> ⚠️ **Unofficial API.** This plugin talks to Kwikset's cloud (the same backend the Kwikset app uses) via an undocumented API. It can break at any time if Kwikset changes their service. Use at your own risk.

## Requirements

- Homebridge v1.6+ on Node.js 18+
- [homebridge-config-ui-x](https://github.com/homebridge/homebridge-config-ui-x) (used for sign-in)
- A Kwikset account with at least one Halo lock, already set up in the Kwikset app

## Installation

In the Homebridge UI, go to **Plugins**, search for **homebridge-kwikset**, and click **Install**. It shows as an *unverified* plugin — that's normal for community plugins; install it anyway.

Or from the Homebridge UI's built-in **Terminal** (or any shell on the Homebridge host):

```bash
hb-service add homebridge-kwikset
# or a plain global install:
npm install -g homebridge-kwikset
```

> Just published and not showing in UI search yet? npm's search index lags new releases by up to a few hours. `hb-service add homebridge-kwikset` installs it immediately by name.

## Setup

1. In the Homebridge UI, open the **Kwikset** plugin settings.
2. Enter your Kwikset **email** and **password** and click **Sign In**.
   - Your password is sent to the plugin only to obtain a login token; it is **never stored**.
   - If your account requires a verification code, a **code field** appears — enter the code emailed to you.
3. On success, the plugin stores a long-lived **refresh token** in its config and you can close the dialog.
4. **Restart Homebridge** to apply. Your locks appear as accessories.

If the session ever stops working (e.g. you changed your password), just open the plugin settings and sign in again, then restart Homebridge.

### Recommended: run as a child bridge

Because this plugin depends on a cloud service, running it as a **child bridge** isolates it in its own process — so a slow or failed Kwikset API call can't make your other accessories unresponsive. In the Homebridge UI, open the plugin's **⋮ menu → Bridge Settings**, enable the child bridge, **Save**, and restart. The UI then shows a pairing QR code; add it once in the Home app via **Add Accessory**.

The plugin does **not** enable this automatically: a child bridge needs its own unique bridge username and port, which Homebridge owns, so you turn it on in the UI. Tip — confirm sign-in and that the lock works on the normal bridge first, then enable the child bridge.

## Configuration

Most users only need to sign in. Additional options:

| Option | Default | Description |
| --- | --- | --- |
| `pollIntervalSeconds` | `30` | How often (15–900s) to refresh lock state from the cloud. |
| `lowBatteryThreshold` | `20` | Report low battery at or below this percentage. |
| `email` / `refreshToken` | — | Set automatically when you sign in. Treat the token as a secret. |

The refresh token is stored in plaintext in the Homebridge config, like all Homebridge plugin secrets. Run Homebridge on a trusted network.

## How it works

- **Auth:** AWS Cognito SRP login (with a verification-code fallback) yields a refresh token; the plugin renews short-lived tokens automatically.
- **State:** the plugin polls your home's devices on an interval and maps `lockstatus` → HomeKit lock state and `batterypercentage` → the Battery service. Offline locks show as **No Response**.
- **Commands:** lock/unlock is sent to the cloud, shown optimistically in HomeKit, then confirmed on a follow-up read (the cloud command is asynchronous). If it isn't confirmed in time, the state reverts.

## Limitations

This release covers lock/unlock + battery + reachability via **cloud polling**. Not (yet) included: instant push updates, access-code management, auto-lock/LED/audio toggles, and door-position sensing. State can be up to one poll interval stale for changes made at the keypad.

## Development

```bash
npm install
npm run build      # compile TypeScript to dist/
npm test           # run the unit test suite (vitest)
npm run lint
```

## Credits

This plugin would not exist without the prior reverse-engineering work of the Home Assistant community. The Kwikset cloud authentication flow and REST endpoints used here were learned from:

- **[explosivo22/kwikset-ha](https://github.com/explosivo22/kwikset-ha)** — the Home Assistant integration for Kwikset locks, which served as the behavioral reference (especially the optimistic lock-state handling).
- **[aiokwikset](https://pypi.org/project/aiokwikset/)** — the async Python client behind that integration, whose Cognito auth flow and API endpoints this plugin ports to Node.

Many thanks to those maintainers. This is an independent project and is not affiliated with them or with Kwikset.

## Contributing

Issues and pull requests are welcome at [github.com/danshort/homebridge-kwikset](https://github.com/danshort/homebridge-kwikset).

## License

MIT © [Dan Short](https://github.com/danshort)

