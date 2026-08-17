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

		return $content . self::markup( $url );
	}

	/**
	 * Build the player's markup, for the post or for the settings preview.
	 *
	 * One function for both so the preview cannot drift from the real player:
	 * a change to the pill is a change to what the author sees while choosing
	 * its colours.
	 *
	 * @param string|null $src     Audio URL, or null in preview mode.
	 * @param bool        $preview Render the enhanced, inert copy for wp-admin.
	 */
	public static function markup( ?string $src, bool $preview = false ): string {
		// In the post, `player.ts` adds the enhanced class and reveals the
		// controls; nothing runs it in wp-admin, so the preview ships that state
		// already applied. `disabled` rather than `hidden` because the preview's
		// controls must be visible, and `aria-hidden` around focusable buttons is
		// an accessibility violation of its own.
		$classes = 'post-voice-player' . ( $preview ? ' post-voice-player--enhanced' : '' );
		$state   = $preview ? ' disabled' : ' hidden';
		ob_start();
		?>
		<div class="<?php echo esc_attr( $classes ); ?>"
			<?php if ( ! $preview ) : ?>
			role="region" aria-label="<?php esc_attr_e( 'Post narration player', 'post-voice' ); ?>"
			<?php endif; ?>
		>
			<?php if ( null !== $src ) : ?>
			<audio controls src="<?php echo esc_url( $src ); ?>"></audio>
			<?php endif; ?>
			<?php
			/*
			 * The enhancement controls ship hidden and player.ts reveals them. Only
			 * JavaScript gives them behaviour, so without it they would render as
			 * buttons that look operable and do nothing — worse than absent,
			 * especially for screen reader and keyboard users. The native <audio>
			 * above is the no-JS experience and works on its own.
			 */
			?>
			<button type="button" data-role="play"<?php echo esc_attr( $state ); ?> aria-pressed="false" aria-label="<?php esc_attr_e( 'Play narration', 'post-voice' ); ?>"
				data-label-playing="<?php esc_attr_e( 'Playing', 'post-voice' ); ?>"
				data-label-paused="<?php esc_attr_e( 'Paused', 'post-voice' ); ?>">&#9654;</button>
			<?php
			/*
			 * A range input rather than a styled <div>: it is seekable with the
			 * arrow keys and Home/End for free, announces its position to screen
			 * readers, and needs no drag handling of our own. `max` is a placeholder
			 * until the audio reports its real duration.
			 */
			?>
			<input type="range" data-role="seek"<?php echo esc_attr( $state ); ?> value="<?php echo $preview ? '40' : '0'; ?>" min="0" max="100" step="0.1"
				aria-label="<?php esc_attr_e( 'Seek within narration', 'post-voice' ); ?>" />
			<button type="button" data-role="rate"<?php echo esc_attr( $state ); ?> aria-label="<?php esc_attr_e( 'Playback speed', 'post-voice' ); ?>">1&#215;</button>
			<button type="button" data-role="close"<?php echo esc_attr( $state ); ?> aria-label="<?php esc_attr_e( 'Close player', 'post-voice' ); ?>">&#10005;</button>
			<?php if ( ! $preview ) : ?>
			<span data-role="live" aria-live="polite" class="screen-reader-text"></span>
			<?php endif; ?>
		</div>
		<?php
		return (string) ob_get_clean();
	}
}
