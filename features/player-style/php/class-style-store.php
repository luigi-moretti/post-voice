<?php
/**
 * Player styling storage.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Owns the site's player styling: what it may be, and what it becomes as CSS.
 *
 * One option rather than four: the values are read and written together, so
 * four rows would be four `get_option` calls for one decision.
 */
class Post_Voice_Style_Store {

	public const OPTION = 'post_voice_player_style';

	/**
	 * The player exactly as Fase 1 shipped it.
	 *
	 * Fixed values rather than something inherited from the active theme: a site
	 * that updates the plugin must not change appearance, and `theme.json`
	 * support varies by theme.
	 */
	public const DEFAULTS = array(
		'surface' => '#1e1e1e',
		'accent'  => '#2b62f0',
		'text'    => '#ffffff',
		'radius'  => 'pill',
	);

	/**
	 * The three shapes offered, and the length each one means.
	 */
	public const RADII = array(
		'pill'    => '999px',
		'rounded' => '12px',
		'square'  => '0',
	);

	/**
	 * Which custom property each key drives.
	 */
	private const PROPERTIES = array(
		'surface' => '--pv-surface',
		'accent'  => '--pv-accent',
		'text'    => '--pv-text',
		'radius'  => '--pv-radius',
	);

	private const COLOUR_KEYS = array( 'surface', 'accent', 'text' );

	/**
	 * Coerce anything into a complete, valid style.
	 *
	 * Per-field fallback rather than rejecting the submission: one malformed
	 * colour should not cost the author the other three values, and the return
	 * always has all four keys so no caller has to handle a missing one.
	 *
	 * @param mixed $value Raw value from a settings save or from the database.
	 * @return array{surface: string, accent: string, text: string, radius: string}
	 */
	public static function sanitize( $value ): array {
		$clean = self::DEFAULTS;
		if ( ! is_array( $value ) ) {
			return $clean;
		}

		foreach ( self::COLOUR_KEYS as $key ) {
			if ( ! isset( $value[ $key ] ) || ! is_string( $value[ $key ] ) ) {
				continue;
			}
			$colour = sanitize_hex_color( $value[ $key ] );
			if ( is_string( $colour ) && '' !== $colour ) {
				// Lower case only — the short form is kept as typed, because CSS
				// treats `#abc` and `#aabbcc` alike and rewriting the author's
				// value would be a change with no benefit. Case is normalised so
				// `#1E1E1E` still compares equal to the default and does not emit
				// a redundant declaration.
				$clean[ $key ] = strtolower( $colour );
			}
		}

		if ( isset( $value['radius'] ) && is_string( $value['radius'] )
			&& array_key_exists( $value['radius'], self::RADII ) ) {
			$clean['radius'] = $value['radius'];
		}

		return $clean;
	}

	/**
	 * The saved style, sanitised on the way out as well as on the way in.
	 *
	 * @return array{surface: string, accent: string, text: string, radius: string}
	 */
	public static function get(): array {
		return self::sanitize( get_option( self::OPTION, array() ) );
	}

	/**
	 * Lengthen `#abc` to `#aabbcc`.
	 *
	 * `<input type="color">` accepts only the six-digit form: handed `#abc` it
	 * silently shows black, so the picker gets the expanded value while the text
	 * field keeps what the author typed.
	 *
	 * @param string $hex A hex colour, three or six digits, with the hash.
	 */
	public static function expand_hex( string $hex ): string {
		if ( 4 !== strlen( $hex ) ) {
			return $hex;
		}
		return '#' . $hex[1] . $hex[1] . $hex[2] . $hex[2] . $hex[3] . $hex[3];
	}

	/**
	 * The custom properties that differ from the defaults, without a selector.
	 *
	 * Only the differences: a site that never customised anything must produce
	 * an empty string here, so no CSS at all reaches its readers.
	 */
	public static function css_declarations(): string {
		$style = self::get();
		$parts = array();

		foreach ( self::PROPERTIES as $key => $property ) {
			if ( self::DEFAULTS[ $key ] === $style[ $key ] ) {
				continue;
			}
			$value   = 'radius' === $key ? self::RADII[ $style[ $key ] ] : $style[ $key ];
			$parts[] = $property . ':' . $value;
		}

		return implode( ';', $parts );
	}

	/**
	 * The same declarations wrapped in the player's selector, for the frontend.
	 */
	public static function inline_css(): string {
		$declarations = self::css_declarations();
		return '' === $declarations ? '' : '.post-voice-player{' . $declarations . '}';
	}
}
