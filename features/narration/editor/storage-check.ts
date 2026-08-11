/** Approximate on-disk size of one language bundle (5 .onnx files + tokenizer + voices). */
export const LANGUAGE_BUNDLE_BYTES = 190 * 1024 * 1024;

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
