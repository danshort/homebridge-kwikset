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
2. **npm token** — create an **Automation** access token at npmjs.com (granular token with publish rights to `homebridge-kwikset` also works), then add it as a repository secret named **`NPM_TOKEN`** (*Settings → Secrets and variables → Actions*).
3. **Squash merge** — *Settings → General → Pull Requests*:
   - Enable **Allow squash merging**, and set the default squash commit message to **"Pull request title and description"** so PR titles drive Release Please.
   - Merge commits are disabled to keep history linear, and merged branches are auto-deleted.

   > These repo settings (Actions permissions + squash config) are already applied. The remaining step is the `NPM_TOKEN` secret above.

The publish workflow requires a public repository for npm **provenance** (this repo is public) and `id-token: write` on the publish job (already set in `release.yml`).
