# Project rules — Post Voice

WordPress plugin that generates spoken narration for posts entirely in the
author's browser (Pocket TTS via ONNX in a Web Worker). PHP only orchestrates:
it stores the finished audio as an attachment and records post meta. No TTS ever
runs on the server.

Documents of record, in this order:

- `docs/adr/` — the architecture decisions, and what constrains new code. The
  front-matter is the configuration for `npm run lint:arch`, which blocks CI;
  `docs/adr/README.md` is the index; the `adr` skill is the procedure for
  opening or changing one. `npm run doctor` reports health without blocking.
- `docs/superpowers/specs/2026-08-08-wp-narration-plugin-mvp-design.md` — what is
  decided and why. Amend it (dated section, with the reasoning) rather than
  letting code and spec disagree.
- `docs/superpowers/plans/2026-08-11-post-voice-fase1-implementation-plan.md` —
  tasks, plus numbered revisions recording every defect execution found.
- `TESTING.md` — how to run every gate.

Path-scoped conventions live in `.claude/rules/` and load when you open a file
they cover. This file carries only what must never be forgotten.

## Before opening a pull request

**Mandatory, in this order. No PR until all of it is green.** wp-env must be
running (`npx wp-env start`). Ordered cheap-to-expensive so it fails fast:

```bash
npm run lint:js && npm run lint:arch
npx tsc --noEmit
composer run lint && composer run stan
npm run test:unit -- --coverage
npm run test:php && npm run test:php:coverage
npm run i18n:check
npm run audit:npm:production && npm run audit:npm && npm run audit:composer
npm run build && npm run test:e2e    # downloads the model on first run
```

This is the same set `.github/workflows/ci.yml` runs; `TESTING.md` has the
thresholds and the timings. Running it locally first is not politeness — CI here
needs Docker, a WordPress install and a ~190MB model download, so a red job
costs far more than a red terminal.

**If anything fails, stop and present correction plans.** Do not open the PR, do
not disable the check, do not lower a threshold to make it pass. Report what
failed with the actual output; the root cause, established rather than guessed;
two or three ways to fix it, each with its cost and risk; and a recommendation.
Then wait for the decision. A gate or a threshold is only changed when the user
chooses that explicitly, and the reasoning goes into the spec.

**If everything passes**, run `npm run doctor` and act on what it shows, then
invoke `superpowers:requesting-code-review`, which dispatches a reviewer
subagent against the branch's diff. Address what it finds — or explain why a
finding does not apply — before the PR exists.

**Only then open the PR, and only if the user asked for one.** Opening a PR is
an outward-facing action; it is never done unprompted.

## Conventions

- Layout is feature-based, `features/<feature>/{php,editor,frontend,tests}/`;
  code moves to `shared/` at the second real consumer (ADR-0004, ADR-0005).
- The server never synthesizes speech, transcodes audio, or recomputes what the
  client already computed (ADR-0002, ADR-0008, ADR-0009).
- PHP classes: prefix `Post_Voice_`, one per file, `class-*.php` — there is no
  autoloader, so the name is how the file is found (ADR-0006).
- REST is namespaced `post-voice/v1`, and every value an endpoint accepts is
  validated server-side even when the UI already constrains it (ADR-0007).
- Every user-facing string goes through gettext with the domain `post-voice` (ADR-0010).
- Worker, ONNX or a real browser means an E2E scenario, never a mock; pure
  TypeScript means Jest (ADR-0012).
- A new ADR never touches this file (ADR-0001).

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
