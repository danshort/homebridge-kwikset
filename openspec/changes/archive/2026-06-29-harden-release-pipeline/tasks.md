## 1. Split the release workflow (release.yml)

- [x] 1.1 Add an unprivileged `build` job (no `id-token`): `npm ci`, lint, build, test; upload `dist/` artifact
- [x] 1.2 Rework `npm-publish`: `needs: [release-please, build]`, gated on `release_created`, `id-token: write` + `environment: release`; download the `dist/` artifact
- [x] 1.3 Publish with `npm publish --ignore-scripts` (no prepublishOnly/test/deps execute under the token); keep the npm upgrade for OIDC

## 2. Pin Actions to SHAs

- [x] 2.1 `release.yml`: pin release-please-action, checkout, setup-node, upload/download-artifact to SHAs (with `# vX` comments)
- [x] 2.2 `ci.yml`: pin checkout + setup-node to SHAs
- [x] 2.3 `pr-title-lint.yml`: pin action-semantic-pull-request to a SHA

## 3. Verify & ship

- [x] 3.1 Validate all workflow YAML; confirm the job graph (publish needs build, gated, id-token only on publish) and that pinned SHAs resolve to real commits
- [x] 3.2 Adversarial review panel scoped to the workflows; address findings
- [x] 3.3 Archive (sync spec) and open the stacked PR (no merge)
