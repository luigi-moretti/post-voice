<?php
/**
 * PHPUnit bootstrap — loads the WordPress test suite and this plugin.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

$_tests_dir = getenv( 'WP_PHPUNIT__DIR' );
if ( ! $_tests_dir ) {
	$_tests_dir = dirname( __DIR__, 2 ) . '/vendor/wp-phpunit/wp-phpunit';
}

// wp-phpunit ships a wp-tests-config.php that only forwards to a real one, and
// without this constant it looks for that file next to its own package rather
// than in the project. Point it at ours explicitly.
if ( ! defined( 'WP_TESTS_CONFIG_FILE_PATH' ) ) {
	define( 'WP_TESTS_CONFIG_FILE_PATH', __DIR__ . '/wp-tests-config.php' );
}

require $_tests_dir . '/includes/functions.php';

/**
 * Load the plugin into the test WordPress install.
 */
function _post_voice_manually_load_plugin(): void {
	require dirname( __DIR__, 2 ) . '/post-voice.php';
}
tests_add_filter( 'muplugins_loaded', '_post_voice_manually_load_plugin' );

require_once __DIR__ . '/trait-fires-admin-init.php';

require $_tests_dir . '/includes/bootstrap.php';
