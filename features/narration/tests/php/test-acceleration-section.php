<?php
/**
 * Tests for the narration performance section.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

/**
 * @covers Post_Voice_Acceleration_Section
 */
class Test_Post_Voice_Acceleration_Section extends WP_UnitTestCase {

	use Post_Voice_Fires_Admin_Init;

	private const SECTION = 'post_voice_acceleration_section';

	/**
	 * `register_setting()` and `add_settings_section()` write straight into
	 * globals WP_UnitTestCase's rollback never touches, so a registration left
	 * behind here leaks into every test class that runs after this one.
	 */
	protected function tearDown(): void {
		global $wp_settings_sections, $wp_settings_fields;
		unset( $wp_settings_sections[ Post_Voice_Settings_Page::MENU_SLUG ][ self::SECTION ] );
		unset( $wp_settings_fields[ Post_Voice_Settings_Page::MENU_SLUG ][ self::SECTION ] );
		unregister_setting( Post_Voice_Settings_Page::OPTION_GROUP, Post_Voice_Acceleration_Store::OPTION );
		delete_option( Post_Voice_Acceleration_Store::OPTION );
		parent::tearDown();
	}

	private function register(): void {
		set_current_screen( 'dashboard' );
		Post_Voice_Acceleration_Section::register();
		self::fire_admin_init();
	}

	public function test_option_is_registered_with_the_store_sanitiser(): void {
		$this->register();

		$registered = get_registered_settings();

		$this->assertArrayHasKey( Post_Voice_Acceleration_Store::OPTION, $registered );
		$this->assertSame(
			array( 'Post_Voice_Acceleration_Store', 'sanitize' ),
			$registered[ Post_Voice_Acceleration_Store::OPTION ]['sanitize_callback']
		);
	}

	public function test_the_field_is_registered_in_the_shared_save_group(): void {
		// `MENU_SLUG`, not `STANDALONE_SLUG`: this section is backed by a real
		// option, so the settings screen's shared Save Changes must cover it.
		global $wp_settings_fields;
		$this->register();

		$fields = $wp_settings_fields[ Post_Voice_Settings_Page::MENU_SLUG ][ self::SECTION ] ?? array();

		$this->assertSame( array( 'post_voice_acceleration' ), array_keys( $fields ) );
	}

	public function test_the_checkbox_is_ticked_for_a_site_that_never_touched_the_setting(): void {
		$this->register();

		$html = $this->render_field();

		$this->assertStringContainsString( "checked='checked'", $html );
	}

	public function test_the_checkbox_is_unticked_for_a_site_that_turned_it_off(): void {
		update_option(
			Post_Voice_Acceleration_Store::OPTION,
			Post_Voice_Acceleration_Store::OFF
		);
		$this->register();

		$html = $this->render_field();

		$this->assertStringNotContainsString( "checked='checked'", $html );
	}

	public function test_the_checkbox_has_exactly_one_label(): void {
		// Every label associated with a control is concatenated into its
		// accessible name, so passing `label_for` here — which makes core wrap
		// the row title in a second `<label for>` — would have a screen reader
		// announce "Generation speed Generate narration faster, checkbox".
		$this->register();

		ob_start();
		do_settings_sections( Post_Voice_Settings_Page::MENU_SLUG );
		$html = (string) ob_get_clean();

		$this->assertSame(
			1,
			substr_count( $html, '<label for="post-voice-acceleration"' )
		);
	}

	public function test_the_checkbox_posts_under_the_option_name(): void {
		// Without this the control renders, saves nothing, and looks like it
		// simply refuses to stay off.
		$this->register();

		$html = $this->render_field();

		$this->assertStringContainsString(
			'name="' . Post_Voice_Acceleration_Store::OPTION . '"',
			$html
		);
	}

	private function render_field(): string {
		ob_start();
		Post_Voice_Acceleration_Section::render_field();
		return (string) ob_get_clean();
	}
}
