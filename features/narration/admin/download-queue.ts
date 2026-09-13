import { hasEnoughStorage } from '../editor/storage-check';
import {
	BundleManifest,
	bundleJsonUrl,
	resolveBundleFiles,
} from './model-manifest';
import { deleteBundleFiles } from './bundle-size';

const CACHE_NAME = 'post-voice-models-v1';

export type DownloadErrorReason = 'storage' | 'network' | 'unknown';

/**
 * A classified download failure. `reason` drives the message
 * `models-table.ts` shows — kept as a code here, not a translated string, so
 * this module stays free of `@wordpress/i18n` and trivially Jest-testable.
 */
export class DownloadError extends Error {
	public readonly reason: DownloadErrorReason;

	constructor( reason: DownloadErrorReason, message: string ) {
		super( message );
		this.reason = reason;
		this.name = 'DownloadError';
	}
}

export interface DownloadProgress {
	receivedBytes: number;
	totalBytes: number;
}

export interface DownloadOptions {
	signal: AbortSignal;
	onProgress: ( progress: DownloadProgress ) => void;
}

function contentLength( response: Response ): number {
	return Number( response.headers.get( 'content-length' ) ?? 0 );
}

async function readStreamCounting(
	response: Response,
	onChunk: ( bytes: number ) => void
): Promise< void > {
	const reader = response.body?.getReader();
	if ( ! reader ) {
		return;
	}
	for (;;) {
		const { done, value } = await reader.read();
		if ( done ) {
			break;
		}
		onChunk( value.length );
	}
}

/**
 * Download and cache every file of one language's bundle.
 *
 * Clears any residue of a previous attempt under that language's prefix
 * first, so a retry (or recovering from a session that ended abruptly) never
 * mixes old and new files. Fetches `bundle.json` first — its
 * `tokenizer_file`/`bos_before_voice_file` fields are needed to know the
 * rest of the file list — then fetches everything else in parallel, so the
 * progress total is known almost immediately instead of growing as each
 * file finishes.
 *
 * Only a complete, successful (`200`) response is written to the cache —
 * the same rule the worker's own interceptor follows
 * (`engine/model-cache.ts`'s `installModelCache`). Cancelling (aborting
 * `options.signal`) or any failure deletes whatever was already written for
 * this language, so the cache never holds a partial bundle.
 *
 * @param language Bundle identifier, e.g. `portuguese`.
 * @param options  Abort signal and progress callback.
 */
export async function downloadBundle(
	language: string,
	options: DownloadOptions
): Promise< void > {
	if ( typeof caches === 'undefined' ) {
		throw new DownloadError(
			'unknown',
			'Cache API unavailable outside a secure context.'
		);
	}

	await deleteBundleFiles( language );

	try {
		if ( navigator.storage?.estimate ) {
			const estimate = await navigator.storage.estimate();
			if ( ! hasEnoughStorage( estimate ) ) {
				throw new DownloadError(
					'storage',
					'Not enough free storage for this model.'
				);
			}
		}

		const cache = await caches.open( CACHE_NAME );

		const bundleJsonResponse = await fetch( bundleJsonUrl( language ), {
			signal: options.signal,
		} );
		if ( ! bundleJsonResponse.ok ) {
			throw new DownloadError(
				'network',
				`bundle.json responded ${ bundleJsonResponse.status }`
			);
		}
		const bundleJsonForCache = bundleJsonResponse.clone();
		const bundleJsonBytes = contentLength( bundleJsonResponse );
		const manifest: BundleManifest = await bundleJsonResponse.json();

		const otherFiles = resolveBundleFiles( language, manifest ).filter(
			( file ) => file.filename !== 'bundle.json'
		);
		const responses = await Promise.all(
			otherFiles.map( ( file ) =>
				fetch( file.url, { signal: options.signal } )
			)
		);
		const failed = responses.find( ( response ) => ! response.ok );
		if ( failed ) {
			throw new DownloadError(
				'network',
				`${ failed.url } responded ${ failed.status }`
			);
		}

		const totalBytes =
			bundleJsonBytes +
			responses.reduce(
				( sum, response ) => sum + contentLength( response ),
				0
			);
		let receivedBytes = bundleJsonBytes;
		options.onProgress( { receivedBytes, totalBytes } );

		await cache.put( bundleJsonUrl( language ), bundleJsonForCache );
		await Promise.all(
			responses.map( async ( response ) => {
				const toCache = response.clone();
				await readStreamCounting( response, ( bytes ) => {
					receivedBytes += bytes;
					options.onProgress( { receivedBytes, totalBytes } );
				} );
				await cache.put( response.url, toCache );
			} )
		);
	} catch ( error ) {
		await deleteBundleFiles( language );
		if ( options.signal.aborted ) {
			throw error;
		}
		if ( error instanceof DownloadError ) {
			throw error;
		}
		// `QuotaExceededError` (thrown by `cache.put()` when storage fills up
		// mid-download) is a `DOMException`, which does *not* extend `Error`
		// in the DOM types — `instanceof Error` would silently miss it and
		// misclassify a storage failure as a network one.
		if (
			error instanceof DOMException &&
			error.name === 'QuotaExceededError'
		) {
			throw new DownloadError( 'storage', error.message );
		}
		const message =
			error instanceof Error || error instanceof DOMException
				? error.message
				: String( error );
		throw new DownloadError( 'network', message );
	}
}
