<?php
/**
 * WordPress test-suite configuration.
 *
 * Defaults target the `tests-wordpress` container that `wp-env` provisions, which
 * is where `composer run test` runs (see the `test` script in composer.json) —
 * WordPress core itself lives in that container, not on the host. Every value is
 * overridable by environment variable so CI can point the same file elsewhere.
 *
 * The table prefix is deliberately `wptests_`, not wp-env's `wp_`: the WordPress
 * test bootstrap drops and recreates every table carrying the configured prefix,
 * so sharing a prefix with the E2E site would destroy its fixture data on every
 * PHPUnit run.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

/**
 * Read a setting from the environment, falling back to the wp-env default.
 *
 * @param string $name     Environment variable name.
 * @param string $fallback Value to use when unset.
 */
function post_voice_test_env( string $name, string $fallback ): string {
	$value = getenv( $name );

	return ( false === $value || '' === $value ) ? $fallback : $value;
}

define( 'ABSPATH', post_voice_test_env( 'WP_TESTS_ABSPATH', '/var/www/html/' ) );

define( 'DB_NAME', post_voice_test_env( 'WP_TESTS_DB_NAME', 'tests-wordpress' ) );
define( 'DB_USER', post_voice_test_env( 'WP_TESTS_DB_USER', 'root' ) );
define( 'DB_PASSWORD', post_voice_test_env( 'WP_TESTS_DB_PASSWORD', 'password' ) );
define( 'DB_HOST', post_voice_test_env( 'WP_TESTS_DB_HOST', 'tests-mysql' ) );
define( 'DB_CHARSET', 'utf8' );
define( 'DB_COLLATE', '' );

// The WordPress test bootstrap reads $table_prefix as a local from this file —
// that is the documented contract of wp-tests-config.php, not an accidental
// global override.
// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
$table_prefix = post_voice_test_env( 'WP_TESTS_TABLE_PREFIX', 'wptests_' );

define( 'WP_TESTS_DOMAIN', post_voice_test_env( 'WP_TESTS_DOMAIN', 'localhost' ) );
define( 'WP_TESTS_EMAIL', post_voice_test_env( 'WP_TESTS_EMAIL', 'admin@example.org' ) );
define( 'WP_TESTS_TITLE', 'Post Voice Tests' );
define( 'WP_PHP_BINARY', post_voice_test_env( 'WP_PHP_BINARY', 'php' ) );

define( 'WP_DEBUG', true );
define( 'WP_DEFAULT_THEME', 'default' );
