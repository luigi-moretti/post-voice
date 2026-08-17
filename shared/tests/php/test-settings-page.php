<?php
/**
 * Settings screen tests.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

/**
 * @covers Post_Voice_Settings_Page
 */
class Test_Post_Voice_Settings_Page extends WP_UnitTestCase {

	public function test_register_adds_the_options_page_for_an_administrator(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		set_current_screen( 'dashboard' );

		Post_Voice_Settings_Page::register();
		do_action( 'admin_menu' );

		$this->assertNotFalse(
			menu_page_url( Post_Voice_Settings_Page::MENU_SLUG, false )
		);
	}

	public function test_option_is_registered_with_the_store_sanitiser(): void {
		// `set_current_screen()` makes `is_admin()` true, same as a real wp-admin
		// request would: without it, WP core's own admin_init listeners (e.g. its
		// default privacy-policy suggestion) log a "doing it wrong" notice that
		// WP_UnitTestCase turns into a failure, over behaviour that has nothing to
		// do with this plugin.
		set_current_screen( 'dashboard' );
		Post_Voice_Settings_Page::register();
		self::fire_admin_init();

		$registered = get_registered_settings();

		$this->assertArrayHasKey( Post_Voice_Dictionary_Store::OPTION, $registered );
		$this->assertSame(
			array( 'Post_Voice_Dictionary_Store', 'sanitize' ),
			$registered[ Post_Voice_Dictionary_Store::OPTION ]['sanitize_callback']
		);
	}

	public function test_saving_the_option_runs_the_sanitiser(): void {
		// See the note in the previous test.
		set_current_screen( 'dashboard' );
		Post_Voice_Settings_Page::register();
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

	public function test_render_outputs_the_existing_entries(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
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
		Post_Voice_Settings_Page::render();
		$html = (string) ob_get_clean();

		$this->assertStringContainsString( 'ONNX', $html );
		$this->assertStringContainsString( 'ó-nex', $html );
	}

	public function test_render_refuses_a_user_without_manage_options(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'author' ) ) );

		ob_start();
		Post_Voice_Settings_Page::render();
		$html = (string) ob_get_clean();

		$this->assertSame( '', $html );
	}

	/**
	 * Fire `admin_init`, swallowing the one warning this triggers that has
	 * nothing to do with this plugin.
	 *
	 * WP core's own `wp_admin_headers()` is unconditionally hooked to
	 * `admin_init` (via wp-admin/includes/admin-filters.php, loaded while
	 * wp-phpunit installs the test database) and calls `header()`. wp-phpunit's
	 * own bootstrap already writes install-progress output straight to stdout
	 * before any test runs, so PHP's headers-already-sent state is tripped for
	 * the whole process before this test ever gets a chance to run — confirmed
	 * by reproducing the same warning with a bare `do_action( 'admin_init' )`
	 * and no Post Voice code at all. A scoped error handler, rather than `@`,
	 * keeps every other warning live.
	 */
	private static function fire_admin_init(): void {
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
