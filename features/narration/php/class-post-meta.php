<?php
/**
 * Narration post meta.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Owns the four meta keys that record a post's narration.
 *
 * Exposed via `show_in_rest` so the editor panel reads existing narration state
 * straight from the post's own REST payload — no separate GET endpoint.
 */
class Post_Voice_Post_Meta {

	public const ATTACHMENT_ID = '_narration_attachment_id';
	public const LANGUAGE      = '_narration_language';
	public const VOICE         = '_narration_voice';
	public const SOURCE_HASH   = '_narration_source_hash';

	/**
	 * Gate meta writes on the post's own edit capability.
	 *
	 * @param bool   $allowed  Whether the user can act on the meta (unused; recomputed here).
	 * @param string $meta_key Meta key being authorised (unused; all four share one rule).
	 * @param int    $post_id  Post the meta belongs to.
	 */
	public static function auth_callback( $allowed, $meta_key, $post_id ): bool {
		return current_user_can( 'edit_post', $post_id );
	}

	/**
	 * Register the four meta keys on the `post` post type.
	 */
	public static function register(): void {
		$args = array(
			'single'        => true,
			'show_in_rest'  => true,
			'auth_callback' => array( self::class, 'auth_callback' ),
		);

		register_post_meta( 'post', self::ATTACHMENT_ID, array_merge( $args, array( 'type' => 'integer' ) ) );
		register_post_meta( 'post', self::LANGUAGE, array_merge( $args, array( 'type' => 'string' ) ) );
		register_post_meta( 'post', self::VOICE, array_merge( $args, array( 'type' => 'string' ) ) );
		register_post_meta( 'post', self::SOURCE_HASH, array_merge( $args, array( 'type' => 'string' ) ) );
	}

	/**
	 * Attachment ID of the post's narration, or 0 when it has none.
	 *
	 * @param int $post_id Post to read.
	 */
	public static function get_attachment_id( int $post_id ): int {
		return (int) get_post_meta( $post_id, self::ATTACHMENT_ID, true );
	}

	/**
	 * Record a saved narration against the post.
	 *
	 * @param int    $post_id       Post the narration belongs to.
	 * @param int    $attachment_id Media Library attachment holding the MP3.
	 * @param string $language      Language bundle the audio was generated with.
	 * @param string $voice         Predefined voice the audio was generated with.
	 * @param string $source_hash   SHA-256 of the narrated text, for staleness detection.
	 */
	public static function save( int $post_id, int $attachment_id, string $language, string $voice, string $source_hash ): void {
		update_post_meta( $post_id, self::ATTACHMENT_ID, $attachment_id );
		update_post_meta( $post_id, self::LANGUAGE, $language );
		update_post_meta( $post_id, self::VOICE, $voice );
		update_post_meta( $post_id, self::SOURCE_HASH, $source_hash );
	}

	/**
	 * Remove every trace of narration from the post.
	 *
	 * @param int $post_id Post to clear.
	 */
	public static function clear( int $post_id ): void {
		delete_post_meta( $post_id, self::ATTACHMENT_ID );
		delete_post_meta( $post_id, self::LANGUAGE );
		delete_post_meta( $post_id, self::VOICE );
		delete_post_meta( $post_id, self::SOURCE_HASH );
	}
}
