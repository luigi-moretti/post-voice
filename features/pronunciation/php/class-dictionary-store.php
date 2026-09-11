<?php
/**
 * Pronunciation dictionary storage.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Owns both dictionaries: the site-wide option and the per-post meta.
 *
 * Sanitisation lives here rather than in each caller because the same shape
 * arrives from two directions — a settings form POST and a block editor meta
 * write — and a rule enforced in only one of them is not a rule.
 */
class Post_Voice_Dictionary_Store {

	public const OPTION = 'post_voice_dictionary';
	public const META   = '_narration_dictionary';

	public const MAX_ENTRIES            = 200;
	public const MAX_TERM_LENGTH        = 100;
	public const MAX_REPLACEMENT_LENGTH = 200;

	/**
	 * Coerce anything into a valid list of entries, dropping what cannot be saved.
	 *
	 * Dropping beats erroring: this runs on a settings save and on a meta write,
	 * and a single malformed row should not cost the author the other 199.
	 *
	 * @param mixed $value Raw value from a form post or a meta write.
	 * @return array<int, array{term: string, replacement: string, language: string}>
	 */
	public static function sanitize( $value ): array {
		if ( ! is_array( $value ) ) {
			return array();
		}

		$clean = array();
		foreach ( $value as $entry ) {
			if ( ! is_array( $entry ) ) {
				continue;
			}

			// Deliberately reaching into the narration feature's constant rather than
			// copying the list: Post_Voice_Model's ALLOWED_LANGUAGES — the server's
			// single source for what a language may be, and a second copy here would
			// eventually disagree with it. The spec's boundary ("pronunciation
			// exposes a pure function, narration imports it") is about the editor
			// pipeline; on the PHP side there is one list, and this is it.
			$language = isset( $entry['language'] ) ? (string) $entry['language'] : '';
			if ( ! in_array( $language, Post_Voice_Model::ALLOWED_LANGUAGES, true ) ) {
				continue;
			}

			$term        = trim( sanitize_text_field( (string) ( $entry['term'] ?? '' ) ) );
			$replacement = trim( sanitize_text_field( (string) ( $entry['replacement'] ?? '' ) ) );

			if ( '' === $term || '' === $replacement ) {
				continue;
			}

			// `mb_substr`, not `substr`: the caps are in characters, which is what
			// the spec says, what the editor's `maxLength` enforces on both inputs
			// and what `dictionary-entry.ts` validates. `substr` counts bytes, so a
			// 60-character accented replacement the UI accepted (120 bytes) was cut
			// in half here, and cut wherever byte 200 happened to land — possibly
			// mid-codepoint, producing mojibake in a field that is read aloud by a
			// speech model. WordPress guarantees `mb_substr` exists: core polyfills
			// it in `wp-includes/compat.php` when the mbstring extension is absent.
			$clean[] = array(
				'term'        => mb_substr( $term, 0, self::MAX_TERM_LENGTH ),
				'replacement' => mb_substr( $replacement, 0, self::MAX_REPLACEMENT_LENGTH ),
				'language'    => $language,
			);

			if ( count( $clean ) >= self::MAX_ENTRIES ) {
				break;
			}
		}

		return $clean;
	}

	/**
	 * Register the per-post meta. The option is registered by the settings page.
	 */
	public static function register(): void {
		register_post_meta(
			'post',
			self::META,
			array(
				'single'            => true,
				'type'              => 'array',
				'show_in_rest'      => array(
					'schema' => array(
						'type'  => 'array',
						'items' => array(
							'type'       => 'object',
							'properties' => array(
								'term'        => array( 'type' => 'string' ),
								'replacement' => array( 'type' => 'string' ),
								'language'    => array( 'type' => 'string' ),
							),
						),
					),
				),
				'sanitize_callback' => array( self::class, 'sanitize' ),
				'auth_callback'     => array( 'Post_Voice_Capability_Guard', 'auth_callback' ),
				'default'           => array(),
			)
		);
	}

	/**
	 * The site dictionary, sanitised on the way out.
	 *
	 * Sanitising on read as well as on write costs nothing measurable and covers
	 * a row written directly to the database by a migration or by hand.
	 *
	 * @return array<int, array{term: string, replacement: string, language: string}>
	 */
	public static function get_global(): array {
		return self::sanitize( get_option( self::OPTION, array() ) );
	}

	/**
	 * This post's dictionary.
	 *
	 * @param int $post_id Post to read.
	 * @return array<int, array{term: string, replacement: string, language: string}>
	 */
	public static function get_for_post( int $post_id ): array {
		return self::sanitize( get_post_meta( $post_id, self::META, true ) );
	}
}
