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
 * Owns the five meta keys that record a post's narration.
 *
 * Exposed via `show_in_rest` so the editor panel reads existing narration state
 * straight from the post's own REST payload — no separate GET endpoint.
 */
class Post_Voice_Post_Meta {

	public const ATTACHMENT_ID = '_narration_attachment_id';

	/**
	 * Marker written on every attachment this plugin creates.
	 *
	 * Lets the endpoint recognise its own audio among a post's attachments, so
	 * it can clear out narrations orphaned by an interrupted or concurrent save
	 * without ever touching media the author uploaded themselves.
	 */
	public const ATTACHMENT_MARKER = '_post_voice_narration';
	public const LANGUAGE          = '_narration_language';
	public const LANGUAGES         = '_narration_languages';
	public const VOICE             = '_narration_voice';
	public const SOURCE_HASH       = '_narration_source_hash';

	/**
	 * Gate meta writes on the post's own edit capability.
	 *
	 * @param bool   $allowed  Whether the user can act on the meta (unused; recomputed here).
	 * @param string $meta_key Meta key being authorised (unused; all five share one rule).
	 * @param int    $post_id  Post the meta belongs to.
	 */
	public static function auth_callback( $allowed, $meta_key, $post_id ): bool {
		return current_user_can( 'edit_post', $post_id );
	}

	/**
	 * Register the five meta keys on the `post` post type.
	 */
	public static function register(): void {
		$args = array(
			'single'        => true,
			'show_in_rest'  => true,
			'auth_callback' => array( self::class, 'auth_callback' ),
		);

		register_post_meta( 'post', self::ATTACHMENT_ID, array_merge( $args, array( 'type' => 'integer' ) ) );
		register_post_meta( 'post', self::LANGUAGE, array_merge( $args, array( 'type' => 'string' ) ) );
		register_post_meta(
			'post',
			self::LANGUAGES,
			array_merge(
				$args,
				array(
					'type'              => 'array',
					'show_in_rest'      => array(
						'schema' => array(
							'type'  => 'array',
							'items' => array( 'type' => 'string' ),
						),
					),
					'sanitize_callback' => array( self::class, 'sanitize_languages' ),
					'default'           => array(),
				)
			)
		);
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
	 * Coerce anything into a valid, deduped list of narration languages.
	 *
	 * The narration endpoint validates `languages` on its own way in, but
	 * `_narration_languages` is `show_in_rest`, which means
	 * `PATCH /wp/v2/posts/<id>` can write it directly — a route the endpoint's
	 * own checks never see. Mirrors
	 * `Post_Voice_Dictionary_Store::sanitize()`: the last line of defence lives
	 * on the meta registration itself, not only on the one route that happens
	 * to be the intended way in.
	 *
	 * @param mixed $value Raw value from a meta write.
	 * @return string[]
	 */
	public static function sanitize_languages( $value ): array {
		if ( ! is_array( $value ) ) {
			return array();
		}

		$clean = array();
		foreach ( $value as $language ) {
			$language = (string) $language;
			if (
				in_array( $language, Post_Voice_Rest_Api::ALLOWED_LANGUAGES, true )
				&& ! in_array( $language, $clean, true )
			) {
				$clean[] = $language;
			}
			if ( count( $clean ) >= count( Post_Voice_Rest_Api::ALLOWED_LANGUAGES ) ) {
				break;
			}
		}

		return $clean;
	}

	/**
	 * Record a saved narration against the post.
	 *
	 * @param int      $post_id       Post the narration belongs to.
	 * @param int      $attachment_id Media Library attachment holding the MP3.
	 * @param string   $language      Default language bundle of the post.
	 * @param string[] $languages     Every bundle the audio was generated with.
	 * @param string   $voice         Predefined voice the audio was generated with.
	 * @param string   $source_hash   SHA-256 of the resolved segments.
	 */
	public static function save( int $post_id, int $attachment_id, string $language, array $languages, string $voice, string $source_hash ): void {
		update_post_meta( $post_id, self::ATTACHMENT_ID, $attachment_id );
		update_post_meta( $post_id, self::LANGUAGE, $language );
		update_post_meta( $post_id, self::LANGUAGES, $languages );
		update_post_meta( $post_id, self::VOICE, $voice );
		update_post_meta( $post_id, self::SOURCE_HASH, $source_hash );
	}

	/**
	 * Claim an attachment as a narration this plugin produced.
	 *
	 * @param int $attachment_id Attachment to mark.
	 */
	public static function mark_attachment( int $attachment_id ): void {
		update_post_meta( $attachment_id, self::ATTACHMENT_MARKER, 1 );
	}

	/**
	 * Every narration attachment currently hanging off a post, oldest first.
	 *
	 * Ordered by ID because attachment IDs are monotonic: the highest is always
	 * the most recently created, which is the one an author means by "the
	 * narration I just made". Post dates would tie at one-second resolution.
	 *
	 * @param int $post_id Post to inspect.
	 * @return int[]
	 */
	public static function get_narration_attachment_ids( int $post_id ): array {
		return array_map(
			'intval',
			get_posts(
				array(
					'post_type'              => 'attachment',
					'post_status'            => 'inherit',
					'post_parent'            => $post_id,
					'posts_per_page'         => -1,
					'orderby'                => 'ID',
					'order'                  => 'ASC',
					'fields'                 => 'ids',
					'meta_key'               => self::ATTACHMENT_MARKER, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- Bounded by one post's own attachments, and the alternative is trusting a single meta value that concurrent saves have already been shown to lose.
					'no_found_rows'          => true,
					'update_post_term_cache' => false,
				)
			)
		);
	}

	/**
	 * Remove every trace of narration from the post.
	 *
	 * @param int $post_id Post to clear.
	 */
	public static function clear( int $post_id ): void {
		delete_post_meta( $post_id, self::ATTACHMENT_ID );
		delete_post_meta( $post_id, self::LANGUAGE );
		delete_post_meta( $post_id, self::LANGUAGES );
		delete_post_meta( $post_id, self::VOICE );
		delete_post_meta( $post_id, self::SOURCE_HASH );
	}
}
