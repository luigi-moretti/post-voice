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
