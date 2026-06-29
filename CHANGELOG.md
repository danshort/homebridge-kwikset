# Changelog

## [0.2.0](https://github.com/danshort/homebridge-kwikset/compare/v0.1.1...v0.2.0) (2026-06-29)


### Features

* surface session-expired state in the config UI ([347c162](https://github.com/danshort/homebridge-kwikset/commit/347c16281c18b6ebdf2264cc69760ea0c8f08535)), closes [#14](https://github.com/danshort/homebridge-kwikset/issues/14)


### Bug Fixes

* harden config-UI auth (no enumeration, per-flow challenge sessions) ([#21](https://github.com/danshort/homebridge-kwikset/issues/21)) ([6743304](https://github.com/danshort/homebridge-kwikset/commit/6743304a93be3da62487534e3e61299466dccbfe))
* harden REST client error handling and retries ([#18](https://github.com/danshort/homebridge-kwikset/issues/18)) ([e5255b5](https://github.com/danshort/homebridge-kwikset/commit/e5255b587bd833c127c882976cc98437ca4c9d06))
* make discovery/polling concurrency-safe and self-recovering ([#19](https://github.com/danshort/homebridge-kwikset/issues/19)) ([c90a642](https://github.com/danshort/homebridge-kwikset/commit/c90a642e8ce8b3dac9e41f3b71f1535c8ebe29c6))
* prevent an overlapping lock command from clobbering a newer one ([#20](https://github.com/danshort/homebridge-kwikset/issues/20)) ([cdff8a4](https://github.com/danshort/homebridge-kwikset/commit/cdff8a47f903e35fa8c774fd912c8c91decb2a83))
