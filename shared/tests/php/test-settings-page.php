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
