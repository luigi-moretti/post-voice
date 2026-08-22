# Narration Performance — COOP/COEP Editor Headers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy` headers on the narration editor screen only, so `self.crossOriginIsolated` is `true` there and the Worker's ONNX runtime runs WASM multi-threaded instead of always falling back to single-thread.

**Architecture:** One new PHP class, `Post_Voice_Editor_Headers`, hooks `admin_init` and sends the two headers only when `$pagenow` is `post.php`/`post-new.php` **and** the post type being edited is `post`. The E2E-only mu-plugin that used to stand in for this (on the wrong hook, so it never actually worked on the editor screen) is deleted. Making the document `crossOriginIsolated` was not sufficient on its own: the narration Worker's own script is served by Apache as a static file and never gets a matching header, so `new Worker()` silently failed to even start once the document-level fix landed — Task 3 fixes the Worker's construction (`blob:`, classic-not-module build, a static import in place of a dynamic one) and the silent-hang bug (`load()`/`generate()`/`setLanguage()` never listened for the Worker's own `error` event). New E2E coverage proves the headers land by default, stay scoped, and that a Worker failure now surfaces as a visible error instead of hanging.

**Tech Stack:** PHP 8.2+ (WordPress 6.6+ admin hooks), PHPUnit (`WP_UnitTestCase`), Playwright (`@wordpress/e2e-test-utils-playwright`).

**Spec:** `docs/superpowers/specs/2026-08-21-narration-tts-performance-coop-coep-design.md`
(document-level COOP/COEP headers) and
`docs/superpowers/specs/2026-08-21-narration-worker-cross-origin-isolation-design.md`
(the Worker's own delivery under that isolation — Task 3 below implements it).

## Global Constraints

- WordPress 6.6+, PHP 8.2+ (project minimums — do not touch these pins).
- PHP: class prefix `Post_Voice_`, one class per file, `class-*.php`, WPCS clean.
- No i18n changes needed — this feature adds no user-facing strings.
- No REST/meta/public-interface changes.
- `npm ci`, never `npm install`.
- Never `--no-verify`, never commit to `master`, never push unless asked.
- wp-env must be running (`npx wp-env start`) for every PHP/E2E step below. If a PHP edit does not seem to take effect, run `npm run refresh:php` before assuming the code is wrong (Docker Desktop file-sharing + opcache cache stale copies — see `CLAUDE.md`).

**Already done, not a task below:** manual QA with real Jetpack 13.0, WooCommerce
8.5.0 and Yoast SEO 22.0 active together (the issue's own ask) happened during
this session's spec review — no breakage found on the post editor, and the
`post_type` scope confirmed correct against a real WooCommerce product screen.
Full findings, including the one open limitation (none of the three plugins
were tested connected to an external account), are in the spec's "Achado de
investigação — QA manual com Jetpack, Yoast SEO, WooCommerce" section, which
Task 1 commits. Nothing further to do here unless a code reviewer asks for the
connected-account case specifically.

---

## Task 1: `Post_Voice_Editor_Headers` — the header-sending class

Investigated and implemented live during this session's spec review (three RED→GREEN rounds: the class itself, the hook fix `send_headers` → `admin_init`, the `post_type` scope fix). The three files below already exist in the working tree exactly as shown. This task's job is to verify that, and commit.

**Files:**
- Create (if not already present — see note above): `features/narration/php/class-editor-headers.php`
- Create (if not already present): `features/narration/tests/php/test-editor-headers.php`
- Modify (if not already present): `post-voice.php`
- Already saved, commit alongside: `docs/superpowers/specs/2026-08-21-narration-tts-performance-coop-coep-design.md`, `docs/superpowers/plans/2026-08-21-narration-tts-performance-coop-coep.md` (this file)

**Interfaces:**
- Produces: `Post_Voice_Editor_Headers::register(): void`, `Post_Voice_Editor_Headers::is_editor_screen( string $pagenow, string $post_type ): bool` (public, pure). Tasks 2, 3 and 4 rely only on the *behavior* (headers present/absent on given URLs), not on calling these directly.

- [ ] **Step 1: Confirm (or create) the test file**

`features/narration/tests/php/test-editor-headers.php`:

```php
<?php
/**
 * Tests for Post_Voice_Editor_Headers.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

/**
 * @covers Post_Voice_Editor_Headers
 */
class Test_Post_Voice_Editor_Headers extends WP_UnitTestCase {

	public function test_post_editor_screen_is_an_editor_screen(): void {
		$this->assertTrue( Post_Voice_Editor_Headers::is_editor_screen( 'post.php', 'post' ) );
	}

	public function test_new_post_screen_is_an_editor_screen(): void {
		$this->assertTrue( Post_Voice_Editor_Headers::is_editor_screen( 'post-new.php', 'post' ) );
	}

	public function test_unrelated_admin_screen_is_not_an_editor_screen(): void {
		$this->assertFalse( Post_Voice_Editor_Headers::is_editor_screen( 'edit.php', 'post' ) );
	}

	public function test_page_editor_is_not_an_editor_screen(): void {
		// Narration only ever renders for the `post` post type
		// (`Post_Voice_Assets::enqueue_editor_assets`) — a Page uses the same
		// `post.php`/`post-new.php` `$pagenow`, but must not get the headers.
		$this->assertFalse( Post_Voice_Editor_Headers::is_editor_screen( 'post.php', 'page' ) );
	}

	public function test_other_post_type_editor_is_not_an_editor_screen(): void {
		// Same reasoning for any other post type, e.g. a WooCommerce product —
		// exactly the kind of screen the issue asks to sanity-check in QA.
		$this->assertFalse( Post_Voice_Editor_Headers::is_editor_screen( 'post-new.php', 'product' ) );
	}
}
```

- [ ] **Step 2: If the class does not exist yet, run the test and confirm it fails**

Run: `npm run test:php -- --filter Test_Post_Voice_Editor_Headers`
Expected (only if `class-editor-headers.php` is missing): `Error: Class "Post_Voice_Editor_Headers" not found`. If the file already exists (it should — see the note above the file list), this step is a no-op; skip to Step 3.

- [ ] **Step 3: Confirm (or create) the class**

`features/narration/php/class-editor-headers.php`:

```php
<?php
/**
 * Cross-origin isolation headers for the post editor.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Enables `self.crossOriginIsolated` (SharedArrayBuffer) on the post editor
 * screens only, so the Worker's ONNX runtime can run WASM multi-threaded.
 *
 * Scoped to `post.php`/`post-new.php` — the only screens narration
 * generation runs on — rather than the whole admin, to limit the blast
 * radius on other plugins' admin assets (oEmbed, Gravatar, third-party
 * scripts) that a site-wide `Cross-Origin-Embedder-Policy` could break.
 * `credentialless` (not `require-corp`) narrows that risk further: it does
 * not require every cross-origin subresource to opt in with its own
 * `Cross-Origin-Resource-Policy` header.
 */
class Post_Voice_Editor_Headers {

	/**
	 * Hook header emission.
	 *
	 * `admin_init`, not `send_headers`: `send_headers` fires only from
	 * `WP::send_headers()`, called from `WP::main()` — the front-end request
	 * router (`wp-blog-header.php`). `wp-admin` never calls it for the post
	 * editor (`post.php`/`post-new.php`); confirmed empirically (curl against
	 * a running install, both with and without this hook) and by tracing
	 * `WP::main()`'s only other admin-side caller, `wp_edit_posts_query()` on
	 * `edit.php` — a list-table implementation detail unrelated to and not
	 * present on the editor screens this class targets. `admin_init` fires
	 * early in the `wp-admin/admin.php` bootstrap, well before any HTML
	 * output, with `$pagenow` already set — safe for `header()`.
	 */
	public static function register(): void {
		add_action( 'admin_init', array( self::class, 'maybe_send_headers' ) );
	}

	/**
	 * Send the isolation headers when the current admin page is the post
	 * editor, for the `post` post type specifically.
	 *
	 * `post.php`/`post-new.php` are shared by every post type — a Page or a
	 * third-party CPT (e.g. a WooCommerce product) resolves to the same
	 * `$pagenow` as narration's own editor screen, but must not get the
	 * headers: narration itself never renders there
	 * (`Post_Voice_Assets::enqueue_editor_assets` already gates on
	 * `post_type === 'post'`), so sending them would only add blast radius
	 * with nothing to show for it. Post type is resolved the same way core
	 * resolves it in `post.php`/`post-new.php` themselves (read directly,
	 * rather than waiting for `set_current_screen()`, which runs after
	 * `admin_init`): `post-new.php` defaults to `post` when `$_GET['post_type']`
	 * is absent; `post.php` looks the existing post up by ID.
	 */
	public static function maybe_send_headers(): void {
		global $pagenow;

		$post_type = self::resolve_post_type( (string) $pagenow );

		if ( ! self::is_editor_screen( (string) $pagenow, $post_type ) ) {
			return;
		}

		header( 'Cross-Origin-Opener-Policy: same-origin' );
		header( 'Cross-Origin-Embedder-Policy: credentialless' );
	}

	/**
	 * Post type of the current request, for the two editor `$pagenow`
	 * values. Empty string for anything else or when it cannot be resolved.
	 *
	 * @param string $pagenow Value of the global `$pagenow`.
	 */
	private static function resolve_post_type( string $pagenow ): string {
		if ( 'post-new.php' === $pagenow ) {
			return isset( $_GET['post_type'] ) ? sanitize_key( wp_unslash( $_GET['post_type'] ) ) : 'post'; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only, mirrors core's own default resolution in wp-admin/post-new.php.
		}

		if ( 'post.php' === $pagenow && isset( $_GET['post'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only.
			$post = get_post( (int) $_GET['post'] ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only.
			return $post ? $post->post_type : '';
		}

		return '';
	}

	/**
	 * Whether a `$pagenow`/post type pair is the narration editor screen.
	 *
	 * @param string $pagenow   Value of the global `$pagenow`.
	 * @param string $post_type Post type being edited.
	 */
	public static function is_editor_screen( string $pagenow, string $post_type ): bool {
		return in_array( $pagenow, array( 'post.php', 'post-new.php' ), true ) && 'post' === $post_type;
	}
}
```

- [ ] **Step 4: Wire it into the plugin bootstrap**

In `post-voice.php`, add the require next to `class-assets.php`'s:

```php
require_once POST_VOICE_PATH . 'features/narration/php/class-assets.php';
require_once POST_VOICE_PATH . 'features/narration/php/class-editor-headers.php';
```

And register it next to `Post_Voice_Assets::register()`:

```php
Post_Voice_Assets::register();
Post_Voice_Editor_Headers::register();
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npm run test:php -- --filter Test_Post_Voice_Editor_Headers`
Expected: `OK (5 tests, 5 assertions)`

- [ ] **Step 6: Run the full PHP suite to confirm no regression**

Run: `npm run test:php`
Expected: all green (112 tests as of this session; a higher number is fine if other work landed in the meantime — it must not be lower, and there must be zero failures).

- [ ] **Step 7: Manual sanity check against a real running instance**

wp-env's dev site (port 8888) is a real server, not a test double — this confirms the hook actually fires in a live request, which PHPUnit's simulated admin context cannot: `WP_UnitTestCase` never calls PHP's real `header()` pathway with real superglobals in the same way a live `admin_init` does.

```bash
npm run refresh:php
```

Log in as the default wp-env admin (`admin`/`password`) and request the editor screen with that session:

```bash
curl -s -c /tmp/cookies.txt -d "log=admin&pwd=password&wp-submit=Log+In&redirect_to=http://localhost:8888/wp-admin/" http://localhost:8888/wp-login.php -o /dev/null
curl -s -b /tmp/cookies.txt -D - http://localhost:8888/wp-admin/post-new.php -o /dev/null | grep -Ei "^Cross-Origin"
```

Expected output:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

Then confirm a Page does **not** get them:

```bash
curl -s -b /tmp/cookies.txt -D - "http://localhost:8888/wp-admin/post-new.php?post_type=page" -o /dev/null | grep -Ei "^Cross-Origin"
```

Expected: no output at all.

Clean up: `rm -f /tmp/cookies.txt`.

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/specs/2026-08-21-narration-tts-performance-coop-coep-design.md docs/superpowers/plans/2026-08-21-narration-tts-performance-coop-coep.md
git commit -m "docs: add spec and plan for TTS performance COOP/COEP header fix (issue #5)"

git add features/narration/php/class-editor-headers.php features/narration/tests/php/test-editor-headers.php post-voice.php
git commit -m "feat: send COOP/COEP headers on the narration editor screen only

Enables self.crossOriginIsolated (and therefore WASM multi-threading in
pocket-tts.worker.js) on post.php/post-new.php when the post type is
'post'. Scoped by post type, not just \$pagenow, so editing a Page or a
third-party CPT (e.g. a WooCommerce product) does not get the headers.

credentialless, not require-corp: does not require third-party
cross-origin subresources to send their own Cross-Origin-Resource-Policy.

Hooked on admin_init, not send_headers: send_headers never fires on
wp-admin for the post editor (confirmed by code trace and empirically) -
the e2e mu-plugin that assumed otherwise never actually worked here.

Refs #5"
```

---

## Task 2: Delete the E2E-only mu-plugin it replaces

**Files:**
- Delete: `e2e/mu-plugins/coop-coep-headers.php`
- Modify: `.wp-env.json`
- Modify: `e2e/mu-plugins/segment-pipeline-harness.php` (stale doc reference)
- Modify: `e2e/fixtures/segment-pipeline-harness.ts` (stale doc reference)

**Interfaces:**
- Consumes: `Post_Voice_Editor_Headers` from Task 1 (must already be sending the headers on the editor screen for this task's verification step to pass).
- Produces: nothing new — this task only removes a now-redundant (and previously non-functional, on the editor screen) stand-in.

- [ ] **Step 1: Delete the mu-plugin**

```bash
rm /home/luigi/Documentos/projects/post-voice/e2e/mu-plugins/coop-coep-headers.php
```

- [ ] **Step 2: Remove its mapping from `.wp-env.json`**

Current content:

```json
{
	"core": "WordPress/WordPress#6.6",
	"plugins": [ "." ],
	"mappings": {
		"wp-content/mu-plugins/coop-coep-headers.php": "./e2e/mu-plugins/coop-coep-headers.php",
		"wp-content/mu-plugins/segment-pipeline-harness.php": "./e2e/mu-plugins/segment-pipeline-harness.php"
	},
	"config": {
		"WP_DEBUG": true
	}
}
```

New content — remove the `coop-coep-headers.php` line, keep the rest, fix the now-trailing comma:

```json
{
	"core": "WordPress/WordPress#6.6",
	"plugins": [ "." ],
	"mappings": {
		"wp-content/mu-plugins/segment-pipeline-harness.php": "./e2e/mu-plugins/segment-pipeline-harness.php"
	},
	"config": {
		"WP_DEBUG": true
	}
}
```

- [ ] **Step 3: Fix the two stale doc references to the deleted file**

In `e2e/mu-plugins/segment-pipeline-harness.php`, the docblock currently reads:

```
 * E2E-only, mirroring `coop-coep-headers.php`: mapped into `wp-content/mu-plugins`
 * only by `.wp-env.json`. Nothing in `post-voice.php`'s own require chain loads
 * this file, so a production install of the plugin never enqueues the handle it
 * registers below.
```

Change to (drop the now-dangling filename, keep the rest of the sentence):

```
 * E2E-only: mapped into `wp-content/mu-plugins` only by `.wp-env.json`.
 * Nothing in `post-voice.php`'s own require chain loads this file, so a
 * production install of the plugin never enqueues the handle it registers
 * below.
```

In `e2e/fixtures/segment-pipeline-harness.ts`, the docblock currently ends with:

```
 * Built by its own webpack entry (see `webpack.config.js`) and loaded only by
 * `e2e/mu-plugins/segment-pipeline-harness.php`, which nothing in the plugin's
 * own `post-voice.php` chain requires — a production install never enqueues
 * it. Mirrors the `coop-coep-headers.php` pattern.
 */
```

Change the last sentence (drop the now-dangling filename):

```
 * Built by its own webpack entry (see `webpack.config.js`) and loaded only by
 * `e2e/mu-plugins/segment-pipeline-harness.php`, which nothing in the plugin's
 * own `post-voice.php` chain requires — a production install never enqueues
 * it.
 */
```

- [ ] **Step 4: Recreate wp-env so the mapping change takes effect**

wp-env generates its `docker-compose` mounts from `.wp-env.json` at container creation, not on every `start` — a running container keeps its old mounts. Force a clean recreate:

```bash
npx wp-env destroy
npx wp-env start
```

(`wp-env destroy` asks for confirmation; the CI/local convention for this repo is to answer yes since this is disposable local state, not data anyone needs.)

- [ ] **Step 5: Confirm the removed mu-plugin's header is gone from the dev site, and the real one (Task 1) still isn't**

```bash
curl -s -D - http://localhost:8888/wp-admin/edit.php -o /dev/null | grep -Ei "^Cross-Origin"
```

Expected: no output (previously this showed `require-corp` from the deleted mu-plugin's incidental firing via `wp_edit_posts_query()`).

```bash
curl -c /tmp/cookies.txt -d "log=admin&pwd=password&wp-submit=Log+In&redirect_to=http://localhost:8888/wp-admin/" http://localhost:8888/wp-login.php -o /dev/null
curl -s -b /tmp/cookies.txt -D - http://localhost:8888/wp-admin/post-new.php -o /dev/null | grep -Ei "^Cross-Origin"
rm -f /tmp/cookies.txt
```

Expected: `credentialless` still present — from `Post_Voice_Editor_Headers` (Task 1), not the deleted mu-plugin.

- [ ] **Step 6: Run the existing fallback E2E scenario end-to-end**

This scenario used to strip the mu-plugin's headers; it now strips the real production ones — same test code, but for the first time it is testing something that actually ships. Confirm it still passes against production headers:

```bash
npm run build
npx playwright test -g "generates audio single-threaded when crossOriginIsolated is unavailable" --headed
```

Expected: PASS (downloads the model on first run if not already cached — allow a few minutes).

- [ ] **Step 7: Commit**

```bash
git add e2e/mu-plugins/coop-coep-headers.php .wp-env.json e2e/mu-plugins/segment-pipeline-harness.php e2e/fixtures/segment-pipeline-harness.ts
git commit -m "test: delete the E2E-only COOP/COEP mu-plugin, superseded by production code

It was hooked on send_headers, which never fires on the post editor
(wp-admin/post.php, wp-admin/post-new.php) - it never actually exercised
the multi-thread path it claimed to. Post_Voice_Editor_Headers (previous
commit) replaces it for real, on admin_init.

Refs #5"
```

---

## Task 3: Fix Worker construction under cross-origin isolation

Task 1 made the document `crossOriginIsolated`. That was necessary but not
sufficient: running the full E2E suite afterward (Task 4's own attempt, before
this task existed — see `.superpowers/sdd/2026-08-21-narration-tts-performance-coop-coep/task-4-report.md`
for the full RED evidence, four real-generation scenarios hanging at
"Preparing…" until their timeout) showed every real generation still hangs.
Investigated in
`docs/superpowers/specs/2026-08-21-narration-worker-cross-origin-isolation-design.md`:
three stacked causes, each confirmed live in real Chrome, fixed here together
because they are only meaningful as a set (fixing one alone still hangs) —
plus a fourth, a deliberate resilience decision rather than a reproduced bug:
an automatic retry to single-thread if the first attempt fails on a
`crossOriginIsolated` document, defence in depth for a browser-specific
threading incompatibility this session could not test for (only Chrome was
available; the plugin also targets Safari/Firefox).

**Files:**
- Modify: `features/narration/editor/engine/pocket-tts.worker.js`
- Modify: `features/narration/editor/engine/tts-engine.ts`
- Modify: `features/narration/editor/index.tsx`
- Create: `e2e/narration-worker-error.spec.ts`

**Interfaces:**
- Consumes: `Post_Voice_Editor_Headers` sending real COOP/COEP on the editor
  screen (Task 1) — this task's own verification needs a genuinely isolated
  document to reproduce and then fix the hang.
- Produces: nothing later tasks call directly. Task 4's Step 5 (full E2E
  suite) and Task 5 (RTF benchmark) both depend on real generation actually
  completing, which only exists after this task.

- [ ] **Step 1: Static import instead of dynamic import for the tokenizer**

In `features/narration/editor/engine/pocket-tts.worker.js`, add the import at
the top (with the other three):

```js
import { MODEL_BASE_URL } from '../model-source';
import { installModelCache } from './model-cache';
import { sanitizeForTokenizer } from './tokenizer-sanitize';
import * as sentencepieceModule from './sentencepiece.js';
```

Then replace the dynamic import inside `loadBundle()`:

```js
    const spModule = await import("./sentencepiece.js");
    tokenizerProcessor = new spModule.SentencePieceProcessor();
```

with:

```js
    tokenizerProcessor = new sentencepieceModule.SentencePieceProcessor();
```

This import was never conditional — `loadBundle()` calls it every single time,
unconditionally. Making it static removes the only dynamic `import()` inside
this worker, which removes the only lazy webpack chunk it needs at runtime
(today built as a separate numbered file, e.g. `646.js`) — see Step 5 for why
that chunk is exactly what breaks once the worker is constructed from a
`blob:` URL (Step 3).

- [ ] **Step 2: Accept a `forceSingleThread` flag in the worker's `load` message**

Still in `pocket-tts.worker.js`. Replace:

```js
async function loadOrt() {
    if (ort) {
        return;
    }

    postMessage({ type: "status", status: "Loading ONNX Runtime...", state: "loading" });
    const version = "1.20.0";
    const cdnBase = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/`;
    // webpackIgnore keeps this a real runtime import of an absolute URL. ONNX
    // Runtime Web is loaded from a CDN on purpose (spec: not an npm dependency);
    // without the comment webpack tries to resolve the URL as a local path at
    // build time and fails with "Can't resolve 'https://cdn.jsdelivr.net/npm'".
    const ortModule = await import(/* webpackIgnore: true */ `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/ort.min.mjs`);
    ort = ortModule.default || ortModule;
    ort.env.wasm.wasmPaths = cdnBase;
    ort.env.wasm.simd = true;
    ort.env.wasm.numThreads = self.crossOriginIsolated
        ? Math.min(navigator.hardwareConcurrency || 4, 8)
        : 1;
    precomputeFlowBuffers();
}
```

with:

```js
async function loadOrt(forceSingleThread = false) {
    if (ort) {
        return;
    }

    postMessage({ type: "status", status: "Loading ONNX Runtime...", state: "loading" });
    const version = "1.20.0";
    const cdnBase = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/`;
    // webpackIgnore keeps this a real runtime import of an absolute URL. ONNX
    // Runtime Web is loaded from a CDN on purpose (spec: not an npm dependency);
    // without the comment webpack tries to resolve the URL as a local path at
    // build time and fails with "Can't resolve 'https://cdn.jsdelivr.net/npm'".
    const ortModule = await import(/* webpackIgnore: true */ `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/ort.min.mjs`);
    ort = ortModule.default || ortModule;
    ort.env.wasm.wasmPaths = cdnBase;
    ort.env.wasm.simd = true;
    // `forceSingleThread` is set by `PocketTtsEngine.load()`'s retry, after a
    // first multi-thread attempt on this document failed for a reason other
    // than crossOriginIsolated being off (that case never reaches here with
    // `numThreads > 1` in the first place) — see
    // docs/superpowers/specs/2026-08-21-narration-worker-cross-origin-isolation-design.md,
    // "Achado 4". `loadOrt()` only ever runs once per worker instance (the
    // guard above), so this decision is fixed for the worker's whole
    // lifetime, same as it always was.
    ort.env.wasm.numThreads = (self.crossOriginIsolated && !forceSingleThread)
        ? Math.min(navigator.hardwareConcurrency || 4, 8)
        : 1;
    precomputeFlowBuffers();
}
```

Then replace:

```js
async function loadBundle(language, { initialLoad = false } = {}) {
    if (!LANGUAGE_BUNDLES.includes(language)) {
        throw new Error(`Unsupported language bundle: ${language}`);
    }

    await loadOrt();
```

with:

```js
async function loadBundle(language, { initialLoad = false, forceSingleThread = false } = {}) {
    if (!LANGUAGE_BUNDLES.includes(language)) {
        throw new Error(`Unsupported language bundle: ${language}`);
    }

    await loadOrt(forceSingleThread);
```

Then, in the `self.onmessage` handler, replace:

```js
        if (type === "load") {
            await loadBundle(DEFAULT_LANGUAGE, { initialLoad: true });
            return;
        }
```

with:

```js
        if (type === "load") {
            await loadBundle(DEFAULT_LANGUAGE, {
                initialLoad: true,
                forceSingleThread: Boolean(data?.forceSingleThread),
            });
            return;
        }
```

(`set_language` is deliberately left alone — `loadOrt()`'s guard means the
thread-count decision is already locked in for this worker instance by the
time any `set_language` message could arrive; see the spec's "Achado 4" for
why a second language failing is treated differently.)

- [ ] **Step 3: Construct the Worker from a `blob:` URL, as a classic (non-module) script, and retry once single-threaded if it fails**

In `features/narration/editor/engine/tts-engine.ts`, add this function after
the imports, before the `PocketTtsEngine` class:

```ts
/**
 * Constructs the narration Worker from a `blob:` URL instead of pointing
 * straight at its own script, and as a classic (non-module) script — both
 * load-bearing, confirmed empirically, see
 * docs/superpowers/specs/2026-08-21-narration-worker-cross-origin-isolation-design.md:
 *
 * - `blob:`: the post editor sends COOP/COEP (`Post_Voice_Editor_Headers`),
 *   which makes this document `crossOriginIsolated`. A cross-origin-isolated
 *   document requires a Worker's own script response to also carry a COEP
 *   header for `new Worker()` to succeed — and this script is served by
 *   Apache as a plain static file, which never runs through WordPress/PHP
 *   and therefore never gets one. Fetching the same file ourselves and
 *   constructing the Worker from a same-origin `blob:` of its contents
 *   sidesteps that requirement without touching the server at all — it is
 *   the exact same bytes the browser would have loaded directly.
 * - Classic, not module: `onnxruntime-web`'s threaded WASM backend calls
 *   `importScripts()` during initialisation, an API module-type workers do
 *   not support at all, in any version (confirmed against 1.20.0, the
 *   version pinned in this worker, and the latest release at investigation
 *   time). This worker's own code only needed `{ type: 'module' }` for its
 *   own static `import`s, which webpack bundles into a plain classic script
 *   just as well when the option is omitted.
 *
 * The object URL is revoked immediately after construction — confirmed
 * empirically that this does not break anything (the browser has already
 * captured the Blob's contents by the time `new Worker()` returns); without
 * it, every call (and every retry) leaks one Blob reference for the rest of
 * the page's life.
 */
async function createNarrationWorker(): Promise< Worker > {
	const scriptUrl = new URL( './pocket-tts.worker.js', import.meta.url );
	const code = await ( await fetch( scriptUrl ) ).text();
	const blobUrl = URL.createObjectURL(
		new Blob( [ code ], { type: 'text/javascript' } )
	);
	const worker = new Worker( blobUrl );
	URL.revokeObjectURL( blobUrl );
	return worker;
}
```

Then add a field the retry (Step below) sets, right after the existing
`sampleRate` field:

```ts
	private readonly rtfByLanguage = new Map< string, number >();
	public sampleRate = 24000;
```

with:

```ts
	private readonly rtfByLanguage = new Map< string, number >();
	public sampleRate = 24000;
	// Set by `load()`'s retry (see below) when the first, multi-thread
	// attempt failed and the second, single-threaded one succeeded — so the
	// caller can tell the author generation is running slower than the
	// device would otherwise support.
	public usedSingleThreadFallback = false;
```

Then replace the entire `load()` method:

```ts
	async load( language: string ): Promise< void > {
		this.language = language;
		this.worker = new Worker(
			new URL( './pocket-tts.worker.js', import.meta.url ),
			{ type: 'module' }
		);

		await new Promise< void >( ( resolve, reject ) => {
			if ( ! this.worker ) {
				return reject( new Error( 'Worker not created' ) );
			}
			const onMessage = ( e: MessageEvent ) => {
				const { type, sampleRate, error, defaultVoice } = e.data;
				if ( type === 'voices_loaded' ) {
					// The worker picks the bundle's default voice itself; remember it so
					// callers never have to name one.
					this.defaultVoice = defaultVoice ?? null;
				} else if ( type === 'bundle_loaded' ) {
					// `sampleRate` rides on `bundle_loaded`, never on `loaded` — reading it
					// off the wrong message leaves the hardcoded default in place forever,
					// which would silently mis-scale RTF and produce wrong-pitch MP3s if a
					// bundle ever shipped at something other than 24kHz.
					if ( sampleRate ) {
						this.sampleRate = sampleRate;
					}
				} else if ( type === 'loaded' ) {
					this.ready = true;
					this.worker?.removeEventListener( 'message', onMessage );
					resolve();
				} else if ( type === 'error' ) {
					this.worker?.removeEventListener( 'message', onMessage );
					reject( new Error( error ) );
				}
			};
			this.worker.addEventListener( 'message', onMessage );
			this.worker.postMessage( { type: 'load' } );
		} );

		if ( language !== 'english_2026-04' ) {
			await this.setLanguage( language );
		}
	}
```

with:

```ts
	async load( language: string ): Promise< void > {
		this.language = language;
		try {
			await this.loadWorkerAndLanguage( language, false );
		} catch ( err ) {
			// A multi-thread attempt can fail for a browser-specific reason
			// unrelated to whether crossOriginIsolated is on at all — that case
			// already runs single-thread from the start, inside loadOrt(). An
			// untested browser's own WASM-threading bug is exactly the case
			// this retries for. Retrying when isolation was never on would just
			// repeat the same single-threaded attempt, so it isn't worth doing.
			// Retries on ANY failure (network, parse, threading), not just ones
			// that look threading-related — matching on error messages reliably
			// is not possible across onnxruntime-web versions, and the cost of
			// one unnecessary retry (a few seconds) is cheap. See
			// docs/superpowers/specs/2026-08-21-narration-worker-cross-origin-isolation-design.md,
			// "Achado 4" — deliberately scoped to this first load only, not a
			// later, independent `setLanguage()` call (see that section for why).
			if ( ! self.crossOriginIsolated ) {
				throw err;
			}
			this.worker?.terminate();
			this.worker = null;
			await this.loadWorkerAndLanguage( language, true );
			this.usedSingleThreadFallback = true;
		}
	}

	/**
	 * Constructs the Worker, waits for the default bundle to finish loading,
	 * then switches to `language` if it isn't the default — the whole
	 * first-load sequence `load()`'s retry redoes as one unit.
	 *
	 * @param language          Model bundle identifier.
	 * @param forceSingleThread Skip the worker's own crossOriginIsolated
	 *                          check and run single-threaded regardless — set
	 *                          only by `load()`'s retry, on the second attempt.
	 */
	private async loadWorkerAndLanguage(
		language: string,
		forceSingleThread: boolean
	): Promise< void > {
		this.worker = await createNarrationWorker();

		await new Promise< void >( ( resolve, reject ) => {
			if ( ! this.worker ) {
				return reject( new Error( 'Worker not created' ) );
			}
			const cleanup = () => {
				this.worker?.removeEventListener( 'message', onMessage );
				this.worker?.removeEventListener( 'error', onError );
			};
			const onMessage = ( e: MessageEvent ) => {
				const { type, sampleRate, error, defaultVoice } = e.data;
				if ( type === 'voices_loaded' ) {
					// The worker picks the bundle's default voice itself; remember it so
					// callers never have to name one.
					this.defaultVoice = defaultVoice ?? null;
				} else if ( type === 'bundle_loaded' ) {
					// `sampleRate` rides on `bundle_loaded`, never on `loaded` — reading it
					// off the wrong message leaves the hardcoded default in place forever,
					// which would silently mis-scale RTF and produce wrong-pitch MP3s if a
					// bundle ever shipped at something other than 24kHz.
					if ( sampleRate ) {
						this.sampleRate = sampleRate;
					}
				} else if ( type === 'loaded' ) {
					this.ready = true;
					cleanup();
					resolve();
				} else if ( type === 'error' ) {
					cleanup();
					reject( new Error( error ) );
				}
			};
			// Without this, a Worker that fails after construction (a corrupt
			// fetch, a future regression reintroducing the classic-vs-module
			// incompatibility this file works around) never posts any message
			// at all — this Promise hung forever and "Preparing…" never became
			// a visible error. See the spec's "Achado 1" for how this was found.
			const onError = ( event: ErrorEvent ) => {
				cleanup();
				reject( new Error( event.message || 'Worker failed to start' ) );
			};
			this.worker.addEventListener( 'message', onMessage );
			this.worker.addEventListener( 'error', onError );
			this.worker.postMessage( {
				type: 'load',
				data: { forceSingleThread },
			} );
		} );

		if ( language !== 'english_2026-04' ) {
			await this.setLanguage( language );
		}
	}
```

Apply the same `cleanup`/`onError` pattern to `setLanguage()` (same file,
right below `load()`) — replace:

```ts
	private setLanguage( language: string ): Promise< void > {
		return new Promise( ( resolve, reject ) => {
			if ( ! this.worker ) {
				return reject( new Error( 'Engine not loaded' ) );
			}
			const onMessage = ( e: MessageEvent ) => {
				if ( e.data.type === 'voices_loaded' ) {
					this.defaultVoice =
						e.data.defaultVoice ?? this.defaultVoice;
				} else if ( e.data.type === 'bundle_loaded' ) {
					if ( e.data.sampleRate ) {
						this.sampleRate = e.data.sampleRate;
					}
					this.worker?.removeEventListener( 'message', onMessage );
					resolve();
				} else if ( e.data.type === 'error' ) {
					this.worker?.removeEventListener( 'message', onMessage );
					reject( new Error( e.data.error ) );
				}
			};
			this.worker.addEventListener( 'message', onMessage );
			this.worker.postMessage( {
				type: 'set_language',
				data: { language },
			} );
		} );
	}
```

with:

```ts
	private setLanguage( language: string ): Promise< void > {
		return new Promise( ( resolve, reject ) => {
			if ( ! this.worker ) {
				return reject( new Error( 'Engine not loaded' ) );
			}
			const cleanup = () => {
				this.worker?.removeEventListener( 'message', onMessage );
				this.worker?.removeEventListener( 'error', onError );
			};
			const onMessage = ( e: MessageEvent ) => {
				if ( e.data.type === 'voices_loaded' ) {
					this.defaultVoice =
						e.data.defaultVoice ?? this.defaultVoice;
				} else if ( e.data.type === 'bundle_loaded' ) {
					if ( e.data.sampleRate ) {
						this.sampleRate = e.data.sampleRate;
					}
					cleanup();
					resolve();
				} else if ( e.data.type === 'error' ) {
					cleanup();
					reject( new Error( e.data.error ) );
				}
			};
			const onError = ( event: ErrorEvent ) => {
				cleanup();
				reject( new Error( event.message || 'Worker failed to start' ) );
			};
			this.worker.addEventListener( 'message', onMessage );
			this.worker.addEventListener( 'error', onError );
			this.worker.postMessage( {
				type: 'set_language',
				data: { language },
			} );
		} );
	}
```

And to `generate()` (same class, same file) — the same defect exists here:
a Worker that crashes mid-generation currently hangs the "Synthesising
audio…" progress bar forever with no error, for the same reason. Replace:

```ts
	generate(
		text: string,
		options: GenerateOptions
	): Promise< Float32Array > {
		return new Promise( ( resolve, reject ) => {
			if ( ! this.worker || ! this.ready ) {
				return reject( new Error( 'Engine not loaded' ) );
			}

			const chunks: Float32Array[] = [];

			const cleanup = () => {
				this.worker?.removeEventListener( 'message', onMessage );
				options.signal?.removeEventListener( 'abort', onAbort );
			};

			const onAbort = () => {
				this.worker?.postMessage( { type: 'stop' } );
				cleanup();
				reject(
					new DOMException( 'Generation cancelled', 'AbortError' )
				);
			};
			options.signal?.addEventListener( 'abort', onAbort, {
				once: true,
			} );

			const onMessage = ( e: MessageEvent ) => {
				const { type, data, error } = e.data;
				if ( type === 'audio_chunk' ) {
					chunks.push( new Float32Array( data ) );
				} else if ( type === 'stream_ended' ) {
					cleanup();
					resolve( concatFloat32( chunks ) );
				} else if ( type === 'error' ) {
					cleanup();
					reject( new Error( error ) );
				}
			};

			this.worker.addEventListener( 'message', onMessage );
			this.worker.postMessage( {
				type: 'generate',
				data: { text, voice: options.voice ?? this.defaultVoice },
			} );
		} );
	}
```

with:

```ts
	generate(
		text: string,
		options: GenerateOptions
	): Promise< Float32Array > {
		return new Promise( ( resolve, reject ) => {
			if ( ! this.worker || ! this.ready ) {
				return reject( new Error( 'Engine not loaded' ) );
			}

			const chunks: Float32Array[] = [];

			const cleanup = () => {
				this.worker?.removeEventListener( 'message', onMessage );
				this.worker?.removeEventListener( 'error', onError );
				options.signal?.removeEventListener( 'abort', onAbort );
			};

			const onAbort = () => {
				this.worker?.postMessage( { type: 'stop' } );
				cleanup();
				reject(
					new DOMException( 'Generation cancelled', 'AbortError' )
				);
			};
			options.signal?.addEventListener( 'abort', onAbort, {
				once: true,
			} );

			const onMessage = ( e: MessageEvent ) => {
				const { type, data, error } = e.data;
				if ( type === 'audio_chunk' ) {
					chunks.push( new Float32Array( data ) );
				} else if ( type === 'stream_ended' ) {
					cleanup();
					resolve( concatFloat32( chunks ) );
				} else if ( type === 'error' ) {
					cleanup();
					reject( new Error( error ) );
				}
			};
			const onError = ( event: ErrorEvent ) => {
				cleanup();
				reject(
					new Error( event.message || 'Worker crashed during generation' )
				);
			};

			this.worker.addEventListener( 'message', onMessage );
			this.worker.addEventListener( 'error', onError );
			this.worker.postMessage( {
				type: 'generate',
				data: { text, voice: options.voice ?? this.defaultVoice },
			} );
		} );
	}
```

(This last one extends slightly past what the spec's "Decisão" table names —
it only lists `load()`/`setLanguage()`. Same defect, same class, same fix,
trivial risk: apply it. If a reviewer disagrees, that is the moment to drop
it, not before.)

- [ ] **Step 4: Show a snackbar notice when the retry falls back to single-thread**

In `features/narration/editor/index.tsx`, inside `ensureEngine`, replace:

```ts
			if ( ! engineRef.current ) {
				engineRef.current = new PocketTtsEngine();
				await engineRef.current.load( targetLanguage );
			} else {
```

with:

```ts
			if ( ! engineRef.current ) {
				engineRef.current = new PocketTtsEngine();
				await engineRef.current.load( targetLanguage );
				// The retry inside load() (see tts-engine.ts) is silent by
				// design at that layer — this is the one place that knows
				// there is an author to tell. Without it, the only symptom
				// is generation taking longer than the device should need,
				// with nothing explaining why.
				if ( engineRef.current.usedSingleThreadFallback ) {
					createErrorNotice(
						__(
							"This browser couldn't run faster multi-threaded narration — falling back to a slower single-threaded mode.",
							'post-voice'
						),
						{ type: 'snackbar' }
					);
				}
			} else {
```

Then add `createErrorNotice` to `ensureEngine`'s dependency array — replace:

```ts
		[ language, wasmSupported ]
	);
```

(the one immediately after the `ensureEngine` callback body — check you are editing the right one; `useCallback` appears more than once in this file) with:

```ts
		[ createErrorNotice, language, wasmSupported ]
	);
```

`createErrorNotice` is already destructured from `useDispatch( noticesStore )`
earlier in this file (`const { createErrorNotice } = useDispatch(
noticesStore );`) — this reuses it, matching the existing
`shouldWarnSlowDevice` snackbar a few dozen lines below for the same "this is
degraded, not broken" category of message.

- [ ] **Step 5: Rebuild and confirm the worker chunk is now self-contained**

```bash
rm -rf build
npm run build
```

Confirm no build errors. Then confirm the worker's own chunk has no leftover
lazy-chunk loading (Step 1 should have removed the only one):

```bash
grep -rl "Worker Thread Started" build/
```

Note the filename this prints (it changes with content — it was `285.js`
before this task, `498.js` when this was investigated, it will likely differ
again now). Then, on that file:

```bash
grep -o "n\.e([0-9]*)" build/<the-file-from-above>.js
```

Expected: no output. (If this prints something, Step 1 did not remove every
dynamic `import()` this worker makes — find and statically import that one
too before continuing.)

- [ ] **Step 6: Confirm the fix — full end-to-end generation completes under real cross-origin isolation**

This is GREEN for the RED already on record (the four hung scenarios in
`.superpowers/sdd/2026-08-21-narration-tts-performance-coop-coep/task-4-report.md`
under "Step 5 — full E2E suite"). Re-run the exact scenario that was reproduced there in isolation:

```bash
npx playwright test e2e/narration.spec.ts -g "author generates, previews, and saves narration end to end"
```

Expected: **PASS**, well under its 120s timeout (the report's RED evidence
showed it hitting the full timeout, "Preparing…" never advancing past
initialisation).

Then run the other three that failed in that report:

```bash
npx playwright test e2e/narration-audio-quality.spec.ts e2e/narration-fase2.spec.ts -g "generates without error|is left out of the narration|dictionary entry changes"
```

Expected: all **PASS**.

Then confirm the deliberately-disabled single-thread fallback path still
works (unaffected by this task, but it is the one scenario that already
passed before — regression check):

```bash
npx playwright test e2e/narration-fallbacks.spec.ts
```

Expected: both scenarios still **PASS**.

- [ ] **Step 7: New E2E tests — a Worker failure surfaces as a visible error, and a first-attempt failure retries single-threaded instead**

`e2e/narration-worker-error.spec.ts`:

```typescript
import { test, expect } from '@wordpress/e2e-test-utils-playwright';
import { openNarrationPanel } from './open-narration-panel';

// Short on purpose — the first test proves a fast, visible failure, not a
// real generation. See e2e/narration-fallbacks.spec.ts for the sibling
// pattern this borrows (a route intercept that changes what the editor
// receives).
const NARRATION_TEXT = 'Hello world, this is a test post.';

test( 'shows an error instead of hanging when the Worker fails to start', async ( {
	admin,
	editor,
	page,
} ) => {
	// The Worker's own compiled chunk is served under a content-hashed
	// filename that changes on every build — matched by content, not name,
	// so this test survives the next rebuild without editing a filename here.
	// Every matching request is corrupted, deliberately: with the retry from
	// Achado 4, the second (single-threaded) attempt fetches this same URL
	// again and must fail too, so the test still proves the *eventual*
	// visible-error case, not a lucky recovery.
	await page.route(
		'**/wp-content/plugins/post-voice/build/*.js',
		async ( route ) => {
			const response = await route.fetch();
			const body = await response.text();
			if ( body.includes( 'Worker Thread Started' ) ) {
				await route.fulfill( {
					response,
					body: 'throw new Error("simulated worker crash");',
				} );
				return;
			}
			await route.fulfill( { response, body } );
		}
	);

	await admin.createNewPost( { title: 'Worker crash' } );
	await editor.insertBlock( {
		name: 'core/paragraph',
		attributes: { content: NARRATION_TEXT },
	} );
	await editor.saveDraft();
	await openNarrationPanel( page );
	await page
		.getByRole( 'button', { name: 'Generate audio', exact: true } )
		.click();
	await expect( page.getByRole( 'alert' ) ).toContainText(
		'simulated worker crash',
		{ timeout: 15_000 }
	);
} );

test( 'retries single-threaded and still completes when only the first Worker attempt fails', async ( {
	admin,
	editor,
	page,
} ) => {
	// Corrupt only the first matching fetch (the multi-thread attempt);
	// every later one (the retry, Achado 4) gets the real script.
	let attempts = 0;
	await page.route(
		'**/wp-content/plugins/post-voice/build/*.js',
		async ( route ) => {
			const response = await route.fetch();
			const body = await response.text();
			if ( body.includes( 'Worker Thread Started' ) ) {
				attempts += 1;
				if ( attempts === 1 ) {
					await route.fulfill( {
						response,
						body: 'throw new Error("simulated first-attempt crash");',
					} );
					return;
				}
			}
			await route.fulfill( { response, body } );
		}
	);

	await admin.createNewPost( { title: 'Worker retry' } );
	await editor.insertBlock( {
		name: 'core/paragraph',
		attributes: { content: NARRATION_TEXT },
	} );
	await editor.saveDraft();
	await openNarrationPanel( page );
	await page
		.getByRole( 'button', { name: 'Generate audio', exact: true } )
		.click();
	// A real generation, on the retry's single thread — the fallback e2e
	// scenario's single-threaded run takes ~46s; budget for that plus the
	// failed first attempt and the download this post's Worker instance
	// hasn't cached yet.
	await expect(
		page.getByRole( 'button', { name: 'Save narration', exact: true } )
	).toBeVisible( { timeout: 180_000 } );
} );
```

Run both once and confirm they pass:

```bash
npx playwright test e2e/narration-worker-error.spec.ts
```

Expected: **PASS**. The first test resolves in well under its 15s timeout
(the corruption fails immediately on parse — not waiting out a real
generation). The second takes up to a few minutes (a real single-threaded
generation, after one failed attempt) — that's expected, not a problem.

- [ ] **Step 8: Update `TESTING.md`'s scenario count for this new file**

Change the summary table row:

```
| `npm run test:e2e` | Playwright, 37 scenarios | all pass | ~20-25min |
```

to:

```
| `npm run test:e2e` | Playwright, 39 scenarios | all pass | ~20-25min |
```

Change:

```
The 37 scenarios split in four families, plus the performance ceiling
described further below.
```

to:

```
The 39 scenarios split in five families, plus the performance ceiling
described further below.
```

After the paragraph that begins "Two more, in `narration-audio-quality.spec.ts`..."
and before the one that begins "Five more, in `player-style.spec.ts`...", insert:

```markdown
Two more, in `narration-worker-error.spec.ts`: the Worker's own script is
intercepted and corrupted, proving a Worker construction/runtime failure now
surfaces as a visible error in the panel instead of hanging forever, and that
a failure on the first (multi-thread) attempt retries once single-threaded
and still completes rather than failing outright — the regression tests for
the two fixes in the 2026-08-21 Worker cross-origin-isolation spec ("Achado
1" and "Achado 4"). The first is page-load-fast (no real generation, no
model download — the corruption fails on parse); the second is a real
single-threaded generation and costs real time, same as the existing
single-thread fallback scenario it shares its shape with.
```

(Task 4, next, adds three more scenarios and its own family on top of this —
its numbers there already account for this file existing first.)

- [ ] **Step 9: Prove both tests can actually fail**

**9a — the visible-error test**: in `features/narration/editor/engine/tts-engine.ts`,
temporarily revert `loadWorkerAndLanguage()`'s `onError`/`cleanup` back to the
pre-Step-3 shape (delete the `onError` function and the
`this.worker.addEventListener( 'error', onError )` line; put
`this.worker?.removeEventListener( 'message', onMessage )` directly back in
the two branches that called `cleanup()`).

Run:

```bash
npm run build
npx playwright test e2e/narration-worker-error.spec.ts -g "shows an error instead of hanging"
```

Expected: **FAIL** (times out waiting for the alert — the exact hang Step 3
exists to fix). Revert the temporary change back.

**9b — the retry test**: in the same file, temporarily revert `load()` to its
pre-Step-3 shape (no `try`/`catch`, no `loadWorkerAndLanguage()` — just the
single un-retried attempt).

Run:

```bash
npm run build
npx playwright test e2e/narration-worker-error.spec.ts -g "retries single-threaded"
```

Expected: **FAIL** (times out waiting for "Save narration" — with no retry,
the first attempt's corruption is the only attempt, and it now surfaces as a
visible error rather than completing). Revert the temporary change back.

Rebuild and re-run both tests once more to confirm both pass again. Leave
`tts-engine.ts` exactly as Step 3 left it —
`git diff features/narration/editor/engine/tts-engine.ts` must show only
Step 3's changes before continuing.

- [ ] **Step 10: Commit**

```bash
git add features/narration/editor/engine/pocket-tts.worker.js features/narration/editor/engine/tts-engine.ts features/narration/editor/index.tsx e2e/narration-worker-error.spec.ts TESTING.md docs/superpowers/specs/2026-08-21-narration-worker-cross-origin-isolation-design.md
git commit -m "fix: construct the narration Worker so it survives cross-origin isolation

Three stacked causes, each confirmed live (see the spec this commits
alongside): the Worker's own script is a static asset that never gets a
COEP header, so new Worker() silently failed once the document became
crossOriginIsolated (Task 1) - fixed by constructing it from a blob: of
its own fetched contents. onnxruntime-web's threaded WASM backend calls
importScripts(), unsupported in module-type workers in any version -
fixed by dropping { type: 'module' }, which this worker only needed for
its own static imports. Once classic, its one dynamic import() (the
tokenizer) tried to load a lazy chunk from the wrong URL, because
webpack's publicPath auto-detection breaks against a blob: origin -
fixed by making that import static too, removing the lazy chunk
entirely. The blob URL is revoked immediately after construction -
confirmed empirically that this does not break anything - so this does
not leak one Blob reference per load.

Also: PocketTtsEngine.load()/setLanguage()/generate() never listened for
the Worker's own 'error' event, so any future construction or runtime
failure - not just this one - would hang forever instead of surfacing.
Fixed alongside, with a dedicated regression test.

Also: load() now retries once, forcing single-thread, if the first
(multi-thread) attempt fails while the document is crossOriginIsolated -
defence in depth for a browser-specific WASM-threading incompatibility
we have not hit and have not tested for (only Chrome was available this
session; the plugin also targets Safari/Firefox, per the Fase 1 spec).
Retries on any failure, not just threading-looking ones - matching error
messages reliably across onnxruntime-web versions is not possible, and a
spare retry is cheap. Scoped to the first load only, not a later,
independent setLanguage() call - see the spec's 'Achado 4' for why. When
the retry succeeds, the panel shows a non-blocking snackbar so the
author knows generation is running in the slower mode, instead of the
fallback being entirely silent. Covered by a second regression test
alongside the first.

Refs #5"
```

---

## Task 4: E2E coverage proving the headers land, and stay scoped

**Files:**
- Create: `e2e/narration-performance.spec.ts`
- Modify: `TESTING.md`

**Interfaces:**
- Consumes: `admin.visitAdminPage( adminPath: string, query?: string ): Promise<void>` and `page.evaluate( () => window.crossOriginIsolated ): Promise<boolean>` — both already used elsewhere in this suite (`e2e/player-style.spec.ts`, `e2e/narration-fallbacks.spec.ts`).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the three scenarios**

`e2e/narration-performance.spec.ts`:

```typescript
import { test, expect } from '@wordpress/e2e-test-utils-playwright';

// No post content, no generation, no model download: these three scenarios
// only need to observe response headers on a page load, so they stay cheap —
// unlike almost everything else in this suite (see TESTING.md).

test( 'sends the isolation headers on the post editor by default', async ( {
	admin,
	page,
} ) => {
	await admin.visitAdminPage( 'post-new.php' );
	expect( await page.evaluate( () => window.crossOriginIsolated ) ).toBe(
		true
	);
} );

test( 'does not send the isolation headers on an unrelated admin screen', async ( {
	admin,
	page,
} ) => {
	await admin.visitAdminPage( 'edit.php' );
	expect( await page.evaluate( () => window.crossOriginIsolated ) ).toBe(
		false
	);
} );

test( 'does not send the isolation headers when editing a different post type', async ( {
	admin,
	page,
} ) => {
	await admin.visitAdminPage( 'post-new.php', 'post_type=page' );
	expect( await page.evaluate( () => window.crossOriginIsolated ) ).toBe(
		false
	);
} );
```

- [ ] **Step 2: Run it once and confirm all three pass (proves GREEN, not RED — the fix already ships)**

```bash
npm run build
npx playwright test e2e/narration-performance.spec.ts
```

Expected: 3 passed.

- [ ] **Step 3: Prove each assertion can actually fail — temporarily break the code it guards, one at a time**

This is the substitute for a pre-implementation RED: the feature already exists, so RED comes from deliberately reintroducing the exact bug this branch fixed and watching the new test catch it, then restoring the fix.

**3a — the hook bug** (this is the actual regression the "Achado de investigação" section of the spec found — reproduce it to prove the first test catches it):

In `features/narration/php/class-editor-headers.php`, temporarily change:

```php
		add_action( 'admin_init', array( self::class, 'maybe_send_headers' ) );
```

to:

```php
		add_action( 'send_headers', array( self::class, 'maybe_send_headers' ) );
```

Run:

```bash
npm run refresh:php
npx playwright test e2e/narration-performance.spec.ts -g "sends the isolation headers on the post editor by default"
```

Expected: **FAIL** (`crossOriginIsolated` is `false` — `send_headers` never fires on `wp-admin`, per the spec's investigation). Revert the change back to `admin_init`, run `npm run refresh:php` again, and re-run the same command to confirm it passes again.

**3b — the post-type scoping bug**:

In `features/narration/php/class-editor-headers.php`, temporarily change:

```php
	public static function is_editor_screen( string $pagenow, string $post_type ): bool {
		return in_array( $pagenow, array( 'post.php', 'post-new.php' ), true ) && 'post' === $post_type;
	}
```

to:

```php
	public static function is_editor_screen( string $pagenow, string $post_type ): bool {
		return in_array( $pagenow, array( 'post.php', 'post-new.php' ), true );
	}
```

Run:

```bash
npm run refresh:php
npx playwright test e2e/narration-performance.spec.ts -g "does not send the isolation headers when editing a different post type"
```

Expected: **FAIL** (`crossOriginIsolated` is `true` on the Page editor — exactly the over-broad scope the spec's "Achado de investigação — escopo por post type" section found and closed). Revert the change, run `npm run refresh:php` again, confirm it passes again.

Leave the file exactly as Task 1 committed it when done — `git diff features/narration/php/class-editor-headers.php` must be empty before continuing.

- [ ] **Step 4: Update `TESTING.md`'s scenario count and family list**

Change the summary table row (Task 3 already moved this from 37 to 39 for
`narration-worker-error.spec.ts`'s two scenarios — this step adds three more
on top):

```
| `npm run test:e2e` | Playwright, 39 scenarios | all pass | ~20-25min |
```

to:

```
| `npm run test:e2e` | Playwright, 42 scenarios | all pass | ~20-25min |
```

Change:

```
The 39 scenarios split in five families, plus the performance ceiling
described further below.
```

to:

```
The 42 scenarios split in six families, plus the performance ceiling
described further below.
```

After the paragraph Task 3 inserted (begins "Two more, in
`narration-worker-error.spec.ts`...") and before the one that begins "Five
more, in `player-style.spec.ts`...", insert:

```markdown
Three more, in `narration-performance.spec.ts`: the post editor gets the
`crossOriginIsolated`-enabling headers by default, an unrelated admin
screen does not, and neither does the post editor's own `$pagenow` when
editing a different post type (a Page, or any third-party CPT — see the
2026-08-21 performance spec's investigation for why that distinction
matters: `post.php`/`post-new.php` are shared by every post type). All
three are page-load-only — no post content, no generation, no model
download — so they run in well under a second each.
```

- [ ] **Step 5: Run the full E2E suite to confirm nothing else regressed**

```bash
npm run build && npm run test:e2e
```

Expected: all scenarios pass (42 + the performance ceiling).

- [ ] **Step 6: Commit**

```bash
git add e2e/narration-performance.spec.ts TESTING.md
git commit -m "test: cover COOP/COEP header scoping with a dedicated E2E spec

Proves the headers are present by default on the post editor, absent on
an unrelated admin screen, and absent when the pagenow is shared with a
different post type (Page, third-party CPT) - closing the coverage gap
the spec's investigation found (send_headers never firing, and the
missing post_type filter).

Refs #5"
```

---

## Task 5: Manual RTF benchmark

Not a CI gate (see spec's "Decisão" table — RTF is machine-dependent, a hard-gate would be flaky). This task produces the numbers the issue's checklist and `CLAUDE.md`'s PR process ask for, and records them in the spec.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-21-narration-tts-performance-coop-coep-design.md`

- [ ] **Step 1: Prepare a short post and a long post**

Via the block editor (`npm run build` first if not already built this session), create two draft posts:
- "RTF bench — short": one paragraph, ~40 words.
- "RTF bench — long": several paragraphs, ~800+ words (long enough to span many of the worker's internal ~50-token chunks — see the audio-quality spec for why that matters to this model specifically).

- [ ] **Step 2: Measure multi-thread (today's default — Task 1's headers are live, Task 3's Worker fix makes it actually run)**

For each post: open the Narration panel, open the browser's DevTools console, click Generate, and immediately run `console.time('gen')` then, when the "Save narration" button appears, `console.timeEnd('gen')` — or simpler, note wall-clock start/end with a stopwatch. Once generation finishes, note the resulting `<audio>` element's duration (visible in the mini-player, or `document.querySelector('audio').duration` in the console).

Compute `RTF = elapsed_seconds / audio_duration_seconds` for each post.

- [ ] **Step 3: Measure single-thread (headers forced off, for comparison)**

In DevTools, add a request-blocking rule (Network tab → right-click the `post-new.php` document request → "Block request URL", or use `page.route` via a one-off Playwright script) that strips `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` from the response — the same technique `e2e/narration-fallbacks.spec.ts` uses. Reload, confirm `window.crossOriginIsolated === false` in the console, then repeat Step 2's timing for both posts.

- [ ] **Step 4: Record the four numbers in the spec**

Append to `docs/superpowers/specs/2026-08-21-narration-tts-performance-coop-coep-design.md`, after the last "Achado de investigação" section and before "## Mudanças":

```markdown
## Resultado do benchmark manual de RTF

Medido em `[preencher: descrição da máquina, ex. modelo de CPU e núcleos]`,
`[preencher: data]`:

| Post | Multi-thread (RTF) | Single-thread (RTF) | Ganho |
|---|---|---|---|
| Curto (~40 palavras) | `[preencher]` | `[preencher]` | `[preencher]`x |
| Longo (~800+ palavras) | `[preencher]` | `[preencher]` | `[preencher]`x |
```

Fill in the four measured numbers and the computed ratio — do not leave the placeholders in the committed version.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-08-21-narration-tts-performance-coop-coep-design.md
git commit -m "docs: record manual RTF benchmark (multi-thread vs single-thread)

Refs #5"
```

---

## Task 6: Full local CI gate

Per `CLAUDE.md`, no PR opens before this is green, in this order (cheap to expensive):

- [ ] **Step 1: Run every gate**

```bash
npm run lint:js
npx tsc --noEmit
composer run lint
composer run stan
npm run test:unit -- --coverage
npm run test:php
npm run test:php:coverage
npm run i18n:check
npm run audit:npm:production && npm run audit:npm && npm run audit:composer
npm run build && npm run test:e2e
```

- [ ] **Step 2: If anything fails, stop**

Do not weaken a gate or skip a check to force green. Report: what failed (actual output), the root cause, two or three fix options with cost/risk, and a recommendation — then wait. This applies even to something that looks unrelated to this branch's changes.

- [ ] **Step 3: If everything passes, hand off to code review**

Invoke `superpowers:requesting-code-review` per `CLAUDE.md` — this is outside this plan's scope (it dispatches a reviewer subagent against the branch's full diff). Only after that returns clean, and only if the user asks for a PR, does one get opened.
