# Narration Performance — COOP/COEP Editor Headers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy` headers on the narration editor screen only, so `self.crossOriginIsolated` is `true` there and the Worker's ONNX runtime runs WASM multi-threaded instead of always falling back to single-thread.

**Architecture:** One new PHP class, `Post_Voice_Editor_Headers`, hooks `admin_init` and sends the two headers only when `$pagenow` is `post.php`/`post-new.php` **and** the post type being edited is `post`. The E2E-only mu-plugin that used to stand in for this (on the wrong hook, so it never actually worked on the editor screen) is deleted. New E2E coverage proves the headers land by default and stay scoped.

**Tech Stack:** PHP 8.2+ (WordPress 6.6+ admin hooks), PHPUnit (`WP_UnitTestCase`), Playwright (`@wordpress/e2e-test-utils-playwright`).

**Spec:** `docs/superpowers/specs/2026-08-21-narration-tts-performance-coop-coep-design.md`

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
- Produces: `Post_Voice_Editor_Headers::register(): void`, `Post_Voice_Editor_Headers::is_editor_screen( string $pagenow, string $post_type ): bool` (public, pure). Task 2 and Task 3 rely only on the *behavior* (headers present/absent on given URLs), not on calling these directly.

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

## Task 3: E2E coverage proving the headers land, and stay scoped

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

Change the summary table row:

```
| `npm run test:e2e` | Playwright, 37 scenarios | all pass | ~20-25min |
```

to:

```
| `npm run test:e2e` | Playwright, 40 scenarios | all pass | ~20-25min |
```

Change:

```
The 37 scenarios split in four families, plus the performance ceiling
described further below.
```

to:

```
The 40 scenarios split in five families, plus the performance ceiling
described further below.
```

After the existing paragraph that begins "Two more, in `narration-audio-quality.spec.ts`..." and before the one that begins "Five more, in `player-style.spec.ts`...", insert:

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

Expected: all scenarios pass (40 + the performance ceiling).

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

## Task 4: Manual RTF benchmark

Not a CI gate (see spec's "Decisão" table — RTF is machine-dependent, a hard-gate would be flaky). This task produces the numbers the issue's checklist and `CLAUDE.md`'s PR process ask for, and records them in the spec.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-21-narration-tts-performance-coop-coep-design.md`

- [ ] **Step 1: Prepare a short post and a long post**

Via the block editor (`npm run build` first if not already built this session), create two draft posts:
- "RTF bench — short": one paragraph, ~40 words.
- "RTF bench — long": several paragraphs, ~800+ words (long enough to span many of the worker's internal ~50-token chunks — see the audio-quality spec for why that matters to this model specifically).

- [ ] **Step 2: Measure multi-thread (today's default — Task 1's headers are live)**

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

## Task 5: Full local CI gate

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
