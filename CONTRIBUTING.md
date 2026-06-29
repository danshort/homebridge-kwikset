# Contributing

## Development

```bash
npm install
npm run build      # compile TypeScript to dist/
npm test           # vitest unit suite
npm run lint
```

## Branching & PRs

- Work on a branch; open a pull request into `main`.
- The repo **squash-merges**, so the **PR title becomes the commit on `main`**.
- PR titles **must be [Conventional Commits](https://www.conventionalcommits.org/)** — enforced by the *PR Title* check. Examples:
  - `feat: add door-position contact sensor`
  - `fix: handle Jammed status from the keypad`
  - `docs: clarify child-bridge setup`
- `feat:` → minor bump, `fix:` → patch bump. `docs:`/`chore:`/`ci:`/etc. land on `main` but do **not** trigger a release on their own.
- The *CI* check (lint + build + tests) must pass before merge.

## How releases work (automated)

Releases use [Release Please](https://github.com/googleapis/release-please-action). You never hand-edit the version or tag.

```
branch → Conventional-Commit PR → squash-merge to main
      → Release Please opens/updates a "release PR" (version bump + CHANGELOG)
      → merge the release PR
      → tag + GitHub Release created
      → CI publishes to npm (with provenance)
```

1. Merge feature/fix PRs to `main` as usual.
2. Release Please maintains a **release PR** titled like `chore(main): release x.y.z` that accumulates the next version and `CHANGELOG.md`.
3. When you're ready to ship, **merge the release PR**. That creates the tag + GitHub Release and — in the same workflow run — publishes to npm.

> The publish job is gated on the release being created and runs in the same workflow run as Release Please, because a tag/release made by the default `GITHUB_TOKEN` does not trigger a separate workflow.

## One-time repository setup

These must be configured once (in **Settings**) before the pipeline can publish:

1. **Actions permissions** — *Settings → Actions → General → Workflow permissions*:
   - Select **Read and write permissions**.
   - Enable **Allow GitHub Actions to create and approve pull requests** (Release Please opens the release PR).
2. **npm Trusted Publishing** — on [npmjs.com](https://www.npmjs.com/package/homebridge-kwikset), open the **homebridge-kwikset** package → **Settings → Trusted Publishing** → add a **GitHub Actions** publisher:
   - Repository owner / repo: `danshort/homebridge-kwikset`
   - Workflow filename: `release.yml`
   - Environment name: `release` (matches the `environment: release` on the publish job; the GitHub environment already exists)

   No token or secret is stored — CI authenticates via GitHub OIDC and short-lived credentials, and you can **keep 2FA enabled**. (npm now steers automation away from long-lived automation tokens toward Trusted Publishing.)
3. **Squash merge** — *Settings → General → Pull Requests*:
   - Enable **Allow squash merging**, and set the default squash commit message to **"Pull request title and description"** so PR titles drive Release Please.
   - Merge commits are disabled to keep history linear, and merged branches are auto-deleted.

   > The repo settings (Actions permissions + squash config) are already applied. The remaining step is configuring the **Trusted Publisher** on npm (step 2).

Trusted Publishing (and the automatic **provenance** attestation) requires a public repository — this repo is public — and `id-token: write` on the publish job, which is already set in `release.yml`.
