<?php
/**
 * Server-rendered narration player markup.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Appends the player to single-post content.
 *
 * Progressive enhancement: a real `<audio controls>` element ships from the
 * server and works with JavaScript disabled. `player.ts` only upgrades it,
 * hooking the pill controls through their `data-role` attributes.
 */
class Post_Voice_Frontend_Render {

	/**
	 * Hook the content filter.
	 */
	public static function register(): void {
		add_filter( 'the_content', array( self::class, 'append_player' ) );
	}

	/**
	 * Append player markup to a narrated post's content.
	 *
	 * @param string $content Post content being filtered.
	 */
	public static function append_player( string $content ): string {
		if ( ! is_singular( 'post' ) || ! in_the_loop() || ! is_main_query() ) {
			return $content;
		}

		$post_id       = get_the_ID();
		$attachment_id = Post_Voice_Post_Meta::get_attachment_id( (int) $post_id );
		if ( ! $attachment_id ) {
			return $content;
		}

		$url = wp_get_attachment_url( $attachment_id );
		if ( ! $url ) {
			return $content;
		}

		ob_start();
		?>
		<div class="post-voice-player" role="region" aria-label="<?php esc_attr_e( 'Post narration player', 'post-voice' ); ?>">
			<audio controls src="<?php echo esc_url( $url ); ?>"></audio>
			<button type="button" data-role="play" aria-pressed="false" aria-label="<?php esc_attr_e( 'Play narration', 'post-voice' ); ?>"
				data-label-playing="<?php esc_attr_e( 'Playing', 'post-voice' ); ?>"
				data-label-paused="<?php esc_attr_e( 'Paused', 'post-voice' ); ?>">&#9654;</button>
			<button type="button" data-role="rate" aria-label="<?php esc_attr_e( 'Playback speed', 'post-voice' ); ?>">1&#215;</button>
			<button type="button" data-role="close" aria-label="<?php esc_attr_e( 'Close player', 'post-voice' ); ?>">&#10005;</button>
			<span data-role="live" aria-live="polite" class="screen-reader-text"></span>
		</div>
		<?php
		return $content . ob_get_clean();
	}
}
