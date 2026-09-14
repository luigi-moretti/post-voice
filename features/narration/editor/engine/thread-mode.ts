/**
 * Whether a failed first load is worth retrying single-threaded.
 *
 * The retry exists for one case only: a cross-origin-isolated document whose
 * multi-threaded attempt failed for a browser-specific reason that cannot be
 * recognised from the error message (onnxruntime-web's wording is not stable
 * across versions, so `load()` retries on any failure). Every other
 * combination already ran single-threaded on the first attempt — because the
 * document was never isolated, or because the site asked for single-threaded
 * generation through `post_voice_force_single_thread` — so retrying would
 * repeat the identical attempt and cost the author seconds for nothing.
 *
 * @param forcedSingleThread Whether the site asked for single-threaded generation.
 * @param isolated           Whether the document is cross-origin isolated.
 */
export function shouldRetrySingleThreaded(
	forcedSingleThread: boolean,
	isolated: boolean
): boolean {
	return isolated && ! forcedSingleThread;
}
