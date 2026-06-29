## 1. Release Please configuration

- [x] 1.1 Add `release-please-config.json` (release-type `node`, `changelog-path` CHANGELOG.md, `bump-minor-pre-major: true`, `include-component-in-tag: false`, single root package)
- [x] 1.2 Add `.release-please-manifest.json` seeded to the current published version (`{ ".": "0.1.1" }`)

## 2. Release workflow

- [x] 2.1 Add `.github/workflows/release.yml` triggered on push to `main` with `contents: write` + `pull-requests: write`
- [x] 2.2 Add the `release-please` job (googleapis/release-please-action@v4) exposing `release_created` and `tag_name` outputs
- [x] 2.3 Add the `npm-publish` job: `needs` release-please, `if: release_created == 'true'`, checks out `tag_name`, `permissions: id-token: write` + `contents: read`
- [x] 2.4 In the publish job, set up Node 20 with `registry-url` (npm registry), `npm ci`, run the test suite, upgrade npm (Trusted Publishing needs ≥ 11.5.1), then `npm publish --access public` authenticated via npm Trusted Publishing (GitHub OIDC, no token); job runs in the `release` environment to match the npm Trusted Publisher config
- [x] 2.5 Add a header comment explaining the same-run gating (default token doesn't trigger downstream release workflows)

## 3. PR title enforcement

- [x] 3.1 Add `.github/workflows/pr-title-lint.yml` using amannn/action-semantic-pull-request@v5 with the allowed Conventional Commit types and a subject pattern
- [x] 3.2 Confirm the existing `ci.yml` still runs on pull requests as the independent merge gate (no change needed beyond verification)

## 4. Documentation

- [x] 4.1 Document one-time repo setup: Actions workflow permissions (read/write + allow Actions to create/approve PRs), `NPM_TOKEN` automation-token secret, and squash-merge with the PR title as the squash subject
- [x] 4.2 Document the day-to-day release flow (branch → Conventional-Commit PR → squash-merge → release PR → merge → auto-publish) in the README/contributing notes

## 5. Validation & rollout

- [x] 5.1 Validate workflow YAML and JSON config locally (syntax + `openspec validate`); confirm versions/manifest are consistent with package.json (`0.1.1`)
- [x] 5.2 Open this change as a Conventional-Commit-titled PR; confirm `ci.yml` and `pr-title-lint` pass on it (PR #1: build 18.x/20.x + PR Title all green)
- [ ] 5.3 After merge, verify Release Please does NOT propose re-releasing `0.1.1` (manifest seeding correct) and that the pipeline is inert until the next `feat`/`fix` (observable only post-merge)
- [x] 5.4 Confirm required settings are in place so the next releasing PR can publish — npm Trusted Publisher configured (repo + `release.yml` + `release` env), Actions "create/approve PRs" permission enabled, squash-merge config applied
