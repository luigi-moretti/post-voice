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
		unset( $wp_settings_sections[ Post_Voice_Settings_Page::STANDALONE_SLUG ] );
		$this->tear_down_asset_files();
		parent::tearDown();
	}

	public function test_section_is_registered_on_the_standalone_slug(): void {
		global $wp_settings_sections;
		set_current_screen( 'dashboard' );
		Post_Voice_Models_Section::register();
		self::fire_admin_init();

		// Standalone, not MENU_SLUG: this table has no option to save, so it
		// renders below the shared Save Changes button rather than beside
		// sections that button actually applies to.
		$this->assertArrayHasKey(
			'post_voice_models_section',
			$wp_settings_sections[ Post_Voice_Settings_Page::STANDALONE_SLUG ]
		);
		$this->assertArrayNotHasKey(
			'post_voice_models_section',
			$wp_settings_sections[ Post_Voice_Settings_Page::MENU_SLUG ] ?? array()
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
