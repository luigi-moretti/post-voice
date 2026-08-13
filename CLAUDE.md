# Project rules — Post Voice

WordPress plugin that generates spoken narration for posts entirely in the
author's browser (Pocket TTS via ONNX in a Web Worker). PHP only orchestrates:
it stores the finished audio as an attachment and records post meta. No TTS ever
runs on the server.

Documents of record, in this order:

- `docs/superpowers/specs/2026-08-08-wp-narration-plugin-mvp-design.md` — what is
  decided and why. Amend it (dated section, with the reasoning) rather than
  letting code and spec disagree.
- `docs/superpowers/plans/2026-08-11-post-voice-fase1-implementation-plan.md` —
  tasks, plus numbered revisions recording every defect execution found.
- `TESTING.md` — how to run every gate.

## Before opening a pull request

**Mandatory, in this order. No PR until all of it is green.**

**1. Run the full CI locally.** wp-env must be running (`npx wp-env start`).
Ordered cheap-to-expensive so it fails fast:

```bash
npm run lint:js
npx tsc --noEmit
composer run lint
composer run stan
npm run test:unit -- --coverage      # gate: 80% lines
npm run test:php
npm run test:php:coverage            # gate: 85% lines
npm run i18n:check
npm run audit:npm:production && npm run audit:npm && npm run audit:composer
npm run build && npm run test:e2e    # ~9 min, downloads the model on first run
```

This is the same set `.github/workflows/ci.yml` runs. Running it locally first is
not politeness — CI here needs Docker, a WordPress install and a ~190MB model
download, so a red job costs far more than a red terminal.

**2. If anything fails: stop and present correction plans.** Do not open the PR,
do not disable the check, do not lower a threshold to make it pass. Report:

- what failed, with the actual output;
- the root cause, established rather than guessed;
- two or three ways to fix it, each with its cost and what it risks;
- a recommendation.

Then wait for the decision. A threshold or a gate is only changed when the user
chooses that explicitly, and the reasoning goes into the spec.

**3. If everything passes: run the code review skill.** Invoke
`superpowers:requesting-code-review`, which dispatches a reviewer subagent
against the branch's diff. Address what it finds — or explain why a finding does
not apply — before the PR exists.

**4. Only then open the PR, and only if the user asked for one.** Opening a PR is
an outward-facing action; it is never done unprompted.

## Conventions

- **Layout is feature-based**: `features/<feature>/{php,editor,frontend,tests}/`.
  Shared code moves to `shared/` only when a second feature actually needs it.
- **PHP**: class prefix `Post_Voice_`, one class per file, `class-*.php`, WPCS
  clean, PHP 8.2+, WordPress 6.6+.
- **REST**: namespace `post-voice/v1`. Every value the endpoint accepts is
  validated server-side even when the UI already constrains it — a disabled
  control is UX, not a guarantee.
- **i18n**: every user-facing string through `__()`/`_x()` with text domain
  `post-voice`. The one deliberate exception is `SAMPLE_TEXTS` in
  `voice-catalog.ts`: gettext follows the admin locale, but those phrases feed a
  speech model whose language is the chosen bundle. Regenerate the `.pot`
  (`npm run i18n:pot`) whenever strings change; `npm run i18n:check` enforces it.
- **Tests**: pure TypeScript gets Jest; PHP gets PHPUnit with a `@covers`
  annotation per test class; anything involving the Worker, ONNX or a real
  browser gets an E2E scenario instead of a mock.
- **Dependencies**: `npm ci`, never `npm install`, in CI and in scripts — the
  lockfile is the audit surface.

## Gotchas that have already cost a session each

- **PHP edits not taking effect in the browser**: the container serves a stale
  copy (Docker Desktop's file-sharing cache is keyed on inode, and opcache keeps
  the old compilation). Run `npm run refresh:php`.
- **Coverage that looks wrong**: `@covers` credits only the class under test.
  Code reached through another class reads as uncovered, by design.
- **`npm audit` numbers**: `audit-check.mjs` counts distinct (advisory, package)
  pairs, not npm's per-node count. Read the printed issue list, not the raw npm
  total.
- **The Bash tool's working directory persists between calls.** A `cd` in one
  command still applies in the next, which has already turned a relative `mv`
  into a lost file. Prefer absolute paths for anything destructive.

## Never

- Skip the hooks (`--no-verify`) or weaken a gate to get a commit through.
- Commit to `master`, or push anything the user did not ask to be pushed.
- Change `contract`-like pins — `MODEL_BASE_URL`'s commit SHA, the WordPress and
  PHP minimums — as a side effect of unrelated work. Those are deliberate, and
  moving them is its own change with its own testing.
