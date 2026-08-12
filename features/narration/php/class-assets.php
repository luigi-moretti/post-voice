<?php
/**
 * Conditional asset enqueue for the editor panel and the frontend player.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Loads build output only where it is actually used.
 *
 * Handles resolve to `build/narration-editor.js` and `build/narration-player.js`
 * — the exact entry names pinned in `webpack.config.js`. If those names change,
 * both files change together.
 */
class Post_Voice_Assets {

	/**
	 * Hook both enqueue points.
	 */
	public static function register(): void {
		add_action( 'enqueue_block_editor_assets', array( self::class, 'enqueue_editor_assets' ) );
		add_action( 'wp_enqueue_scripts', array( self::class, 'enqueue_frontend_assets' ) );
	}

	/**
	 * Load the narration panel in the block editor, for posts only.
	 */
	public static function enqueue_editor_assets(): void {
		$screen = get_current_screen();
		if ( ! $screen || 'post' !== $screen->post_type ) {
			return;
		}

		$asset_file = POST_VOICE_PATH . 'build/narration-editor.asset.php';
		if ( ! file_exists( $asset_file ) ) {
			return;
		}
		$asset = require $asset_file;

		wp_enqueue_script(
			'post-voice-editor',
			POST_VOICE_URL . 'build/narration-editor.js',
			$asset['dependencies'],
			$asset['version'],
			true
		);
		wp_set_script_translations( 'post-voice-editor', 'post-voice', POST_VOICE_PATH . 'languages' );

		wp_enqueue_style(
			'post-voice-editor',
			POST_VOICE_URL . 'build/style-narration-editor.css',
			array(),
			$asset['version']
		);
	}

	/**
	 * Load the sticky player on single posts that actually have narration.
	 */
	public static function enqueue_frontend_assets(): void {
		if ( ! is_singular( 'post' ) ) {
			return;
		}
		$post_id = get_queried_object_id();
		if ( ! Post_Voice_Post_Meta::get_attachment_id( $post_id ) ) {
			return;
		}

		wp_enqueue_script(
			'post-voice-player',
			POST_VOICE_URL . 'build/narration-player.js',
			array(),
			POST_VOICE_VERSION,
			true
		);
		wp_enqueue_style(
			'post-voice-player',
			POST_VOICE_URL . 'build/style-narration-player.css',
			array(),
			POST_VOICE_VERSION
		);
	}
}
