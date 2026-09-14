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

	/**
	 * `add_settings_section()` writes straight into a global that
	 * `WP_UnitTestCase`'s own rollback never touches. Left alone, a test here
	 * that registers one leaks it into every test class that runs afterwards
	 * in the same process — including this file's own "no sections
	 * registered" case.
	 */
	protected function tearDown(): void {
		global $wp_settings_sections;
		unset( $wp_settings_sections[ Post_Voice_Settings_Page::MENU_SLUG ] );
		unset( $wp_settings_sections[ Post_Voice_Settings_Page::STANDALONE_SLUG ] );
		parent::tearDown();
	}

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

	public function test_render_omits_the_divider_when_nothing_is_standalone(): void {
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

		$this->assertStringNotContainsString( '<hr', $html );
	}

	/**
	 * The whole point of `STANDALONE_SLUG`: a section there has no option
	 * for the shared button to save, so that button — and the divider
	 * marking the boundary — must print before it, not after.
	 */
	public function test_render_puts_save_changes_and_a_divider_before_standalone_sections(): void {
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
		add_settings_section(
			'post_voice_test_standalone_section',
			'A standalone section',
			static function (): void {
				echo 'standalone body';
			},
			Post_Voice_Settings_Page::STANDALONE_SLUG
		);

		ob_start();
		Post_Voice_Settings_Page::render();
		$html = (string) ob_get_clean();

		$save_position       = strpos( $html, 'Save Changes' );
		$divider_position    = strpos( $html, '<hr' );
		$standalone_position = strpos( $html, 'standalone body' );

		$this->assertIsInt( $save_position );
		$this->assertIsInt( $divider_position );
		$this->assertIsInt( $standalone_position );
		$this->assertLessThan( $divider_position, $save_position );
		$this->assertLessThan( $standalone_position, $divider_position );
	}
}
