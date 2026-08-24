# Semantic Release Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every merge to `master` that passes CI automatically computes the next semantic version from Conventional Commits, bumps it in the 3 places it's hardcoded, tags it, publishes a GitHub Release, and attaches an installable plugin zip — with zero manual steps.

**Architecture:** Two decoupled GitHub Actions workflows. `release.yml` (Workflow A) runs semantic-release after `ci.yml` succeeds on `master`, computing the version, bumping files, and publishing a GitHub Release. `release-assets.yml` (Workflow B) reacts to that release being published, rebuilds the plugin in production mode, zips it against a `.distignore` allowlist, and uploads it as a release asset. Neither workflow knows about the other beyond the `release: published` event — swapping the version tool later only touches Workflow A.

**Tech Stack:** semantic-release (Node, `conventionalcommits` preset), GitHub Actions (`workflow_run`, `release`, `workflow_dispatch` triggers), rsync + zip for packaging, `gh release upload` for the asset.

**Spec:** [`docs/superpowers/specs/2026-08-23-semver-release-automation-design.md`](../specs/2026-08-23-semver-release-automation-design.md)

## Global Constraints

- Tag format: `vX.Y.Z` (e.g. `v0.1.0`).
- Version lives in exactly 3 files: `package.json` (`version`), `post-voice.php` (header `Version:` line + `POST_VOICE_VERSION` constant), `readme.txt` (`Stable tag:`). Nothing else — never touch `Requires at least:`/`Requires PHP` in either file (protected pins per `CLAUDE.md`).
- No `CHANGELOG.md` in the repo. No wordpress.org/SVN deploy. No pre-release/beta channel — `master` only.
- semantic-release's `.releaserc.json` declares `plugins` explicitly — never rely on its default plugin set (that default silently includes `@semantic-release/npm`, which would double-write `package.json`'s version).
- Workflow A authenticates as the PAT in secret `SEMANTIC_RELEASE_TOKEN` (not the default `GITHUB_TOKEN` — that token type never triggers downstream workflows, which would silently break Workflow B). Workflow B keeps the default `GITHUB_TOKEN` — nothing depends on what it triggers.
- Never bypass a git hook (`--no-verify`, `HUSKY=0`, etc.) to make an automated commit succeed — make the hook's dependencies available instead (`CLAUDE.md`: "Never skip the hooks").
- Don't commit to `master` directly and don't push anything not explicitly asked for — every task below that touches the remote repo (tags, secrets) is a checkpoint, not a default-yes action.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/build-plugin-zip.sh` (new) | Packages the working tree into `post-voice-<version>.zip`, respecting `.distignore`. Runnable locally and from Workflow B. |
| `.distignore` (new) | rsync exclude list: everything not needed to run the installed plugin. |
| `.gitignore` (modify) | Ignore `post-voice-*.zip` so a failed local smoke-test cleanup can't land a build artifact in a commit. |
| `scripts/bump-plugin-version.mjs` (new) | CLI: given a semver string, rewrites the version in the 3 hardcoded locations. Called by semantic-release's `exec` plugin. |
| `.releaserc.json` (new) | semantic-release config: explicit plugin pipeline, tag format, branch. |
| `.github/workflows/release.yml` (new) | Workflow A — computes version, bumps files, tags, publishes GitHub Release. |
| `.github/workflows/release-assets.yml` (new) | Workflow B — builds and uploads the zip to a published release. |
| `package.json` (modify) | New `devDependencies`: semantic-release + its plugins used above. |
| `TESTING.md` (modify) | New "Release pipeline" section documenting the dry-run and manual smoke-test commands. |

---

### Task 1: Bootstrap the `v0.1.0` tag

The whole pipeline computes the *next* version relative to the latest tag. With zero tags, semantic-release treats the repo as a first release and starts from `1.0.0`, silently jumping past the `0.1.0` already hardcoded in `package.json`/`post-voice.php`/`readme.txt`. This task creates the missing baseline before anything else in this plan can be verified end-to-end.

**Files:** none — this is a git tag, not a file change.

**Interfaces:**
- Produces: annotated tag `v0.1.0` on `origin/master`, pointing at current `master` HEAD.

- [ ] **Step 1: Confirm no tags exist yet and record current `master` HEAD**

```bash
git fetch origin --tags
git tag -l
git rev-parse origin/master
```

Expected: `git tag -l` prints nothing. Note the SHA `git rev-parse` prints — that's what gets tagged.

- [ ] **Step 2: Create the annotated tag on that commit**

```bash
git tag -a v0.1.0 -m "Baseline tag for automated releases — matches the version already in package.json, post-voice.php, and readme.txt" "$(git rev-parse origin/master)"
```

- [ ] **Step 3: Verify the tag points at the right commit and message**

```bash
git show v0.1.0 --no-patch
```

Expected: shows the tag message from Step 2 and a commit matching `origin/master`'s current tip.

- [ ] **Step 4: Push the tag — checkpoint, confirm with the user first**

This is outward-facing (visible on GitHub immediately). Confirm before running:

```bash
git push origin v0.1.0
```

- [ ] **Step 5: Verify on GitHub**

```bash
gh api repos/luigi-moretti/post-voice/git/refs/tags/v0.1.0
```

Expected: JSON with `"ref": "refs/tags/v0.1.0"` and an `object.sha` matching Step 1's SHA.

---

### Task 2: `.distignore` and the zip-packaging script

**Files:**
- Create: `.distignore`
- Create: `scripts/build-plugin-zip.sh`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `scripts/build-plugin-zip.sh <version>` — writes `post-voice-<version>.zip` to the repo root, exit 0 on success, exit 1 with a usage message if `<version>` is missing.
- Consumed by: Task 6 (`release-assets.yml`).

- [ ] **Step 1: Write `.distignore`**

```
# Packaging exclude list, read by scripts/build-plugin-zip.sh. rsync
# --exclude-from syntax: a bare name (no leading slash) matches a
# directory of that name anywhere in the tree; trailing slash means
# "directory only". Philosophy: ship only what WordPress needs to run
# the installed plugin — php source, compiled build/ output, readme,
# license. Everything dev/build/test-tooling stays out.

node_modules/
vendor/
coverage/
artifacts/
test-results/
playwright-report/
e2e/
docs/
.github/
.claude/
.superpowers/
.husky/
.git/
scripts/
types/

tests/
editor/
frontend/
admin/

package.json
package-lock.json
composer.json
composer.lock
webpack.config.js
tsconfig.json
phpstan.neon
phpcs.xml.dist
phpunit.xml.dist
jest.config.js
playwright.config.ts
.eslintrc.js
.prettierrc.js
.prettierignore
.wp-env.json
.phpunit.result.cache
.releaserc.json
CLAUDE.md
TESTING.md
.distignore
.gitignore
*.log
.DS_Store
```

- [ ] **Step 2: Write `scripts/build-plugin-zip.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Builds the installable plugin zip from the current working tree,
# respecting .distignore. Called by .github/workflows/release-assets.yml
# right after `npm run build`; also runnable locally for a smoke test.
#
# Usage: scripts/build-plugin-zip.sh <version>
# Output: post-voice-<version>.zip in the repo root.

if [ $# -ne 1 ]; then
	echo "usage: $0 <version>" >&2
	exit 1
fi

VERSION="$1"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE_DIR="$(mktemp -d)"
PLUGIN_DIR="${STAGE_DIR}/post-voice"

mkdir -p "${PLUGIN_DIR}"

rsync -a --exclude-from="${REPO_ROOT}/.distignore" "${REPO_ROOT}/" "${PLUGIN_DIR}/"

ZIP_NAME="post-voice-${VERSION}.zip"
( cd "${STAGE_DIR}" && zip -rq "${REPO_ROOT}/${ZIP_NAME}" post-voice )

rm -rf "${STAGE_DIR}"

echo "built ${ZIP_NAME}"
```

- [ ] **Step 3: Make it executable**

```bash
chmod +x scripts/build-plugin-zip.sh
```

- [ ] **Step 4: Syntax-check the script**

```bash
bash -n scripts/build-plugin-zip.sh
```

Expected: no output, exit 0.

- [ ] **Step 5: Build a real production bundle, then smoke-test the packaging**

```bash
npm run build
scripts/build-plugin-zip.sh 9.9.9-smoketest
unzip -l post-voice-9.9.9-smoketest.zip | head -50
```

Expected: listing includes `post-voice/post-voice.php`, `post-voice/readme.txt`, `post-voice/build/narration-editor.js` (and the other 3 build entries), `post-voice/features/narration/php/...`. Must NOT include anything under `post-voice/node_modules/`, `post-voice/vendor/`, `post-voice/scripts/`, or any `tests/`/`editor/`/`frontend/`/`admin/` directory.

- [ ] **Step 6: Clean up the smoke-test artifact**

```bash
rm post-voice-9.9.9-smoketest.zip
```

- [ ] **Step 7: Ignore packaged zips so a failed cleanup never lands one in a commit**

Add to `.gitignore` (anywhere in the file; the existing "Build output" section fits):

```
post-voice-*.zip
```

- [ ] **Step 8: Commit**

```bash
git add .distignore .gitignore scripts/build-plugin-zip.sh
git commit -m "feat: add plugin zip packaging script"
```

---

### Task 3: `scripts/bump-plugin-version.mjs`

**Files:**
- Create: `scripts/bump-plugin-version.mjs`

**Interfaces:**
- Produces: `node scripts/bump-plugin-version.mjs <version>` — run from a directory containing `package.json`, `post-voice.php`, `readme.txt`; rewrites the version in all 3 in place. Exits 1 with an error on stderr if `<version>` isn't a bare `X.Y.Z`, or if any target line isn't found (never silently no-ops).
- Consumed by: Task 4 (`.releaserc.json`'s `exec` plugin `prepareCmd`).

- [ ] **Step 1: Write the script**

```javascript
#!/usr/bin/env node
// scripts/bump-plugin-version.mjs
//
// Rewrites the plugin's 3 hardcoded version locations to a new semver
// string. Called by semantic-release's exec plugin `prepare` step with
// the computed next version (see .releaserc.json). Regex-targeted,
// single-purpose: touches exactly the 3 lines below and nothing else —
// must never match `Requires at least:`/`Requires PHP` in
// post-voice.php or readme.txt (protected pins, see CLAUDE.md).
//
// Usage: node scripts/bump-plugin-version.mjs <version>

import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
	console.error(
		`bump-plugin-version: expected a semver like 1.2.3, got ${JSON.stringify(version)}`
	);
	process.exit(1);
}

function replaceOrThrow(path, pattern, replacement) {
	const original = readFileSync(path, 'utf8');
	if (!pattern.test(original)) {
		throw new Error(`bump-plugin-version: pattern not found in ${path}: ${pattern}`);
	}
	const updated = original.replace(pattern, replacement);
	writeFileSync(path, updated);
}

replaceOrThrow('package.json', /"version":\s*"\d+\.\d+\.\d+"/, `"version": "${version}"`);

replaceOrThrow(
	'post-voice.php',
	/^ \* Version: \d+\.\d+\.\d+$/m,
	` * Version: ${version}`
);
replaceOrThrow(
	'post-voice.php',
	/define\( 'POST_VOICE_VERSION', '\d+\.\d+\.\d+' \);/,
	`define( 'POST_VOICE_VERSION', '${version}' );`
);

replaceOrThrow('readme.txt', /^Stable tag: \d+\.\d+\.\d+$/m, `Stable tag: ${version}`);

console.log(`bump-plugin-version: bumped to ${version}`);
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/bump-plugin-version.mjs
```

- [ ] **Step 3: Smoke-test against scratch copies — verify it bumps correctly**

```bash
SCRATCH="$(mktemp -d)"
cp package.json post-voice.php readme.txt "$SCRATCH/"
( cd "$SCRATCH" && node "$OLDPWD/scripts/bump-plugin-version.mjs" 9.9.9 )
grep '"version"' "$SCRATCH/package.json"
grep -E 'Version:|POST_VOICE_VERSION' "$SCRATCH/post-voice.php"
grep 'Stable tag:' "$SCRATCH/readme.txt"
```

Expected: all three print `9.9.9` in place of `0.1.0`.

- [ ] **Step 4: Verify the guardrail — protected pins untouched**

```bash
diff <(grep -E 'Requires at least|Requires PHP' post-voice.php) \
     <(grep -E 'Requires at least|Requires PHP' "$SCRATCH/post-voice.php")
diff <(grep -E 'Requires at least|Requires PHP' readme.txt) \
     <(grep -E 'Requires at least|Requires PHP' "$SCRATCH/readme.txt")
```

Expected: no output from either `diff` — those lines are byte-identical before and after.

- [ ] **Step 5: Verify the failure path — bad input is rejected loudly**

```bash
( cd "$SCRATCH" && node "$OLDPWD/scripts/bump-plugin-version.mjs" not-a-version ; echo "exit=$?" )
```

Expected: prints the `expected a semver like 1.2.3` error to stderr and `exit=1`.

- [ ] **Step 6: Clean up**

```bash
rm -rf "$SCRATCH"
```

- [ ] **Step 7: Commit**

```bash
git add scripts/bump-plugin-version.mjs
git commit -m "feat: add plugin version bump script"
```

---

### Task 4: semantic-release config and dependencies

**Files:**
- Create: `.releaserc.json`
- Modify: `package.json` (new `devDependencies`)
- Modify: `package-lock.json` (regenerated by `npm install`)

**Interfaces:**
- Consumes: `scripts/bump-plugin-version.mjs <version>` (Task 3).
- Produces: `.releaserc.json`, readable by `npx semantic-release` in Task 5.

- [ ] **Step 1: Install the dependencies**

```bash
npm install --save-dev semantic-release \
  @semantic-release/commit-analyzer \
  @semantic-release/release-notes-generator \
  @semantic-release/exec \
  @semantic-release/git \
  @semantic-release/github \
  conventional-changelog-conventionalcommits
```

- [ ] **Step 2: Write `.releaserc.json`**

```json
{
	"branches": ["master"],
	"tagFormat": "v${version}",
	"plugins": [
		[
			"@semantic-release/commit-analyzer",
			{
				"preset": "conventionalcommits"
			}
		],
		[
			"@semantic-release/release-notes-generator",
			{
				"preset": "conventionalcommits"
			}
		],
		[
			"@semantic-release/exec",
			{
				"prepareCmd": "node scripts/bump-plugin-version.mjs ${nextRelease.version}"
			}
		],
		[
			"@semantic-release/git",
			{
				"assets": ["package.json", "post-voice.php", "readme.txt"],
				"message": "chore(release): ${nextRelease.version} [skip ci]"
			}
		],
		"@semantic-release/github"
	]
}
```

- [ ] **Step 3: Verify it parses and the plugin list is exactly what's expected**

```bash
node -e "const c = require('./.releaserc.json'); console.log(JSON.stringify(c.plugins.map(p => Array.isArray(p) ? p[0] : p)))"
```

Expected:
```
["@semantic-release/commit-analyzer","@semantic-release/release-notes-generator","@semantic-release/exec","@semantic-release/git","@semantic-release/github"]
```

No `@semantic-release/npm` in that list — that's the point of declaring `plugins` explicitly (Global Constraints).

- [ ] **Step 4: Dry-run against the real repo (safe — dry-run skips the `prepare`/`publish` steps that would mutate files or tag anything)**

Requires Task 1's `v0.1.0` tag to already be pushed, and a GitHub token with at least read access to the repo (the local `gh` CLI login is enough for this check — it does not need the `SEMANTIC_RELEASE_TOKEN` secret, which only matters inside Workflow A).

This runs from `feat/semver-release-automation`, not `master` — `.releaserc.json` restricts releases to `branches: ["master"]`, and without an override semantic-release just logs that this branch isn't a release branch and exits without analyzing anything. `--branches` overrides that check for this one invocation only (it doesn't touch the file):

```bash
GH_TOKEN="$(gh auth token)" npx semantic-release --dry-run --branches "$(git branch --show-current)"
```

Expected: log lines ending in something like `The next release version is 0.1.1` (or `0.2.0`, depending on whether any `feat:` commits landed since `v0.1.0` — check with `git log v0.1.0..HEAD --oneline`). No error about missing tags, no attempt to push or create a release.

- [ ] **Step 5: Commit**

```bash
git add .releaserc.json package.json package-lock.json
git commit -m "feat: configure semantic-release"
```

---

### Task 5: Workflow A — `release.yml`

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `.releaserc.json` and the `devDependencies` from Task 4; `scripts/bump-plugin-version.mjs` from Task 3 (invoked indirectly via the `exec` plugin); secret `SEMANTIC_RELEASE_TOKEN` (provisioned in Task 7).
- Produces: on a successful run, a git tag `vX.Y.Z` on `master`, a `chore(release): ...` commit on `master`, and a published GitHub Release — which is what Workflow B (Task 6) reacts to.

- [ ] **Step 1: Write `.github/workflows/release.yml`**

```yaml
name: Release

on:
  workflow_run:
    workflows: ["CI"]
    types: [completed]
    branches: [master]

concurrency:
  group: release-master
  cancel-in-progress: false

jobs:
  release:
    if: github.event.workflow_run.conclusion == 'success'
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      # token: here (not just GH_TOKEN as env on the semantic-release step
      # below) matters: this is what configures git's credential helper
      # for the whole job. @semantic-release/git's `git push` rides on
      # that helper, not on the env var — checkout with the default token
      # would silently push the release commit authenticated as
      # GITHUB_TOKEN, reintroducing the exact "doesn't trigger downstream
      # workflows" bug the PAT exists to avoid.
      #
      # ref: head_sha (not `master`) pins this run to the exact commit
      # workflow_run says passed CI. Master can move between CI finishing
      # and this job starting; if it has, the push below fails
      # (non-fast-forward) instead of releasing an unvalidated commit.
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.SEMANTIC_RELEASE_TOKEN }}
          ref: ${{ github.event.workflow_run.head_sha }}
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci

      # composer install matters here for a reason that has nothing to
      # do with PHP tests: @semantic-release/git commits the 3 bumped
      # files through a real `git commit`, which fires
      # .husky/pre-commit -> lint-staged -> `./vendor/bin/phpcs` on
      # post-voice.php. Without vendor/ present that hook fails and the
      # whole release aborts — this step is what lets the commit
      # succeed without bypassing the hook (CLAUDE.md: never skip
      # hooks).
      - uses: shivammathur/setup-php@v2
        with: { php-version: '8.2', tools: composer }
      - run: composer install

      - name: Configure git identity for the release commit
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"

      - run: npx semantic-release
        env:
          GH_TOKEN: ${{ secrets.SEMANTIC_RELEASE_TOKEN }}
```

- [ ] **Step 2: Validate YAML syntax**

```bash
node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/release.yml', 'utf8')); console.log('ok')"
```

Expected: `ok`.

- [ ] **Step 3: Cross-check against ci.yml's workflow name**

```bash
grep -n "^name:" .github/workflows/ci.yml
```

Expected: `name: CI` — must match the `workflows: ["CI"]` string in Step 1 exactly, or `workflow_run` will never fire.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "feat: add release.yml — semantic-release on green CI on master"
```

---

### Task 6: Workflow B — `release-assets.yml`

**Files:**
- Create: `.github/workflows/release-assets.yml`

**Interfaces:**
- Consumes: `scripts/build-plugin-zip.sh <version>` (Task 2); triggered by the `release: published` event Task 5 produces, or manually via `workflow_dispatch`.
- Produces: the release's zip asset, uploaded via `gh release upload`.

- [ ] **Step 1: Write `.github/workflows/release-assets.yml`**

```yaml
name: Release Assets

on:
  release:
    types: [published]
  workflow_dispatch:
    inputs:
      tag:
        description: 'Release tag to (re)build the zip for, e.g. v1.2.3'
        required: true

permissions:
  contents: write

jobs:
  build-zip:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.release.tag_name || inputs.tag }}

      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run build

      - name: Resolve version from tag
        id: version
        run: |
          TAG="${{ github.event.release.tag_name || inputs.tag }}"
          echo "version=${TAG#v}" >> "$GITHUB_OUTPUT"

      - run: scripts/build-plugin-zip.sh "${{ steps.version.outputs.version }}"

      - name: Upload zip to the release
        run: gh release upload "${{ github.event.release.tag_name || inputs.tag }}" "post-voice-${{ steps.version.outputs.version }}.zip"
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Validate YAML syntax**

```bash
node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/release-assets.yml', 'utf8')); console.log('ok')"
```

Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release-assets.yml
git commit -m "feat: add release-assets.yml — build and attach the plugin zip"
```

---

### Task 7: Provision the `SEMANTIC_RELEASE_TOKEN` secret

Human checkpoint — a fine-grained PAT is an account-level credential; the agent cannot create it. This task is a checklist for you (or whoever has repo admin) to hand back once done.

**Files:** none.

**Interfaces:**
- Produces: repo secret `SEMANTIC_RELEASE_TOKEN`, consumed by Task 5's workflow at runtime.

- [ ] **Step 1: Create the fine-grained PAT**

GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token.
- Repository access: **Only select repositories** → `luigi-moretti/post-voice`.
- Permissions: **Contents: Read and write**. Nothing else needed.
- Expiration: your call — shorter is safer, but remember Task 8's TESTING.md note documents what breaks (and how you'll notice) when it lapses.

- [ ] **Step 2: Add it as a repo secret**

Repo → Settings → Secrets and variables → Actions → New repository secret.
- Name: `SEMANTIC_RELEASE_TOKEN` (must match exactly — `release.yml` references this name).
- Value: the token from Step 1.

- [ ] **Step 3: Confirm it's there (value stays hidden, name is visible)**

```bash
gh secret list --repo luigi-moretti/post-voice
```

Expected: `SEMANTIC_RELEASE_TOKEN` in the list.

---

### Task 8: Document the release pipeline in `TESTING.md`

**Files:**
- Modify: `TESTING.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Read the current end of the file to place the new section correctly**

```bash
tail -20 TESTING.md
```

- [ ] **Step 2: Add a "Release pipeline" section**

Insert before `## What CI runs` (or at the file's end if that heading has moved), matching the file's existing heading style. Heading and prose:

```
## Release pipeline

Not a gate you run before opening a PR — this runs automatically after a
PR merges to `master`, once `ci.yml` is green. Full design:
`docs/superpowers/specs/2026-08-23-semver-release-automation-design.md`.

To check what the next version *would* be without publishing anything:
```

Then this command, in its own fenced block:

```bash
GH_TOKEN="$(gh auth token)" npx semantic-release --dry-run
```

Then this closing prose:

```
To rebuild and re-attach a release's zip without re-running
semantic-release (e.g. Workflow B failed after Workflow A already
tagged): Actions tab → "Release Assets" → "Run workflow" → paste the
tag (e.g. `v1.2.3`).

If `release.yml` fails with an authentication error, `SEMANTIC_RELEASE_TOKEN`
(a fine-grained PAT, Settings → Secrets and variables → Actions) has
likely expired — regenerate it and update the secret.
```

- [ ] **Step 3: Commit**

```bash
git add TESTING.md
git commit -m "docs: document the release pipeline in TESTING.md"
```

---

## After this plan

This branch's own merge to `master` is the first real trigger of the
pipeline it builds — there's no way to exercise `release.yml`'s
`workflow_run` end-to-end before that (it depends on `ci.yml` and
`release.yml` both already existing on `master`). Once merged, watch the
first `master` push's Actions run: `ci.yml` → `release.yml` → a
`v0.1.1`/`v0.2.0` release → `release-assets.yml` attaching the zip. That
live run is the spec's own "Testing / verificação" checklist closing
out — not a task here, since opening/merging that PR is a separate,
explicit user decision (`CLAUDE.md`: PR only opens if asked).

Before that PR: run the full local CI checklist and the code-review
skill per `CLAUDE.md`'s "Before opening a pull request" section — this
plan's tasks don't replace that gate.
