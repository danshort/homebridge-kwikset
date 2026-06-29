## ADDED Requirements

### Requirement: Release PR maintained from Conventional Commits

The pipeline SHALL run Release Please on every push to `main` and maintain a release pull request that bumps the version and updates `CHANGELOG.md` based on the Conventional Commit messages merged since the last release.

#### Scenario: Releasable commit merged

- **WHEN** a `feat:` or `fix:` commit is merged to `main`
- **THEN** Release Please opens or updates a release PR containing the computed version bump and the corresponding changelog entries

#### Scenario: Non-releasable commits only

- **WHEN** only non-releasing commits (e.g. `docs:`, `chore:`, `ci:`) are merged since the last release
- **THEN** no release PR is created and no new version is proposed

### Requirement: Tag and GitHub Release on release-PR merge

Merging the release pull request SHALL create a git tag and a GitHub Release for the new version, with notes drawn from the changelog.

#### Scenario: Release PR merged

- **WHEN** the maintainer merges the Release Please release PR
- **THEN** a matching git tag and GitHub Release are created for the bumped version

### Requirement: Automated npm publish gated on the release

When (and only when) a release is created, the pipeline SHALL publish the package to npm from CI using npm Trusted Publishing (GitHub OIDC, no stored token), checking out the released tag and publishing with public access and automatic provenance. The publish job SHALL run in the same workflow run as the release so it is not skipped by the default token not triggering downstream workflows.

#### Scenario: Release created

- **WHEN** the release job reports that a release was created
- **THEN** the publish job checks out the released tag, installs dependencies, and runs `npm publish` authenticated via OIDC, producing a public, provenance-signed release

#### Scenario: No release created

- **WHEN** a push to `main` does not result in a release (only the release PR is updated, or nothing changes)
- **THEN** the publish job does not run

#### Scenario: Trusted publisher not configured

- **WHEN** the npm Trusted Publisher for this repository/workflow is not configured (or OIDC is unavailable)
- **THEN** the publish step fails clearly without producing a partial or unauthenticated publish

### Requirement: Conventional Commit PR titles enforced

Because the repository squash-merges (the PR title becomes the commit subject Release Please consumes), the pipeline SHALL validate that pull request titles follow the Conventional Commits format using the allowed type list.

#### Scenario: Invalid PR title

- **WHEN** a pull request title does not match an allowed Conventional Commit type and subject pattern
- **THEN** the PR title check fails and reports the expected format

#### Scenario: Valid PR title

- **WHEN** a pull request title is a valid Conventional Commit (e.g. `feat: add door sensor`)
- **THEN** the PR title check passes

### Requirement: Version source of truth is the manifest

The released version SHALL be owned by Release Please via `.release-please-manifest.json` and the bumped `package.json`, seeded to the currently published version so the first automated run does not regress or duplicate a release.

#### Scenario: Pipeline introduced at current version

- **WHEN** the pipeline first runs on `main` with the manifest seeded to the already-published version
- **THEN** it does not propose re-releasing the current version and only proposes future bumps from new commits

### Requirement: PR-gating CI remains independent of releasing

The existing lint/build/test CI SHALL continue to run on pull requests and pushes as the merge gate, independent of the release workflow.

#### Scenario: PR opened

- **WHEN** a pull request is opened or updated
- **THEN** the CI workflow runs lint, build, and the test suite as a required-style check, separately from release automation

### Requirement: Documented release operating procedure

The repository SHALL document the one-time setup (Actions PR permissions, npm Trusted Publisher configuration, squash-merge configuration) and the day-to-day release flow so a maintainer can operate and reproduce releases.

#### Scenario: Maintainer sets up releasing

- **WHEN** a maintainer follows the documented setup
- **THEN** the required repo settings and secrets are enumerated, and the branch → PR → release-PR → publish flow is described
