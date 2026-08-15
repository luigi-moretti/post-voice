import { MODEL_BASE_URL } from './model-source';

/**
 * Cache name, mirrored from `engine/model-cache.ts`. Duplicated deliberately:
 * importing that module would pull the fetch interceptor into the panel bundle,
 * and this only needs to read.
 */
const CACHE_NAME = 'post-voice-models-v1';

/**
 * Which of these bundles are already downloaded in this browser.
 *
 * Probes `bundle.json`, the first file the worker fetches for a language: it is
 * present exactly when that language was loaded to completion, and it costs a
 * single cache lookup instead of nine.
 *
 * @param languages Bundles to check.
 */
export async function cachedBundles(
	languages: string[]
): Promise< Set< string > > {
	const cached = new Set< string >();
	if ( typeof caches === 'undefined' ) {
		// No secure context, so no Cache API. Reporting "nothing cached" errs
		// towards warning the author about a download that may not happen, which is
		// the safe direction.
		return cached;
	}
	const cache = await caches.open( CACHE_NAME );
	await Promise.all(
		languages.map( async ( language ) => {
			const hit = await cache.match(
				`${ MODEL_BASE_URL }${ language }/bundle.json`
			);
			if ( hit ) {
				cached.add( language );
			}
		} )
	);
	return cached;
}
