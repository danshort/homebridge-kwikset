## Context

`release.yml`'s `npm-publish` job runs `npm ci` + `npm test` (and `prepublishOnly` would run lint+build) while holding `id-token: write` in the `release` environment — untrusted code with access to the OIDC publishing identity (GitHub #10). All third-party Actions are pinned to mutable tags (GitHub #11).

## Goals / Non-Goals

**Goals:** the privileged publish step executes no untrusted code; Action references are immutable. Same release outcome (Trusted Publishing + provenance).

**Non-Goals:** changing Trusted Publishing config; adding branch protection; configuring Dependabot (recommended, but a separate maintainer action).

## Decisions

### Decision: two-job split — unprivileged build/test, minimal privileged publish
A `build` job (no `id-token`, normal `contents: read`) runs `npm ci`, lint, build, test, and uploads `dist/` via `actions/upload-artifact`. The `npm-publish` job `needs: [release-please, build]`, holds `id-token: write` in `environment: release`, downloads the `dist/` artifact, and runs `npm publish --ignore-scripts`. `--ignore-scripts` skips `prepublishOnly` (so no lint/build/tsc runs in the privileged job) and any dependency lifecycle scripts. The package's `files` allowlist (`dist`, `homebridge-ui`, `config.schema.json`) is satisfied by the downloaded `dist` plus the checked-out source. **Alternative:** keep one job but `--ignore-scripts` — rejected; `npm ci`/`npm test` would still run untrusted code under the token. **Alternative:** OIDC token minted only at the publish step — not configurable at that granularity; job isolation is the lever GitHub gives us.

### Decision: still upgrade npm in the publish job
Trusted Publishing needs npm ≥ 11.5.1; `setup-node` (Node 20) ships npm 10. `npm install -g npm@latest` installs npm itself (first-party), which is acceptable trust in the privileged job. Provenance remains automatic under OIDC.

### Decision: pin all third-party Actions to SHAs
Resolve each `@vX` to its current commit SHA and pin `uses: owner/repo@<sha> # vX` across `release.yml`, `ci.yml`, `pr-title-lint.yml`. First-party `actions/*` are pinned too (cheap, uniform). Recommend enabling Dependabot (`github-actions`) to bump the pins; documented, not configured here.

## Risks / Trade-offs

- **SHA pins freeze patch updates** → mitigated by recommending Dependabot; worth it for a credential-minting workflow.
- **Artifact hand-off between jobs** → the unprivileged build job has no `id-token`, so even if it were compromised it can't exfiltrate the publishing identity; it only influences the published bytes, which is no worse than today.
- **`--ignore-scripts` skips `prepublishOnly`** → intentional; the build job already produced and tested `dist/`. The published tarball content is unchanged.

## Open Questions

- Add a Dependabot config in this PR, or leave to the maintainer? Leaning: leave it (out of the stated scope), but trivial to add if wanted.
