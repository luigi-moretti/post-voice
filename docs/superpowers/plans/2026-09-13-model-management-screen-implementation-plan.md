# Model Management Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Models" section to `Configurações → Narration` listing the 5
Pocket TTS language bundles, letting the author see which are downloaded (with
real size), download one on demand with live progress, cancel, retry after an
error, and remove one to free space — all against the browser's own Cache API,
never the server.

**Architecture:** A static PHP-rendered table (`Post_Voice_Models_Section`,
same pattern as `Post_Voice_Style_Section`/`Post_Voice_Dictionary_Section`)
enhanced by a small vanilla-TypeScript layer (`features/narration/admin/`,
new webpack entry `models-admin`). Four leaf modules do the Cache-API work —
`model-manifest.ts` (resolve a bundle's file list), `bundle-status.ts`
(is a bundle fully downloaded?), `bundle-size.ts` (measure/delete cached
bytes), `download-queue.ts` (fetch, cache, queue, cancel, classify errors) —
and are unit-tested in Jest with hand-written `fetch`/`caches` stand-ins, the
same style already used by `bundle-cache-status.test.ts`. `models-table.ts`
renders state into the DOM; `index.ts` wires it all together and is the one
file with no dedicated test (thin orchestration glue, same as
`editor/index.tsx` today).

**Tech Stack:** WordPress Settings API (PHP 8.2, `declare(strict_types=1)`),
TypeScript compiled by `wp-scripts`/webpack, Jest (`@wordpress/scripts`
preset), PHPUnit (`WP_UnitTestCase`), Cache API + `fetch` (browser), gettext
via `@wordpress/i18n` / WordPress `__()`.

**Spec:** `docs/superpowers/specs/2026-09-12-model-management-screen-design.md`

## Global Constraints

- Every user-facing string goes through gettext, domain `post-voice` (ADR-0010).
- No cross-feature TypeScript/PHP imports; everything here stays inside
  `features/narration/` (ADR-0004/0005).
- The server never touches model bytes — no REST route, no PHP state for
  download status (ADR-0002, ADR-0008, ADR-0009).
- `MODEL_BASE_URL` and the pinned commit SHA inside it are never touched by
  this work (contract pin, `CLAUDE.md`).
- Pure TypeScript → Jest; nothing here touches Worker or ONNX, so no new E2E
  scenario is added (ADR-0012, and explicit user decision in the spec).
- Jest coverage gate is 80% lines on every file listed in
  `jest.config.js`'s `collectCoverageFrom` (`CLAUDE.md`).
- PHP classes: prefix `Post_Voice_`, one per file, `class-*.php`, required by
  hand in `post-voice.php` — no autoloader (ADR-0006).
- Cache name is the literal string `post-voice-models-v1`, duplicated per
  file rather than imported from `engine/model-cache.ts` — same reasoning
  `bundle-cache-status.ts` already documents (avoid coupling this screen to
  the vendored worker file, ADR-0011).

---

## Task 1: PHP "Models" section — static table, no JS content yet

**Files:**
- Create: `features/narration/php/class-models-section.php`
- Create: `features/narration/admin/index.ts` (placeholder — filled in Task 8)
- Create: `features/narration/admin/style.scss` (placeholder — filled in Task 8)
- Modify: `post-voice.php`
- Modify: `webpack.config.js`
- Test: `features/narration/tests/php/test-models-section.php`

**Interfaces:**
- Consumes: `Post_Voice_Model::ALLOWED_LANGUAGES` (`features/narration/php/class-model.php`), `Post_Voice_Settings_Page::MENU_SLUG`/`is_current_screen()` (`shared/php/class-settings-page.php`).
- Produces: the HTML contract every later JS module relies on — `<table id="post-voice-models">`, one `<tr data-language="...">` per bundle, each with a `.post-voice-model-status`, `.post-voice-model-size` and `.post-voice-model-actions` cell.

- [ ] **Step 1: Write the failing PHPUnit test**

```php
<?php
/**
 * Tests for the model management section.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

/**
 * @covers Post_Voice_Models_Section
 */
class Test_Post_Voice_Models_Section extends WP_UnitTestCase {

	use Post_Voice_Fires_Admin_Init;
	use Post_Voice_With_Asset_File;

	private function asset_file(): string {
		return POST_VOICE_PATH . 'build/models-admin.asset.php';
	}

	protected function setUp(): void {
		parent::setUp();
		$this->recover_parked_asset_file( $this->asset_file() );
		$GLOBALS['wp_scripts'] = new WP_Scripts();
		$GLOBALS['wp_styles']  = new WP_Styles();
	}

	protected function tearDown(): void {
		global $wp_settings_sections;
		unset( $wp_settings_sections[ Post_Voice_Settings_Page::MENU_SLUG ] );
		$this->tear_down_asset_files();
		parent::tearDown();
	}

	public function test_section_is_registered_on_the_settings_screen(): void {
		global $wp_settings_sections;
		set_current_screen( 'dashboard' );
		Post_Voice_Models_Section::register();
		self::fire_admin_init();

		$this->assertArrayHasKey(
			'post_voice_models_section',
			$wp_settings_sections[ Post_Voice_Settings_Page::MENU_SLUG ]
		);
	}

	public function test_render_lists_one_row_per_allowed_language(): void {
		ob_start();
		Post_Voice_Models_Section::render();
		$html = (string) ob_get_clean();

		foreach ( Post_Voice_Model::ALLOWED_LANGUAGES as $language ) {
			$this->assertStringContainsString( 'data-language="' . $language . '"', $html );
		}
		$this->assertStringContainsString( 'Kyutai Pocket TTS', $html );
		$this->assertStringContainsString( 'Portuguese', $html );
	}

	public function test_render_lists_all_eight_voices_inside_a_details_element(): void {
		ob_start();
		Post_Voice_Models_Section::render();
		$html = (string) ob_get_clean();

		$this->assertStringContainsString( '<details>', $html );
		foreach ( array( 'alba', 'azelma', 'cosette', 'eponine', 'fantine', 'javert', 'jean', 'marius' ) as $voice ) {
			$this->assertStringContainsString( '<li>' . $voice . '</li>', $html );
		}
	}

	public function test_render_status_and_size_start_as_placeholders(): void {
		ob_start();
		Post_Voice_Models_Section::render();
		$html = (string) ob_get_clean();

		// Correct before any JavaScript runs, and correct if it never does —
		// same reasoning as the player-style preview's own placeholder.
		$this->assertStringContainsString( 'post-voice-model-status', $html );
		$this->assertStringContainsString( 'role="status"', $html );
		$this->assertStringContainsString( 'post-voice-model-size', $html );
		$this->assertStringContainsString( 'post-voice-model-actions', $html );
	}

	public function test_enqueue_ignores_another_screen(): void {
		Post_Voice_Models_Section::enqueue( 'post.php' );

		$this->assertFalse( wp_script_is( 'post-voice-models-admin', 'enqueued' ) );
	}

	public function test_enqueue_loads_the_script_on_this_screen(): void {
		$this->with_asset_file( $this->asset_file() );

		Post_Voice_Models_Section::enqueue( 'settings_page_post-voice' );

		$this->assertTrue( wp_script_is( 'post-voice-models-admin', 'enqueued' ) );
		$this->assertTrue( wp_style_is( 'post-voice-models-admin', 'enqueued' ) );
	}

	public function test_enqueue_skips_everything_when_the_plugin_was_never_built(): void {
		$this->without_asset_file( $this->asset_file() );

		Post_Voice_Models_Section::enqueue( 'settings_page_post-voice' );

		$this->assertFalse( wp_script_is( 'post-voice-models-admin', 'enqueued' ) );
		$this->assertFalse( wp_style_is( 'post-voice-models-admin', 'enqueued' ) );
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:php -- --filter Test_Post_Voice_Models_Section`
Expected: FAIL — `Class "Post_Voice_Models_Section" not found`.

- [ ] **Step 3: Write `class-models-section.php`**

```php
<?php
/**
 * The model management section of the settings screen.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Lists the five Pocket TTS language bundles and lets the author download or
 * remove each one. No option is registered here — nothing on this screen is
 * persisted server-side; what is "downloaded" lives entirely in the
 * browser's own Cache API (see the design doc this implements). The table's
 * Status/Tamanho/Ações cells render as neutral placeholders and are filled
 * in by `models-admin.js`, which is the only thing that can answer "is this
 * downloaded" — the server never knows.
 */
class Post_Voice_Models_Section {

	private const SECTION = 'post_voice_models_section';

	/**
	 * The predefined voices every Pocket TTS bundle ships, identical in
	 * every language — duplicated from `VOICES` in `editor/voice-catalog.ts`
	 * because there is no path from a TypeScript module into PHP.
	 */
	private const VOICES = array( 'alba', 'azelma', 'cosette', 'eponine', 'fantine', 'javert', 'jean', 'marius' );

	/**
	 * Hook the section and this screen's assets.
	 */
	public static function register(): void {
		add_action( 'admin_init', array( self::class, 'register_section' ) );
		add_action( 'admin_enqueue_scripts', array( self::class, 'enqueue' ) );
	}

	/**
	 * Register the section only — no option, nothing to sanitise.
	 */
	public static function register_section(): void {
		add_settings_section(
			self::SECTION,
			__( 'Models', 'post-voice' ),
			array( self::class, 'render' ),
			Post_Voice_Settings_Page::MENU_SLUG
		);
	}

	/**
	 * Load the table-management script, on this screen only.
	 *
	 * @param string $hook_suffix Current admin page.
	 */
	public static function enqueue( $hook_suffix ): void {
		if ( ! Post_Voice_Settings_Page::is_current_screen( (string) $hook_suffix ) ) {
			return;
		}

		$asset_file = POST_VOICE_PATH . 'build/models-admin.asset.php';
		if ( ! file_exists( $asset_file ) ) {
			return;
		}
		$asset = require $asset_file;

		wp_enqueue_style(
			'post-voice-models-admin',
			POST_VOICE_URL . 'build/style-models-admin.css',
			array(),
			$asset['version']
		);
		wp_enqueue_script(
			'post-voice-models-admin',
			POST_VOICE_URL . 'build/models-admin.js',
			$asset['dependencies'],
			$asset['version'],
			true
		);
		wp_set_script_translations( 'post-voice-models-admin', 'post-voice', POST_VOICE_PATH . 'languages' );
	}

	/**
	 * Render the table: one row per allowed language.
	 */
	public static function render(): void {
		?>
		<p><?php esc_html_e( 'Each language is a separate ~199 MB download, stored in this browser only.', 'post-voice' ); ?></p>
		<table class="widefat striped" id="post-voice-models">
			<thead>
				<tr>
					<th scope="col"><?php esc_html_e( 'Model', 'post-voice' ); ?></th>
					<th scope="col"><?php esc_html_e( 'Language', 'post-voice' ); ?></th>
					<th scope="col"><?php esc_html_e( 'Voice', 'post-voice' ); ?></th>
					<th scope="col"><?php esc_html_e( 'Status', 'post-voice' ); ?></th>
					<th scope="col"><?php esc_html_e( 'Size', 'post-voice' ); ?></th>
					<th scope="col"><span class="screen-reader-text"><?php esc_html_e( 'Actions', 'post-voice' ); ?></span></th>
				</tr>
			</thead>
			<tbody>
				<?php foreach ( Post_Voice_Model::ALLOWED_LANGUAGES as $language ) : ?>
				<tr data-language="<?php echo esc_attr( $language ); ?>">
					<td>Kyutai Pocket TTS</td>
					<td><?php echo esc_html( self::language_label( $language ) ); ?></td>
					<td><?php self::render_voices(); ?></td>
					<td class="post-voice-model-status" role="status"><?php esc_html_e( 'Checking…', 'post-voice' ); ?></td>
					<td class="post-voice-model-size">—</td>
					<td class="post-voice-model-actions"></td>
				</tr>
				<?php endforeach; ?>
			</tbody>
		</table>
		<?php
	}

	/**
	 * Human-readable name for a bundle identifier.
	 *
	 * Kept in PHP rather than imported from `editor/language-labels.ts` — a
	 * server-rendered admin screen and a TypeScript panel are different
	 * runtimes, so this small map is inherent duplication, not a shortcut.
	 *
	 * @param string $language Bundle identifier, e.g. `portuguese`.
	 */
	private static function language_label( string $language ): string {
		switch ( $language ) {
			case 'english_2026-04':
				return __( 'English', 'post-voice' );
			case 'german':
				return __( 'German', 'post-voice' );
			case 'italian':
				return __( 'Italian', 'post-voice' );
			case 'portuguese':
				return __( 'Portuguese', 'post-voice' );
			case 'spanish':
				return __( 'Spanish', 'post-voice' );
			default:
				return $language;
		}
	}

	/**
	 * Render the Voice cell: a count that expands to the full list. Fully
	 * static — the eight voices never vary by language or by download state
	 * — so this needs no JavaScript.
	 */
	private static function render_voices(): void {
		$count = count( self::VOICES );
		?>
		<details>
			<summary>
				<?php
				echo esc_html(
					sprintf(
						/* translators: %d: number of voices. */
						_n( '%d voice', '%d voices', $count, 'post-voice' ),
						$count
					)
				);
				?>
			</summary>
			<ul class="post-voice-model-voices">
				<?php foreach ( self::VOICES as $voice ) : ?>
				<li><?php echo esc_html( $voice ); ?></li>
				<?php endforeach; ?>
			</ul>
		</details>
		<?php
	}
}
```

- [ ] **Step 4: Create the placeholder JS entry and stylesheet**

`features/narration/admin/index.ts`:

```ts
// Filled in by Task 8 of the model-management-screen implementation plan.
// Placeholder kept trivial so `models-admin` is a valid webpack entry from
// the first commit that references it.
export {};
```

`features/narration/admin/style.scss`:

```scss
// Filled in by Task 8.
```

- [ ] **Step 5: Wire the webpack entry**

In `webpack.config.js`, add to the `entry` object (after `player-style-admin`):

```js
		'models-admin': path.resolve(
			__dirname,
			'features/narration/admin/index.ts'
		),
```

- [ ] **Step 6: Wire the plugin bootstrap**

In `post-voice.php`, add after the `class-style-section.php` require:

```php
require_once POST_VOICE_PATH . 'features/narration/php/class-models-section.php';
```

And after `Post_Voice_Style_Section::register();`:

```php
Post_Voice_Models_Section::register();
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm run test:php -- --filter Test_Post_Voice_Models_Section`
Expected: PASS, 7 tests.

- [ ] **Step 8: Gates for this task**

Run: `composer run lint && composer run stan && npm run lint:arch`
Expected: clean — no PHP standards or static-analysis violations, and the
new file stays inside `features/narration/`, so `lint:arch` sees no new
cross-feature edge.

- [ ] **Step 9: Commit**

```bash
git add features/narration/php/class-models-section.php \
  features/narration/admin/index.ts features/narration/admin/style.scss \
  features/narration/tests/php/test-models-section.php \
  post-voice.php webpack.config.js
git commit -m "feat(narration): add Models settings section shell"
```

---

## Task 2: `model-manifest.ts` — resolve a bundle's file list

**Files:**
- Create: `features/narration/admin/model-manifest.ts`
- Test: `features/narration/tests/js/model-manifest.test.ts`
- Modify: `jest.config.js`

**Interfaces:**
- Consumes: `MODEL_BASE_URL` from `features/narration/editor/model-source.ts`.
- Produces: `bundleUrl(language, filename): string`, `bundleJsonUrl(language): string`, `STATIC_BUNDLE_FILES: readonly string[]`, `resolveBundleFiles(language, manifest: BundleManifest): BundleFile[]`, and the `BundleManifest`/`BundleFile` types — consumed by Task 3 (`bundle-status.ts`) and Task 5 (`download-queue.ts`).

- [ ] **Step 1: Write the failing test**

```ts
import {
	bundleJsonUrl,
	bundleUrl,
	resolveBundleFiles,
	STATIC_BUNDLE_FILES,
} from '../../admin/model-manifest';
import { MODEL_BASE_URL } from '../../editor/model-source';

describe( 'bundleUrl / bundleJsonUrl', () => {
	it( 'builds a URL under the language folder', () => {
		expect( bundleUrl( 'portuguese', 'voices.bin' ) ).toBe(
			`${ MODEL_BASE_URL }portuguese/voices.bin`
		);
		expect( bundleJsonUrl( 'portuguese' ) ).toBe(
			`${ MODEL_BASE_URL }portuguese/bundle.json`
		);
	} );
} );

describe( 'resolveBundleFiles', () => {
	it( 'includes bundle.json, the six static files and the tokenizer, without bos_before_voice_file', () => {
		const files = resolveBundleFiles( 'italian', {
			tokenizer_file: 'tokenizer.json',
		} );

		expect( files ).toHaveLength( 8 );
		expect( files.map( ( f ) => f.filename ) ).toEqual( [
			'bundle.json',
			...STATIC_BUNDLE_FILES,
			'tokenizer.json',
		] );
		expect(
			files.find( ( f ) => f.filename === 'tokenizer.json' )?.url
		).toBe( `${ MODEL_BASE_URL }italian/tokenizer.json` );
	} );

	it( 'includes bos_before_voice_file when the manifest has one', () => {
		const files = resolveBundleFiles( 'german', {
			tokenizer_file: 'tokenizer.json',
			bos_before_voice_file: 'bos_before_voice.bin',
		} );

		expect( files ).toHaveLength( 9 );
		expect( files.map( ( f ) => f.filename ) ).toContain(
			'bos_before_voice.bin'
		);
	} );
} );
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- model-manifest`
Expected: FAIL — cannot find module `../../admin/model-manifest`.

- [ ] **Step 3: Write the implementation**

```ts
import { MODEL_BASE_URL } from '../editor/model-source';

/**
 * The fields of `bundle.json` this admin screen actually reads. The real
 * file has many more (sample rate, state manifests, ...) — irrelevant here,
 * since this screen never runs inference, only downloads and caches.
 */
export interface BundleManifest {
	tokenizer_file: string;
	bos_before_voice_file?: string;
}

export interface BundleFile {
	filename: string;
	url: string;
}

/**
 * The five ONNX sessions plus the predefined-voice records, under the exact
 * names every bundle ships them as. Duplicated from `MODEL_STEMS` in
 * `pocket-tts.worker.js` rather than imported — importing the worker file
 * would couple this admin screen to a vendored file (ADR-0011), the same
 * reason `bundle-cache-status.ts` duplicates `CACHE_NAME` instead of
 * importing `engine/model-cache.ts`.
 */
export const STATIC_BUNDLE_FILES: readonly string[] = [
	'mimi_encoder_int8.onnx',
	'text_conditioner_int8.onnx',
	'flow_lm_main_int8.onnx',
	'flow_lm_flow_int8.onnx',
	'mimi_decoder_int8.onnx',
	'voices.bin',
];

/**
 * URL of one file inside a language's bundle folder.
 *
 * @param language Bundle identifier, e.g. `portuguese`.
 * @param filename File name inside that folder.
 */
export function bundleUrl( language: string, filename: string ): string {
	return `${ MODEL_BASE_URL }${ language }/${ filename }`;
}

/**
 * URL of a language's `bundle.json` — the one file whose name is not itself
 * inside the manifest, since it *is* the manifest.
 *
 * @param language Bundle identifier.
 */
export function bundleJsonUrl( language: string ): string {
	return bundleUrl( language, 'bundle.json' );
}

/**
 * Every file a bundle consists of: `bundle.json` itself, the six statically
 * named files, the always-present tokenizer, and — only when the manifest
 * names one — the BOS-before-voice file.
 *
 * @param language Bundle identifier.
 * @param manifest Already-parsed `bundle.json` for that language.
 */
export function resolveBundleFiles(
	language: string,
	manifest: BundleManifest
): BundleFile[] {
	const filenames = [
		'bundle.json',
		...STATIC_BUNDLE_FILES,
		manifest.tokenizer_file,
	];
	if ( manifest.bos_before_voice_file ) {
		filenames.push( manifest.bos_before_voice_file );
	}
	return filenames.map( ( filename ) => ( {
		filename,
		url: bundleUrl( language, filename ),
	} ) );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- model-manifest`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add the file to the coverage gate**

In `jest.config.js`, add to `collectCoverageFrom` (after `'features/narration/editor/bundle-cache-status.ts',`):

```js
		'features/narration/admin/model-manifest.ts',
```

- [ ] **Step 6: Run coverage to verify the gate is met**

Run: `npm run test:unit -- --coverage model-manifest`
Expected: 100% lines on `model-manifest.ts` (every branch is exercised by
the two `resolveBundleFiles` tests).

- [ ] **Step 7: Commit**

```bash
git add features/narration/admin/model-manifest.ts \
  features/narration/tests/js/model-manifest.test.ts jest.config.js
git commit -m "feat(narration): resolve a bundle's file list from its manifest"
```

---

## Task 3: `bundle-status.ts` — is a language fully downloaded?

**Files:**
- Create: `features/narration/admin/bundle-status.ts`
- Test: `features/narration/tests/js/bundle-status.test.ts`
- Modify: `jest.config.js`

**Interfaces:**
- Consumes: `bundleJsonUrl`, `resolveBundleFiles`, `BundleManifest` from `./model-manifest` (Task 2).
- Produces: `isBundleComplete(language: string): Promise<boolean>` — consumed by Task 8 (`index.ts`'s initial-state check).

- [ ] **Step 1: Write the failing test**

```ts
import { isBundleComplete } from '../../admin/bundle-status';
import { MODEL_BASE_URL } from '../../editor/model-source';

function fakeCache( entries: Record< string, unknown > ) {
	return {
		match: jest.fn( async ( url: string ) => entries[ url ] ),
	};
}

describe( 'isBundleComplete', () => {
	afterEach( () => {
		// @ts-expect-error — restoring the global the test replaced.
		delete global.caches;
	} );

	it( 'is false when the Cache API is unavailable', async () => {
		expect( await isBundleComplete( 'portuguese' ) ).toBe( false );
	} );

	it( 'is false when bundle.json itself was never cached, without checking anything else', async () => {
		const cache = fakeCache( {} );
		// @ts-expect-error — minimal CacheStorage stand-in.
		global.caches = { open: async () => cache };

		expect( await isBundleComplete( 'portuguese' ) ).toBe( false );
		expect( cache.match ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'is false when bundle.json is cached but a required file is missing — an interrupted download', async () => {
		const bundleJsonUrl = `${ MODEL_BASE_URL }portuguese/bundle.json`;
		const manifest = { tokenizer_file: 'tokenizer.json' };
		const cache = fakeCache( {
			[ bundleJsonUrl ]: {
				json: async () => manifest,
			},
			// `voices.bin`, the five .onnx files and `tokenizer.json` are all
			// absent — simulates a session that stopped right after the very
			// first file, which the naive "bundle.json alone" check would
			// have reported as complete.
		} );
		// @ts-expect-error — minimal CacheStorage stand-in.
		global.caches = { open: async () => cache };

		expect( await isBundleComplete( 'portuguese' ) ).toBe( false );
	} );

	it( 'is true when every resolved file is cached', async () => {
		const language = 'portuguese';
		const manifest = { tokenizer_file: 'tokenizer.json' };
		const entries: Record< string, unknown > = {
			[ `${ MODEL_BASE_URL }${ language }/bundle.json` ]: {
				json: async () => manifest,
			},
		};
		for ( const filename of [
			'mimi_encoder_int8.onnx',
			'text_conditioner_int8.onnx',
			'flow_lm_main_int8.onnx',
			'flow_lm_flow_int8.onnx',
			'mimi_decoder_int8.onnx',
			'voices.bin',
			'tokenizer.json',
		] ) {
			entries[ `${ MODEL_BASE_URL }${ language }/${ filename }` ] = {};
		}
		const cache = fakeCache( entries );
		// @ts-expect-error — minimal CacheStorage stand-in.
		global.caches = { open: async () => cache };

		expect( await isBundleComplete( language ) ).toBe( true );
	} );

	it( 'requires bos_before_voice_file too, when the manifest names one', async () => {
		const language = 'german';
		const manifest = {
			tokenizer_file: 'tokenizer.json',
			bos_before_voice_file: 'bos_before_voice.bin',
		};
		const entries: Record< string, unknown > = {
			[ `${ MODEL_BASE_URL }${ language }/bundle.json` ]: {
				json: async () => manifest,
			},
		};
		for ( const filename of [
			'mimi_encoder_int8.onnx',
			'text_conditioner_int8.onnx',
			'flow_lm_main_int8.onnx',
			'flow_lm_flow_int8.onnx',
			'mimi_decoder_int8.onnx',
			'voices.bin',
			'tokenizer.json',
			// bos_before_voice.bin intentionally missing.
		] ) {
			entries[ `${ MODEL_BASE_URL }${ language }/${ filename }` ] = {};
		}
		const cache = fakeCache( entries );
		// @ts-expect-error — minimal CacheStorage stand-in.
		global.caches = { open: async () => cache };

		expect( await isBundleComplete( language ) ).toBe( false );
	} );
} );
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- bundle-status`
Expected: FAIL — cannot find module `../../admin/bundle-status`.

- [ ] **Step 3: Write the implementation**

```ts
import {
	BundleManifest,
	bundleJsonUrl,
	resolveBundleFiles,
} from './model-manifest';

const CACHE_NAME = 'post-voice-models-v1';

/**
 * Whether every file of a language's bundle is present in the browser's
 * model cache, read-only — never fetches over the network, so calling this
 * for all five languages on every settings-page load is cheap.
 *
 * Deliberately stronger than `cachedBundles()` (`editor/bundle-cache-status.ts`),
 * which only probes `bundle.json` — the *first* file the worker fetches, so
 * a download interrupted right after it would read as complete there. This
 * checks every file the manifest actually requires, so an interrupted
 * session correctly reads as `Not downloaded` rather than `Downloaded`.
 *
 * @param language Bundle identifier, e.g. `portuguese`.
 */
export async function isBundleComplete(
	language: string
): Promise< boolean > {
	if ( typeof caches === 'undefined' ) {
		return false;
	}
	const cache = await caches.open( CACHE_NAME );
	const bundleJsonResponse = await cache.match( bundleJsonUrl( language ) );
	if ( ! bundleJsonResponse ) {
		return false;
	}

	const manifest: BundleManifest = await bundleJsonResponse.json();
	const files = resolveBundleFiles( language, manifest );
	const matches = await Promise.all(
		files.map( ( file ) => cache.match( file.url ) )
	);
	return matches.every( ( match ) => match !== undefined );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- bundle-status`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the file to the coverage gate**

In `jest.config.js`, add after the `model-manifest.ts` line from Task 2:

```js
		'features/narration/admin/bundle-status.ts',
```

- [ ] **Step 6: Run coverage to verify the gate is met**

Run: `npm run test:unit -- --coverage bundle-status`
Expected: 100% lines.

- [ ] **Step 7: Commit**

```bash
git add features/narration/admin/bundle-status.ts \
  features/narration/tests/js/bundle-status.test.ts jest.config.js
git commit -m "feat(narration): detect a fully-downloaded bundle without a network call"
```

---

## Task 4: `bundle-size.ts` — measure and delete cached bytes

**Files:**
- Create: `features/narration/admin/bundle-size.ts`
- Test: `features/narration/tests/js/bundle-size.test.ts`
- Modify: `jest.config.js`

**Interfaces:**
- Consumes: `MODEL_BASE_URL` from `features/narration/editor/model-source.ts`.
- Produces: `realBundleBytes(language: string): Promise<number>`, `deleteBundleFiles(language: string): Promise<void>` — consumed by Task 5 and Task 8.

- [ ] **Step 1: Write the failing test**

```ts
import { deleteBundleFiles, realBundleBytes } from '../../admin/bundle-size';
import { MODEL_BASE_URL } from '../../editor/model-source';

function fakeCache( sizes: Record< string, number > ) {
	const keys = Object.keys( sizes ).map( ( url ) => ( { url } ) );
	return {
		keys: jest.fn( async () => keys ),
		match: jest.fn( async ( request: { url: string } ) => ( {
			blob: async () => ( { size: sizes[ request.url ] } ),
		} ) ),
		delete: jest.fn( async () => true ),
	};
}

describe( 'realBundleBytes', () => {
	afterEach( () => {
		// @ts-expect-error — restoring the global the test replaced.
		delete global.caches;
	} );

	it( 'is 0 when the Cache API is unavailable', async () => {
		expect( await realBundleBytes( 'portuguese' ) ).toBe( 0 );
	} );

	it( 'sums only the entries under this language\'s prefix', async () => {
		const cache = fakeCache( {
			[ `${ MODEL_BASE_URL }portuguese/bundle.json` ]: 100,
			[ `${ MODEL_BASE_URL }portuguese/voices.bin` ]: 900,
			[ `${ MODEL_BASE_URL }german/bundle.json` ]: 50,
		} );
		// @ts-expect-error — minimal CacheStorage stand-in.
		global.caches = { open: async () => cache };

		expect( await realBundleBytes( 'portuguese' ) ).toBe( 1000 );
	} );

	it( 'is 0 when nothing of that language is cached', async () => {
		const cache = fakeCache( {
			[ `${ MODEL_BASE_URL }german/bundle.json` ]: 50,
		} );
		// @ts-expect-error — minimal CacheStorage stand-in.
		global.caches = { open: async () => cache };

		expect( await realBundleBytes( 'portuguese' ) ).toBe( 0 );
	} );
} );

describe( 'deleteBundleFiles', () => {
	afterEach( () => {
		// @ts-expect-error — restoring the global the test replaced.
		delete global.caches;
	} );

	it( 'deletes only entries under this language\'s prefix, leaving others', async () => {
		const cache = fakeCache( {
			[ `${ MODEL_BASE_URL }portuguese/bundle.json` ]: 100,
			[ `${ MODEL_BASE_URL }portuguese/voices.bin` ]: 900,
			[ `${ MODEL_BASE_URL }german/bundle.json` ]: 50,
		} );
		// @ts-expect-error — minimal CacheStorage stand-in.
		global.caches = { open: async () => cache };

		await deleteBundleFiles( 'portuguese' );

		expect( cache.delete ).toHaveBeenCalledTimes( 2 );
		expect( cache.delete ).not.toHaveBeenCalledWith(
			expect.objectContaining( {
				url: `${ MODEL_BASE_URL }german/bundle.json`,
			} )
		);
	} );

	it( 'is a no-op when the Cache API is unavailable', async () => {
		await expect( deleteBundleFiles( 'portuguese' ) ).resolves.toBeUndefined();
	} );
} );
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- bundle-size`
Expected: FAIL — cannot find module `../../admin/bundle-size`.

- [ ] **Step 3: Write the implementation**

```ts
import { MODEL_BASE_URL } from '../editor/model-source';

const CACHE_NAME = 'post-voice-models-v1';

function prefix( language: string ): string {
	return `${ MODEL_BASE_URL }${ language }/`;
}

/**
 * Real bytes a language's bundle occupies in the browser's model cache right
 * now — the sum of every cached response's body size under that language's
 * URL prefix. `0` if nothing of that language is cached, or outside a
 * secure context (no Cache API).
 *
 * @param language Bundle identifier, e.g. `portuguese`.
 */
export async function realBundleBytes( language: string ): Promise< number > {
	if ( typeof caches === 'undefined' ) {
		return 0;
	}
	const cache = await caches.open( CACHE_NAME );
	const keys = ( await cache.keys() ).filter( ( request ) =>
		request.url.startsWith( prefix( language ) )
	);
	const sizes = await Promise.all(
		keys.map( async ( request ) => {
			const response = await cache.match( request );
			if ( ! response ) {
				return 0;
			}
			return ( await response.blob() ).size;
		} )
	);
	return sizes.reduce( ( total, size ) => total + size, 0 );
}

/**
 * Delete every cached file of a language's bundle, whatever state it is in
 * — complete, partial, or a single stray file. Used for Remove, for the
 * pre-download residue cleanup, and for cleaning up after a cancelled or
 * failed download.
 *
 * @param language Bundle identifier.
 */
export async function deleteBundleFiles( language: string ): Promise< void > {
	if ( typeof caches === 'undefined' ) {
		return;
	}
	const cache = await caches.open( CACHE_NAME );
	const keys = ( await cache.keys() ).filter( ( request ) =>
		request.url.startsWith( prefix( language ) )
	);
	await Promise.all( keys.map( ( request ) => cache.delete( request ) ) );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- bundle-size`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the file to the coverage gate**

In `jest.config.js`, add after the `bundle-status.ts` line from Task 3:

```js
		'features/narration/admin/bundle-size.ts',
```

- [ ] **Step 6: Run coverage to verify the gate is met**

Run: `npm run test:unit -- --coverage bundle-size`
Expected: 100% lines.

- [ ] **Step 7: Commit**

```bash
git add features/narration/admin/bundle-size.ts \
  features/narration/tests/js/bundle-size.test.ts jest.config.js
git commit -m "feat(narration): measure and delete a language's cached bundle bytes"
```

---

## Task 5: `download-queue.ts` — `downloadBundle()`, the network/cache mechanics

**Files:**
- Create: `features/narration/admin/download-queue.ts`
- Test: `features/narration/tests/js/download-queue.test.ts`
- Modify: `jest.config.js`

**Interfaces:**
- Consumes: `resolveBundleFiles`, `bundleJsonUrl`, `BundleManifest` from `./model-manifest` (Task 2); `deleteBundleFiles` from `./bundle-size` (Task 4); `hasEnoughStorage` from `../editor/storage-check`.
- Produces: `DownloadError` (class, with `.reason: 'storage' | 'network' | 'unknown'`), `DownloadProgress` (`{receivedBytes, totalBytes}`), `downloadBundle(language, {signal, onProgress}): Promise<void>` — consumed by Task 6's queue wrapper, added to the same file.

- [ ] **Step 1: Write the failing test**

```ts
import { downloadBundle, DownloadError } from '../../admin/download-queue';
import { MODEL_BASE_URL } from '../../editor/model-source';

function fakeReader( chunkSizes: number[] ) {
	let i = 0;
	return {
		read: jest.fn( async () => {
			if ( i >= chunkSizes.length ) {
				return { done: true, value: undefined };
			}
			const value = new Uint8Array( chunkSizes[ i ] );
			i += 1;
			return { done: false, value };
		} ),
	};
}

function fakeResponse( {
	url,
	status = 200,
	contentLength,
	chunkSizes = [ contentLength ],
	jsonBody,
}: {
	url: string;
	status?: number;
	contentLength: number;
	chunkSizes?: number[];
	jsonBody?: unknown;
} ) {
	return {
		ok: status >= 200 && status < 300,
		status,
		url,
		headers: {
			get: ( name: string ) =>
				name === 'content-length' ? String( contentLength ) : null,
		},
		body: { getReader: () => fakeReader( chunkSizes ) },
		json: async () => jsonBody,
		clone() {
			return this;
		},
	};
}

function fakeCache() {
	const store = new Map< string, unknown >();
	return {
		store,
		match: jest.fn( async ( url: string ) => store.get( url ) ),
		put: jest.fn( async ( url: string, response: unknown ) => {
			store.set( url, response );
		} ),
		delete: jest.fn( async ( request: { url: string } ) => {
			store.delete( request.url );
		} ),
		keys: jest.fn( async () =>
			Array.from( store.keys() ).map( ( url ) => ( { url } ) )
		),
	};
}

const LANGUAGE = 'italian';
const MANIFEST = { tokenizer_file: 'tokenizer.json' };
const OTHER_FILENAMES = [
	'mimi_encoder_int8.onnx',
	'text_conditioner_int8.onnx',
	'flow_lm_main_int8.onnx',
	'flow_lm_flow_int8.onnx',
	'mimi_decoder_int8.onnx',
	'voices.bin',
	'tokenizer.json',
];

function urlFor( filename: string ): string {
	return `${ MODEL_BASE_URL }${ LANGUAGE }/${ filename }`;
}

describe( 'downloadBundle', () => {
	let cache: ReturnType< typeof fakeCache >;
	let fetchMock: jest.Mock;

	beforeEach( () => {
		cache = fakeCache();
		// @ts-expect-error — minimal CacheStorage stand-in.
		global.caches = { open: async () => cache };
		fetchMock = jest.fn( async ( url: string ) => {
			if ( url === urlFor( 'bundle.json' ) ) {
				return fakeResponse( {
					url,
					contentLength: 40,
					jsonBody: MANIFEST,
				} );
			}
			return fakeResponse( {
				url,
				contentLength: 100,
				chunkSizes: [ 60, 40 ],
			} );
		} );
		// @ts-expect-error — test double, not a full fetch implementation.
		global.fetch = fetchMock;
		Object.defineProperty( global.navigator, 'storage', {
			value: {
				estimate: async () => ( {
					quota: 10 * 1024 * 1024 * 1024,
					usage: 0,
				} ),
			},
			configurable: true,
		} );
	} );

	afterEach( () => {
		// @ts-expect-error — restoring the global the test replaced.
		delete global.caches;
		// @ts-expect-error — restoring the global the test replaced.
		delete global.fetch;
		// @ts-expect-error — restoring the global the test replaced.
		delete global.navigator.storage;
	} );

	it( 'caches bundle.json and every resolved file on success, reporting cumulative progress', async () => {
		const progress: Array< { receivedBytes: number; totalBytes: number } > =
			[];
		await downloadBundle( LANGUAGE, {
			signal: new AbortController().signal,
			onProgress: ( p ) => progress.push( { ...p } ),
		} );

		expect( cache.store.size ).toBe( 1 + OTHER_FILENAMES.length );
		expect( cache.store.has( urlFor( 'bundle.json' ) ) ).toBe( true );
		expect( cache.store.has( urlFor( 'voices.bin' ) ) ).toBe( true );

		const total = 40 + OTHER_FILENAMES.length * 100;
		const last = progress[ progress.length - 1 ];
		expect( last.totalBytes ).toBe( total );
		expect( last.receivedBytes ).toBe( total );
	} );

	it( 'clears any residue under this language\'s prefix before starting', async () => {
		cache.store.set( urlFor( 'bundle.json' ), fakeResponse( {
			url: urlFor( 'bundle.json' ),
			contentLength: 1,
		} ) );

		await downloadBundle( LANGUAGE, {
			signal: new AbortController().signal,
			onProgress: () => undefined,
		} );

		expect( cache.delete ).toHaveBeenCalled();
	} );

	it( 'rejects with a storage DownloadError when free space is insufficient, without fetching anything', async () => {
		Object.defineProperty( global.navigator, 'storage', {
			value: { estimate: async () => ( { quota: 100, usage: 0 } ) },
			configurable: true,
		} );

		await expect(
			downloadBundle( LANGUAGE, {
				signal: new AbortController().signal,
				onProgress: () => undefined,
			} )
		).rejects.toMatchObject( { reason: 'storage' } );
		expect( fetchMock ).not.toHaveBeenCalled();
	} );

	it( 'rejects with a network DownloadError when a file responds with an error status, and cleans up the cache', async () => {
		fetchMock.mockImplementation( async ( url: string ) => {
			if ( url === urlFor( 'bundle.json' ) ) {
				return fakeResponse( {
					url,
					contentLength: 40,
					jsonBody: MANIFEST,
				} );
			}
			if ( url === urlFor( 'voices.bin' ) ) {
				return fakeResponse( { url, status: 500, contentLength: 0 } );
			}
			return fakeResponse( { url, contentLength: 100 } );
		} );

		await expect(
			downloadBundle( LANGUAGE, {
				signal: new AbortController().signal,
				onProgress: () => undefined,
			} )
		).rejects.toBeInstanceOf( DownloadError );
		expect( cache.store.size ).toBe( 0 );
	} );

	it( 'cleans up and re-throws when the signal is aborted mid-download', async () => {
		const controller = new AbortController();
		fetchMock.mockImplementation( async ( url: string ) => {
			if ( url === urlFor( 'bundle.json' ) ) {
				return fakeResponse( {
					url,
					contentLength: 40,
					jsonBody: MANIFEST,
				} );
			}
			controller.abort();
			throw new DOMException( 'Aborted', 'AbortError' );
		} );

		await expect(
			downloadBundle( LANGUAGE, {
				signal: controller.signal,
				onProgress: () => undefined,
			} )
		).rejects.toBeTruthy();
		expect( cache.store.size ).toBe( 0 );
	} );
} );
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- download-queue`
Expected: FAIL — cannot find module `../../admin/download-queue`.

- [ ] **Step 3: Write `downloadBundle()`**

```ts
import { hasEnoughStorage } from '../editor/storage-check';
import {
	BundleManifest,
	bundleJsonUrl,
	resolveBundleFiles,
} from './model-manifest';
import { deleteBundleFiles } from './bundle-size';

const CACHE_NAME = 'post-voice-models-v1';

export type DownloadErrorReason = 'storage' | 'network' | 'unknown';

/**
 * A classified download failure. `reason` drives the message
 * `models-table.ts` shows — kept as a code here, not a translated string, so
 * this module stays free of `@wordpress/i18n` and trivially Jest-testable.
 */
export class DownloadError extends Error {
	public readonly reason: DownloadErrorReason;

	constructor( reason: DownloadErrorReason, message: string ) {
		super( message );
		this.reason = reason;
		this.name = 'DownloadError';
	}
}

export interface DownloadProgress {
	receivedBytes: number;
	totalBytes: number;
}

export interface DownloadOptions {
	signal: AbortSignal;
	onProgress: ( progress: DownloadProgress ) => void;
}

function contentLength( response: Response ): number {
	return Number( response.headers.get( 'content-length' ) ?? 0 );
}

async function readStreamCounting(
	response: Response,
	onChunk: ( bytes: number ) => void
): Promise< void > {
	const reader = response.body?.getReader();
	if ( ! reader ) {
		return;
	}
	for ( ;; ) {
		const { done, value } = await reader.read();
		if ( done ) {
			break;
		}
		onChunk( value.length );
	}
}

/**
 * Download and cache every file of one language's bundle.
 *
 * Clears any residue of a previous attempt under that language's prefix
 * first, so a retry (or recovering from a session that ended abruptly) never
 * mixes old and new files. Fetches `bundle.json` first — its
 * `tokenizer_file`/`bos_before_voice_file` fields are needed to know the
 * rest of the file list — then fetches everything else in parallel, so the
 * progress total is known almost immediately instead of growing as each
 * file finishes.
 *
 * Only a complete, successful (`200`) response is written to the cache —
 * the same rule the worker's own interceptor follows
 * (`engine/model-cache.ts`'s `installModelCache`). Cancelling (aborting
 * `options.signal`) or any failure deletes whatever was already written for
 * this language, so the cache never holds a partial bundle.
 *
 * @param language Bundle identifier, e.g. `portuguese`.
 * @param options  Abort signal and progress callback.
 */
export async function downloadBundle(
	language: string,
	options: DownloadOptions
): Promise< void > {
	if ( typeof caches === 'undefined' ) {
		throw new DownloadError(
			'unknown',
			'Cache API unavailable outside a secure context.'
		);
	}

	await deleteBundleFiles( language );

	try {
		if ( navigator.storage?.estimate ) {
			const estimate = await navigator.storage.estimate();
			if ( ! hasEnoughStorage( estimate ) ) {
				throw new DownloadError(
					'storage',
					'Not enough free storage for this model.'
				);
			}
		}

		const cache = await caches.open( CACHE_NAME );

		const bundleJsonResponse = await fetch( bundleJsonUrl( language ), {
			signal: options.signal,
		} );
		if ( ! bundleJsonResponse.ok ) {
			throw new DownloadError(
				'network',
				`bundle.json responded ${ bundleJsonResponse.status }`
			);
		}
		const bundleJsonForCache = bundleJsonResponse.clone();
		const bundleJsonBytes = contentLength( bundleJsonResponse );
		const manifest: BundleManifest = await bundleJsonResponse.json();

		const otherFiles = resolveBundleFiles( language, manifest ).filter(
			( file ) => file.filename !== 'bundle.json'
		);
		const responses = await Promise.all(
			otherFiles.map( ( file ) =>
				fetch( file.url, { signal: options.signal } )
			)
		);
		const failed = responses.find( ( response ) => ! response.ok );
		if ( failed ) {
			throw new DownloadError(
				'network',
				`${ failed.url } responded ${ failed.status }`
			);
		}

		const totalBytes =
			bundleJsonBytes +
			responses.reduce(
				( sum, response ) => sum + contentLength( response ),
				0
			);
		let receivedBytes = bundleJsonBytes;
		options.onProgress( { receivedBytes, totalBytes } );

		await cache.put( bundleJsonUrl( language ), bundleJsonForCache );
		await Promise.all(
			responses.map( async ( response ) => {
				const toCache = response.clone();
				await readStreamCounting( response, ( bytes ) => {
					receivedBytes += bytes;
					options.onProgress( { receivedBytes, totalBytes } );
				} );
				await cache.put( response.url, toCache );
			} )
		);
	} catch ( error ) {
		await deleteBundleFiles( language );
		if ( options.signal.aborted ) {
			throw error;
		}
		if ( error instanceof DownloadError ) {
			throw error;
		}
		// `QuotaExceededError` (thrown by `cache.put()` when storage fills up
		// mid-download) is a `DOMException`, which does *not* extend `Error`
		// in the DOM types — `instanceof Error` would silently miss it and
		// misclassify a storage failure as a network one.
		if (
			error instanceof DOMException &&
			error.name === 'QuotaExceededError'
		) {
			throw new DownloadError( 'storage', error.message );
		}
		const message =
			error instanceof Error || error instanceof DOMException
				? error.message
				: String( error );
		throw new DownloadError( 'network', message );
	}
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- download-queue`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the file to the coverage gate**

In `jest.config.js`, add after the `bundle-size.ts` line from Task 4:

```js
		'features/narration/admin/download-queue.ts',
```

- [ ] **Step 6: Run coverage to verify the gate is met**

Run: `npm run test:unit -- --coverage download-queue`
Expected: 80%+ lines (Task 6 adds more of this file's coverage on top).

- [ ] **Step 7: Commit**

```bash
git add features/narration/admin/download-queue.ts \
  features/narration/tests/js/download-queue.test.ts jest.config.js
git commit -m "feat(narration): download and cache a bundle with real progress"
```

---

## Task 6: `download-queue.ts` — `createDownloadQueue()`, the state machine

**Files:**
- Modify: `features/narration/admin/download-queue.ts`
- Modify: `features/narration/tests/js/download-queue.test.ts`

**Interfaces:**
- Consumes: `downloadBundle`, `DownloadError` (same file, Task 5); `realBundleBytes`, `deleteBundleFiles` from `./bundle-size` (Task 4).
- Produces: `ModelState` (discriminated union: `{status:'not-downloaded'}` | `{status:'queued'}` | `{status:'downloading', receivedBytes, totalBytes}` | `{status:'downloaded', bytes}` | `{status:'error', reason: DownloadErrorReason}`), `createDownloadQueue(): DownloadQueue` where `DownloadQueue = { subscribe(listener): unsubscribe; requestDownload(language): void; cancelDownload(language): void; removeBundle(language): Promise<void> }` — consumed by Task 8 (`index.ts`).

A factory, not module-level singleton state, so each test gets an isolated
queue instead of needing `jest.resetModules()` between cases — and so a
second `<table>` on the page (were one ever added) would not share state
with the first by accident.

- [ ] **Step 1: Add the failing tests**

First, widen the existing top-of-file import from `'../../admin/download-queue'`
(from Task 5) to also pull in `createDownloadQueue` and `ModelState` — one
import statement per module, not two:

```ts
import {
	downloadBundle,
	DownloadError,
	createDownloadQueue,
	ModelState,
} from '../../admin/download-queue';
```

Add one more import line next to it (new module, nothing to merge with):

```ts
import { realBundleBytes } from '../../admin/bundle-size';
```

Then append the new `describe` block to the end of
`features/narration/tests/js/download-queue.test.ts`:

```ts
describe( 'createDownloadQueue', () => {
	let cache: ReturnType< typeof fakeCache >;

	beforeEach( () => {
		cache = fakeCache();
		// @ts-expect-error — minimal CacheStorage stand-in.
		global.caches = { open: async () => cache };
		global.fetch = jest.fn( async ( url: string ) => {
			if ( url === urlFor( 'bundle.json' ) ) {
				return fakeResponse( {
					url,
					contentLength: 10,
					jsonBody: MANIFEST,
				} );
			}
			return fakeResponse( { url, contentLength: 10 } );
		} ) as unknown as typeof fetch;
		Object.defineProperty( global.navigator, 'storage', {
			value: {
				estimate: async () => ( {
					quota: 10 * 1024 * 1024 * 1024,
					usage: 0,
				} ),
			},
			configurable: true,
		} );
	} );

	afterEach( () => {
		// @ts-expect-error — restoring the global the test replaced.
		delete global.caches;
		// @ts-expect-error — restoring the global the test replaced.
		delete global.fetch;
		// @ts-expect-error — restoring the global the test replaced.
		delete global.navigator.storage;
	} );

	function collectStates( queue: ReturnType< typeof createDownloadQueue > ) {
		const states: Array< [ string, ModelState ] > = [];
		queue.subscribe( ( language, state ) =>
			states.push( [ language, state ] )
		);
		return states;
	}

	it( 'goes not-downloaded → downloading → downloaded on a successful download', async () => {
		const queue = createDownloadQueue();
		const states = collectStates( queue );

		queue.requestDownload( LANGUAGE );
		// requestDownload is fire-and-forget; wait for the microtask queue to
		// drain the whole download.
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		const statuses = states
			.filter( ( [ language ] ) => language === LANGUAGE )
			.map( ( [ , state ] ) => state.status );
		expect( statuses[ 0 ] ).toBe( 'downloading' );
		expect( statuses[ statuses.length - 1 ] ).toBe( 'downloaded' );
	} );

	it( 'queues a second requestDownload while one is active, then runs it when the first finishes', async () => {
		const queue = createDownloadQueue();
		const states = collectStates( queue );

		queue.requestDownload( 'portuguese' );
		queue.requestDownload( 'german' );
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		expect(
			states.find(
				( [ language, state ] ) =>
					language === 'german' && state.status === 'queued'
			)
		).toBeTruthy();

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		expect(
			states.some(
				( [ language, state ] ) =>
					language === 'german' && state.status === 'downloading'
			)
		).toBe( true );
	} );

	it( 'cancelling a queued (not yet started) download returns it straight to not-downloaded', async () => {
		const queue = createDownloadQueue();
		const states = collectStates( queue );

		queue.requestDownload( 'portuguese' );
		queue.requestDownload( 'german' );
		queue.cancelDownload( 'german' );

		expect(
			states[ states.length - 1 ]
		).toEqual( [ 'german', { status: 'not-downloaded' } ] );
	} );

	it( 'cancelling the active download cleans the cache and returns to not-downloaded', async () => {
		let released: () => void = () => undefined;
		const blocked = new Promise< void >( ( resolve ) => {
			released = resolve;
		} );
		global.fetch = jest.fn( async ( url: string ) => {
			if ( url === urlFor( 'bundle.json' ) ) {
				await blocked;
				throw new DOMException( 'Aborted', 'AbortError' );
			}
			return fakeResponse( { url, contentLength: 10 } );
		} ) as unknown as typeof fetch;

		const queue = createDownloadQueue();
		const states = collectStates( queue );

		queue.requestDownload( LANGUAGE );
		queue.cancelDownload( LANGUAGE );
		released();
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		expect( states[ states.length - 1 ] ).toEqual( [
			LANGUAGE,
			{ status: 'not-downloaded' },
		] );
	} );

	it( 'a failed download reports error with the classified reason', async () => {
		global.fetch = jest.fn( async ( url: string ) =>
			fakeResponse( { url, status: 500, contentLength: 0 } )
		) as unknown as typeof fetch;

		const queue = createDownloadQueue();
		const states = collectStates( queue );

		queue.requestDownload( LANGUAGE );
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		const last = states[ states.length - 1 ];
		expect( last[ 1 ] ).toEqual( {
			status: 'error',
			reason: 'network',
		} );
	} );

	it( 'removeBundle deletes the cache and reports not-downloaded', async () => {
		cache.store.set( urlFor( 'bundle.json' ), fakeResponse( {
			url: urlFor( 'bundle.json' ),
			contentLength: 10,
		} ) );

		const queue = createDownloadQueue();
		const states = collectStates( queue );

		await queue.removeBundle( LANGUAGE );

		expect( await realBundleBytes( LANGUAGE ) ).toBe( 0 );
		expect( states[ states.length - 1 ] ).toEqual( [
			LANGUAGE,
			{ status: 'not-downloaded' },
		] );
	} );
} );
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- download-queue`
Expected: FAIL — `createDownloadQueue` is not exported.

- [ ] **Step 3: Add `ModelState` and `createDownloadQueue()`**

First, widen the existing `./bundle-size` import at the top of
`features/narration/admin/download-queue.ts` (from Task 5) to also pull in
`realBundleBytes` — one import statement per module, not two:

```ts
import { deleteBundleFiles, realBundleBytes } from './bundle-size';
```

Then append the rest to the end of the file:

```ts
export type ModelState =
	| { status: 'not-downloaded' }
	| { status: 'queued' }
	| { status: 'downloading'; receivedBytes: number; totalBytes: number }
	| { status: 'downloaded'; bytes: number }
	| { status: 'error'; reason: DownloadErrorReason };

export type ModelStateListener = (
	language: string,
	state: ModelState
) => void;

export interface DownloadQueue {
	subscribe: ( listener: ModelStateListener ) => () => void;
	requestDownload: ( language: string ) => void;
	cancelDownload: ( language: string ) => void;
	removeBundle: ( language: string ) => Promise< void >;
}

/**
 * A fresh, self-contained download queue: one active download at a time,
 * everyone else waits in FIFO order. A factory rather than module-level
 * state, so this screen's own lifetime (one page load) owns exactly one
 * queue, with nothing to reset between tests.
 */
export function createDownloadQueue(): DownloadQueue {
	const listeners: ModelStateListener[] = [];
	const pending: string[] = [];
	let active: { language: string; controller: AbortController } | null =
		null;

	function emit( language: string, state: ModelState ): void {
		for ( const listener of listeners ) {
			listener( language, state );
		}
	}

	function subscribe( listener: ModelStateListener ): () => void {
		listeners.push( listener );
		return () => {
			const index = listeners.indexOf( listener );
			if ( index !== -1 ) {
				listeners.splice( index, 1 );
			}
		};
	}

	function requestDownload( language: string ): void {
		if ( active?.language === language || pending.includes( language ) ) {
			return;
		}
		if ( active ) {
			pending.push( language );
			emit( language, { status: 'queued' } );
			return;
		}
		void runDownload( language );
	}

	function cancelDownload( language: string ): void {
		const queuedIndex = pending.indexOf( language );
		if ( queuedIndex !== -1 ) {
			pending.splice( queuedIndex, 1 );
			emit( language, { status: 'not-downloaded' } );
			return;
		}
		if ( active?.language === language ) {
			active.controller.abort();
		}
	}

	async function removeBundle( language: string ): Promise< void > {
		await deleteBundleFiles( language );
		emit( language, { status: 'not-downloaded' } );
	}

	async function runDownload( language: string ): Promise< void > {
		const controller = new AbortController();
		active = { language, controller };
		emit( language, {
			status: 'downloading',
			receivedBytes: 0,
			totalBytes: 0,
		} );

		try {
			await downloadBundle( language, {
				signal: controller.signal,
				onProgress: ( progress ) =>
					emit( language, {
						status: 'downloading',
						receivedBytes: progress.receivedBytes,
						totalBytes: progress.totalBytes,
					} ),
			} );
			const bytes = await realBundleBytes( language );
			emit( language, { status: 'downloaded', bytes } );
		} catch ( error ) {
			if ( controller.signal.aborted ) {
				emit( language, { status: 'not-downloaded' } );
			} else {
				const reason =
					error instanceof DownloadError ? error.reason : 'unknown';
				emit( language, { status: 'error', reason } );
			}
		} finally {
			active = null;
			const next = pending.shift();
			if ( next ) {
				void runDownload( next );
			}
		}
	}

	return { subscribe, requestDownload, cancelDownload, removeBundle };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- download-queue`
Expected: PASS, 11 tests total (5 from Task 5 + 6 new).

- [ ] **Step 5: Run coverage to verify the gate is met**

Run: `npm run test:unit -- --coverage download-queue`
Expected: 80%+ lines on `download-queue.ts` (the file is already listed in
`jest.config.js` from Task 5).

- [ ] **Step 6: Commit**

```bash
git add features/narration/admin/download-queue.ts \
  features/narration/tests/js/download-queue.test.ts
git commit -m "feat(narration): add the one-at-a-time download queue and its state machine"
```

---

## Task 7: `models-table.ts` — render state into the DOM

**Files:**
- Create: `features/narration/admin/models-table.ts`
- Test: `features/narration/tests/js/models-table.test.ts`
- Modify: `jest.config.js`

**Interfaces:**
- Consumes: `ModelState` from `./download-queue` (Task 6); `formatBytes`, `LANGUAGE_BUNDLE_BYTES` from `../editor/storage-check`.
- Produces: `applyState(language: string, state: ModelState): void`, `wireActions(onAction: (action: string, language: string) => void): void` — consumed by Task 8 (`index.ts`). `wireActions`'s `action` values are exactly `'download' | 'cancel' | 'remove' | 'retry'`, read from each button's `data-action`.

- [ ] **Step 1: Write the failing test**

```ts
import { applyState, wireActions } from '../../admin/models-table';

function renderTable(): void {
	document.body.innerHTML = `
		<table id="post-voice-models">
			<tbody>
				<tr data-language="portuguese">
					<td>Kyutai Pocket TTS</td>
					<td>Portuguese</td>
					<td>8 voices</td>
					<td class="post-voice-model-status" role="status">Checking…</td>
					<td class="post-voice-model-size">—</td>
					<td class="post-voice-model-actions"></td>
				</tr>
			</tbody>
		</table>
	`;
}

describe( 'applyState', () => {
	beforeEach( renderTable );

	it( 'not-downloaded: shows the estimated size and a Download button', () => {
		applyState( 'portuguese', { status: 'not-downloaded' } );

		const row = document.querySelector( 'tr[data-language="portuguese"]' )!;
		expect( row.querySelector( '.post-voice-model-status' )?.textContent ).toBe(
			'Not downloaded'
		);
		expect( row.querySelector( '.post-voice-model-size' )?.textContent ).toContain(
			'~'
		);
		const button = row.querySelector< HTMLButtonElement >(
			'.post-voice-model-action'
		);
		expect( button?.dataset.action ).toBe( 'download' );
	} );

	it( 'downloading: shows a percentage and a Cancel button', () => {
		applyState( 'portuguese', {
			status: 'downloading',
			receivedBytes: 50,
			totalBytes: 200,
		} );

		const row = document.querySelector( 'tr[data-language="portuguese"]' )!;
		expect( row.querySelector( '.post-voice-model-status' )?.textContent ).toContain(
			'25'
		);
		const button = row.querySelector< HTMLButtonElement >(
			'.post-voice-model-action'
		);
		expect( button?.dataset.action ).toBe( 'cancel' );
	} );

	it( 'downloaded: shows the measured size and a Remove button', () => {
		applyState( 'portuguese', { status: 'downloaded', bytes: 100 * 1024 * 1024 } );

		const row = document.querySelector( 'tr[data-language="portuguese"]' )!;
		expect( row.querySelector( '.post-voice-model-status' )?.textContent ).toBe(
			'Downloaded'
		);
		expect( row.querySelector( '.post-voice-model-size' )?.textContent ).toBe(
			'100 MB'
		);
		const button = row.querySelector< HTMLButtonElement >(
			'.post-voice-model-action'
		);
		expect( button?.dataset.action ).toBe( 'remove' );
	} );

	it( 'error: shows the classified reason and a Retry button', () => {
		applyState( 'portuguese', { status: 'error', reason: 'network' } );

		const row = document.querySelector( 'tr[data-language="portuguese"]' )!;
		const button = row.querySelector< HTMLButtonElement >(
			'.post-voice-model-action'
		);
		expect( button?.dataset.action ).toBe( 'retry' );
	} );

	it( 'does nothing when the row is missing (defensive, no throw)', () => {
		expect( () =>
			applyState( 'klingon', { status: 'not-downloaded' } )
		).not.toThrow();
	} );
} );

describe( 'wireActions', () => {
	beforeEach( renderTable );

	it( 'reports the clicked button\'s action and its row\'s language', () => {
		applyState( 'portuguese', { status: 'not-downloaded' } );
		const onAction = jest.fn();
		wireActions( onAction );

		document
			.querySelector< HTMLButtonElement >( '.post-voice-model-action' )
			?.click();

		expect( onAction ).toHaveBeenCalledWith( 'download', 'portuguese' );
	} );

	it( 'ignores clicks outside an action button', () => {
		const onAction = jest.fn();
		wireActions( onAction );

		document.querySelector( 'td' )?.dispatchEvent(
			new MouseEvent( 'click', { bubbles: true } )
		);

		expect( onAction ).not.toHaveBeenCalled();
	} );
} );
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- models-table`
Expected: FAIL — cannot find module `../../admin/models-table`.

- [ ] **Step 3: Write the implementation**

```ts
import { __, sprintf } from '@wordpress/i18n';
import { formatBytes, LANGUAGE_BUNDLE_BYTES } from '../editor/storage-check';
import { DownloadErrorReason, ModelState } from './download-queue';

const TABLE_ID = 'post-voice-models';

function row( language: string ): HTMLTableRowElement | null {
	return document.querySelector< HTMLTableRowElement >(
		`#${ TABLE_ID } tbody tr[data-language="${ language }"]`
	);
}

function actionButton( action: string, label: string ): HTMLButtonElement {
	const button = document.createElement( 'button' );
	button.type = 'button';
	button.className = 'button post-voice-model-action';
	button.dataset.action = action;
	button.textContent = label;
	return button;
}

function errorMessage( reason: DownloadErrorReason ): string {
	switch ( reason ) {
		case 'storage':
			return __( 'Not enough free storage', 'post-voice' );
		case 'network':
			return __( 'Network error', 'post-voice' );
		default:
			return __( 'Download failed', 'post-voice' );
	}
}

/**
 * Render one row's Status, Size and Actions cells for its current state.
 * Safe to call for a language whose row is not on the page (a no-op) —
 * `index.ts` only ever calls this for rows it found, but the guard keeps
 * this function usable on its own without that precondition.
 *
 * @param language Bundle identifier.
 * @param state    Current state, from `createDownloadQueue()` or the
 *                 initial completeness check.
 */
export function applyState( language: string, state: ModelState ): void {
	const tr = row( language );
	if ( ! tr ) {
		return;
	}
	const status = tr.querySelector< HTMLElement >(
		'.post-voice-model-status'
	);
	const size = tr.querySelector< HTMLElement >( '.post-voice-model-size' );
	const actions = tr.querySelector< HTMLElement >(
		'.post-voice-model-actions'
	);
	if ( ! status || ! size || ! actions ) {
		return;
	}
	actions.replaceChildren();

	switch ( state.status ) {
		case 'not-downloaded':
			status.textContent = __( 'Not downloaded', 'post-voice' );
			size.textContent = sprintf(
				/* translators: %s: approximate download size, e.g. "199 MB". */
				__( '~%s', 'post-voice' ),
				formatBytes( LANGUAGE_BUNDLE_BYTES )
			);
			actions.appendChild(
				actionButton( 'download', __( 'Download', 'post-voice' ) )
			);
			break;
		case 'queued':
			status.textContent = __( 'Queued', 'post-voice' );
			actions.appendChild(
				actionButton( 'cancel', __( 'Cancel', 'post-voice' ) )
			);
			break;
		case 'downloading': {
			const percent =
				state.totalBytes > 0
					? Math.round(
							( state.receivedBytes / state.totalBytes ) * 100
					  )
					: 0;
			status.textContent = sprintf(
				/* translators: %d: percent complete. */
				__( 'Downloading… %d%%', 'post-voice' ),
				percent
			);
			size.textContent = sprintf(
				/* translators: 1: bytes received so far, 2: total expected. */
				__( '%1$s of ~%2$s', 'post-voice' ),
				formatBytes( state.receivedBytes ),
				formatBytes( state.totalBytes || LANGUAGE_BUNDLE_BYTES )
			);
			actions.appendChild(
				actionButton( 'cancel', __( 'Cancel', 'post-voice' ) )
			);
			break;
		}
		case 'downloaded':
			status.textContent = __( 'Downloaded', 'post-voice' );
			size.textContent = formatBytes( state.bytes );
			actions.appendChild(
				actionButton( 'remove', __( 'Remove', 'post-voice' ) )
			);
			break;
		case 'error':
			status.textContent = errorMessage( state.reason );
			size.textContent = '—';
			actions.appendChild(
				actionButton( 'retry', __( 'Retry', 'post-voice' ) )
			);
			break;
	}
}

/**
 * Wire the table's one delegated click handler. `onAction` receives the
 * clicked button's `data-action` (`'download' | 'cancel' | 'remove' |
 * 'retry'`, as set by `applyState()` above) and the language of the row it
 * was clicked in.
 *
 * @param onAction Called on every action-button click.
 */
export function wireActions(
	onAction: ( action: string, language: string ) => void
): void {
	const table = document.getElementById( TABLE_ID );
	if ( ! table ) {
		return;
	}
	table.addEventListener( 'click', ( event ) => {
		const button = ( event.target as HTMLElement ).closest< HTMLButtonElement >(
			'.post-voice-model-action'
		);
		if ( ! button ) {
			return;
		}
		const tr = button.closest< HTMLTableRowElement >(
			'tr[data-language]'
		);
		const language = tr?.dataset.language;
		const action = button.dataset.action;
		if ( ! language || ! action ) {
			return;
		}
		onAction( action, language );
	} );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- models-table`
Expected: PASS, 7 tests.

- [ ] **Step 5: Add the file to the coverage gate**

In `jest.config.js`, add after the `download-queue.ts` line from Task 5:

```js
		'features/narration/admin/models-table.ts',
```

- [ ] **Step 6: Run coverage to verify the gate is met**

Run: `npm run test:unit -- --coverage models-table`
Expected: 80%+ lines (the `default` branch of `errorMessage` for `'unknown'`
is the one branch these tests don't hit directly — acceptable against the
80% line threshold, matching how other switch-based modules in this codebase
already sit at or above the line, not the branch, gate).

- [ ] **Step 7: Commit**

```bash
git add features/narration/admin/models-table.ts \
  features/narration/tests/js/models-table.test.ts jest.config.js
git commit -m "feat(narration): render model download state into the settings table"
```

---

## Task 8: `index.ts` — wire it all together

**Files:**
- Modify: `features/narration/admin/index.ts` (replaces the Task 1 placeholder)
- Modify: `features/narration/admin/style.scss` (replaces the Task 1 placeholder)

**Interfaces:**
- Consumes: `isBundleComplete` (Task 3), `realBundleBytes` (Task 4), `applyState`/`wireActions` (Task 7), `createDownloadQueue` (Task 6).
- Produces: nothing further — this is the entry point itself, the last file in the dependency graph.

No dedicated Jest test for this file: it is thin `DOMContentLoaded`
orchestration with no branching logic of its own to assert on, same as
`features/narration/editor/index.tsx` today — every decision it makes was
already unit-tested in the module it calls. It is verified by the manual
checklist in Task 9 instead, and is intentionally left out of
`jest.config.js`'s `collectCoverageFrom` (same as `index.tsx`).

- [ ] **Step 1: Write `index.ts`**

```ts
import { __ } from '@wordpress/i18n';
import './style.scss';
import { isBundleComplete } from './bundle-status';
import { realBundleBytes } from './bundle-size';
import { applyState, wireActions } from './models-table';
import { createDownloadQueue } from './download-queue';

const TABLE_ID = 'post-voice-models';

async function init(): Promise< void > {
	const table = document.getElementById( TABLE_ID );
	if ( ! table ) {
		return;
	}
	const rows = table.querySelectorAll< HTMLTableRowElement >(
		'tbody tr[data-language]'
	);
	const languages = Array.from( rows )
		.map( ( tr ) => tr.dataset.language ?? '' )
		.filter( ( language ) => language !== '' );

	const queue = createDownloadQueue();
	queue.subscribe( ( language, state ) => applyState( language, state ) );

	wireActions( ( action, language ) => {
		switch ( action ) {
			case 'download':
			case 'retry':
				queue.requestDownload( language );
				break;
			case 'cancel':
				queue.cancelDownload( language );
				break;
			case 'remove':
				if (
					window.confirm(
						__(
							'Remove this downloaded model? It will need to be downloaded again the next time you narrate in this language.',
							'post-voice'
						)
					)
				) {
					void queue.removeBundle( language );
				}
				break;
			default:
				break;
		}
	} );

	for ( const language of languages ) {
		const complete = await isBundleComplete( language );
		if ( complete ) {
			const bytes = await realBundleBytes( language );
			applyState( language, { status: 'downloaded', bytes } );
		} else {
			applyState( language, { status: 'not-downloaded' } );
		}
	}
}

document.addEventListener( 'DOMContentLoaded', () => void init() );
```

- [ ] **Step 2: Write `style.scss`**

```scss
#post-voice-models {
	.post-voice-model-status {
		white-space: nowrap;
	}

	.post-voice-model-size {
		white-space: nowrap;
		color: #646970;
	}

	.post-voice-model-voices {
		margin: 0.5em 0 0;
		padding-left: 1.2em;
	}

	details summary {
		cursor: pointer;
	}
}
```

- [ ] **Step 3: Build and smoke-check in wp-env**

Run: `npm run build && npm run refresh:php`
Expected: `build/models-admin.js`, `build/models-admin.asset.php` and
`build/style-models-admin.css` all exist; no webpack errors.

Then, with `npx wp-env start` running, open
`http://localhost:8888/wp-admin/options-general.php?page=post-voice`
and confirm the "Models" section renders five rows, each starting at
"Checking…" and settling into "Not downloaded" (or "Downloaded" if this
browser profile already has one cached from earlier narration work).

- [ ] **Step 4: Commit**

```bash
git add features/narration/admin/index.ts features/narration/admin/style.scss
git commit -m "feat(narration): wire the Models table to the download queue"
```

---

## Task 9: i18n, TESTING.md, and the full pre-PR gate

**Files:**
- Modify: `package.json` (the `i18n:pot` script's `--include` list)
- Modify: `TESTING.md`
- Modify: `languages/post-voice.pot` (regenerated, not hand-edited)

**Interfaces:** None — this task wires documentation and build-script
coverage, produces nothing another task consumes.

- [ ] **Step 1: Add the new build output to the `.pot` scan**

In `package.json`, the `i18n:pot` script currently ends its `--include` list
with `...,build/dictionary-admin.js,build/player-style-admin.js`. Extend it:

```json
		"i18n:pot": "npm run build:dev && wp-env run cli --env-cwd=wp-content/plugins/post-voice wp i18n make-pot . languages/post-voice.pot --include=post-voice.php,shared/php,features/narration/php,features/pronunciation/php,features/player-style/php,build/narration-editor.js,build/narration-player.js,build/dictionary-admin.js,build/player-style-admin.js,build/models-admin.js",
```

- [ ] **Step 2: Regenerate the `.pot` file**

Run: `npm run i18n:pot`
Expected: `languages/post-voice.pot` gains entries for every new
translatable string — `Models`, `Model`, `Language`, `Voice`, `Status`,
`Size`, the per-language labels, `%d voice`/`%d voices`, `Checking…`,
`Not downloaded`, `Queued`, `Downloading… %d%%`, `Downloaded`, `~%s`,
`%1$s of ~%2$s`, `Not enough free storage`, `Network error`,
`Download failed`, `Download`, `Cancel`, `Remove`, `Retry`, and the Remove
confirmation sentence. `Project-Id-Version` in the header may drift to the
current plugin version — expected, not a manual edit.

- [ ] **Step 3: Update `TESTING.md`**

Add the four new Jest suites (`model-manifest.test.ts`, `bundle-status.test.ts`,
`download-queue.test.ts`, `models-table.test.ts`) and the new PHPUnit suite
(`test-models-section.php`) to whichever section of `TESTING.md` already
enumerates the project's test files, following that section's existing
format. Add a manual-verification entry for this screen:

> **Models settings screen** (`Configurações → Narration → Models`, manual —
> no E2E scenario, see the 2026-09-12 design doc): download one language for
> real and confirm the progress bar and the switch to `Downloaded` with a
> measured size; cancel a download in progress and confirm it returns to
> `Not downloaded`; click Download on two languages in a row and confirm the
> second shows `Queued` until the first finishes; remove a downloaded
> language and confirm it returns to `Not downloaded`; go offline and force
> a network error, confirming the message and the Retry button.

- [ ] **Step 4: Run the full pre-PR gate**

Run, in order, per `CLAUDE.md` (`wp-env` must be running):

```bash
npm run lint:js && npm run lint:arch
npx tsc --noEmit
composer run lint && composer run stan
npm run test:unit -- --coverage
npm run test:php && npm run test:php:coverage
npm run i18n:check
npm run audit:npm:production && npm run audit:npm && npm run audit:composer
npm run build && npm run test:e2e
```

Expected: everything green. If anything fails, stop — per `CLAUDE.md`, do
not weaken a gate; report the failure, the established root cause, and 2-3
fix options with a recommendation, and wait for a decision before touching
the gate.

- [ ] **Step 5: `npm run doctor`**

Run: `npm run doctor`
Expected: no new findings attributable to this work (E2E scenario count is
unchanged by design — see the spec's explicit "no new E2E" decision).

- [ ] **Step 6: Commit**

```bash
git add package.json TESTING.md languages/post-voice.pot
git commit -m "docs(narration): document the Models screen tests and regenerate .pot"
```

- [ ] **Step 7: Code review**

Invoke `superpowers:requesting-code-review` against this branch's full diff,
per `CLAUDE.md`. Address every finding, or record why it does not apply,
before opening a PR — and only open one if the user asks.
