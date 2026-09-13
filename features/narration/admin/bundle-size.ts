import { MODEL_BASE_URL } from '../editor/model-source';

const CACHE_NAME = 'post-voice-models-v1';

function prefix( language: string ): string {
	return `${ MODEL_BASE_URL }${ language }/`;
}

/**
 * Real bytes a language's bundle occupies in the browser's model cache right
 * now — the sum of every cached response's body size under that language's
 * URL prefix. `0` if nothing of that language is cached, or outside a
 * secure context (no Cache API).
 *
 * @param language Bundle identifier, e.g. `portuguese`.
 */
export async function realBundleBytes( language: string ): Promise< number > {
	if ( typeof caches === 'undefined' ) {
		return 0;
	}
	const cache = await caches.open( CACHE_NAME );
	const keys = ( await cache.keys() ).filter( ( request ) =>
		request.url.startsWith( prefix( language ) )
	);
	const sizes = await Promise.all(
		keys.map( async ( request ) => {
			const response = await cache.match( request );
			if ( ! response ) {
				return 0;
			}
			return ( await response.blob() ).size;
		} )
	);
	return sizes.reduce( ( total, size ) => total + size, 0 );
}

/**
 * Delete every cached file of a language's bundle, whatever state it is in
 * — complete, partial, or a single stray file. Used for Remove, for the
 * pre-download residue cleanup, and for cleaning up after a cancelled or
 * failed download.
 *
 * @param language Bundle identifier.
 */
export async function deleteBundleFiles( language: string ): Promise< void > {
	if ( typeof caches === 'undefined' ) {
		return;
	}
	const cache = await caches.open( CACHE_NAME );
	const keys = ( await cache.keys() ).filter( ( request ) =>
		request.url.startsWith( prefix( language ) )
	);
	await Promise.all( keys.map( ( request ) => cache.delete( request ) ) );
}
