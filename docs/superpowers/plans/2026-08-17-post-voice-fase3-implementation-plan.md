# Post Voice Fase 3 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a site owner set the narration player's background, accent, text colour and corner radius on `Settings → Narration`, with a live preview built from the real player, and have a post that was never customised ship byte-for-byte the same HTML and CSS it ships today.

**Architecture:** Four values live in one option, sanitised by `Post_Voice_Style_Store`. The player's SCSS reads them as CSS custom properties with the current values as `var()` fallbacks, so the stylesheet is correct on its own; PHP appends an inline block through `wp_add_inline_style` only for the properties that differ from the defaults. The settings screen becomes a shell in `shared/php/` that renders sections registered by each feature, and the preview reuses `Post_Voice_Frontend_Render::markup()` — the same function the frontend uses — so it cannot drift from the real player.

**Tech Stack:** PHP 8.2 (WordPress 6.6+), vanilla TypeScript compiled by `@wordpress/scripts`, SCSS, PHPUnit, Jest, Playwright + axe.

**Spec of record:** [`docs/superpowers/specs/2026-08-17-post-voice-fase3-design.md`](../specs/2026-08-17-post-voice-fase3-design.md). Where this plan and the spec disagree, the spec wins — amend it with a dated section rather than letting them drift.

## Global Constraints

- **PHP 8.2+, WordPress 6.6+.** Never raise or lower either floor as a side effect.
- **PHP class prefix `Post_Voice_`**, one class per file, filenames `class-*.php`, `declare(strict_types=1)`, WPCS clean, PHPStan level 6 clean.
- **Feature-based layout:** `features/<feature>/{php,editor,frontend,admin,tests}/`. This phase creates the first `shared/` code, and does it for the reason `CLAUDE.md` gives: a second feature actually needs the settings page.
- **Every value the server accepts is validated server-side**, even when the UI already constrains it. A `pattern` attribute is UX, not a guarantee.
- **i18n:** every user-facing string through `__()`/`_x()` with text domain `post-voice`. Regenerate with `npm run i18n:pot`; `npm run i18n:check` enforces it. Colour values are user data and are never translated.
- **Tests:** pure TypeScript gets Jest; every PHPUnit test class carries exactly one `@covers`; anything needing a real browser gets an E2E scenario instead of a mock.
- **Coverage gates, unchanged:** 80% lines for pure TS, 85% lines for PHP. Every new pure TS file is added to `collectCoverageFrom` in `jest.config.js` in the same task that creates it.
- **No new npm or Composer dependency in this phase.** `npm ci`, never `npm install`.
- **Never change contract-like pins:** `MODEL_BASE_URL`'s commit SHA, the WordPress and PHP minimums.
- **Never `--no-verify`**, never weaken a gate to get a commit through.
- **PHP edits not showing in the browser:** run `npm run refresh:php`.
- **E2E:** run the whole suite, never a `--grep`, before calling a browser-touching task done.
- **Commit style:** Conventional Commits, imperative subject, body explaining *why* when it is not obvious.

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `shared/php/class-settings-page.php` | The `Settings → Narration` shell: menu, form, `do_settings_sections()`, screen check |
| `shared/tests/php/test-settings-page.php` | PHPUnit for the shell (moved from `features/pronunciation/tests/php/`) |
| `features/pronunciation/php/class-dictionary-section.php` | The dictionary section: its `register_setting`, its markup, its script |
| `features/pronunciation/tests/php/test-dictionary-section.php` | PHPUnit for that section |
| `features/player-style/php/class-style-store.php` | `OPTION`, `DEFAULTS`, `RADII`, `sanitize()`, `get()`, `expand_hex()`, `css_declarations()`, `inline_css()` |
| `features/player-style/php/class-style-section.php` | The player section: option registration, preview, four fields, asset enqueue |
| `features/player-style/admin/index.ts` | Entry point: imports the SCSS, boots the preview on `DOMContentLoaded` |
| `features/player-style/admin/preview.ts` | DOM wiring: field sync, live custom properties, contrast message, restore link |
| `features/player-style/admin/contrast.ts` | Pure: hex → relative luminance → contrast ratio |
| `features/player-style/admin/hex-field.ts` | Pure: validate, normalise and expand a hex string |
| `features/player-style/admin/style.scss` | Admin-only rules that make the real player renderable inside wp-admin |
| `features/player-style/tests/php/test-style-store.php` | PHPUnit |
| `features/player-style/tests/php/test-style-section.php` | PHPUnit |
| `features/player-style/tests/js/contrast.test.ts` | Jest |
| `features/player-style/tests/js/hex-field.test.ts` | Jest |
| `tests/php/trait-fires-admin-init.php` | Test helper shared by the two admin-screen test classes |
| `e2e/player-style.spec.ts` | Playwright scenarios for this phase |

**Modified**

| File | Change |
|---|---|
| `features/pronunciation/php/class-settings-page.php` | Deleted — `git mv` to `shared/php/`, then emptied of everything that is not shell |
| `features/narration/php/class-frontend-render.php` | Markup extracted to `markup( ?string $src, bool $preview = false )` |
| `features/narration/php/class-assets.php` | Appends `Post_Voice_Style_Store::inline_css()` when it is not empty |
| `features/narration/frontend/style.scss` | Sass variables become CSS custom properties with fallbacks; two derived tones become `color-mix` with a literal fallback declaration |
| `post-voice.php` | Four new `require_once` lines, two new `register()` calls |
| `webpack.config.js` | Entry `player-style-admin` |
| `phpunit.xml.dist` | Two new test directories; `shared` added to coverage include, its tests excluded |
| `phpstan.neon` | `shared` added to `paths`; `shared/*/tests/php/*` excluded |
| `jest.config.js` | `contrast.ts` and `hex-field.ts` added to `collectCoverageFrom` |
| `package.json` | `i18n:pot` include list gains `shared/php`, `features/player-style/php`, `build/player-style-admin.js` |
| `scripts/check-pot.sh` | The same list, duplicated there on purpose |
| `tests/php/bootstrap.php` | Requires the new test trait |
| `languages/post-voice.pot` | Regenerated |
| `TESTING.md` | The two gotchas this phase adds |

---

### Task 1: Split the settings screen into a shared shell and a dictionary section

Pure refactor. The screen must look and behave exactly as it does today when this task ends; only the ownership of its parts changes. Everything else in the phase hangs off this, which is why it comes first.

**Files:**
- Create: `shared/php/class-settings-page.php` (via `git mv`)
- Create: `features/pronunciation/php/class-dictionary-section.php`
- Create: `tests/php/trait-fires-admin-init.php`
- Create: `shared/tests/php/test-settings-page.php` (via `git mv`)
- Create: `features/pronunciation/tests/php/test-dictionary-section.php`
- Modify: `post-voice.php`, `phpunit.xml.dist`, `phpstan.neon`, `package.json`, `scripts/check-pot.sh`, `tests/php/bootstrap.php`
- Delete: `features/pronunciation/php/class-settings-page.php`, `features/pronunciation/tests/php/test-settings-page.php`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `Post_Voice_Settings_Page::MENU_SLUG` (`'post-voice'`), `Post_Voice_Settings_Page::OPTION_GROUP` (`'post_voice_settings'`, now `public`)
  - `Post_Voice_Settings_Page::is_current_screen( string $hook_suffix ): bool`
  - `Post_Voice_Settings_Page::register(): void`, `add_page(): void`, `render(): void`
  - `Post_Voice_Dictionary_Section::register(): void`
  - `Post_Voice_Fires_Admin_Init` trait, method `fire_admin_init(): void`

- [ ] **Step 1: Move the two files with git, so history follows them**

```bash
mkdir -p shared/php shared/tests/php
git mv features/pronunciation/php/class-settings-page.php shared/php/class-settings-page.php
git mv features/pronunciation/tests/php/test-settings-page.php shared/tests/php/test-settings-page.php
```

- [ ] **Step 2: Teach the test suite, the analyser and the string extractor about `shared/`**

`phpunit.xml.dist` — add the two directories and the coverage entries:

```xml
            <directory suffix=".php">features/narration/tests/php</directory>
            <directory suffix=".php">features/pronunciation/tests/php</directory>
            <directory suffix=".php">features/player-style/tests/php</directory>
            <directory suffix=".php">shared/tests/php</directory>
```

```xml
        <include>
            <directory suffix=".php">features</directory>
            <directory suffix=".php">shared</directory>
        </include>
        <exclude>
            <directory suffix=".php">features/narration/tests</directory>
            <directory suffix=".php">features/pronunciation/tests</directory>
            <directory suffix=".php">features/player-style/tests</directory>
            <directory suffix=".php">shared/tests</directory>
        </exclude>
```

`phpstan.neon` — `shared` is not under `features`, so without this the moved class silently leaves static analysis:

```neon
    paths:
        - features
        - shared
```

```neon
    excludePaths:
        - build
        - features/*/tests/php/*
        - shared/tests/php/*
```

`package.json`, the `i18n:pot` script — the `--include` list becomes:

```
--include=post-voice.php,shared/php,features/narration/php,features/pronunciation/php,features/player-style/php,build/narration-editor.js,build/narration-player.js,build/dictionary-admin.js,build/player-style-admin.js
```

`scripts/check-pot.sh` — the same list, in the `wp i18n make-pot` invocation. It is duplicated there deliberately; a list changed in only one of the two makes the gate check something other than what the command produces.

> The `features/player-style/…` and `build/player-style-admin.js` entries name paths that do not exist yet. `wp i18n make-pot` skips a missing include without failing, and PHPUnit ignores a missing `<directory>` — writing them now keeps the whole configuration change in one reviewable commit.

- [ ] **Step 3: Write the failing tests for the shell**

Replace the body of `shared/tests/php/test-settings-page.php` with the tests that belong to the shell. The `fire_admin_init()` helper moves out to a trait in Step 4.

```php
<?php
/**
 * Settings screen shell tests.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

/**
 * @covers Post_Voice_Settings_Page
 */
class Test_Post_Voice_Settings_Page extends WP_UnitTestCase {

	use Post_Voice_Fires_Admin_Init;

	public function test_register_adds_the_options_page_for_an_administrator(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		set_current_screen( 'dashboard' );

		Post_Voice_Settings_Page::register();
		do_action( 'admin_menu' );

		$this->assertNotFalse(
			menu_page_url( Post_Voice_Settings_Page::MENU_SLUG, false )
		);
	}

	public function test_render_refuses_a_user_without_manage_options(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'author' ) ) );

		ob_start();
		Post_Voice_Settings_Page::render();

		$this->assertSame( '', (string) ob_get_clean() );
	}

	public function test_is_current_screen_only_matches_this_screen(): void {
		$this->assertTrue( Post_Voice_Settings_Page::is_current_screen( 'settings_page_post-voice' ) );
		$this->assertFalse( Post_Voice_Settings_Page::is_current_screen( 'options-general.php' ) );
		$this->assertFalse( Post_Voice_Settings_Page::is_current_screen( 'post.php' ) );
	}

	public function test_render_prints_the_sections_that_registered_themselves(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		set_current_screen( 'dashboard' );

		add_settings_section(
			'post_voice_test_section',
			'A registered section',
			static function (): void {
				echo 'section body';
			},
			Post_Voice_Settings_Page::MENU_SLUG
		);

		ob_start();
		Post_Voice_Settings_Page::render();
		$html = (string) ob_get_clean();

		$this->assertStringContainsString( 'A registered section', $html );
		$this->assertStringContainsString( 'section body', $html );
		$this->assertStringContainsString( 'action="options.php"', $html );
	}

	/**
	 * The shell must not depend on who registered. A feature deactivated (or a
	 * section added in a later task) cannot take the screen down with it.
	 */
	public function test_render_survives_with_no_sections_registered(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		set_current_screen( 'dashboard' );

		ob_start();
		Post_Voice_Settings_Page::render();
		$html = (string) ob_get_clean();

		$this->assertStringContainsString( 'action="options.php"', $html );
		$this->assertStringNotContainsString( 'post-voice-dictionary', $html );
	}
}
```

- [ ] **Step 4: Write the test trait and load it from the bootstrap**

Create `tests/php/trait-fires-admin-init.php` — the docblock is the one already in the current settings-page test, moved verbatim because the reason has not changed:

```php
<?php
/**
 * Shared test helper: fire `admin_init` without the unrelated core warning.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

/**
 * Fire `admin_init`, swallowing the one warning this triggers that has nothing
 * to do with this plugin.
 *
 * WP core's own `wp_admin_headers()` is unconditionally hooked to `admin_init`
 * (via wp-admin/includes/admin-filters.php, loaded while wp-phpunit installs the
 * test database) and calls `header()`. wp-phpunit's own bootstrap already writes
 * install-progress output straight to stdout before any test runs, so PHP's
 * headers-already-sent state is tripped for the whole process before any test
 * gets a chance to run. A scoped error handler, rather than `@`, keeps every
 * other warning live.
 */
trait Post_Voice_Fires_Admin_Init {

	protected static function fire_admin_init(): void {
		$previous = null;
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_set_error_handler -- Not debug code: a narrowly-scoped, restored handler that swallows one specific, unrelated core warning (see the docblock above) and delegates everything else — including PHPUnit's own warning-to-exception converter — to whatever handler was already installed.
		$previous = set_error_handler(
			static function ( int $errno, string $errstr, string $errfile = '', int $errline = 0 ) use ( &$previous ) {
				if ( preg_match( '/headers already sent/', $errstr ) ) {
					return true;
				}
				return $previous ? $previous( $errno, $errstr, $errfile, $errline ) : false;
			}
		);
		try {
			do_action( 'admin_init' );
		} finally {
			restore_error_handler();
		}
	}
}
```

In `tests/php/bootstrap.php`, above the final `require`:

```php
require_once __DIR__ . '/trait-fires-admin-init.php';
```

- [ ] **Step 5: Write the failing test for the dictionary section**

Create `features/pronunciation/tests/php/test-dictionary-section.php`. These assertions are the ones that used to live in the settings-page test, now aimed at their new owner:

```php
<?php
/**
 * Dictionary settings section tests.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

/**
 * @covers Post_Voice_Dictionary_Section
 */
class Test_Post_Voice_Dictionary_Section extends WP_UnitTestCase {

	use Post_Voice_Fires_Admin_Init;

	public function test_option_is_registered_with_the_store_sanitiser(): void {
		// `set_current_screen()` makes `is_admin()` true, same as a real wp-admin
		// request would: without it, WP core's own admin_init listeners log a
		// "doing it wrong" notice that WP_UnitTestCase turns into a failure.
		set_current_screen( 'dashboard' );
		Post_Voice_Dictionary_Section::register();
		self::fire_admin_init();

		$registered = get_registered_settings();

		$this->assertArrayHasKey( Post_Voice_Dictionary_Store::OPTION, $registered );
		$this->assertSame(
			array( 'Post_Voice_Dictionary_Store', 'sanitize' ),
			$registered[ Post_Voice_Dictionary_Store::OPTION ]['sanitize_callback']
		);
	}

	public function test_saving_the_option_runs_the_sanitiser(): void {
		set_current_screen( 'dashboard' );
		Post_Voice_Dictionary_Section::register();
		self::fire_admin_init();

		update_option(
			Post_Voice_Dictionary_Store::OPTION,
			array(
				array(
					'term'        => 'BYD',
					'replacement' => 'Bi Iou Di',
					'language'    => 'klingon',
				),
			)
		);

		$this->assertSame( array(), Post_Voice_Dictionary_Store::get_global() );
	}

	public function test_section_renders_the_existing_entries(): void {
		update_option(
			Post_Voice_Dictionary_Store::OPTION,
			array(
				array(
					'term'        => 'ONNX',
					'replacement' => 'ó-nex',
					'language'    => 'portuguese',
				),
			)
		);

		ob_start();
		Post_Voice_Dictionary_Section::render();
		$html = (string) ob_get_clean();

		$this->assertStringContainsString( 'ONNX', $html );
		$this->assertStringContainsString( 'ó-nex', $html );
		$this->assertStringContainsString( 'post-voice-dictionary', $html );
	}

	public function test_enqueue_ignores_another_screen(): void {
		Post_Voice_Dictionary_Section::enqueue( 'post.php' );

		$this->assertFalse( wp_script_is( 'post-voice-dictionary-admin', 'enqueued' ) );
	}
}
```

- [ ] **Step 6: Run both test files and watch them fail**

```bash
npm run test:php -- --filter 'Test_Post_Voice_Settings_Page|Test_Post_Voice_Dictionary_Section'
```

Expected: `Error: Class "Post_Voice_Dictionary_Section" not found`, and the shell tests failing on `is_current_screen()`.

- [ ] **Step 7: Reduce the settings page to a shell**

`shared/php/class-settings-page.php` becomes, in full:

```php
<?php
/**
 * The plugin's settings screen.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * `Settings → Narration`: a shell that renders whatever sections the features
 * registered.
 *
 * A plain settings page rather than the Customizer or Global Styles: the
 * per-site values here are not theme concerns, and tying them to `theme.json`
 * would tie the plugin to whatever the active theme supports.
 *
 * This class owns no field and no option. Each feature registers its own
 * section against `OPTION_GROUP` and `MENU_SLUG`, so the screen grows without
 * this file changing, and one feature's absence cannot take the screen down.
 */
class Post_Voice_Settings_Page {

	public const MENU_SLUG    = 'post-voice';
	public const OPTION_GROUP = 'post_voice_settings';

	/**
	 * Hook the menu.
	 */
	public static function register(): void {
		add_action( 'admin_menu', array( self::class, 'add_page' ) );
	}

	/**
	 * Add the options page.
	 */
	public static function add_page(): void {
		add_options_page(
			__( 'Narration', 'post-voice' ),
			__( 'Narration', 'post-voice' ),
			'manage_options',
			self::MENU_SLUG,
			array( self::class, 'render' )
		);
	}

	/**
	 * Whether the given admin screen is this one.
	 *
	 * Exposed so each section can guard its own `admin_enqueue_scripts` without
	 * copying the hook suffix, which would then have two places to be wrong.
	 *
	 * @param string $hook_suffix Current admin page, as passed to the hook.
	 */
	public static function is_current_screen( string $hook_suffix ): bool {
		return 'settings_page_' . self::MENU_SLUG === $hook_suffix;
	}

	/**
	 * Render the screen.
	 */
	public static function render(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Narration', 'post-voice' ); ?></h1>
			<form method="post" action="options.php">
				<?php
				settings_fields( self::OPTION_GROUP );
				do_settings_sections( self::MENU_SLUG );
				submit_button();
				?>
			</form>
		</div>
		<?php
	}
}
```

- [ ] **Step 8: Move the dictionary's own parts into its section class**

Create `features/pronunciation/php/class-dictionary-section.php`. The table markup is the one deleted from the old `render()`, unchanged except for losing the `<form>` and `submit_button()` that now belong to the shell:

```php
<?php
/**
 * The pronunciation dictionary's section of the settings screen.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Registers the site dictionary's option, its section and its script.
 *
 * The whole dictionary is one wide table rather than a set of labelled fields,
 * so it is rendered by the section callback — which prints above the form
 * table — instead of through `add_settings_field()`.
 */
class Post_Voice_Dictionary_Section {

	private const SECTION = 'post_voice_dictionary_section';

	/**
	 * Hook the setting, the section and this screen's script.
	 */
	public static function register(): void {
		add_action( 'admin_init', array( self::class, 'register_setting' ) );
		add_action( 'admin_enqueue_scripts', array( self::class, 'enqueue' ) );
	}

	/**
	 * Register the option against the store's sanitiser, plus the section.
	 */
	public static function register_setting(): void {
		register_setting(
			Post_Voice_Settings_Page::OPTION_GROUP,
			Post_Voice_Dictionary_Store::OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( 'Post_Voice_Dictionary_Store', 'sanitize' ),
				'default'           => array(),
			)
		);

		add_settings_section(
			self::SECTION,
			__( 'Pronunciation dictionary', 'post-voice' ),
			array( self::class, 'render' ),
			Post_Voice_Settings_Page::MENU_SLUG
		);
	}

	/**
	 * Load the row-editing script, on this screen only.
	 *
	 * @param string $hook_suffix Current admin page.
	 */
	public static function enqueue( $hook_suffix ): void {
		if ( ! Post_Voice_Settings_Page::is_current_screen( (string) $hook_suffix ) ) {
			return;
		}

		$asset_file = POST_VOICE_PATH . 'build/dictionary-admin.asset.php';
		if ( ! file_exists( $asset_file ) ) {
			return;
		}
		$asset = require $asset_file;

		wp_enqueue_script(
			'post-voice-dictionary-admin',
			POST_VOICE_URL . 'build/dictionary-admin.js',
			$asset['dependencies'],
			$asset['version'],
			true
		);
		wp_set_script_translations( 'post-voice-dictionary-admin', 'post-voice', POST_VOICE_PATH . 'languages' );
	}

	/**
	 * Render the dictionary table.
	 */
	public static function render(): void {
		$entries   = Post_Voice_Dictionary_Store::get_global();
		$languages = Post_Voice_Rest_Api::ALLOWED_LANGUAGES;
		$option    = Post_Voice_Dictionary_Store::OPTION;
		?>
		<p>
			<?php
			esc_html_e(
				'Read a term aloud as something else. Entries apply to the language you choose, because a respelling is phonetic: the same correction read by another language model is a new mistake.',
				'post-voice'
			);
			?>
		</p>
		<table class="widefat striped" id="post-voice-dictionary">
			<thead>
				<tr>
					<th scope="col"><?php esc_html_e( 'Term', 'post-voice' ); ?></th>
					<th scope="col"><?php esc_html_e( 'Read as', 'post-voice' ); ?></th>
					<th scope="col"><?php esc_html_e( 'Language', 'post-voice' ); ?></th>
					<th scope="col"><span class="screen-reader-text"><?php esc_html_e( 'Actions', 'post-voice' ); ?></span></th>
				</tr>
			</thead>
			<tbody>
				<?php foreach ( $entries as $index => $entry ) : ?>
				<tr>
					<td>
						<input type="text" name="<?php echo esc_attr( $option . '[' . $index . '][term]' ); ?>"
							value="<?php echo esc_attr( $entry['term'] ); ?>"
							maxlength="<?php echo esc_attr( (string) Post_Voice_Dictionary_Store::MAX_TERM_LENGTH ); ?>"
							aria-label="<?php esc_attr_e( 'Term', 'post-voice' ); ?>" />
					</td>
					<td>
						<input type="text" name="<?php echo esc_attr( $option . '[' . $index . '][replacement]' ); ?>"
							value="<?php echo esc_attr( $entry['replacement'] ); ?>"
							maxlength="<?php echo esc_attr( (string) Post_Voice_Dictionary_Store::MAX_REPLACEMENT_LENGTH ); ?>"
							aria-label="<?php esc_attr_e( 'Read as', 'post-voice' ); ?>" />
					</td>
					<td>
						<select name="<?php echo esc_attr( $option . '[' . $index . '][language]' ); ?>"
							aria-label="<?php esc_attr_e( 'Language', 'post-voice' ); ?>">
							<?php foreach ( $languages as $language ) : ?>
							<option value="<?php echo esc_attr( $language ); ?>" <?php selected( $entry['language'], $language ); ?>>
								<?php echo esc_html( $language ); ?>
							</option>
							<?php endforeach; ?>
						</select>
					</td>
					<td>
						<button type="button" class="button-link post-voice-remove-row">
							<?php esc_html_e( 'Remove', 'post-voice' ); ?>
						</button>
					</td>
				</tr>
				<?php endforeach; ?>
			</tbody>
		</table>
		<p>
			<button type="button" class="button" id="post-voice-add-row"
				data-option="<?php echo esc_attr( $option ); ?>"
				data-next-index="<?php echo esc_attr( (string) count( $entries ) ); ?>"
				data-languages="<?php echo esc_attr( (string) wp_json_encode( $languages ) ); ?>">
				<?php esc_html_e( 'Add entry', 'post-voice' ); ?>
			</button>
		</p>
		<?php
	}
}
```

- [ ] **Step 9: Wire both into the bootstrap**

In `post-voice.php`, replace the pronunciation settings-page `require_once` and add the section:

```php
require_once POST_VOICE_PATH . 'shared/php/class-settings-page.php';
require_once POST_VOICE_PATH . 'features/pronunciation/php/class-dictionary-store.php';
require_once POST_VOICE_PATH . 'features/pronunciation/php/class-dictionary-section.php';
```

```php
Post_Voice_Settings_Page::register();
Post_Voice_Dictionary_Section::register();
```

- [ ] **Step 10: Run the PHP suite and the linters**

```bash
npm run test:php
composer run lint
composer run stan
```

Expected: all green. If PHPStan reports the moved class as unknown, `shared` is missing from `paths` — go back to Step 2.

- [ ] **Step 11: Confirm the screen still works in the browser**

```bash
npm run refresh:php
```

Then open `http://localhost:8888/wp-admin/options-general.php?page=post-voice`, add a dictionary row, save, and reload. The row must survive. This is a refactor: any visible difference is a defect, not a step forward.

- [ ] **Step 12: Regenerate the `.pot` and check it**

```bash
npm run i18n:pot
npm run i18n:check
```

Expected: "languages/post-voice.pot is current." The message ids should not change — the strings only moved file.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "refactor: make the settings screen a shell with feature-owned sections

The dictionary screen was a single class in features/pronunciation that owned
the page, the form, the option and its own markup. Fase 3 adds a second feature
to that screen, which is the trigger CLAUDE.md defines for shared/: the shell
moves there and each feature now registers its own section, so neither owns the
other's UI and the screen survives either one being absent."
```

---

### Task 2: The style store

**Files:**
- Create: `features/player-style/php/class-style-store.php`
- Create: `features/player-style/tests/php/test-style-store.php`
- Modify: `post-voice.php`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `Post_Voice_Style_Store::OPTION` = `'post_voice_player_style'`
  - `Post_Voice_Style_Store::DEFAULTS` = `array( 'surface' => '#1e1e1e', 'accent' => '#2b62f0', 'text' => '#ffffff', 'radius' => 'pill' )`
  - `Post_Voice_Style_Store::RADII` = `array( 'pill' => '999px', 'rounded' => '12px', 'square' => '0' )`
  - `sanitize( mixed $value ): array` — always the four keys
  - `get(): array`
  - `expand_hex( string $hex ): string` — `#abc` → `#aabbcc`
  - `css_declarations(): string` — e.g. `--pv-accent:#c00000`, empty when all default
  - `inline_css(): string` — the same wrapped in `.post-voice-player{…}`, empty when all default

- [ ] **Step 1: Write the failing tests**

Create `features/player-style/tests/php/test-style-store.php`:

```php
<?php
/**
 * Tests for Post_Voice_Style_Store.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

/**
 * @covers Post_Voice_Style_Store
 */
class Test_Post_Voice_Style_Store extends WP_UnitTestCase {

	public function test_non_array_input_gives_the_defaults(): void {
		$this->assertSame( Post_Voice_Style_Store::DEFAULTS, Post_Voice_Style_Store::sanitize( 'nope' ) );
		$this->assertSame( Post_Voice_Style_Store::DEFAULTS, Post_Voice_Style_Store::sanitize( null ) );
	}

	public function test_a_bad_colour_falls_back_without_taking_the_others_with_it(): void {
		$clean = Post_Voice_Style_Store::sanitize(
			array(
				'surface' => 'javascript:alert(1)',
				'accent'  => '#c00000',
				'text'    => '#ffffff',
				'radius'  => 'square',
			)
		);

		$this->assertSame( '#1e1e1e', $clean['surface'] );
		$this->assertSame( '#c00000', $clean['accent'] );
		$this->assertSame( 'square', $clean['radius'] );
	}

	public function test_three_digit_hex_is_accepted_and_kept_short(): void {
		$clean = Post_Voice_Style_Store::sanitize( array( 'accent' => '#ABC' ) );

		$this->assertSame( '#abc', $clean['accent'] );
	}

	public function test_missing_and_unknown_keys_are_handled(): void {
		$clean = Post_Voice_Style_Store::sanitize( array( 'accent' => '#c00000', 'nonsense' => 'x' ) );

		$this->assertSame( array( 'surface', 'accent', 'text', 'radius' ), array_keys( $clean ) );
		$this->assertSame( '#1e1e1e', $clean['surface'] );
		$this->assertArrayNotHasKey( 'nonsense', $clean );
	}

	public function test_radius_outside_the_whitelist_falls_back_to_pill(): void {
		$clean = Post_Voice_Style_Store::sanitize( array( 'radius' => '99px' ) );

		$this->assertSame( 'pill', $clean['radius'] );
	}

	public function test_expand_hex_lengthens_the_short_form_only(): void {
		$this->assertSame( '#aabbcc', Post_Voice_Style_Store::expand_hex( '#abc' ) );
		$this->assertSame( '#c00000', Post_Voice_Style_Store::expand_hex( '#c00000' ) );
	}

	public function test_css_is_empty_when_nothing_differs_from_the_defaults(): void {
		update_option( Post_Voice_Style_Store::OPTION, Post_Voice_Style_Store::DEFAULTS );

		$this->assertSame( '', Post_Voice_Style_Store::css_declarations() );
		$this->assertSame( '', Post_Voice_Style_Store::inline_css() );
	}

	public function test_css_carries_only_what_changed(): void {
		update_option(
			Post_Voice_Style_Store::OPTION,
			array( 'accent' => '#c00000' ) + Post_Voice_Style_Store::DEFAULTS
		);

		$this->assertSame( '--pv-accent:#c00000', Post_Voice_Style_Store::css_declarations() );
		$this->assertSame( '.post-voice-player{--pv-accent:#c00000}', Post_Voice_Style_Store::inline_css() );
	}

	public function test_radius_reaches_the_css_as_a_length_never_as_the_key(): void {
		update_option(
			Post_Voice_Style_Store::OPTION,
			array( 'radius' => 'rounded' ) + Post_Voice_Style_Store::DEFAULTS
		);

		$this->assertSame( '--pv-radius:12px', Post_Voice_Style_Store::css_declarations() );
	}

	public function test_get_sanitises_a_row_written_straight_to_the_database(): void {
		update_option( Post_Voice_Style_Store::OPTION, array( 'accent' => 'red; }' ) );

		$this->assertSame( '#2b62f0', Post_Voice_Style_Store::get()['accent'] );
	}
}
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npm run test:php -- --filter Test_Post_Voice_Style_Store
```

Expected: `Error: Class "Post_Voice_Style_Store" not found`.

- [ ] **Step 3: Write the store**

Create `features/player-style/php/class-style-store.php`:

```php
<?php
/**
 * Player styling storage.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Owns the site's player styling: what it may be, and what it becomes as CSS.
 *
 * One option rather than four: the values are read and written together, so
 * four rows would be four `get_option` calls for one decision.
 */
class Post_Voice_Style_Store {

	public const OPTION = 'post_voice_player_style';

	/**
	 * The player exactly as Fase 1 shipped it.
	 *
	 * Fixed values rather than something inherited from the active theme: a site
	 * that updates the plugin must not change appearance, and `theme.json`
	 * support varies by theme.
	 */
	public const DEFAULTS = array(
		'surface' => '#1e1e1e',
		'accent'  => '#2b62f0',
		'text'    => '#ffffff',
		'radius'  => 'pill',
	);

	/**
	 * The three shapes offered, and the length each one means.
	 */
	public const RADII = array(
		'pill'    => '999px',
		'rounded' => '12px',
		'square'  => '0',
	);

	/**
	 * Which custom property each key drives.
	 */
	private const PROPERTIES = array(
		'surface' => '--pv-surface',
		'accent'  => '--pv-accent',
		'text'    => '--pv-text',
		'radius'  => '--pv-radius',
	);

	private const COLOUR_KEYS = array( 'surface', 'accent', 'text' );

	/**
	 * Coerce anything into a complete, valid style.
	 *
	 * Per-field fallback rather than rejecting the submission: one malformed
	 * colour should not cost the author the other three values, and the return
	 * always has all four keys so no caller has to handle a missing one.
	 *
	 * @param mixed $value Raw value from a settings save or from the database.
	 * @return array{surface: string, accent: string, text: string, radius: string}
	 */
	public static function sanitize( $value ): array {
		$clean = self::DEFAULTS;
		if ( ! is_array( $value ) ) {
			return $clean;
		}

		foreach ( self::COLOUR_KEYS as $key ) {
			if ( ! isset( $value[ $key ] ) || ! is_string( $value[ $key ] ) ) {
				continue;
			}
			$colour = sanitize_hex_color( $value[ $key ] );
			if ( is_string( $colour ) && '' !== $colour ) {
				// Lower case only — the short form is kept as typed, because CSS
				// treats `#abc` and `#aabbcc` alike and rewriting the author's
				// value would be a change with no benefit. Case is normalised so
				// `#1E1E1E` still compares equal to the default and does not emit
				// a redundant declaration.
				$clean[ $key ] = strtolower( $colour );
			}
		}

		if ( isset( $value['radius'] ) && is_string( $value['radius'] )
			&& array_key_exists( $value['radius'], self::RADII ) ) {
			$clean['radius'] = $value['radius'];
		}

		return $clean;
	}

	/**
	 * The saved style, sanitised on the way out as well as on the way in.
	 *
	 * @return array{surface: string, accent: string, text: string, radius: string}
	 */
	public static function get(): array {
		return self::sanitize( get_option( self::OPTION, array() ) );
	}

	/**
	 * Lengthen `#abc` to `#aabbcc`.
	 *
	 * `<input type="color">` accepts only the six-digit form: handed `#abc` it
	 * silently shows black, so the picker gets the expanded value while the text
	 * field keeps what the author typed.
	 *
	 * @param string $hex A hex colour, three or six digits, with the hash.
	 */
	public static function expand_hex( string $hex ): string {
		if ( 4 !== strlen( $hex ) ) {
			return $hex;
		}
		return '#' . $hex[1] . $hex[1] . $hex[2] . $hex[2] . $hex[3] . $hex[3];
	}

	/**
	 * The custom properties that differ from the defaults, without a selector.
	 *
	 * Only the differences: a site that never customised anything must produce
	 * an empty string here, so no CSS at all reaches its readers.
	 */
	public static function css_declarations(): string {
		$style = self::get();
		$parts = array();

		foreach ( self::PROPERTIES as $key => $property ) {
			if ( $style[ $key ] === self::DEFAULTS[ $key ] ) {
				continue;
			}
			$value   = 'radius' === $key ? self::RADII[ $style[ $key ] ] : $style[ $key ];
			$parts[] = $property . ':' . $value;
		}

		return implode( ';', $parts );
	}

	/**
	 * The same declarations wrapped in the player's selector, for the frontend.
	 */
	public static function inline_css(): string {
		$declarations = self::css_declarations();
		return '' === $declarations ? '' : '.post-voice-player{' . $declarations . '}';
	}
}
```

- [ ] **Step 4: Require it from the bootstrap**

In `post-voice.php`, after the pronunciation requires:

```php
require_once POST_VOICE_PATH . 'features/player-style/php/class-style-store.php';
```

- [ ] **Step 5: Run the tests and the linters**

```bash
npm run test:php -- --filter Test_Post_Voice_Style_Store
composer run lint
composer run stan
```

Expected: PASS, both linters clean.

- [ ] **Step 6: Commit**

```bash
git add features/player-style post-voice.php
git commit -m "feat: store and sanitise the player's four style values

One option, per-field fallback, and a CSS serialiser that emits only what
differs from the shipped defaults — so a site that never opened the screen
produces no CSS at all."
```

---

### Task 3: One markup function for the player and its preview

**Files:**
- Modify: `features/narration/php/class-frontend-render.php`
- Modify: `features/narration/tests/php/test-frontend-render.php`

**Interfaces:**
- Consumes: nothing.
- Produces: `Post_Voice_Frontend_Render::markup( ?string $src, bool $preview = false ): string`

- [ ] **Step 1: Write the failing tests**

Append to `features/narration/tests/php/test-frontend-render.php`:

```php
	public function test_markup_in_preview_mode_is_the_enhanced_player_without_audio(): void {
		$html = Post_Voice_Frontend_Render::markup( null, true );

		$this->assertStringContainsString( 'post-voice-player--enhanced', $html );
		$this->assertStringNotContainsString( '<audio', $html );
		$this->assertStringNotContainsString( 'aria-live', $html );
		$this->assertStringNotContainsString( 'role="region"', $html );
	}

	public function test_preview_controls_are_disabled_rather_than_hidden(): void {
		$html = Post_Voice_Frontend_Render::markup( null, true );

		foreach ( array( 'play', 'rate', 'close' ) as $role ) {
			$this->assertMatchesRegularExpression(
				'/<button[^>]*data-role="' . $role . '"[^>]*\sdisabled/',
				$html,
				"The preview's {$role} button should be disabled."
			);
		}
		// `aria-hidden` on a block containing focusable controls is an axe
		// violation, so the preview disables them instead.
		$this->assertStringNotContainsString( ' hidden', $html );
	}

	public function test_preview_shows_the_progress_bar_partly_filled(): void {
		$html = Post_Voice_Frontend_Render::markup( null, true );

		$this->assertMatchesRegularExpression(
			'/<input[^>]*data-role="seek"[^>]*value="40"/',
			$html
		);
	}

	public function test_frontend_markup_keeps_the_audio_element_and_the_region(): void {
		$html = Post_Voice_Frontend_Render::markup( 'https://example.com/n.mp3' );

		$this->assertStringContainsString( '<audio controls src="https://example.com/n.mp3"', $html );
		$this->assertStringContainsString( 'role="region"', $html );
		$this->assertStringNotContainsString( 'post-voice-player--enhanced', $html );
		$this->assertStringNotContainsString( 'disabled', $html );
	}
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npm run test:php -- --filter Test_Post_Voice_Frontend_Render
```

Expected: `Call to undefined method Post_Voice_Frontend_Render::markup()`.

- [ ] **Step 3: Extract the markup**

In `features/narration/php/class-frontend-render.php`, replace the body of `append_player()` after its guards, and add `markup()`:

```php
	public static function append_player( string $content ): string {
		if ( ! is_singular( 'post' ) || ! in_the_loop() || ! is_main_query() ) {
			return $content;
		}

		$post_id       = get_the_ID();
		$attachment_id = Post_Voice_Post_Meta::get_attachment_id( (int) $post_id );
		if ( ! $attachment_id ) {
			return $content;
		}

		$url = wp_get_attachment_url( $attachment_id );
		if ( ! $url ) {
			return $content;
		}

		return $content . self::markup( $url );
	}

	/**
	 * Build the player's markup, for the post or for the settings preview.
	 *
	 * One function for both so the preview cannot drift from the real player:
	 * a change to the pill is a change to what the author sees while choosing
	 * its colours.
	 *
	 * @param string|null $src     Audio URL, or null in preview mode.
	 * @param bool        $preview Render the enhanced, inert copy for wp-admin.
	 */
	public static function markup( ?string $src, bool $preview = false ): string {
		// In the post, `player.ts` adds the enhanced class and reveals the
		// controls; nothing runs it in wp-admin, so the preview ships that state
		// already applied. `disabled` rather than `hidden` because the preview's
		// controls must be visible, and `aria-hidden` around focusable buttons is
		// an accessibility violation of its own.
		$classes = 'post-voice-player' . ( $preview ? ' post-voice-player--enhanced' : '' );
		$state   = $preview ? ' disabled' : ' hidden';
		ob_start();
		?>
		<div class="<?php echo esc_attr( $classes ); ?>"
			<?php if ( ! $preview ) : ?>
			role="region" aria-label="<?php esc_attr_e( 'Post narration player', 'post-voice' ); ?>"
			<?php endif; ?>
		>
			<?php if ( null !== $src ) : ?>
			<audio controls src="<?php echo esc_url( $src ); ?>"></audio>
			<?php endif; ?>
			<?php
			/*
			 * The enhancement controls ship hidden and player.ts reveals them. Only
			 * JavaScript gives them behaviour, so without it they would render as
			 * buttons that look operable and do nothing — worse than absent,
			 * especially for screen reader and keyboard users. The native <audio>
			 * above is the no-JS experience and works on its own.
			 */
			?>
			<button type="button" data-role="play"<?php echo esc_attr( $state ); ?> aria-pressed="false" aria-label="<?php esc_attr_e( 'Play narration', 'post-voice' ); ?>"
				data-label-playing="<?php esc_attr_e( 'Playing', 'post-voice' ); ?>"
				data-label-paused="<?php esc_attr_e( 'Paused', 'post-voice' ); ?>">&#9654;</button>
			<?php
			/*
			 * A range input rather than a styled <div>: it is seekable with the
			 * arrow keys and Home/End for free, announces its position to screen
			 * readers, and needs no drag handling of our own. `max` is a placeholder
			 * until the audio reports its real duration.
			 */
			?>
			<input type="range" data-role="seek"<?php echo esc_attr( $state ); ?> value="<?php echo $preview ? '40' : '0'; ?>" min="0" max="100" step="0.1"
				aria-label="<?php esc_attr_e( 'Seek within narration', 'post-voice' ); ?>" />
			<button type="button" data-role="rate"<?php echo esc_attr( $state ); ?> aria-label="<?php esc_attr_e( 'Playback speed', 'post-voice' ); ?>">1&#215;</button>
			<button type="button" data-role="close"<?php echo esc_attr( $state ); ?> aria-label="<?php esc_attr_e( 'Close player', 'post-voice' ); ?>">&#10005;</button>
			<?php if ( ! $preview ) : ?>
			<span data-role="live" aria-live="polite" class="screen-reader-text"></span>
			<?php endif; ?>
		</div>
		<?php
		return (string) ob_get_clean();
	}
```

- [ ] **Step 4: Run the whole render test class**

```bash
npm run test:php -- --filter Test_Post_Voice_Frontend_Render
composer run lint
```

Expected: PASS, including the Fase 1 tests that assert the frontend markup is unchanged. If `test_enhancement_controls_ship_hidden_for_the_no_js_case` fails, `$state` is inverted.

- [ ] **Step 5: Commit**

```bash
git add features/narration
git commit -m "refactor: build the player markup through one reusable function

The settings preview needs the same pill the reader sees. Rendering it from the
same function is what keeps the two from drifting; a second copy in the admin
screen would be wrong the first time the player changed."
```

---

### Task 4: Custom properties in the stylesheet, inline CSS on the frontend

**Files:**
- Modify: `features/narration/frontend/style.scss`
- Modify: `features/narration/php/class-assets.php`
- Modify: `features/narration/tests/php/test-assets.php`

**Interfaces:**
- Consumes: `Post_Voice_Style_Store::inline_css()` (Task 2).
- Produces: the custom properties `--pv-surface`, `--pv-accent`, `--pv-text`, `--pv-radius`, read by the preview in Task 6.

- [ ] **Step 1: Write the failing test for the enqueue**

Append to `features/narration/tests/php/test-assets.php`:

```php
	public function test_no_inline_style_when_the_player_was_never_customised(): void {
		delete_option( Post_Voice_Style_Store::OPTION );
		$post_id       = self::factory()->post->create();
		$attachment_id = self::factory()->attachment->create_object(
			array(
				'file'        => 'n.mp3',
				'post_parent' => $post_id,
			)
		);
		Post_Voice_Post_Meta::save( $post_id, $attachment_id, 'portuguese', array( 'portuguese' ), 'alba', str_repeat( 'a', 64 ) );

		$this->go_to( get_permalink( $post_id ) );
		Post_Voice_Assets::enqueue_frontend_assets();

		$this->assertSame( array(), (array) wp_styles()->get_data( 'post-voice-player', 'after' ) );
	}

	public function test_customised_player_ships_its_declarations_inline(): void {
		update_option(
			Post_Voice_Style_Store::OPTION,
			array( 'accent' => '#c00000' ) + Post_Voice_Style_Store::DEFAULTS
		);
		$post_id       = self::factory()->post->create();
		$attachment_id = self::factory()->attachment->create_object(
			array(
				'file'        => 'n.mp3',
				'post_parent' => $post_id,
			)
		);
		Post_Voice_Post_Meta::save( $post_id, $attachment_id, 'portuguese', array( 'portuguese' ), 'alba', str_repeat( 'a', 64 ) );

		$this->go_to( get_permalink( $post_id ) );
		Post_Voice_Assets::enqueue_frontend_assets();

		$this->assertContains(
			'.post-voice-player{--pv-accent:#c00000}',
			(array) wp_styles()->get_data( 'post-voice-player', 'after' )
		);
	}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm run test:php -- --filter Test_Post_Voice_Assets
```

Expected: the second test fails — the `after` data is empty.

- [ ] **Step 3: Append the inline style**

In `features/narration/php/class-assets.php`, at the end of `enqueue_frontend_assets()`, after the `wp_enqueue_style` call:

```php
		// Only what differs from the shipped defaults, and nothing at all when
		// the site never customised the player — the stylesheet already carries
		// today's values as `var()` fallbacks, so silence here is correct.
		$inline = Post_Voice_Style_Store::inline_css();
		if ( '' !== $inline ) {
			wp_add_inline_style( 'post-voice-player', $inline );
		}
```

- [ ] **Step 4: Turn the Sass variables into custom properties**

In `features/narration/frontend/style.scss`, keep the `$pv-*` variables — they become the fallback values, so there is still one place to change a default — and use them through `var()`.

Replace each usage as follows:

```scss
.post-voice-player--enhanced {
	background: var( --pv-surface, #{ $pv-surface } );
	color: var( --pv-text, #{ $pv-text } );
	border-radius: var( --pv-radius, 999px );

	button {
		&:focus-visible {
			outline: 2px solid var( --pv-text, #{ $pv-text } );
		}
	}

	[data-role='play'] {
		background: var( --pv-accent, #{ $pv-accent } );
		// Stays a circle at every radius: the preset shapes the pill's outline,
		// not its controls, and a square play button inside a rounded card is
		// nobody's intent.
		border-radius: 50%;
	}

	[data-role='rate'] {
		// Two declarations on purpose: a browser without `color-mix` keeps the
		// first. The percentage reproduces today's #333 against the default
		// surface (9.3% of the way to the text colour, rounded to 9).
		background: $pv-surface-hover;
		background: color-mix( in srgb, var( --pv-surface, #{ $pv-surface } ) 91%, var( --pv-text, #{ $pv-text } ) );
	}

	[data-role='close'] {
		&:hover {
			background: $pv-surface-hover;
			background: color-mix( in srgb, var( --pv-surface, #{ $pv-surface } ) 91%, var( --pv-text, #{ $pv-text } ) );
		}
	}
}
```

and in the seek block. The existing file already keeps every vendor-prefixed
pseudo-element in its own separate rule — `-webkit-` and `-moz-` selectors are
never comma-joined anywhere in it — because a browser that does not recognise
one pseudo-element in a grouped selector drops the *whole* rule, not just its
own branch. Keep that structure: only the `background` line inside each
existing rule changes, nothing is merged.

```scss
	&:focus-visible {
		outline: 2px solid var( --pv-text, #{ $pv-text } );
	}

	&::-webkit-slider-runnable-track {
		// Same fallback pair as below; 80% reproduces today's #4a4a4a.
		background: $pv-track;
		background: color-mix( in srgb, var( --pv-surface, #{ $pv-surface } ) 80%, var( --pv-text, #{ $pv-text } ) );
	}

	&::-moz-range-track {
		background: $pv-track;
		background: color-mix( in srgb, var( --pv-surface, #{ $pv-surface } ) 80%, var( --pv-text, #{ $pv-text } ) );
	}

	&::-moz-range-progress {
		background: var( --pv-accent, #{ $pv-accent } );
	}

	&::-webkit-slider-thumb {
		background: var( --pv-accent, #{ $pv-accent } );
	}

	&::-moz-range-thumb {
		background: var( --pv-accent, #{ $pv-accent } );
	}
```

> Keep the existing `height`, `width`, `margin-top`, `border`, `border-radius`
> and `appearance` declarations in each of those blocks exactly as they are —
> only the `background` line changes, and each rule stays in its own block.

- [ ] **Step 5: Build and verify both declarations survive minification**

```bash
npm run build
grep -c 'color-mix' build/style-narration-player.css
grep -o '#4a4a4a' build/style-narration-player.css | head -1
```

Expected: `color-mix` appears (4 or more times) **and** `#4a4a4a` is still present. If the literal fallback is gone, cssnano dropped it — stop and report; the fix is a build-config change, which is a decision, not a step.

- [ ] **Step 6: Run the PHP tests and the linters**

```bash
npm run test:php -- --filter Test_Post_Voice_Assets
composer run lint
composer run stan
npm run lint:js
```

Expected: all green.

- [ ] **Step 7: Check the reader's page is unchanged**

```bash
npm run refresh:php
```

Open a narrated post with no style option saved. The pill must look exactly as before, and the page source must contain no `<style id="post-voice-player-inline-css">`.

- [ ] **Step 8: Commit**

```bash
git add features/narration
git commit -m "feat: drive the player's colours through CSS custom properties

The stylesheet carries today's values as var() fallbacks, so it is complete on
its own and an uncustomised site receives no inline CSS. The two derived tones
stay derived — via color-mix with a literal fallback declaration — rather than
becoming fields nobody asked for that would break on a light background."
```

---

### Task 5: The two pure TypeScript modules

**Files:**
- Create: `features/player-style/admin/hex-field.ts`
- Create: `features/player-style/admin/contrast.ts`
- Create: `features/player-style/tests/js/hex-field.test.ts`
- Create: `features/player-style/tests/js/contrast.test.ts`
- Modify: `jest.config.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `isValidHex( value: string ): boolean`
  - `normalizeHex( value: string ): string | null`
  - `expandHex( value: string ): string`
  - `contrastRatio( a: string, b: string ): number`
  - `relativeLuminance( hex: string ): number`

- [ ] **Step 1: Write the failing tests**

Create `features/player-style/tests/js/hex-field.test.ts`:

```ts
import {
	isValidHex,
	normalizeHex,
	expandHex,
} from '../../admin/hex-field';

describe( 'isValidHex', () => {
	it( 'accepts both hex forms, with the hash', () => {
		expect( isValidHex( '#abc' ) ).toBe( true );
		expect( isValidHex( '#AABBCC' ) ).toBe( true );
	} );

	it( 'rejects anything the server would also reject', () => {
		expect( isValidHex( 'abc' ) ).toBe( false );
		expect( isValidHex( '#ab' ) ).toBe( false );
		expect( isValidHex( '#gggggg' ) ).toBe( false );
		expect( isValidHex( '' ) ).toBe( false );
		expect( isValidHex( '#aabbccdd' ) ).toBe( false );
	} );
} );

describe( 'normalizeHex', () => {
	it( 'lowercases and keeps the short form as typed', () => {
		expect( normalizeHex( '#ABC' ) ).toBe( '#abc' );
	} );

	it( 'trims surrounding whitespace from a paste', () => {
		expect( normalizeHex( '  #C00000 ' ) ).toBe( '#c00000' );
	} );

	it( 'returns null for a value that is not a hex colour', () => {
		expect( normalizeHex( 'rebeccapurple' ) ).toBeNull();
	} );
} );

describe( 'expandHex', () => {
	it( 'lengthens the short form, because <input type="color"> needs six digits', () => {
		expect( expandHex( '#abc' ) ).toBe( '#aabbcc' );
	} );

	it( 'leaves the long form alone', () => {
		expect( expandHex( '#c00000' ) ).toBe( '#c00000' );
	} );
} );
```

Create `features/player-style/tests/js/contrast.test.ts`:

```ts
import { contrastRatio, relativeLuminance } from '../../admin/contrast';

describe( 'relativeLuminance', () => {
	it( 'anchors at the two ends of the scale', () => {
		expect( relativeLuminance( '#ffffff' ) ).toBeCloseTo( 1, 5 );
		expect( relativeLuminance( '#000000' ) ).toBeCloseTo( 0, 5 );
	} );

	it( 'reads the short form the same as the long one', () => {
		expect( relativeLuminance( '#fff' ) ).toBeCloseTo(
			relativeLuminance( '#ffffff' ),
			5
		);
	} );
} );

describe( 'contrastRatio', () => {
	it( 'gives 21:1 for black on white, either way round', () => {
		expect( contrastRatio( '#ffffff', '#000000' ) ).toBeCloseTo( 21, 2 );
		expect( contrastRatio( '#000000', '#ffffff' ) ).toBeCloseTo( 21, 2 );
	} );

	it( 'passes the shipped text pair comfortably', () => {
		expect( contrastRatio( '#ffffff', '#1e1e1e' ) ).toBeGreaterThan( 4.5 );
	} );

	it( 'puts the shipped accent between the UI and the text thresholds', () => {
		// 3.26:1 — this is why the accent-against-surface pair is judged at 3:1,
		// the WCAG threshold for a UI component. A blanket 4.5 would warn against
		// the plugin's own default the first time the screen is opened.
		const ratio = contrastRatio( '#2b62f0', '#1e1e1e' );
		expect( ratio ).toBeGreaterThan( 3 );
		expect( ratio ).toBeLessThan( 4.5 );
	} );

	it( 'fails a genuinely unreadable pair', () => {
		expect( contrastRatio( '#ffffff', '#f0f0f0' ) ).toBeLessThan( 1.5 );
	} );
} );
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npm run test:unit -- features/player-style
```

Expected: `Cannot find module '../../admin/hex-field'`.

- [ ] **Step 3: Write `hex-field.ts`**

```ts
/**
 * Pure helpers for the settings screen's hex text field.
 *
 * Kept separate from the DOM wiring so they can be tested in Jest: the browser
 * work lives in `preview.ts`, which has an E2E scenario instead.
 */

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Whether a string is a hex colour the server would also accept.
 *
 * Mirrors `sanitize_hex_color()`, which takes three or six digits with a hash
 * and nothing else. The UI restricting the field is convenience; the server
 * validating it is the guarantee.
 *
 * @param value Raw field value.
 */
export function isValidHex( value: string ): boolean {
	return HEX.test( value.trim() );
}

/**
 * Lower-case a valid hex colour, or report that it is not one.
 *
 * The short form is kept short: CSS treats the two alike, and rewriting what
 * the author typed buys nothing.
 *
 * @param value Raw field value.
 * @return The normalised colour, or null when the value is not a hex colour.
 */
export function normalizeHex( value: string ): string | null {
	const trimmed = value.trim();
	return isValidHex( trimmed ) ? trimmed.toLowerCase() : null;
}

/**
 * Lengthen `#abc` into `#aabbcc`.
 *
 * `<input type="color">` accepts only the six-digit form — handed anything
 * else it falls back to black without saying so.
 *
 * @param value A valid hex colour.
 */
export function expandHex( value: string ): string {
	if ( value.length !== 4 ) {
		return value;
	}
	const [ , r, g, b ] = value;
	return `#${ r }${ r }${ g }${ g }${ b }${ b }`;
}
```

- [ ] **Step 4: Write `contrast.ts`**

```ts
/**
 * WCAG contrast maths for the settings screen's warning.
 *
 * Pure by design: the screen only needs a number, and a number is testable
 * without a browser.
 */

import { expandHex } from './hex-field';

/**
 * One channel of an sRGB colour, linearised per WCAG 2.x.
 *
 * @param channel Channel value, 0-255.
 */
function linearise( channel: number ): number {
	const c = channel / 255;
	return c <= 0.04045 ? c / 12.92 : ( ( c + 0.055 ) / 1.055 ) ** 2.4;
}

/**
 * Relative luminance of a hex colour, 0 (black) to 1 (white).
 *
 * @param hex Three- or six-digit hex colour, with the hash.
 */
export function relativeLuminance( hex: string ): number {
	const full = expandHex( hex.trim().toLowerCase() );
	const r = linearise( parseInt( full.slice( 1, 3 ), 16 ) );
	const g = linearise( parseInt( full.slice( 3, 5 ), 16 ) );
	const b = linearise( parseInt( full.slice( 5, 7 ), 16 ) );
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Contrast ratio between two colours, from 1 to 21.
 *
 * Order does not matter: the lighter colour is always the numerator.
 *
 * @param a One colour.
 * @param b The other.
 */
export function contrastRatio( a: string, b: string ): number {
	const la = relativeLuminance( a );
	const lb = relativeLuminance( b );
	const lighter = Math.max( la, lb );
	const darker = Math.min( la, lb );
	return ( lighter + 0.05 ) / ( darker + 0.05 );
}
```

- [ ] **Step 5: Add both to the coverage allowlist**

In `jest.config.js`, `collectCoverageFrom` is an explicit list — a file missing from it is invisible to the 80% gate rather than failing it:

```js
		'features/pronunciation/editor/row-ids.ts',
		'features/player-style/admin/contrast.ts',
		'features/player-style/admin/hex-field.ts',
```

- [ ] **Step 6: Run the tests with coverage and the linters**

```bash
npm run test:unit -- --coverage
npm run lint:js
npx tsc --noEmit
```

Expected: PASS, both new files at or near 100% lines, global gate still met.

- [ ] **Step 7: Commit**

```bash
git add features/player-style jest.config.js
git commit -m "feat: add the pure hex and contrast helpers for the style screen

Split out from the DOM wiring so the maths is testable in Jest. The accent
default measures 3.26:1 against the surface, which is the case that decides the
warning thresholds: 4.5 for text, 3 for a UI component."
```

---

### Task 6: The player section on the settings screen

**Files:**
- Create: `features/player-style/php/class-style-section.php`
- Create: `features/player-style/admin/index.ts`
- Create: `features/player-style/admin/style.scss`
- Create: `features/player-style/tests/php/test-style-section.php`
- Modify: `webpack.config.js`, `post-voice.php`

**Interfaces:**
- Consumes: `Post_Voice_Style_Store` (Task 2), `Post_Voice_Frontend_Render::markup()` (Task 3), `Post_Voice_Settings_Page::{MENU_SLUG,OPTION_GROUP,is_current_screen}` (Task 1).
- Produces: `Post_Voice_Style_Section::register()`, `::register_setting()`, `::enqueue( $hook_suffix )`, `::render()`, `::render_color_field( array $args )`, `::render_radius_field()`; the DOM contract the preview script binds to — `.post-voice-preview`, `.post-voice-style-picker`, `.post-voice-style-hex`, `[data-key]`, `.post-voice-contrast-warning`, `#post-voice-style-restore`.

- [ ] **Step 1: Write the failing tests**

Create `features/player-style/tests/php/test-style-section.php`:

```php
<?php
/**
 * Tests for the player styling section.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

/**
 * @covers Post_Voice_Style_Section
 */
class Test_Post_Voice_Style_Section extends WP_UnitTestCase {

	use Post_Voice_Fires_Admin_Init;

	public function test_option_is_registered_with_the_store_sanitiser(): void {
		set_current_screen( 'dashboard' );
		Post_Voice_Style_Section::register();
		self::fire_admin_init();

		$registered = get_registered_settings();

		$this->assertArrayHasKey( Post_Voice_Style_Store::OPTION, $registered );
		$this->assertSame(
			array( 'Post_Voice_Style_Store', 'sanitize' ),
			$registered[ Post_Voice_Style_Store::OPTION ]['sanitize_callback']
		);
	}

	public function test_the_four_fields_are_registered_on_this_screen(): void {
		global $wp_settings_fields;
		set_current_screen( 'dashboard' );
		Post_Voice_Style_Section::register();
		self::fire_admin_init();

		$fields = $wp_settings_fields[ Post_Voice_Settings_Page::MENU_SLUG ]['post_voice_player_style_section'] ?? array();

		$this->assertSame(
			array(
				'post_voice_player_style_surface',
				'post_voice_player_style_accent',
				'post_voice_player_style_text',
				'post_voice_player_style_radius',
			),
			array_keys( $fields )
		);
	}

	public function test_preview_renders_the_real_player_with_the_saved_values(): void {
		update_option(
			Post_Voice_Style_Store::OPTION,
			array( 'accent' => '#c00000' ) + Post_Voice_Style_Store::DEFAULTS
		);

		ob_start();
		Post_Voice_Style_Section::render();
		$html = (string) ob_get_clean();

		$this->assertStringContainsString( 'post-voice-preview', $html );
		$this->assertStringContainsString( 'post-voice-player--enhanced', $html );
		$this->assertStringContainsString( '--pv-accent:#c00000', $html );
		// Correct before any JavaScript runs, and correct if it never does.
		$this->assertStringContainsString( 'role="status"', $html );
	}

	public function test_preview_carries_no_style_attribute_when_nothing_was_customised(): void {
		delete_option( Post_Voice_Style_Store::OPTION );

		ob_start();
		Post_Voice_Style_Section::render();
		$html = (string) ob_get_clean();

		$this->assertStringNotContainsString( 'style="--pv', $html );
	}

	public function test_colour_field_posts_from_the_text_input_only(): void {
		update_option(
			Post_Voice_Style_Store::OPTION,
			array( 'accent' => '#abc' ) + Post_Voice_Style_Store::DEFAULTS
		);

		ob_start();
		Post_Voice_Style_Section::render_color_field(
			array(
				'key'          => 'accent',
				'label_for'    => 'post-voice-style-accent',
				'picker_label' => 'Pick the accent colour',
			)
		);
		$html = (string) ob_get_clean();

		// One name per key: two inputs posting the same key would make "which
		// wins" a question the server should never have to answer.
		$this->assertSame( 1, substr_count( $html, 'name="post_voice_player_style[accent]"' ) );
		$this->assertMatchesRegularExpression( '/<input[^>]*type="text"[^>]*name="post_voice_player_style\[accent\]"/', $html );
		// The picker only understands six digits.
		$this->assertMatchesRegularExpression( '/<input[^>]*type="color"[^>]*value="#aabbcc"/', $html );
		$this->assertMatchesRegularExpression( '/<input[^>]*type="text"[^>]*value="#abc"/', $html );
	}

	public function test_radius_field_offers_the_three_presets_with_the_saved_one_selected(): void {
		update_option(
			Post_Voice_Style_Store::OPTION,
			array( 'radius' => 'square' ) + Post_Voice_Style_Store::DEFAULTS
		);

		ob_start();
		Post_Voice_Style_Section::render_radius_field();
		$html = (string) ob_get_clean();

		foreach ( array_keys( Post_Voice_Style_Store::RADII ) as $key ) {
			$this->assertStringContainsString( 'value="' . $key . '"', $html );
		}
		$this->assertMatchesRegularExpression( '/value="square"\s+selected/', $html );
	}

	public function test_enqueue_ignores_another_screen(): void {
		Post_Voice_Style_Section::enqueue( 'post.php' );

		$this->assertFalse( wp_script_is( 'post-voice-player-style-admin', 'enqueued' ) );
		$this->assertFalse( wp_style_is( 'post-voice-player', 'enqueued' ) );
	}

	public function test_enqueue_loads_the_real_player_stylesheet_on_this_screen(): void {
		if ( ! file_exists( POST_VOICE_PATH . 'build/player-style-admin.asset.php' ) ) {
			$this->markTestSkipped( 'Run `npm run build` first: the enqueue is guarded on the asset file.' );
		}

		Post_Voice_Style_Section::enqueue( 'settings_page_post-voice' );

		// The preview must use the player's own CSS, not a copy of it.
		$this->assertTrue( wp_style_is( 'post-voice-player', 'enqueued' ) );
		$this->assertTrue( wp_style_is( 'post-voice-player-style-admin', 'enqueued' ) );
		$this->assertTrue( wp_script_is( 'post-voice-player-style-admin', 'enqueued' ) );
	}
}
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npm run test:php -- --filter Test_Post_Voice_Style_Section
```

Expected: `Error: Class "Post_Voice_Style_Section" not found`.

- [ ] **Step 3: Write the section**

Create `features/player-style/php/class-style-section.php`:

```php
<?php
/**
 * The player styling section of the settings screen.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Registers the style option, the live preview and the four fields.
 *
 * The preview is rendered by the section callback, which prints above the form
 * table — the author sees the player first and the controls under it, which is
 * the layout the spec's mockups settled on.
 */
class Post_Voice_Style_Section {

	private const SECTION = 'post_voice_player_style_section';

	/**
	 * Hook the setting and this screen's assets.
	 */
	public static function register(): void {
		add_action( 'admin_init', array( self::class, 'register_setting' ) );
		add_action( 'admin_enqueue_scripts', array( self::class, 'enqueue' ) );
	}

	/**
	 * Register the option, the section and the four fields.
	 */
	public static function register_setting(): void {
		register_setting(
			Post_Voice_Settings_Page::OPTION_GROUP,
			Post_Voice_Style_Store::OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( 'Post_Voice_Style_Store', 'sanitize' ),
				'default'           => Post_Voice_Style_Store::DEFAULTS,
			)
		);

		add_settings_section(
			self::SECTION,
			__( 'Player', 'post-voice' ),
			array( self::class, 'render' ),
			Post_Voice_Settings_Page::MENU_SLUG
		);

		$colours = array(
			'surface' => array( __( 'Background', 'post-voice' ), __( 'Pick the background colour', 'post-voice' ) ),
			'accent'  => array( __( 'Accent', 'post-voice' ), __( 'Pick the accent colour', 'post-voice' ) ),
			'text'    => array( __( 'Text and icons', 'post-voice' ), __( 'Pick the text colour', 'post-voice' ) ),
		);

		foreach ( $colours as $key => $labels ) {
			add_settings_field(
				'post_voice_player_style_' . $key,
				$labels[0],
				array( self::class, 'render_color_field' ),
				Post_Voice_Settings_Page::MENU_SLUG,
				self::SECTION,
				array(
					'key'          => $key,
					'label_for'    => 'post-voice-style-' . $key,
					'picker_label' => $labels[1],
				)
			);
		}

		add_settings_field(
			'post_voice_player_style_radius',
			__( 'Corners', 'post-voice' ),
			array( self::class, 'render_radius_field' ),
			Post_Voice_Settings_Page::MENU_SLUG,
			self::SECTION,
			array( 'label_for' => 'post-voice-style-radius' )
		);
	}

	/**
	 * Load the preview's assets, on this screen only.
	 *
	 * The player's own stylesheet is enqueued here under the same handle it uses
	 * on the frontend: the preview is the real player, so it must be the real
	 * CSS. The admin sheet on top only undoes the fixed positioning.
	 *
	 * @param string $hook_suffix Current admin page.
	 */
	public static function enqueue( $hook_suffix ): void {
		if ( ! Post_Voice_Settings_Page::is_current_screen( (string) $hook_suffix ) ) {
			return;
		}

		$asset_file = POST_VOICE_PATH . 'build/player-style-admin.asset.php';
		if ( ! file_exists( $asset_file ) ) {
			return;
		}
		$asset = require $asset_file;

		wp_enqueue_style(
			'post-voice-player',
			POST_VOICE_URL . 'build/style-narration-player.css',
			array(),
			$asset['version']
		);
		wp_enqueue_style(
			'post-voice-player-style-admin',
			POST_VOICE_URL . 'build/style-player-style-admin.css',
			array( 'post-voice-player' ),
			$asset['version']
		);
		wp_enqueue_script(
			'post-voice-player-style-admin',
			POST_VOICE_URL . 'build/player-style-admin.js',
			$asset['dependencies'],
			$asset['version'],
			true
		);
		wp_set_script_translations( 'post-voice-player-style-admin', 'post-voice', POST_VOICE_PATH . 'languages' );
	}

	/**
	 * Render the preview and the contrast message.
	 */
	public static function render(): void {
		$declarations = Post_Voice_Style_Store::css_declarations();
		?>
		<p><?php esc_html_e( 'Colours for the player readers see under a narrated post.', 'post-voice' ); ?></p>
		<div class="post-voice-preview"
			<?php if ( '' !== $declarations ) : ?>
			style="<?php echo esc_attr( $declarations ); ?>"
			<?php endif; ?>
		>
			<?php
			// Built by the same function the frontend uses, so the preview cannot
			// drift from the player. Its own output is escaped at the source.
			echo Post_Voice_Frontend_Render::markup( null, true ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			?>
		</div>
		<p class="post-voice-contrast-warning" role="status"></p>
		<?php
	}

	/**
	 * Render one colour row: a picker and the hex it posts.
	 *
	 * @param array{key: string, label_for: string, picker_label: string} $args Field arguments.
	 */
	public static function render_color_field( array $args ): void {
		$key   = (string) $args['key'];
		$value = Post_Voice_Style_Store::get()[ $key ];
		$name  = Post_Voice_Style_Store::OPTION . '[' . $key . ']';
		?>
		<input type="color"
			class="post-voice-style-picker"
			data-key="<?php echo esc_attr( $key ); ?>"
			value="<?php echo esc_attr( Post_Voice_Style_Store::expand_hex( $value ) ); ?>"
			aria-label="<?php echo esc_attr( (string) $args['picker_label'] ); ?>" />
		<input type="text"
			id="<?php echo esc_attr( (string) $args['label_for'] ); ?>"
			class="post-voice-style-hex"
			data-key="<?php echo esc_attr( $key ); ?>"
			name="<?php echo esc_attr( $name ); ?>"
			value="<?php echo esc_attr( $value ); ?>"
			pattern="#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})"
			maxlength="7"
			spellcheck="false"
			autocomplete="off" />
		<?php
	}

	/**
	 * Render the corner preset select.
	 */
	public static function render_radius_field(): void {
		$labels = array(
			'pill'    => __( 'Pill (default)', 'post-voice' ),
			'rounded' => __( 'Rounded corners', 'post-voice' ),
			'square'  => __( 'Square corners', 'post-voice' ),
		);
		$value  = Post_Voice_Style_Store::get()['radius'];
		?>
		<select id="post-voice-style-radius"
			class="post-voice-style-radius"
			name="<?php echo esc_attr( Post_Voice_Style_Store::OPTION . '[radius]' ); ?>">
			<?php foreach ( $labels as $key => $label ) : ?>
			<option value="<?php echo esc_attr( $key ); ?>"
				data-length="<?php echo esc_attr( Post_Voice_Style_Store::RADII[ $key ] ); ?>"
				<?php selected( $value, $key ); ?>>
				<?php echo esc_html( $label ); ?>
			</option>
			<?php endforeach; ?>
		</select>
		<?php
	}
}
```

- [ ] **Step 4: Write the admin stylesheet**

Create `features/player-style/admin/style.scss`:

```scss
// Admin-only rules for the settings preview. Nothing here ships to the reader.
//
// The real player is `position: fixed` at the bottom of the viewport, which is
// right in a post and wrong in wp-admin, where it would float over the screen
// the author is editing. These three rules put it back in the flow; everything
// else about the preview is the player's own CSS.

.post-voice-preview {
	margin: 0 0 1.5rem;

	.post-voice-player--enhanced {
		position: static;
		animation: none;
		margin: 0;
	}
}

.post-voice-contrast-warning:empty {
	display: none;
}

.post-voice-style-picker {
	// Line the swatch up with the text field next to it.
	block-size: 2.25rem;
	inline-size: 3rem;
	margin-inline-end: 0.5rem;
	vertical-align: middle;
}
```

- [ ] **Step 5: Write the entry point**

Create `features/player-style/admin/index.ts`. The preview wiring itself lands in Task 7; this file exists now so the build produces the asset the enqueue is guarded on:

```ts
/**
 * Settings screen entry: the live preview of the reader's player.
 *
 * Vanilla TS, not React, for the same reason the dictionary screen is: this is
 * a plain WordPress settings form posted to `options.php`, and the editor's
 * React runtime would be a large dependency for a handful of listeners.
 */

import './style.scss';
```

- [ ] **Step 6: Add the build entry**

In `webpack.config.js`, inside `entry`:

```js
		'player-style-admin': path.resolve(
			__dirname,
			'features/player-style/admin/index.ts'
		),
```

- [ ] **Step 7: Register the section**

In `post-voice.php`:

```php
require_once POST_VOICE_PATH . 'features/player-style/php/class-style-section.php';
```

```php
Post_Voice_Style_Section::register();
```

- [ ] **Step 8: Build, then run the tests and the linters**

```bash
npm run build
npm run test:php -- --filter Test_Post_Voice_Style_Section
composer run lint
composer run stan
npm run lint:js
npx tsc --noEmit
```

Expected: PASS. The enqueue test is skipped if the build has not run — if you see the skip after building, the entry name in `webpack.config.js` does not match `player-style-admin`.

- [ ] **Step 9: Look at the screen**

```bash
npm run refresh:php
```

Open `Settings → Narration`. The dictionary is on top, the player section below it, the preview pill is in the flow of the page (not floating over wp-admin), and the four controls show the saved values. Save with a changed colour and confirm it survives a reload. Nothing is live yet — that is Task 7.

- [ ] **Step 10: Commit**

```bash
git add features/player-style webpack.config.js post-voice.php
git commit -m "feat: add the player section to the settings screen

The preview is the real player markup and the real player stylesheet, so it
cannot drift from what readers see. The hex text field is the only input that
carries a name: a picker posting the same key would make 'which one wins' a
question the server should never have to answer."
```

---

### Task 7: Make the preview live

**Files:**
- Create: `features/player-style/admin/preview.ts`
- Modify: `features/player-style/admin/index.ts`

**Interfaces:**
- Consumes: `normalizeHex`, `expandHex`, `isValidHex` (Task 5), `contrastRatio` (Task 5), the DOM contract from Task 6.
- Produces: `initPreview( root: ParentNode = document ): void`.

- [ ] **Step 1: Write the preview module**

There is no Jest test for this file: it is DOM wiring, it stays out of `collectCoverageFrom` for the same reason `features/pronunciation/admin/settings.ts` does, and Task 8 covers it with a real browser.

Create `features/player-style/admin/preview.ts`:

```ts
/**
 * Live preview for the player styling section.
 *
 * The server already rendered the preview with the saved values, so everything
 * here is enhancement: if this file fails to load, the screen still shows the
 * right colours and still saves.
 */

import { __, sprintf } from '@wordpress/i18n';
import { contrastRatio } from './contrast';
import { expandHex, isValidHex, normalizeHex } from './hex-field';

const PROPERTY: Record< string, string > = {
	surface: '--pv-surface',
	accent: '--pv-accent',
	text: '--pv-text',
};

const DEFAULTS: Record< string, string > = {
	surface: '#1e1e1e',
	accent: '#2b62f0',
	text: '#ffffff',
	radius: 'pill',
};

/**
 * The three pairs worth checking, and the threshold WCAG gives each one.
 *
 * Text keeps 4.5:1. The accent against the background is a UI component — the
 * play button and the progress bar — which WCAG 2.2 judges at 3:1; holding it
 * to 4.5 would warn against the plugin's own default pairing, which measures
 * 3.26:1.
 */
const PAIRS: Array< { a: string; b: string; minimum: number; label: string } > =
	[
		{
			a: 'text',
			b: 'surface',
			minimum: 4.5,
			label: __( 'Text and icons against the background', 'post-voice' ),
		},
		{
			a: 'text',
			b: 'accent',
			minimum: 4.5,
			label: __( 'The play icon against the accent', 'post-voice' ),
		},
		{
			a: 'accent',
			b: 'surface',
			minimum: 3,
			label: __( 'The accent against the background', 'post-voice' ),
		},
	];

/**
 * Read the current colour of every hex field, falling back to the defaults.
 *
 * @param fields The hex text inputs.
 */
function readColours( fields: HTMLInputElement[] ): Record< string, string > {
	const colours = { ...DEFAULTS };
	for ( const field of fields ) {
		const key = field.dataset.key ?? '';
		const value = normalizeHex( field.value );
		if ( key && value ) {
			colours[ key ] = value;
		}
	}
	return colours;
}

/**
 * Write the colours and the corner length onto the preview wrapper.
 *
 * @param wrapper The preview container.
 * @param colours Current colour per key.
 * @param radius  Current corner length, e.g. `12px`.
 */
function applyStyle(
	wrapper: HTMLElement,
	colours: Record< string, string >,
	radius: string
): void {
	for ( const [ key, property ] of Object.entries( PROPERTY ) ) {
		wrapper.style.setProperty( property, colours[ key ] );
	}
	wrapper.style.setProperty( '--pv-radius', radius );
}

/**
 * Say which pairs fall below their threshold, or nothing when all pass.
 *
 * A warning, never a block: the choice stays the author's, informed.
 *
 * @param message The status paragraph.
 * @param colours Current colour per key.
 */
function reportContrast(
	message: HTMLElement,
	colours: Record< string, string >
): void {
	const failing = PAIRS.filter(
		( pair ) =>
			contrastRatio( colours[ pair.a ], colours[ pair.b ] ) < pair.minimum
	).map( ( pair ) => pair.label );

	message.textContent =
		failing.length === 0
			? ''
			: sprintf(
					/* translators: %s: comma-separated list of colour pairs with low contrast. */
					__(
						'Low contrast, which can make the player hard to read: %s. You can still save.',
						'post-voice'
					),
					failing.join( '; ' )
			  );
}

/**
 * Wire the fields, the preview and the restore link together.
 *
 * @param root Where to look for the screen's elements.
 */
export function initPreview( root: ParentNode = document ): void {
	const wrapper = root.querySelector< HTMLElement >( '.post-voice-preview' );
	const message = root.querySelector< HTMLElement >(
		'.post-voice-contrast-warning'
	);
	const radiusField = root.querySelector< HTMLSelectElement >(
		'.post-voice-style-radius'
	);
	const hexFields = Array.from(
		root.querySelectorAll< HTMLInputElement >( '.post-voice-style-hex' )
	);
	const pickers = Array.from(
		root.querySelectorAll< HTMLInputElement >( '.post-voice-style-picker' )
	);
	if ( ! wrapper || ! message || ! radiusField || hexFields.length === 0 ) {
		return;
	}

	const currentRadius = (): string =>
		radiusField.selectedOptions[ 0 ]?.dataset.length ?? '999px';

	const refresh = (): void => {
		const colours = readColours( hexFields );
		applyStyle( wrapper, colours, currentRadius() );
		reportContrast( message, colours );
	};

	for ( const field of hexFields ) {
		field.addEventListener( 'input', () => {
			const value = normalizeHex( field.value );
			if ( ! value ) {
				// Leave the preview showing the last good value rather than
				// flashing black while a hex is half-typed.
				return;
			}
			const picker = pickers.find(
				( candidate ) => candidate.dataset.key === field.dataset.key
			);
			if ( picker ) {
				picker.value = expandHex( value );
			}
			refresh();
		} );

		// Never submit something the server would silently discard.
		field.addEventListener( 'blur', () => {
			if ( isValidHex( field.value ) ) {
				field.value = normalizeHex( field.value ) ?? field.value;
				return;
			}
			const picker = pickers.find(
				( candidate ) => candidate.dataset.key === field.dataset.key
			);
			field.value = picker?.value ?? DEFAULTS[ field.dataset.key ?? '' ];
			refresh();
		} );
	}

	for ( const picker of pickers ) {
		picker.addEventListener( 'input', () => {
			const field = hexFields.find(
				( candidate ) => candidate.dataset.key === picker.dataset.key
			);
			if ( field ) {
				field.value = picker.value.toLowerCase();
			}
			refresh();
		} );
	}

	radiusField.addEventListener( 'change', refresh );

	// Client-side only: the Save button remains the one thing that writes. A
	// link that saved on click would let one stray click discard a site's
	// customisation with no confirmation.
	const restore = document.createElement( 'button' );
	restore.type = 'button';
	restore.className = 'button-link';
	restore.id = 'post-voice-style-restore';
	restore.textContent = __( 'Restore defaults', 'post-voice' );
	restore.addEventListener( 'click', () => {
		for ( const field of hexFields ) {
			const key = field.dataset.key ?? '';
			field.value = DEFAULTS[ key ] ?? field.value;
		}
		for ( const picker of pickers ) {
			const key = picker.dataset.key ?? '';
			picker.value = expandHex( DEFAULTS[ key ] ?? picker.value );
		}
		radiusField.value = DEFAULTS.radius;
		refresh();
	} );
	message.insertAdjacentElement( 'afterend', restore );

	refresh();
}
```

- [ ] **Step 2: Boot it from the entry**

`features/player-style/admin/index.ts` becomes:

```ts
/**
 * Settings screen entry: the live preview of the reader's player.
 *
 * Vanilla TS, not React, for the same reason the dictionary screen is: this is
 * a plain WordPress settings form posted to `options.php`, and the editor's
 * React runtime would be a large dependency for a handful of listeners.
 */

import './style.scss';
import { initPreview } from './preview';

document.addEventListener( 'DOMContentLoaded', () => initPreview() );
```

- [ ] **Step 3: Build and check it by hand**

```bash
npm run build
npm run refresh:php
```

On `Settings → Narration`:

1. type `#c00000` in the accent field — the pill's play button and progress bar turn red as you type, and the swatch follows;
2. type `#zz` — nothing changes, and leaving the field restores the last good value;
3. drag the picker — the hex field follows;
4. choose "Square corners" — the pill squares off while the play and close buttons stay round;
5. set the background to `#ffffff` — the contrast message names the failing pairs, and Save still works;
6. click "Restore defaults" — the fields and preview reset, and reloading without saving brings the saved values back.

- [ ] **Step 4: Run the linters and the unit gates**

```bash
npm run lint:js
npx tsc --noEmit
npm run test:unit -- --coverage
```

Expected: all green; coverage unchanged, since this file is deliberately outside the allowlist.

- [ ] **Step 5: Commit**

```bash
git add features/player-style
git commit -m "feat: make the settings preview follow the fields live

Enhancement only: the server already rendered the preview with the saved
values, so a failed script leaves a correct, saveable screen. Restore defaults
writes to the fields and never to the database — the Save button stays the only
thing that persists anything."
```

---

### Task 8: End-to-end proof, translations, and the full gate

**Files:**
- Create: `e2e/player-style.spec.ts`
- Modify: `languages/post-voice.pot`, `TESTING.md`, `docs/superpowers/plans/2026-08-17-post-voice-fase3-implementation-plan.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing further.

- [ ] **Step 1: Write the E2E scenarios**

Create `e2e/player-style.spec.ts`:

```ts
import path from 'node:path';
import { test, expect } from '@wordpress/e2e-test-utils-playwright';
import type { RequestUtils } from '@wordpress/e2e-test-utils-playwright';
import AxeBuilder from '@axe-core/playwright';

const BLOCKING_IMPACTS = [ 'serious', 'critical' ];

/**
 * Publish a post that already has narration attached.
 *
 * The renderer returns the content untouched without
 * `_narration_attachment_id`, so a plain createPost() would leave no player to
 * assert against.
 *
 * @param requestUtils REST helper from the Playwright fixtures.
 * @param title        Title for the created post.
 */
async function createPostWithNarration(
	requestUtils: RequestUtils,
	title: string
) {
	const post = await requestUtils.createPost( {
		title,
		status: 'publish',
		date_gmt: new Date().toISOString(),
	} );
	const media = await requestUtils.uploadMedia(
		path.join( __dirname, 'fixtures', 'sample.mp3' )
	);
	await requestUtils.rest( {
		method: 'POST',
		path: `/wp/v2/media/${ media.id }`,
		data: { post: post.id },
	} );
	await requestUtils.rest( {
		method: 'POST',
		path: `/wp/v2/posts/${ post.id }`,
		data: {
			meta: {
				_narration_attachment_id: media.id,
				_narration_language: 'portuguese',
				_narration_source_hash: 'a'.repeat( 64 ),
			},
		},
	} );
	return post;
}

/**
 * Set the accent colour through the real screen and save.
 *
 * @param page Playwright page, already on the settings screen.
 * @param hex  Colour to type into the accent field.
 */
async function setAccent( page, hex: string ) {
	const accent = page.locator( '#post-voice-style-accent' );
	await accent.fill( hex );
	await page.getByRole( 'button', { name: 'Save Changes' } ).click();
	await expect( page.locator( '#setting-error-settings_updated' ) ).toBeVisible();
}

test.describe( 'player styling', () => {
	test.afterEach( async ( { admin, page } ) => {
		// Every scenario shares one site-wide option, so each one puts it back.
		await admin.visitAdminPage( 'options-general.php', 'page=post-voice' );
		await page.getByRole( 'button', { name: 'Restore defaults' } ).click();
		await page.getByRole( 'button', { name: 'Save Changes' } ).click();
	} );

	test( 'an uncustomised site ships no inline player CSS', async ( {
		page,
		requestUtils,
	} ) => {
		const post = await createPostWithNarration( requestUtils, 'No styling' );
		await page.goto( `/?p=${ post.id }` );

		await expect(
			page.locator( 'style#post-voice-player-inline-css' )
		).toHaveCount( 0 );
	} );

	test( 'a saved accent reaches the reader', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const post = await createPostWithNarration( requestUtils, 'Red accent' );

		await admin.visitAdminPage( 'options-general.php', 'page=post-voice' );
		await setAccent( page, '#c00000' );

		await page.goto( `/?p=${ post.id }` );
		const playButton = page.locator( '[data-role="play"]' );
		await expect( playButton ).toBeVisible();
		await expect( playButton ).toHaveCSS(
			'background-color',
			'rgb(192, 0, 0)'
		);
	} );

	test( 'the preview follows the field before anything is saved', async ( {
		admin,
		page,
	} ) => {
		await admin.visitAdminPage( 'options-general.php', 'page=post-voice' );

		const previewPlay = page.locator(
			'.post-voice-preview [data-role="play"]'
		);
		await expect( previewPlay ).toHaveCSS(
			'background-color',
			'rgb(43, 98, 240)'
		);

		await page.locator( '#post-voice-style-accent' ).fill( '#c00000' );
		await expect( previewPlay ).toHaveCSS(
			'background-color',
			'rgb(192, 0, 0)'
		);

		// Not saved: a reload must bring the shipped colour back.
		await page.reload();
		await expect( previewPlay ).toHaveCSS(
			'background-color',
			'rgb(43, 98, 240)'
		);
	} );

	test( 'a low-contrast choice warns and still saves', async ( {
		admin,
		page,
	} ) => {
		await admin.visitAdminPage( 'options-general.php', 'page=post-voice' );

		await page.locator( '#post-voice-style-surface' ).fill( '#ffffff' );
		await expect(
			page.locator( '.post-voice-contrast-warning' )
		).toContainText( 'Low contrast' );

		await page.getByRole( 'button', { name: 'Save Changes' } ).click();
		await expect(
			page.locator( '#setting-error-settings_updated' )
		).toBeVisible();
		await expect( page.locator( '#post-voice-style-surface' ) ).toHaveValue(
			'#ffffff'
		);
	} );

	test( 'the settings screen has zero serious/critical accessibility violations', async ( {
		admin,
		page,
	} ) => {
		await admin.visitAdminPage( 'options-general.php', 'page=post-voice' );
		await expect( page.locator( '.post-voice-preview' ) ).toBeVisible();

		const results = await new AxeBuilder( { page } )
			.include( '.wrap' )
			.analyze();
		const blocking = results.violations.filter( ( v ) =>
			BLOCKING_IMPACTS.includes( v.impact ?? '' )
		);
		expect( blocking ).toEqual( [] );
	} );
} );
```

- [ ] **Step 2: Run the whole E2E suite, not just this file**

```bash
npm run build && npm run test:e2e
```

Expected: every scenario passes, the Fase 1 and Fase 2 ones included. Running only the new file is what let a five-commit regression hide during Fase 2 — `TESTING.md` records that.

- [ ] **Step 3: Regenerate the translations**

```bash
npm run i18n:pot
npm run i18n:check
```

Expected: "languages/post-voice.pot is current.", and the new strings ("Player", "Background", "Accent", "Text and icons", "Corners", the three corner presets, "Restore defaults", the contrast message and the three pair labels) present in the file.

- [ ] **Step 4: Record the two gotchas this phase adds**

Append to the troubleshooting section of `TESTING.md`:

```markdown
**A colour saved on the settings screen does not reach the reader.** Check the
page source for `<style id="post-voice-player-inline-css">`. Absent means the
value equals the shipped default (nothing is emitted, by design) or the
enqueue's asset-file guard bailed out because `npm run build` has not run.

**The preview pill floats over wp-admin.** `build/style-player-style-admin.css`
did not load. The real player is `position: fixed`; only the admin stylesheet
puts it back in the flow, and it is enqueued through the same guard as the
screen's script.
```

- [ ] **Step 5: Run the full local CI, in the order `CLAUDE.md` sets**

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

If anything fails: stop, and report what failed with its output, the established root cause, two or three fixes with their costs, and a recommendation. Do not lower a threshold or disable a check.

- [ ] **Step 6: Append the revisions section to this plan**

Add a `## Revisões` section at the end of this file recording every defect execution found, numbered, in the same shape as the Fase 1 and Fase 2 plans. A plan that ends exactly as written is a plan nobody executed.

- [ ] **Step 7: Commit**

```bash
git add e2e languages TESTING.md docs/superpowers/plans
git commit -m "test: cover the player styling end to end

Five scenarios in a real browser: no inline CSS without customisation, a saved
accent reaching the reader, the preview following a field before any save, the
contrast warning that does not block, and axe on the screen with the preview
rendered."
```

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: the shared shell and the section split (Task 1), the store with its sanitising and CSS serialisation (Task 2), the single markup function (Task 3), the custom properties, derived tones and inline delivery (Task 4), the contrast maths and hex rules (Task 5), the screen with its preview and four fields (Task 6), the live behaviour and the restore link (Task 7), the E2E proof, the `.pot` and the gates (Task 8). The spec's configuration inventory is distributed to the tasks that create the files it names: `phpunit.xml.dist`, `phpstan.neon`, and both i18n lists in Task 1; `jest.config.js` in Task 5; `webpack.config.js` in Task 6.

**One thing the spec did not say, decided here.** `<input type="color">` accepts only the six-digit hex form and silently shows black when handed `#abc`, so both `Post_Voice_Style_Store::expand_hex()` and `expandHex()` exist to feed the picker while the text field keeps the short form the author typed. The spec's HTML `pattern` is written there with `^…$`; the attribute is implicitly anchored, so the plan uses the unanchored form, which is equivalent.

**Placeholders.** None: every step carries the code it needs, and no task refers to another for its content.

**Type consistency.** `markup( ?string $src, bool $preview = false )` is used with that signature in Tasks 3, 6 and its tests. `css_declarations()` (no selector) feeds the preview wrapper; `inline_css()` (with selector) feeds `wp_add_inline_style` — the two are never swapped. The custom property names `--pv-surface`, `--pv-accent`, `--pv-text`, `--pv-radius` are identical in the SCSS (Task 4), the PHP serialiser (Task 2) and `PROPERTY` in `preview.ts` (Task 7). The DOM contract declared in Task 6 — `.post-voice-preview`, `.post-voice-style-hex`, `.post-voice-style-picker`, `.post-voice-style-radius`, `.post-voice-contrast-warning`, `data-key`, `data-length` — is exactly what Task 7 queries and what Task 8 asserts against.

---

## Revision 2026-08-17 — execution findings

Executing the plan surfaced defects that only a real run could show. Fixes are
inline above where they belong to one task; the rest are recorded here.

**Configuration**

1. **Task 1: the plan assumed `wp i18n make-pot` and PHPUnit both silently
   tolerate a `<directory>` entry pointing at a path that does not exist yet.**
   True for `wp i18n make-pot`'s `--include` and for PHPUnit's
   `<coverage><include>`/`<exclude>`, but PHPUnit 9.6 throws
   `TestDirectoryNotFoundException` on a `<testsuite><directory>` entry pointing
   at a nonexistent path. Task 1 added `features/player-style/tests/php` only to
   `<coverage><exclude>`, with a comment explaining why, and Task 2 — which is
   what actually created that directory's first file — added the
   `<testsuite>` entry.

**Task briefs' reference code**

2. **Task 4: the asset-enqueue test brief asserted
   `assertSame( array(), (array) wp_styles()->get_data(...) )`.** WP core's
   `get_data()` returns the scalar `false` for an unset key, and
   `(array) false === array( 0 => false )`, not `array()` — that assertion would
   fail unconditionally even against a correct implementation. Fixed to
   `assertFalse(...)`, asserted directly rather than cast.
3. **Task 4: a fix-round finding — the two new asset-enqueue tests omitted the
   `with_asset_file( 'player' )` helper every sibling test in that file uses.**
   Without it, `enqueue_frontend_assets()` returns early on a fresh CI checkout
   (`build/` is gitignored and CI's unit job never runs `npm run build` before
   `test:php`): one test would fail and the other would pass vacuously,
   exercising only the file-existence guard rather than the inline-style call it
   was named for. This was masked locally by a stale `build/` directory left
   over from manual testing. Fixed by adding the helper call to both tests,
   verified by moving `build/narration-player.asset.php` aside and confirming
   the customised-player test now fails without the call.
4. **Task 6: the brief's reference code for `render_radius_field()` put the
   `data-length` attribute between `value="…"` and `selected()`'s output, but the
   brief's own PHPUnit regex assertion (`/value="square"\s+selected/`) can only
   match when `selected()` immediately follows `value`.** Fixed by reordering
   the attributes so `selected()` comes first — HTML-semantically inert,
   verified no test or CSS depends on attribute order.
5. **Task 7: the brief's reference code for `initPreview()` in `preview.ts`
   declared `const pickers = Array.from( … )` before the function's early-return
   guard clause.** ESLint's `@wordpress/no-unused-vars-before-return` rule
   (part of this project's enabled recommended config) flags any variable
   initialised by a call expression, declared before a return, with zero
   references before that return — `pickers` is only used after the guard, so
   it triggered the rule. Fixed by moving the declaration to immediately after
   the guard: a pure reorder, no behavioural change, confirmed by tracing all
   three use sites, which already all ran after the guard.
6. **Task 8: the brief's reference code for `e2e/player-style.spec.ts` failed
   both `lint:js` and `tsc --noEmit` verbatim.** Three lines exceeded
   `wp-prettier`'s wrap width (the `await expect( … ).toBeVisible()` call and
   both `createPostWithNarration` call sites), and `setAccent`'s `page`
   parameter carried no type, tripping `strict`'s `noImplicitAny`. Fixed with
   `wp-scripts lint-js --fix` for the first (verified whitespace-only by diff)
   and by importing `Page` from `@playwright/test` and annotating the parameter
   for the second — the same pattern already used by `e2e/open-narration-panel.ts`
   and `e2e/narration-fase2.spec.ts`. Neither changes the scenario's behaviour.
