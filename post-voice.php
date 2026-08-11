<?php
/**
 * Plugin Name: Post Voice
 * Description: Gera narração em áudio de posts 100% no navegador (client-side TTS), com voice cloning via Pocket TTS.
 * Version: 0.1.0
 * Requires at least: 6.6
 * Requires PHP: 8.2
 * Text Domain: post-voice
 * Domain Path: /languages
 * License: GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 *
 * @package Post_Voice
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'POST_VOICE_VERSION', '0.1.0' );
define( 'POST_VOICE_PATH', plugin_dir_path( __FILE__ ) );
define( 'POST_VOICE_URL', plugin_dir_url( __FILE__ ) );

// Feature classes are required and registered incrementally — Tasks 12-16 each
// append their own `require_once` + registration below as they land. Requiring a
// file that does not exist yet is a fatal error the moment PHPUnit's bootstrap
// loads this plugin, so this list only ever names files already committed.
