## ADDED Requirements

### Requirement: Pinned third-party Actions

Every third-party GitHub Action used by the workflows SHALL be referenced by a full commit SHA (annotated with a human-readable version comment), not a mutable tag, so a repointed tag cannot inject code into a workflow — especially the privileged publish job.

#### Scenario: Action reference is immutable

- **WHEN** a workflow references a third-party Action
- **THEN** it pins the Action to a full commit SHA (with a `# vX` comment), not a floating tag

## MODIFIED Requirements

### Requirement: Automated npm publish gated on the release

When (and only when) a release is created, the pipeline SHALL publish the package to npm from CI using npm Trusted Publishing (GitHub OIDC, no stored token), publishing with public access and automatic provenance. The publish job SHALL run in the same workflow run as the release so it is not skipped by the default token not triggering downstream workflows. Build, lint, and tests SHALL run in a separate, unprivileged job (without `id-token`), and the privileged publish job SHALL consume that job's built artifact and run no untrusted code — it SHALL NOT run dependency lifecycle scripts, the test suite, or the project build while the OIDC token is available (`npm publish --ignore-scripts`).

#### Scenario: Release created

- **WHEN** the release job reports that a release was created
- **THEN** an unprivileged job builds and tests the package and uploads the built artifact, and a separate publish job (holding `id-token: write`) downloads it and runs `npm publish --ignore-scripts` authenticated via OIDC, producing a public, provenance-signed release

#### Scenario: Privileged job runs no untrusted code

- **WHEN** the publish job runs while holding `id-token: write`
- **THEN** it does not execute dependency install scripts, the test suite, or the project build (those ran earlier in the unprivileged build job)

#### Scenario: No release created

- **WHEN** a push to `main` does not result in a release (only the release PR is updated, or nothing changes)
- **THEN** neither the build job nor the publish job runs

#### Scenario: Trusted publisher not configured

- **WHEN** the npm Trusted Publisher for this repository/workflow is not configured (or OIDC is unavailable)
- **THEN** the publish step fails clearly without producing a partial or unauthenticated publish
