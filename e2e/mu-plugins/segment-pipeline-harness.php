<?php
/**
 * Exposes the segment pipeline on `window`, for the E2E performance scenario.
 *
 * `extractSegments` -> dictionary -> `resolveSegments`/`mergeAdjacent` ->
 * `computeSegmentHash` is pure text: it never touches ONNX, the worker or the
 * model host. Timing it under Jest mostly measured jsdom's pure-JS `DOMParser`,
 * not the plugin — see `e2e/segment-pipeline-perf.spec.ts` for the detail. This
 * loads the real bundled modules, built by the real bundler, on a plain front-end
 * page, so a real browser's native `DOMParser` can time them without pulling in
 * the block editor or downloading anything.
 *
 * E2E-only, mirroring `coop-coep-headers.php`: mapped into `wp-content/mu-plugins`
 * only by `.wp-env.json`. Nothing in `post-voice.php`'s own require chain loads
 * this file, so a production install of the plugin never enqueues the handle it
 * registers below.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

add_action(
	'wp_enqueue_scripts',
	static function (): void {
		$asset_file = WP_CONTENT_DIR . '/plugins/post-voice/build/segment-pipeline-harness.asset.php';
		if ( ! file_exists( $asset_file ) ) {
			return;
		}
		$asset = require $asset_file;

		wp_enqueue_script(
			'post-voice-segment-pipeline-harness',
			content_url( 'plugins/post-voice/build/segment-pipeline-harness.js' ),
			$asset['dependencies'],
			$asset['version'],
			true
		);
	}
);
