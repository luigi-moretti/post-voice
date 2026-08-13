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
| `npm run test:e2e` | Playwright, 16 scenarios | all pass | ~9min |
| `npm run i18n:check` | committed `.pot` matches the source | no drift | ~20s |
| `npm run audit:npm` / `:production` | dependency advisories | see below | ~15s |
| `npm run audit:composer` | same for PHP tooling | 0 critical, 0 high | ~5s |

### Jest — pure TypeScript

Only pure functions are measured: block filtering, source hashing, RTF/ETA math,
the storage pre-check, the MP3 encoder, the voice catalogue, the WebAssembly
detect, the player state machine, time formatting. The list lives in
`jest.config.js` under `collectCoverageFrom`.

Glue — the worker wrapper, the React panel — is deliberately outside it. Mocking
ONNX Runtime and a Worker only produces a test that always passes; the risks
there are threading, `crossOriginIsolated` and timing, which only a real browser
exercises. That is what the E2E suite is for.

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

The 16 scenarios cover the eight the spec requires — happy path, no
`crossOriginIsolated`, cancel mid-generation, insufficient storage, regenerate
without orphans, axe with zero serious/critical violations in editor and
frontend, full keyboard operation of the player, `prefers-reduced-motion` — plus
regressions for stale badges, model caching, discarding a preview, voice
selection, URL uniqueness and double-click saves.

Most scenarios generate audio for real, which means downloading ~190MB of model
on the first run and 30-45s of synthesis each. Failure artifacts land in
`artifacts/`.

A single scenario, headed, with the inspector:

```bash
npx playwright test -g "double-click" --headed --debug
```

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

## What CI runs

`.github/workflows/ci.yml`, one job each: `lint` (ESLint, PHPCS, PHPStan),
`unit` (Jest with coverage, then PHPUnit with the 85% gate — pcov is requested
explicitly, since PHPUnit 9 emits an empty report rather than failing when no
driver is present), `i18n` (the `.pot` check), `e2e` (build, wp-env, Playwright,
artifacts uploaded on failure) and `audit`.
