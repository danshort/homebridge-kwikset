## Why

The adversarial review flagged two supply-chain weaknesses in the release pipeline. The `npm-publish` job runs `npm ci` and `npm test` (arbitrary dependency lifecycle and test code) **while it holds `id-token: write`** — the classic "build + publish in one privileged job" weakness, where a compromised dependency could mint and exfiltrate the OIDC/provenance identity (GitHub #10). And every third-party Action is referenced by a **mutable tag** (`@v4`/`@v5`); a repointed tag in the privileged job could run attacker code (GitHub #11).

## What Changes

- **Split build/test from publish** (#10): an unprivileged `build` job (no `id-token`) runs `npm ci`, lint, build, and tests and uploads the built `dist/`. A minimal `npm-publish` job (with `id-token: write`, in the `release` environment) downloads that artifact and runs only `npm publish --ignore-scripts` — no dependency scripts, no test code, no project build execute while the OIDC token is available.
- **Pin Actions to commit SHAs** (#11): every third-party Action in `release.yml`, `ci.yml`, and `pr-title-lint.yml` is pinned to a full commit SHA (with a `# vX` comment), so a moved tag cannot inject code.

## Capabilities

### Modified Capabilities
- `release-automation`: harden the publish workflow against supply-chain compromise — isolate the privileged step from untrusted code and pin Action versions.

## Impact

- Code: `.github/workflows/release.yml` (two-job split + SHA pins), `.github/workflows/ci.yml` and `.github/workflows/pr-title-lint.yml` (SHA pins).
- Behavior: same release outcome (Release Please → tag/release → npm publish with provenance via Trusted Publishing); the publish job no longer executes untrusted code.
- Maintenance: SHA pins lose automatic patch updates — note that Dependabot (`github-actions` ecosystem) should be enabled to bump them. (Enabling Dependabot is left to the maintainer; out of scope to configure here unless wanted.)
- Out of scope: changing the Trusted Publishing setup, branch protection.
