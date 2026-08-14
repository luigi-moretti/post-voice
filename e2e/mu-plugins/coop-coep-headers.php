<?php
/**
 * Cross-origin isolation headers for the E2E environment.
 *
 * Pocket TTS needs `self.crossOriginIsolated` (SharedArrayBuffer) to run at full
 * speed. Production sites set these at the server; wp-env's WordPress image does
 * not, so E2E supplies them here. The fallback E2E scenario deliberately strips
 * them to exercise the non-isolated path.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

add_action(
	'send_headers',
	static function (): void {
		header( 'Cross-Origin-Opener-Policy: same-origin' );
		header( 'Cross-Origin-Embedder-Policy: require-corp' );
	}
);
