<?php
/**
 * Lets the E2E suite exercise `post_voice_send_isolation_headers` without a
 * real conflicting plugin: a site turns the filter off, on purpose, only
 * when a query var this file alone recognizes is present.
 *
 * E2E-only: mapped into `wp-content/mu-plugins` only by `.wp-env.json`.
 * Nothing in `post-voice.php`'s own require chain loads this file, so a
 * production install of the plugin never registers this filter.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

add_filter(
	'post_voice_send_isolation_headers',
	static function ( bool $send ): bool {
		if ( isset( $_GET['post_voice_disable_isolation'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only, E2E-only test harness.
			return false;
		}
		return $send;
	}
);
