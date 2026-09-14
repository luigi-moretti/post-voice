<?php
/**
 * Cross-origin isolation headers for the post editor.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Enables `self.crossOriginIsolated` (SharedArrayBuffer) on the post editor
 * screens only, so the Worker's ONNX runtime can run WASM multi-threaded.
 *
 * Scoped to `post.php`/`post-new.php` — the only screens narration
 * generation runs on — rather than the whole admin, to limit the blast
 * radius on other plugins' admin assets (oEmbed, Gravatar, third-party
 * scripts) that a site-wide `Cross-Origin-Embedder-Policy` could break.
 * `credentialless` (not `require-corp`) narrows that risk further: it does
 * not require every cross-origin subresource to opt in with its own
 * `Cross-Origin-Resource-Policy` header.
 */
class Post_Voice_Editor_Headers {

	/**
	 * Hook header emission.
	 *
	 * `admin_init`, not `send_headers`: `send_headers` fires only from
	 * `WP::send_headers()`, called from `WP::main()` — the front-end request
	 * router (`wp-blog-header.php`). `wp-admin` never calls it for the post
	 * editor (`post.php`/`post-new.php`); confirmed empirically (curl against
	 * a running install, both with and without this hook) and by tracing
	 * `WP::main()`'s only other admin-side caller, `wp_edit_posts_query()` on
	 * `edit.php` — a list-table implementation detail unrelated to and not
	 * present on the editor screens this class targets. `admin_init` fires
	 * early in the `wp-admin/admin.php` bootstrap, well before any HTML
	 * output, with `$pagenow` already set — safe for `header()`.
	 */
	public static function register(): void {
		add_action( 'admin_init', array( self::class, 'maybe_send_headers' ) );
	}

	/**
	 * Send the isolation headers when the current admin page is the post
	 * editor, for the `post` post type specifically.
	 *
	 * `post.php`/`post-new.php` are shared by every post type — a Page or a
	 * third-party CPT (e.g. a WooCommerce product) resolves to the same
	 * `$pagenow` as narration's own editor screen, but must not get the
	 * headers: narration itself never renders there
	 * (`Post_Voice_Assets::enqueue_editor_assets` already gates on
	 * `post_type === 'post'`), so sending them would only add blast radius
	 * with nothing to show for it. Post type is resolved the same way core
	 * resolves it in `post.php`/`post-new.php` themselves (read directly,
	 * rather than waiting for `set_current_screen()`, which runs after
	 * `admin_init`): `post-new.php` defaults to `post` when `$_GET['post_type']`
	 * is absent; `post.php` looks the existing post up by ID.
	 */
	public static function maybe_send_headers(): void {
		global $pagenow;

		if ( ! self::should_send( (string) $pagenow, self::resolve_post_type( (string) $pagenow ) ) ) {
			return;
		}

		header( 'Cross-Origin-Opener-Policy: same-origin' );
		header( 'Cross-Origin-Embedder-Policy: credentialless' );
	}

	/**
	 * Whether this request should carry the isolation headers.
	 *
	 * Split out of `maybe_send_headers()` so the decision can be tested: the
	 * emission itself is `header()`, which PHPUnit cannot observe under CLI.
	 *
	 * @param string $pagenow   Value of the global `$pagenow`.
	 * @param string $post_type Post type being edited.
	 */
	public static function should_send( string $pagenow, string $post_type ): bool {
		if ( ! self::is_editor_screen( $pagenow, $post_type ) ) {
			return false;
		}

		/**
		 * Whether to send the isolation headers at all.
		 *
		 * `credentialless` was chosen specifically to minimize breakage (see
		 * the design spec's risk section), but it only relaxes the
		 * `Cross-Origin-Resource-Policy` requirement for subresources — a
		 * nested cross-origin *document* must still send COEP of its own or
		 * it is blocked. That is confirmed, not theoretical: a CodePen embed
		 * block renders as a blank frame in the editor with these headers on
		 * and renders normally with them off. An OAuth "connect your account"
		 * popup (Jetpack, for example) losing `window.opener` under
		 * `COOP: same-origin` remains the other known conflict.
		 *
		 * The site setting (Settings → Narration) is what this defaults to,
		 * so most sites never need this filter; it stays the last word for a
		 * site that disabled the headers in code before the setting existed,
		 * and for one that wants the decision made per request.
		 *
		 * @param bool $send Whether to send the headers. Defaults to the
		 *                   site's own acceleration setting.
		 */
		return (bool) apply_filters(
			'post_voice_send_isolation_headers',
			Post_Voice_Acceleration_Store::is_enabled()
		);
	}

	/**
	 * Post type of the current request, for the two editor `$pagenow`
	 * values. Empty string for anything else or when it cannot be resolved.
	 *
	 * @param string $pagenow Value of the global `$pagenow`.
	 */
	private static function resolve_post_type( string $pagenow ): string {
		if ( 'post-new.php' === $pagenow ) {
			return isset( $_GET['post_type'] ) ? sanitize_key( wp_unslash( $_GET['post_type'] ) ) : 'post'; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only, mirrors core's own default resolution in wp-admin/post-new.php.
		}

		if ( 'post.php' === $pagenow && isset( $_GET['post'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only.
			$post = get_post( (int) $_GET['post'] ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only.
			return $post ? $post->post_type : '';
		}

		return '';
	}

	/**
	 * Whether a `$pagenow`/post type pair is the narration editor screen.
	 *
	 * @param string $pagenow   Value of the global `$pagenow`.
	 * @param string $post_type Post type being edited.
	 */
	public static function is_editor_screen( string $pagenow, string $post_type ): bool {
		return in_array( $pagenow, array( 'post.php', 'post-new.php' ), true ) && 'post' === $post_type;
	}
}
