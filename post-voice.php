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

require_once POST_VOICE_PATH . 'features/narration/php/class-post-meta.php';
require_once POST_VOICE_PATH . 'features/narration/php/class-rest-api.php';
require_once POST_VOICE_PATH . 'features/narration/php/class-attachment-cleanup.php';
require_once POST_VOICE_PATH . 'features/narration/php/class-assets.php';
require_once POST_VOICE_PATH . 'features/narration/php/class-editor-headers.php';
require_once POST_VOICE_PATH . 'features/narration/php/class-frontend-render.php';
require_once POST_VOICE_PATH . 'shared/php/class-settings-page.php';
require_once POST_VOICE_PATH . 'features/pronunciation/php/class-dictionary-store.php';
require_once POST_VOICE_PATH . 'features/pronunciation/php/class-dictionary-section.php';
require_once POST_VOICE_PATH . 'features/player-style/php/class-style-store.php';
require_once POST_VOICE_PATH . 'features/player-style/php/class-style-section.php';

add_action(
	'init',
	static function (): void {
		Post_Voice_Post_Meta::register();
		Post_Voice_Dictionary_Store::register();
	}
);

Post_Voice_Attachment_Cleanup::register();
Post_Voice_Assets::register();
Post_Voice_Editor_Headers::register();
Post_Voice_Frontend_Render::register();
Post_Voice_Settings_Page::register();
Post_Voice_Dictionary_Section::register();
Post_Voice_Style_Section::register();

add_action( 'rest_api_init', array( 'Post_Voice_Rest_Api', 'register_routes' ) );
