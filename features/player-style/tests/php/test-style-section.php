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
	use Post_Voice_With_Asset_File;

	/**
	 * Path of the preview screen's own asset manifest.
	 */
	private function asset_file(): string {
		return POST_VOICE_PATH . 'build/player-style-admin.asset.php';
	}

	protected function setUp(): void {
		parent::setUp();
		$this->recover_parked_asset_file( $this->asset_file() );

		// Enqueued handles are global and survive between tests, so a later
		// test would see whatever an earlier one enqueued and pass (or fail)
		// for the wrong reason.
		$GLOBALS['wp_scripts'] = new WP_Scripts();
		$GLOBALS['wp_styles']  = new WP_Styles();
	}

	/**
	 * `register_setting()` and `add_settings_section()` write straight into
	 * globals that WP_UnitTestCase's own rollback never touches (it undoes DB
	 * writes and re-added hooks, not these). Left alone, a test here that fires
	 * `admin_init` leaks a registered section into every test class that runs
	 * afterwards in the same process — including the settings-page shell's own
	 * "no sections registered" case.
	 */
	protected function tearDown(): void {
		global $wp_settings_sections;
		unset( $wp_settings_sections[ Post_Voice_Settings_Page::MENU_SLUG ] );
		unregister_setting( Post_Voice_Settings_Page::OPTION_GROUP, Post_Voice_Style_Store::OPTION );
		$this->tear_down_asset_files();
		parent::tearDown();
	}

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
		$this->with_asset_file( $this->asset_file() );

		Post_Voice_Style_Section::enqueue( 'settings_page_post-voice' );

		// The preview must use the player's own CSS, not a copy of it.
		$this->assertTrue( wp_style_is( 'post-voice-player', 'enqueued' ) );
		$this->assertTrue( wp_style_is( 'post-voice-player-style-admin', 'enqueued' ) );
		$this->assertTrue( wp_script_is( 'post-voice-player-style-admin', 'enqueued' ) );
	}

	public function test_enqueue_skips_everything_when_the_plugin_was_never_built(): void {
		// Same guard as the frontend and editor enqueues: a plugin copied to a
		// server without running the build must not 404 the settings screen.
		$this->without_asset_file( $this->asset_file() );

		Post_Voice_Style_Section::enqueue( 'settings_page_post-voice' );

		$this->assertFalse( wp_style_is( 'post-voice-player', 'enqueued' ) );
		$this->assertFalse( wp_style_is( 'post-voice-player-style-admin', 'enqueued' ) );
		$this->assertFalse( wp_script_is( 'post-voice-player-style-admin', 'enqueued' ) );
	}
}
