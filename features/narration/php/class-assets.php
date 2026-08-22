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

		// The dictionary is read-only in the editor and small by construction
		// (capped at 200 entries), so it rides along with the script rather than
		// costing every panel open a REST round trip. The raw locale travels with
		// it: mapping it to a bundle is the editor's job, and PHP has no business
		// knowing the bundle names.
		wp_localize_script(
			'post-voice-editor',
			'postVoiceData',
			array(
				'dictionary'       => Post_Voice_Dictionary_Store::get_global(),
				'siteLanguage'     => get_locale(),
				'canManageOptions' => current_user_can( 'manage_options' ),
				'workerUrl'        => self::narration_worker_url(),
			)
		);

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

		// Same guard the editor path has, for the same reason: a plugin copied to
		// a server without running the build would otherwise 404 two assets on
		// every narrated post. The version comes from the asset file rather than
		// POST_VOICE_VERSION so a rebuilt player is not served from the reader's
		// cache until the next release bumps the plugin version.
		$asset_file = POST_VOICE_PATH . 'build/narration-player.asset.php';
		if ( ! file_exists( $asset_file ) ) {
			return;
		}
		$asset = require $asset_file;

		wp_enqueue_script(
			'post-voice-player',
			POST_VOICE_URL . 'build/narration-player.js',
			array(),
			$asset['version'],
			true
		);
		wp_enqueue_style(
			'post-voice-player',
			POST_VOICE_URL . 'build/style-narration-player.css',
			array(),
			$asset['version']
		);

		// Only what differs from the shipped defaults, and nothing at all when
		// the site never customised the player — the stylesheet already carries
		// today's values as `var()` fallbacks, so silence here is correct.
		$inline = Post_Voice_Style_Store::inline_css();
		if ( '' !== $inline ) {
			wp_add_inline_style( 'post-voice-player', $inline );
		}
	}

	/**
	 * URL of the narration Worker's own script, cache-busted like every other
	 * enqueued asset.
	 *
	 * Not enqueued via `wp_enqueue_script()`: `tts-engine.ts` fetches this URL
	 * itself and constructs a `blob:` Worker from the response body, so the
	 * COEP header a same-origin `<script>` tag would need never applies (see
	 * the 2026-08-21 Worker cross-origin-isolation spec, Achado 1). Left
	 * unversioned, this filename is stable across builds (Achado 5's webpack
	 * entry, not a content-hashed chunk), so the browser's own heuristic
	 * freshness could serve a stale 730KB worker after an update — the same
	 * class of bug `enqueue_frontend_assets()` above already guards against
	 * for the player. The version comes from the same `.asset.php` webpack
	 * emits for every other entry.
	 */
	private static function narration_worker_url(): string {
		$asset_file = POST_VOICE_PATH . 'build/pocket-tts-worker.asset.php';
		if ( ! file_exists( $asset_file ) ) {
			return '';
		}
		$asset = require $asset_file;

		return add_query_arg( 'ver', $asset['version'], POST_VOICE_URL . 'build/pocket-tts-worker.js' );
	}
}
