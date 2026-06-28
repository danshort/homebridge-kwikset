# homebridge-kwikset

A [Homebridge](https://homebridge.io) plugin that brings **Kwikset Halo** Wi-Fi smart locks into Apple HomeKit, using Kwikset's cloud API.

It exposes each lock as a HomeKit **Lock** with **battery** reporting, so you can lock/unlock and check battery from the Home app and Siri.

> ⚠️ **Unofficial API.** This plugin talks to Kwikset's cloud (the same backend the Kwikset app uses) via an undocumented API. It can break at any time if Kwikset changes their service. Use at your own risk.

## Requirements

- Homebridge v1.6+ on Node.js 18+
- [homebridge-config-ui-x](https://github.com/homebridge/homebridge-config-ui-x) (used for sign-in)
- A Kwikset account with at least one Halo lock, already set up in the Kwikset app

## Installation

Install **homebridge-kwikset** from the Homebridge UI, or:

```bash
npm install -g homebridge-kwikset
```

## Setup

1. In the Homebridge UI, open the **Kwikset** plugin settings.
2. Enter your Kwikset **email** and **password** and click **Sign In**.
   - Your password is sent to the plugin only to obtain a login token; it is **never stored**.
   - If your account requires a verification code, a **code field** appears — enter the code emailed to you.
3. On success, the plugin stores a long-lived **refresh token** in its config and you can close the dialog.
4. **Restart Homebridge** to apply. Your locks appear as accessories.

If the session ever stops working (e.g. you changed your password), just open the plugin settings and sign in again, then restart Homebridge.

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

This MVP covers lock/unlock + battery + reachability via **cloud polling**. Not (yet) included: instant push updates, access-code management, auto-lock/LED/audio toggles, and door-position sensing. State can be up to one poll interval stale for changes made at the keypad.

## Development

```bash
npm install
npm run build      # compile TypeScript to dist/
npm test           # run the unit test suite (vitest)
npm run lint
```

## License

MIT
