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
		unregister_setting( Post_Voice_Settings_Page::OPTION_GROUP, Post_Voice_Dictionary_Store::OPTION );
		parent::tearDown();
	}

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
