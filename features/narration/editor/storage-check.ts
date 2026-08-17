/**
 * On-disk size of one language bundle, measured against the pinned mirror on
 * 2026-08-14: nine files totalling 198.6 MB, of which `flow_lm_main_int8.onnx`
 * is 76.3 MB and `voices.bin` is 52.4 MB. Nothing is shared between bundles —
 * every language ships its own copy of all nine, the eight voices included.
 */
export const LANGUAGE_BUNDLE_BYTES = Math.round( 198.6 * 1024 * 1024 );

/**
 * Require half a bundle of slack on top of the bundle itself — the browser also
 * needs room for its own HTTP cache and the decode buffers during inference.
 * Checking for the exact bundle size would let a download start that cannot finish.
 */
export const STORAGE_HEADROOM_MULTIPLIER = 1.5;

export interface StorageEstimateLike {
	quota?: number;
	usage?: number;
}

export function hasEnoughStorage(
	estimate: StorageEstimateLike,
	bundleBytes: number = LANGUAGE_BUNDLE_BYTES
): boolean {
	const quota = estimate.quota ?? 0;
	const usage = estimate.usage ?? 0;
	return quota - usage >= bundleBytes * STORAGE_HEADROOM_MULTIPLIER;
}

export function formatBytes( bytes: number ): string {
	const MB = 1024 * 1024;
	const GB = 1024 * MB;
	if ( bytes >= GB ) {
		return `${ ( bytes / GB ).toFixed( 1 ) } GB`;
	}
	return `${ Math.round( bytes / MB ) } MB`;
}

/**
 * Bytes still to download for a generation.
 *
 * @param pendingBundleCount Bundles not yet in the browser's cache.
 */
export function bytesForBundles( pendingBundleCount: number ): number {
	return pendingBundleCount * LANGUAGE_BUNDLE_BYTES;
}
