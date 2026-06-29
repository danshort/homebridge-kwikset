## Context

`homebridge-kwikset` is an npm-published Homebridge plugin (currently `0.1.1`, with a matching `v0.1.1` tag + GitHub Release). Releases are manual today. The sibling repo `danshort/lectern` already runs a Release Please pipeline (release PR → tag/release → GoReleaser). We want the same shape here, with the publish step swapped from Go/GoReleaser to npm. The repo is public, so npm provenance is available. A `ci.yml` (lint + build + 36 vitest tests) already gates PRs.

## Goals / Non-Goals

**Goals:**
- Releases driven by Conventional Commits, attributable to merged PRs.
- A maintained release PR (version bump + `CHANGELOG.md`), and a one-click release on merge.
- Automated, provenance-signed `npm publish` from CI — no local publishing required.
- Mirror lectern's structure so the two repos are operationally consistent.

**Non-Goals:**
- Changing plugin runtime code.
- Signing beyond npm provenance; non-npm channels.
- Multi-package / monorepo releasing.

## Decisions

### Decision: Release Please (manifest mode), `release-type: node`
Matches lectern and owns the version + changelog from commit history. **Alternative:** `semantic-release` — also viable, but choosing release-please keeps both repos on one mental model and one config format. Config mirrors lectern: `bump-minor-pre-major: true`, `include-component-in-tag: false`, single root package.

### Decision: Publish job in the SAME workflow run, gated on `release_created`
A tag/release created by the default `GITHUB_TOKEN` does **not** trigger a separate `on: release`/`on: push tags` workflow (GitHub's loop-prevention). So the publish job must live in `release.yml`, `needs:` the release-please job, and run only `if: needs.release-please.outputs.release_created == 'true'`, checking out `outputs.tag_name`. **Alternative:** a separate `on: release` workflow — rejected; it would silently never fire. This is the single most important structural decision and the reason lectern co-locates goreleaser with release-please.

### Decision: npm Trusted Publishing (OIDC), not a stored token
Publish via `actions/setup-node` (with `registry-url`) + `npm publish --access public`, authenticating through **npm Trusted Publishing**: the job's `id-token: write` OIDC token is exchanged for short-lived publish credentials, with provenance generated automatically. No `NPM_TOKEN` secret is stored. The job upgrades npm (`npm install -g npm@latest`) because Trusted Publishing needs npm ≥ 11.5.1, newer than what `setup-node` may ship. `prepublishOnly` (lint+build) still runs as a local safety net. **Why over a token:** npm now steers automation away from long-lived automation tokens (which would also require disabling account 2FA) toward Trusted Publishing — it's tokenless, can't leak, keeps 2FA on, and still yields provenance. **Trade-off:** requires a one-time Trusted Publisher configuration on the npm package (repo + workflow filename) before the first automated publish.

### Decision: Enforce Conventional Commit PR titles
The repo squash-merges, so the PR title becomes the commit subject release-please parses. `pr-title-lint.yml` (amannn/action-semantic-pull-request) validates titles against the allowed type list. Without this, malformed titles silently produce wrong/no version bumps. **Alternative:** commit-message linting on push — weaker, since squash discards individual commit subjects.

### Decision: Seed the manifest at `0.1.1`
`.release-please-manifest.json` = `{ ".": "0.1.1" }` so the first run recognizes the current published version and only proposes bumps from *new* commits — avoiding a duplicate/regressed release. The accumulated `docs:`/`ci:` commits since v0.1.1 won't trigger a release, so introducing the pipeline is inert until the next `feat`/`fix`.

### Decision: Keep `ci.yml` as the independent PR gate
Release automation and quality-gating stay separate workflows: `ci.yml` runs on PRs/pushes; `release.yml` runs on `main`. Clearer responsibilities and failure isolation.

## Risks / Trade-offs

- **Release-please can't open PRs** → it needs "Allow GitHub Actions to create and approve pull requests" + read/write workflow permissions; **Mitigation:** document as required setup; the pipeline is otherwise inert.
- **`NPM_TOKEN` missing/expired** → publish fails; **Mitigation:** spec requires a clear failure (no partial publish); document token creation; manual `npm publish` remains a fallback.
- **First run double-releases** → **Mitigation:** manifest seeded to `0.1.1`; verify no release PR appears for the existing version.
- **Squash settings not applied** → PR titles wouldn't map to commit subjects; **Mitigation:** document enabling squash with "PR title" as the subject, plus the PR-title lint.
- **Provenance prerequisites** → needs `id-token: write` and npm ≥ 9.5 (setup-node Node 20 ships npm 10); **Mitigation:** pin Node 20 in the publish job.

## Open Questions

- Should `main` get branch protection (require PR + passing `ci.yml`) now, or document it as recommended? Leaning: document as recommended, don't hard-require in this change.
- Node version matrix for publish (single Node 20) vs reuse the CI matrix — publish only needs one modern Node; CI keeps the matrix.
