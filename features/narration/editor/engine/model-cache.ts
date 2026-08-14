import { MODEL_BASE_URL } from '../model-source';

/**
 * Cache name. The pinned commit SHA lives inside every model URL, so bumping the
 * model naturally misses this cache rather than serving stale weights; the `v1`
 * suffix is only for changing the caching scheme itself.
 */
const CACHE_NAME = 'post-voice-models-v1';

/**
 * Store the voice model in the Cache API so it downloads once per browser.
 *
 * Hugging Face serves model files behind a 307 to a signed CDN URL and sends no
 * `Cache-Control` at all — only an ETag. With no freshness directive the browser
 * has nothing to reuse confidently, so it re-requests roughly 190MB on every
 * editor session. Explicit caching is the only way to make the download
 * one-time; the HTTP cache cannot be relied on here.
 *
 * Implemented as a `fetch` interceptor rather than a helper called at each fetch
 * site, because the five `.onnx` files — the bulk of those 190MB — are fetched
 * by ONNX Runtime internally from a URL we hand it, not by the worker's own
 * code. Only requests under `MODEL_BASE_URL` are touched; everything else goes
 * straight through untouched.
 */
export function installModelCache(): void {
	if ( typeof caches === 'undefined' ) {
		// Cache API needs a secure context. The panel refuses to generate outside
		// one, so this is belt-and-braces: degrade to plain fetch rather than throw.
		return;
	}

	const nativeFetch = self.fetch.bind( self );

	self.fetch = async ( input: RequestInfo | URL, init?: RequestInit ) => {
		let url: string;
		if ( typeof input === 'string' ) {
			url = input;
		} else if ( input instanceof URL ) {
			url = input.href;
		} else {
			url = input.url;
		}

		// Range requests must never be served from, or written to, a cache keyed by
		// URL alone — the stored body would be a fragment masquerading as the whole
		// file.
		const isRangeRequest = Boolean(
			new Headers( init?.headers ?? ( input as Request )?.headers ).get(
				'range'
			)
		);

		if ( ! url.startsWith( MODEL_BASE_URL ) || isRangeRequest ) {
			return nativeFetch( input as RequestInfo, init );
		}

		const cache = await caches.open( CACHE_NAME );
		const hit = await cache.match( url );
		if ( hit ) {
			return hit;
		}

		const response = await nativeFetch( input as RequestInfo, init );

		// Only complete, successful responses are storable. `cache.put` rejects on
		// 206 and on opaque responses, and caching an error would pin the failure
		// for the life of the cache.
		if ( response.status === 200 ) {
			try {
				await cache.put( url, response.clone() );
			} catch {
				// Out of quota, or eviction under pressure. The response in hand is
				// still good, so serve it and re-download next time rather than
				// failing the generation outright.
			}
		}

		return response;
	};

	// Drop entries from earlier pinned model versions. Their URLs carry a
	// different commit SHA, so they would otherwise sit there forever, costing the
	// author ~190MB of quota per superseded version.
	void caches.open( CACHE_NAME ).then( async ( cache ) => {
		for ( const request of await cache.keys() ) {
			if ( ! request.url.startsWith( MODEL_BASE_URL ) ) {
				await cache.delete( request );
			}
		}
	} );
}
