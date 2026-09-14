<?php
/**
 * Multi-threaded generation opt-out storage.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Owns the site's answer to one question: may the post editor be
 * cross-origin isolated so narration can generate multi-threaded?
 *
 * A class of its own, rather than a constant on the settings section that
 * renders the control: `Post_Voice_Editor_Headers` reads this on every
 * `admin_init`, and must not have to load an admin-screen class to do it.
 */
class Post_Voice_Acceleration_Store {

	public const OPTION = 'post_voice_acceleration';

	/**
	 * The two values this option is ever stored as.
	 *
	 * Strings, not booleans, and that is load-bearing. `update_option()`
	 * skips the write when the new value matches the current one, and an
	 * option that was never saved reads back as `false`, so storing boolean
	 * `false` writes nothing at all and the next read falls back to the
	 * default "on" — the setting could never be turned off. Through
	 * `options.php` alone that trap would be dodged, because
	 * `register_setting()`'s declared default reaches `$old_value` via the
	 * `default_option_*` filter; it bites wherever the setting is not
	 * registered, which is every write from WP-CLI, from the front end, or
	 * from another plugin. `'0'` is a real value, so it is really written
	 * either way, and it keeps the declared `'type' => 'string'` honest.
	 */
	public const ON  = '1';
	public const OFF = '0';

	/**
	 * On, for a site that never opened the setting.
	 *
	 * Off would mean every existing install silently lost multi-threaded
	 * generation on update — a performance regression nobody asked for. The
	 * sites that need it off are the minority with a conflicting embed, and
	 * they turn it off deliberately.
	 */
	public const DEFAULT_STORED = self::ON;

	/**
	 * Whether this site allows the isolation headers, and with them
	 * multi-threaded generation.
	 */
	public static function is_enabled(): bool {
		// Compared without casting: a corrupt or foreign-written row holding
		// an array would make `(string)` emit "Array to string conversion"
		// on every editor page load. Anything that is not exactly `ON` means
		// off, which is the safe direction — it sends no headers.
		return self::ON === get_option( self::OPTION, self::DEFAULT_STORED );
	}

	/**
	 * Coerce whatever the settings form posted into one of the two stored
	 * values.
	 *
	 * `null` is the important case, not an edge one: an unticked checkbox
	 * posts no value at all, so `options.php` calls this with `null`. Treating
	 * that as "absent, fall back to the default" would make the control
	 * impossible to switch off.
	 *
	 * @param mixed $value Raw posted value.
	 */
	public static function sanitize( $value ): string {
		return $value ? self::ON : self::OFF;
	}
}
