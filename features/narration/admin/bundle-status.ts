import {
	BundleManifest,
	bundleJsonUrl,
	resolveBundleFiles,
} from './model-manifest';

const CACHE_NAME = 'post-voice-models-v1';

/**
 * Whether every file of a language's bundle is present in the browser's
 * model cache, read-only — never fetches over the network, so calling this
 * for all five languages on every settings-page load is cheap.
 *
 * Deliberately stronger than `cachedBundles()` (`editor/bundle-cache-status.ts`),
 * which only probes `bundle.json` — the *first* file the worker fetches, so
 * a download interrupted right after it would read as complete there. This
 * checks every file the manifest actually requires, so an interrupted
 * session correctly reads as `Not downloaded` rather than `Downloaded`.
 *
 * @param language Bundle identifier, e.g. `portuguese`.
 */
export async function isBundleComplete( language: string ): Promise< boolean > {
	if ( typeof caches === 'undefined' ) {
		return false;
	}
	const cache = await caches.open( CACHE_NAME );
	const bundleJsonResponse = await cache.match( bundleJsonUrl( language ) );
	if ( ! bundleJsonResponse ) {
		return false;
	}

	const manifest: BundleManifest = await bundleJsonResponse.json();
	const files = resolveBundleFiles( language, manifest );
	const matches = await Promise.all(
		files.map( ( file ) => cache.match( file.url ) )
	);
	return matches.every( ( match ) => match !== undefined );
}
