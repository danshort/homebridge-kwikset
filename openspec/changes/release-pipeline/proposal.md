## Why

Releasing `homebridge-kwikset` is currently manual: bump the version by hand, tag, push, and run `npm publish` locally. That is error-prone (tag/version/npm can drift, as already happened with v0.1.1) and ties releases to one person's machine. An automated, Conventional-Commit–driven pipeline — modeled on the existing `danshort/lectern` setup — makes releases reproducible, attributable to merged PRs, and publishable from CI.

## What Changes

- Add a **Release Please** based pipeline so that:
  - Work lands on `main` via PRs whose titles are Conventional Commits.
  - A bot-maintained **release PR** accumulates the version bump and `CHANGELOG.md` from those commits.
  - Merging the release PR creates the **git tag + GitHub Release**, which (in the same workflow run) triggers an automated **`npm publish`** with provenance.
- Add `.github/workflows/release.yml` (release-please job + gated npm-publish job).
- Add `.github/workflows/pr-title-lint.yml` enforcing Conventional Commit PR titles.
- Add `release-please-config.json` and `.release-please-manifest.json` (seeded at the current `0.1.1`).
- Document the required one-time repo configuration (Actions PR permissions, `NPM_TOKEN` secret, squash-merge settings) in the README/contributing notes.
- The existing `.github/workflows/ci.yml` (lint + build + tests) is retained unchanged as the PR gate; the manual `prepublishOnly` script remains as a safety net.

## Capabilities

### New Capabilities
- `release-automation`: Conventional-Commit–driven release management — a release PR that maintains version + changelog, a tag/release on merge, and an automated, provenance-signed npm publish gated on that release, plus PR-title enforcement.

### Modified Capabilities
<!-- None — release tooling is orthogonal to the plugin's runtime capabilities. -->

## Impact

- **New files**: `.github/workflows/release.yml`, `.github/workflows/pr-title-lint.yml`, `release-please-config.json`, `.release-please-manifest.json`, and (auto-generated on first release) `CHANGELOG.md`.
- **CI actions used**: `googleapis/release-please-action@v4`, `amannn/action-semantic-pull-request@v5`, `actions/setup-node`, `actions/checkout`.
- **Secrets / settings (manual, one-time)**: `NPM_TOKEN` automation token; Actions workflow permissions set to read/write with "allow GitHub Actions to create and approve pull requests"; squash-merge enabled with the PR title as the squash subject. The pipeline cannot publish until `NPM_TOKEN` exists.
- **Process change**: direct pushes to `main` are replaced by branch → PR → squash-merge; version is no longer hand-edited (release-please owns `package.json` version + manifest).
- **Provenance**: requires the public repo (already public) and `id-token: write` on the publish job.
- **Out of scope**: plugin runtime code, package signing beyond npm provenance, and any non-npm distribution channel.
