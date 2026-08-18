# Running the tests

Every gate CI enforces can be run locally, including the two that look like they
need a special machine (PHP line coverage, translation extraction). Nothing here
requires `sudo` or a global install.

## Prerequisites

| Tool | Version | Used by |
|---|---|---|
| Node | 20+ | build, Jest, Playwright, wp-env |
| PHP | 8.2+ | PHPCS, PHPStan, PHPUnit |
| Composer | 2 | PHP tooling |
| Docker | running daemon | wp-env (WordPress + MySQL), PHP coverage |

One-off setup:

```bash
npm ci                                   # never `npm install` — the lockfile is the audit surface
composer install
npx playwright install --with-deps chromium chromium-headless-shell
npx wp-env start                         # WordPress at localhost:8888, tests DB alongside it
```

`npm ci` also installs the pre-commit hook (husky). From then on every commit
runs ESLint on staged JS/TS and PHPCS on staged PHP, and fails the commit if
either complains.

## The suites

| Command | What it checks | Gate | Time |
|---|---|---|---|
| `npm run lint:js` | ESLint + Prettier + `jsx-a11y` | no errors | ~30s |
| `npx tsc --noEmit` | types across editor and frontend | no errors | ~10s |
| `composer run lint` | PHPCS (WordPress standard) | no errors | ~10s |
| `composer run stan` | PHPStan | no errors | ~15s |
| `npm run test:unit` | Jest — pure TS logic | — | ~3s |
| `npm run test:unit -- --coverage` | same, with the coverage gate | ≥80% lines | ~5s |
| `npm run test:php` | PHPUnit against wp-env | all pass | ~5s |
| `npm run test:php:coverage` | PHPUnit + line coverage | ≥85% lines | ~30s |
| `npm run test:e2e` | Playwright, 32 scenarios | all pass | ~9min |
| `npm run i18n:check` | committed `.pot` matches the source | no drift | ~20s |
| `npm run audit:npm` / `:production` | dependency advisories | see below | ~15s |
| `npm run audit:composer` | same for PHP tooling | 0 critical, 0 high | ~5s |

### Jest — pure TypeScript

Only pure functions are measured: block filtering, segment extraction and
resolution, segment hashing, dictionary application, RTF/ETA math, the storage
pre-check, the MP3 encoder, the voice catalogue, the WebAssembly detect, the
player state machine, time formatting. The list lives in `jest.config.js` under
`collectCoverageFrom`.

Glue — the worker wrapper, the React panel — is deliberately outside it. Mocking
ONNX Runtime and a Worker only produces a test that always passes; the risks
there are threading, `crossOriginIsolated` and timing, which only a real browser
exercises. That is what the E2E suite is for.

The segment pipeline's performance ceiling used to live here too, timed under
Jest. It moved to E2E — see "The segment pipeline ceiling" below — because
jsdom's `DOMParser` turned out to be most of what that test was measuring.

### PHPUnit

`npm run test:php` runs PHPUnit **on the host**, pointed at the WordPress
install and MySQL that wp-env provisions. That is deliberate: Docker Desktop's
file-sharing layer does not reliably propagate host edits into a running
container, so an in-container run can silently execute stale code and report
success on files that no longer exist.

Pass PHPUnit arguments through after `--`:

```bash
npm run test:php -- --filter Test_Post_Voice_Rest_Api
```

### PHP coverage

The host usually has no coverage driver and wp-env's image ships none, so
`npm run test:php:coverage` runs the suite in a throwaway `php:8.2-cli`
container with pcov, mounting this repository and wp-env's `tests-WordPress`,
joined to wp-env's own Docker network. The container image is built once and
reused.

It ends with the same threshold check CI runs, so a red run here is a red job
there.

Two things that will bite anyone editing that script:

- `--network host` does **not** reach wp-env's published MySQL port under Docker
  Desktop, where "host" means the Linux VM. Joining the compose network and
  addressing `tests-mysql:3306` works in both setups.
- Mounting a helper script from `/tmp` fails with `mounts denied`, because
  Docker Desktop only shares configured paths. The runner is passed via `sh -c`.

**Reading the number.** Each test class carries a `@covers` annotation, so
coverage is credited only to the class under test. Code that a test happens to
execute on the way through some other class counts for nothing. This keeps the
percentage honest, and it means a method exercised only indirectly — through the
REST endpoint, say — reads as uncovered until it gets a test of its own. That is
the tool working, not a bug to route around.

### E2E

Playwright drives a real browser against wp-env, so the build has to be current:

```bash
npm run build && npm run test:e2e
```

The 30 scenarios split in three. Eighteen are Fase 1's: happy path, no
`crossOriginIsolated`, cancel mid-generation, insufficient storage, regenerate
without orphans, axe with zero serious/critical violations in editor and
frontend, full keyboard operation of the player, `prefers-reduced-motion`, plus
regressions for stale badges, model caching, discarding a preview, voice
selection, URL uniqueness and double-click saves.

Eleven are Fase 2's, in `narration-fase2.spec.ts`: a block excluded in the
inspector, a second language with no room to download, an inline marked run
surviving a save as an Author (which is the only test of what `kses` does to
`data-pv-lang`, and so reads the post back over REST rather than trusting the
editor's own serialisation), a dictionary entry changing what is narrated,
editing the dictionary marking existing audio stale, a two-language post
producing one MP3, cancelling during a language warm-up, cancelling a
multi-segment generation then immediately regenerating, the pronunciation panel
opening on a browser without `crypto.randomUUID`, one bundle warm-up per
generation rather than one per code path, and one parse of the post per
debounced pass rather than one per keystroke — the last two count calls rather
than timing them, so they fail loudly instead of flaking.

Two more, in `narration-audio-quality.spec.ts`, are issue #5's audio-quality
fix: a long multi-sentence paragraph that spans several of the worker's
internal ~50-token chunks, and a single sentence past that limit with commas,
a colon, a parenthetical and a quoted phrase — the combination that used to
cut mid-word under a raw token boundary. Both are black-box like the rest of
this suite: they prove the pipeline completes without error on adversarial
input, not that the audio sounds better — that part is judged by ear and
reported in the PR, per the spec's decision not to chase an automated
prosody metric.

The thirty-second is the performance ceiling, in `segment-pipeline-perf.spec.ts`: a
64KB post through the whole text pipeline, median under 5ms and every sample
under 50ms. It lives here rather than in Jest because jsdom's `DOMParser` is a
JavaScript implementation and was consuming 86% of the budget on its own.

Most scenarios generate audio for real, which means downloading ~190MB of model
on the first run and 30-45s of synthesis each. Failure artifacts land in
`artifacts/`.

**The multi-language scenarios cost a second download.** Each language bundle is
its own ~190MB fetch, so the two-language scenario pays roughly twice the
first-run model cost of a single-language one — and it pays it again after any
`npx wp-env clean`, which drops the browser profile the bundles were cached in.
On a cold machine budget an extra 3-5 minutes for that scenario alone; on a warm
one it is cache-served and unremarkable. This is also why the storage pre-check
scenario asserts *before* the fetch: the only affordable way to test "no room
for a second bundle" is to never start it.

A single scenario, headed, with the inspector:

```bash
npx playwright test -g "double-click" --headed --debug
```

#### The segment pipeline ceiling

`e2e/segment-pipeline-perf.spec.ts` is the odd one out in this suite: pure
text, no model, no worker, no download. It runs the whole editor-side path —
`extractSegments` → `resolveSegments` → `mergeAdjacent` → `applyDictionary`
(200 terms) → `computeSegmentHash` — over a 120-block, ~61,000-character post,
30 times per run, and fails if any single run crosses **50 ms**. The editor
runs exactly this path on a debounced keystroke, so the number it protects is
typing latency.

It used to be a Jest test. jsdom's `DOMParser` is a pure-JS implementation far
slower than a browser's native one, and `extractSegments` was ~31 ms of that
test's ~36 ms — so it mostly measured the test environment, and its real
headroom (1.4x) was narrow enough to flake on a loaded runner. This scenario
times the same modules, built by the same bundler
(`e2e/fixtures/segment-pipeline-harness.ts`, entry `segment-pipeline-harness`
in `webpack.config.js`), loaded on a plain front-end page by
`e2e/mu-plugins/segment-pipeline-harness.php` — mapped into wp-env only by
`.wp-env.json`, so a production install of the plugin never enqueues it.

Measured across multiple 30-run sessions on the development machine: min
~1.2 ms, median ~1.9 ms, p95 ~5 ms, with occasional single-sample tails up to
~13 ms that are GC/scheduling noise rather than the pipeline. One ceiling
cannot serve both "catch a real regression" and "tolerate a GC pause", so the
test asserts two, per the 2026-08-15 amendment to the Fase 2 spec (see that
section for the full distribution and the reasoning):

- **`MEDIAN_CEILING_MS = 5`** — the regression net. The median is robust to the
  occasional tail, so a real regression (e.g. the 200-term dictionary regex
  recompiling on every call) moves it while noise does not.
- **`SAMPLE_CEILING_MS = 50`** — the design spec's original number, kept as an
  absolute cap on every single sample, to catch a catastrophic outlier a
  median would smooth over.

It is still a ceiling, not a benchmark: the console line each run prints
(`segment-pipeline-perf: min=… median=… mean=… max=… samples=[…]`) is what a
future recalibration should read, not this paragraph.

### Translations

`npm run i18n:check` regenerates the `.pot` into a scratch file and compares
translatable content — `msgid`, `msgid_plural`, `msgctxt` — against the
committed one. It is not a byte diff: `wp i18n make-pot` stamps a fresh
`POT-Creation-Date` on every run and records line numbers that move with any
edit, so a byte comparison would fail on unrelated commits and pass only by
luck.

When it reports drift, the fix is `npm run i18n:pot` and committing the result.

### Dependency audits

Both scripts count **distinct (advisory, vulnerable package) pairs**, not the
packages npm flags. npm's own metadata counts nodes of the dependency tree: one
unpatched advisory reaching six dependents reads as six problems, while three
advisories on a single package collapse into one. The pair is the unit Snyk
headlines as "issues" against a separate "vulnerable paths" figure, and the unit
Dependabot raises alerts in.

Thresholds: production (`--omit=dev`, what reaches an author's browser) allows
nothing critical or high. The full tree, which includes tooling that never
leaves a developer machine, allows 1 critical, 5 high, 10 moderate.

## When something behaves impossibly

**PHP changes have no effect in the browser.** The container is serving a stale
copy — Docker Desktop's file-sharing cache is keyed on inode, and editing in
place keeps the old contents visible inside the container. Run
`npm run refresh:php`, which rewrites each PHP file with a new inode and a new
mtime, the latter because PHP's opcache would otherwise keep the old compilation
regardless of the new bytes.

**An E2E generation scenario reports "No readable text found".** The post is
still an `auto-draft`, or its content arrived as a `core/freeform` block.
Scenarios must insert a real `core/paragraph` and save a draft first.

**A `getByRole( 'button', { name } )` matches two elements.** The editor's
document bar exposes a button whose accessible name is the post title. Use
`exact: true`, and avoid post titles that collide with control labels.

**The whole suite goes red at once, every scenario failing in under two
seconds.** Look for a duplicated accessible name before anything else. This has
happened: the per-block inspector panel was titled "Narration", the same as the
plugin sidebar's toggle, and Playwright's strict mode refused to guess between
them — 14 of 14 scenarios failed on the first `openNarrationPanel`, and stayed
red for five commits because nothing in between ran more than a `--grep`. The
panel is now "Narration for this block", and `e2e/open-narration-panel.ts`
locates the sidebar by `aria-controls` rather than by name so that a future
string collision cannot reproduce it. Note that this class of defect is
invisible to `narration-a11y.spec.ts`, which scopes axe to `.post-voice-panel`:
a name duplicated *across* the panel and the block inspector falls outside that
include. Run the full suite, never a `--grep`, before calling a task that
touched the browser done.

**A colour saved on the settings screen does not reach the reader.** Check the
page source for `<style id="post-voice-player-inline-css">`. Absent means the
value equals the shipped default (nothing is emitted, by design) or the
enqueue's asset-file guard bailed out because `npm run build` has not run.

**The preview pill floats over wp-admin.** `build/style-player-style-admin.css`
did not load. The real player is `position: fixed`; only the admin stylesheet
puts it back in the flow, and it is enqueued through the same guard as the
screen's script.

## What CI runs

`.github/workflows/ci.yml`, one job each: `lint` (ESLint, PHPCS, PHPStan),
`unit` (Jest with coverage, then PHPUnit with the 85% gate — pcov is requested
explicitly, since PHPUnit 9 emits an empty report rather than failing when no
driver is present), `i18n` (the `.pot` check), `e2e` (build, wp-env, Playwright,
artifacts uploaded on failure) and `audit`.
