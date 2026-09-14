import {
	downloadBundle,
	DownloadError,
	createDownloadQueue,
	ModelState,
} from '../../admin/download-queue';
import { realBundleBytes } from '../../admin/bundle-size';
import { MODEL_BASE_URL } from '../../editor/model-source';

function fakeReader( chunkSizes: number[] ) {
	let i = 0;
	return {
		read: jest.fn( async () => {
			if ( i >= chunkSizes.length ) {
				return { done: true, value: undefined };
			}
			const value = new Uint8Array( chunkSizes[ i ] );
			i += 1;
			return { done: false, value };
		} ),
	};
}

interface FakeResponse {
	ok: boolean;
	status: number;
	url: string;
	bodyUsed: boolean;
	headers: { get: ( name: string ) => string | null };
	body: { getReader: () => ReturnType< typeof fakeReader > };
	json: () => Promise< unknown >;
	blob: () => Promise< { size: number } >;
	clone: () => FakeResponse;
}

function fakeResponse( {
	url,
	status = 200,
	contentLength,
	chunkSizes = [ contentLength ],
	jsonBody,
}: {
	url: string;
	status?: number;
	contentLength: number;
	chunkSizes?: number[];
	jsonBody?: unknown;
} ): FakeResponse {
	// `bodyUsed` starts false and flips true the moment this response's body
	// is actually read (`getReader()`, mirroring a stream read, or `json()`,
	// mirroring `Response.json()` draining the body) — never on `clone()`,
	// which builds a brand-new, independent `FakeResponse` with its own fresh
	// state instead of aliasing this one. That lets `fakeCache.put()` below
	// tell "cached a pre-read clone" apart from "cached the drained original".
	const response: FakeResponse = {
		ok: status >= 200 && status < 300,
		status,
		url,
		bodyUsed: false,
		headers: {
			get: ( name: string ) =>
				name === 'content-length' ? String( contentLength ) : null,
		},
		body: {
			getReader: () => {
				response.bodyUsed = true;
				return fakeReader( chunkSizes );
			},
		},
		json: async () => {
			response.bodyUsed = true;
			return jsonBody;
		},
		// Mirrors `Response.blob()` closely enough for `realBundleBytes`
		// (`bundle-size.ts`), which only reads `.size` off the result — not
		// the actual bytes.
		blob: async () => ( { size: contentLength } ),
		clone: () =>
			fakeResponse( {
				url,
				status,
				contentLength,
				chunkSizes,
				jsonBody,
			} ),
	};
	return response;
}

function fakeCache() {
	const store = new Map< string, unknown >();
	return {
		store,
		// Mirrors real `Cache.match()`, which accepts either a URL string or
		// a `Request`-like object — `realBundleBytes`/`deleteBundleFiles` in
		// `bundle-size.ts` call this with the `{ url }` objects `keys()`
		// returns below, not bare strings.
		match: jest.fn( async ( request: string | { url: string } ) =>
			store.get( typeof request === 'string' ? request : request.url )
		),
		put: jest.fn( async ( url: string, response: FakeResponse ) => {
			// Proves callers cache a pre-read clone, not the drained
			// original: a response whose body was already read arrives here
			// with `bodyUsed === true` and fails this assertion.
			expect( response.bodyUsed ).toBe( false );
			store.set( url, response );
		} ),
		delete: jest.fn( async ( request: { url: string } ) => {
			store.delete( request.url );
		} ),
		keys: jest.fn( async () =>
			Array.from( store.keys() ).map( ( url ) => ( { url } ) )
		),
	};
}

const LANGUAGE = 'italian';
const MANIFEST = { tokenizer_file: 'tokenizer.json' };
const OTHER_FILENAMES = [
	'mimi_encoder_int8.onnx',
	'text_conditioner_int8.onnx',
	'flow_lm_main_int8.onnx',
	'flow_lm_flow_int8.onnx',
	'mimi_decoder_int8.onnx',
	'voices.bin',
	'tokenizer.json',
];

function urlFor( filename: string ): string {
	return `${ MODEL_BASE_URL }${ LANGUAGE }/${ filename }`;
}

describe( 'downloadBundle', () => {
	let cache: ReturnType< typeof fakeCache >;
	let fetchMock: jest.Mock;

	beforeEach( () => {
		cache = fakeCache();
		// @ts-expect-error — minimal CacheStorage stand-in.
		global.caches = { open: async () => cache };
		fetchMock = jest.fn( async ( url: string ) => {
			if ( url === urlFor( 'bundle.json' ) ) {
				return fakeResponse( {
					url,
					contentLength: 40,
					jsonBody: MANIFEST,
				} );
			}
			return fakeResponse( {
				url,
				contentLength: 100,
				chunkSizes: [ 60, 40 ],
			} );
		} );
		global.fetch = fetchMock;
		Object.defineProperty( global.navigator, 'storage', {
			value: {
				estimate: async () => ( {
					quota: 10 * 1024 * 1024 * 1024,
					usage: 0,
				} ),
			},
			configurable: true,
		} );
	} );

	afterEach( () => {
		// @ts-expect-error — restoring the global the test replaced.
		delete global.caches;
		// @ts-expect-error — restoring the global the test replaced.
		delete global.fetch;
		// @ts-expect-error — restoring the global the test replaced.
		delete global.navigator.storage;
	} );

	it( 'caches bundle.json and every resolved file on success, reporting cumulative progress', async () => {
		const progress: Array< { receivedBytes: number; totalBytes: number } > =
			[];
		await downloadBundle( LANGUAGE, {
			signal: new AbortController().signal,
			onProgress: ( p ) => progress.push( { ...p } ),
		} );

		expect( cache.store.size ).toBe( 1 + OTHER_FILENAMES.length );
		expect( cache.store.has( urlFor( 'bundle.json' ) ) ).toBe( true );
		expect( cache.store.has( urlFor( 'voices.bin' ) ) ).toBe( true );

		const total = 40 + OTHER_FILENAMES.length * 100;
		const last = progress[ progress.length - 1 ];
		expect( last.totalBytes ).toBe( total );
		expect( last.receivedBytes ).toBe( total );
	} );

	it( 'caches each file under the requested URL, not the redirected one Hugging Face actually serves it from', async () => {
		// Hugging Face answers every model-file request with a 307 to a
		// signed, expiring CDN URL — `Response.url` reflects that final
		// (post-redirect) URL, not the one `fetch()` was called with. A
		// response cached under `response.url` is unfindable by every later
		// lookup, which all key off the stable `bundleUrl()`/`resolveBundleFiles()`
		// URLs — this regressed silently in production because no fake
		// response here previously diverged the two.
		fetchMock.mockImplementation( async ( requestedUrl: string ) => {
			if ( requestedUrl === urlFor( 'bundle.json' ) ) {
				return fakeResponse( {
					url: requestedUrl,
					contentLength: 40,
					jsonBody: MANIFEST,
				} );
			}
			const filename = requestedUrl.slice(
				requestedUrl.lastIndexOf( '/' ) + 1
			);
			return fakeResponse( {
				url: `https://cdn-lfs.huggingface.co/redirected/${ filename }?sig=abc`,
				contentLength: 100,
				chunkSizes: [ 100 ],
			} );
		} );

		await downloadBundle( LANGUAGE, {
			signal: new AbortController().signal,
			onProgress: () => undefined,
		} );

		for ( const filename of OTHER_FILENAMES ) {
			expect( cache.store.has( urlFor( filename ) ) ).toBe( true );
		}
		expect( cache.store.size ).toBe( 1 + OTHER_FILENAMES.length );
	} );

	it( "clears any residue under this language's prefix before starting", async () => {
		cache.store.set(
			urlFor( 'bundle.json' ),
			fakeResponse( {
				url: urlFor( 'bundle.json' ),
				contentLength: 1,
			} )
		);

		await downloadBundle( LANGUAGE, {
			signal: new AbortController().signal,
			onProgress: () => undefined,
		} );

		expect( cache.delete ).toHaveBeenCalled();
	} );

	it( 'rejects with a storage DownloadError when free space is insufficient, without fetching anything', async () => {
		Object.defineProperty( global.navigator, 'storage', {
			value: { estimate: async () => ( { quota: 100, usage: 0 } ) },
			configurable: true,
		} );

		await expect(
			downloadBundle( LANGUAGE, {
				signal: new AbortController().signal,
				onProgress: () => undefined,
			} )
		).rejects.toMatchObject( { reason: 'storage' } );
		expect( fetchMock ).not.toHaveBeenCalled();
	} );

	it( 'rejects with a network DownloadError when a file responds with an error status, and cleans up the cache', async () => {
		fetchMock.mockImplementation( async ( url: string ) => {
			if ( url === urlFor( 'bundle.json' ) ) {
				return fakeResponse( {
					url,
					contentLength: 40,
					jsonBody: MANIFEST,
				} );
			}
			if ( url === urlFor( 'voices.bin' ) ) {
				return fakeResponse( { url, status: 500, contentLength: 0 } );
			}
			return fakeResponse( { url, contentLength: 100 } );
		} );

		await expect(
			downloadBundle( LANGUAGE, {
				signal: new AbortController().signal,
				onProgress: () => undefined,
			} )
		).rejects.toBeInstanceOf( DownloadError );
		expect( cache.store.size ).toBe( 0 );
	} );

	it( 'reclassifies a QuotaExceededError thrown mid-download (e.g. from cache.put()) as a storage DownloadError', async () => {
		// The first `cache.put()` call caches `bundle.json` — let that one
		// succeed normally. Every subsequent call (one of the parallel
		// per-file writes) throws the DOMException storage exhaustion raises
		// mid-download, proving downloadBundle() reclassifies it as a
		// 'storage' DownloadError rather than falling through to the generic
		// 'network'/'unknown' branch.
		let putCalls = 0;
		cache.put.mockImplementation( async ( url: string, response ) => {
			putCalls += 1;
			if ( putCalls === 1 ) {
				cache.store.set( url, response );
				return;
			}
			throw new DOMException( 'Quota exceeded', 'QuotaExceededError' );
		} );

		await expect(
			downloadBundle( LANGUAGE, {
				signal: new AbortController().signal,
				onProgress: () => undefined,
			} )
		).rejects.toMatchObject( { reason: 'storage' } );
	} );

	it( 'cleans up and re-throws when the signal is aborted mid-download', async () => {
		const controller = new AbortController();
		fetchMock.mockImplementation( async ( url: string ) => {
			if ( url === urlFor( 'bundle.json' ) ) {
				return fakeResponse( {
					url,
					contentLength: 40,
					jsonBody: MANIFEST,
				} );
			}
			controller.abort();
			throw new DOMException( 'Aborted', 'AbortError' );
		} );

		await expect(
			downloadBundle( LANGUAGE, {
				signal: controller.signal,
				onProgress: () => undefined,
			} )
		).rejects.not.toBeInstanceOf( DownloadError );
		expect( cache.store.size ).toBe( 0 );
	} );
} );

describe( 'createDownloadQueue', () => {
	let cache: ReturnType< typeof fakeCache >;
	let fetchMock: jest.Mock;

	beforeEach( () => {
		cache = fakeCache();
		// @ts-expect-error — minimal CacheStorage stand-in.
		global.caches = { open: async () => cache };
		fetchMock = jest.fn( async ( url: string ) => {
			if ( url === urlFor( 'bundle.json' ) ) {
				return fakeResponse( {
					url,
					contentLength: 10,
					jsonBody: MANIFEST,
				} );
			}
			return fakeResponse( { url, contentLength: 10 } );
		} );
		global.fetch = fetchMock as unknown as typeof fetch;
		Object.defineProperty( global.navigator, 'storage', {
			value: {
				estimate: async () => ( {
					quota: 10 * 1024 * 1024 * 1024,
					usage: 0,
				} ),
			},
			configurable: true,
		} );
	} );

	afterEach( () => {
		// @ts-expect-error — restoring the global the test replaced.
		delete global.caches;
		// @ts-expect-error — restoring the global the test replaced.
		delete global.fetch;
		// @ts-expect-error — restoring the global the test replaced.
		delete global.navigator.storage;
	} );

	function collectStates( queue: ReturnType< typeof createDownloadQueue > ) {
		const states: Array< [ string, ModelState ] > = [];
		queue.subscribe( ( language, state ) =>
			states.push( [ language, state ] )
		);
		return states;
	}

	it( 'goes not-downloaded → downloading → downloaded on a successful download', async () => {
		const queue = createDownloadQueue();
		const states = collectStates( queue );

		queue.requestDownload( LANGUAGE );
		// requestDownload is fire-and-forget; wait for the microtask queue to
		// drain the whole download.
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		const statuses = states
			.filter( ( [ language ] ) => language === LANGUAGE )
			.map( ( [ , state ] ) => state.status );
		expect( statuses[ 0 ] ).toBe( 'downloading' );
		expect( statuses[ statuses.length - 1 ] ).toBe( 'downloaded' );
	} );

	it( 'queues a second requestDownload while one is active, then runs it when the first finishes', async () => {
		const queue = createDownloadQueue();
		const states = collectStates( queue );

		queue.requestDownload( 'portuguese' );
		queue.requestDownload( 'german' );
		// A third waiter, so the assertion below can tell FIFO order apart
		// from "some" order — with only one item pending, `pending.pop()`
		// and `pending.shift()` (or enqueueing at the front instead of the
		// back) are indistinguishable from correct FIFO behaviour.
		queue.requestDownload( 'french' );
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		expect(
			states.find(
				( [ language, state ] ) =>
					language === 'german' && state.status === 'queued'
			)
		).toBeTruthy();
		expect(
			states.find(
				( [ language, state ] ) =>
					language === 'french' && state.status === 'queued'
			)
		).toBeTruthy();

		for ( let i = 0; i < 10; i++ ) {
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		}

		expect(
			states.some(
				( [ language, state ] ) =>
					language === 'german' && state.status === 'downloading'
			)
		).toBe( true );

		// The two assertions above only prove each language eventually ran —
		// not that they ran in request order. Pin the actual sequence: the
		// first 'downloading' event for each language must appear in the
		// order portuguese, german, french.
		const firstDownloadingIndex = ( language: string ) =>
			states.findIndex(
				( [ lang, state ] ) =>
					lang === language && state.status === 'downloading'
			);
		const portugueseIndex = firstDownloadingIndex( 'portuguese' );
		const germanIndex = firstDownloadingIndex( 'german' );
		const frenchIndex = firstDownloadingIndex( 'french' );
		expect( portugueseIndex ).toBeGreaterThanOrEqual( 0 );
		expect( germanIndex ).toBeGreaterThan( portugueseIndex );
		expect( frenchIndex ).toBeGreaterThan( germanIndex );
	} );

	it( 'requestDownload no-ops when called again for a language already queued', () => {
		const queue = createDownloadQueue();
		const states = collectStates( queue );

		queue.requestDownload( 'portuguese' ); // becomes active immediately.
		queue.requestDownload( 'german' ); // queued.
		queue.requestDownload( 'german' ); // already queued — must no-op.

		const queuedEvents = states.filter(
			( [ language, state ] ) =>
				language === 'german' && state.status === 'queued'
		);
		// A second 'queued' event here would mean the guard let the language
		// be pushed onto `pending` twice.
		expect( queuedEvents ).toHaveLength( 1 );
	} );

	it( 'requestDownload no-ops when called again for a language already downloading', async () => {
		const queue = createDownloadQueue();
		const states = collectStates( queue );

		queue.requestDownload( LANGUAGE ); // becomes active immediately.
		queue.requestDownload( LANGUAGE ); // already active — must no-op.

		const downloadingEvents = states.filter(
			( [ language, state ] ) =>
				language === LANGUAGE && state.status === 'downloading'
		);
		// requestDownload() emits its first 'downloading' event
		// synchronously — a second call that failed to no-op would emit a
		// second one right here, before any fetch even resolves.
		expect( downloadingEvents ).toHaveLength( 1 );

		for ( let i = 0; i < 10; i++ ) {
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		}

		// One download's worth of fetches only (bundle.json + every other
		// file) — a second requestDownload() re-queueing the same language
		// would double this count.
		expect( fetchMock ).toHaveBeenCalledTimes( 8 );
	} );

	it( 'cancelling a queued (not yet started) download returns it straight to not-downloaded, and it never runs later', async () => {
		const queue = createDownloadQueue();
		const states = collectStates( queue );

		queue.requestDownload( 'portuguese' );
		queue.requestDownload( 'german' );
		queue.cancelDownload( 'german' );

		expect( states[ states.length - 1 ] ).toEqual( [
			'german',
			{ status: 'not-downloaded' },
		] );

		// The event above only proves cancelDownload *reported*
		// not-downloaded — not that it actually took 'german' out of the
		// pending queue. Let the active ('portuguese') download run to
		// completion and confirm 'german' is never picked up afterwards:
		// a cancelDownload that emits the event but forgets to remove the
		// language from the queue would still pass the assertion above.
		for ( let i = 0; i < 10; i++ ) {
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		}

		expect(
			states.some(
				( [ language, state ] ) =>
					language === 'german' &&
					( state.status === 'downloading' ||
						state.status === 'downloaded' )
			)
		).toBe( false );
	} );

	it( 'cancelling the active download cleans the cache and returns to not-downloaded', async () => {
		let released: () => void = () => undefined;
		const blocked = new Promise< void >( ( resolve ) => {
			released = resolve;
		} );
		global.fetch = jest.fn( async ( url: string ) => {
			if ( url === urlFor( 'bundle.json' ) ) {
				await blocked;
				throw new DOMException( 'Aborted', 'AbortError' );
			}
			return fakeResponse( { url, contentLength: 10 } );
		} ) as unknown as typeof fetch;

		const queue = createDownloadQueue();
		const states = collectStates( queue );

		queue.requestDownload( LANGUAGE );
		queue.cancelDownload( LANGUAGE );
		released();
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		expect( states[ states.length - 1 ] ).toEqual( [
			LANGUAGE,
			{ status: 'not-downloaded' },
		] );
	} );

	it( 'cancelling WHILE a file is actually streaming (not just while bundle.json is in flight) aborts it and cleans the cache', async () => {
		// The test above only ever cancels while `bundle.json` — a few dozen
		// bytes — is still in flight. In practice a human can never click
		// Cancel that early: `bundle.json` resolves in milliseconds, and by
		// the time "Downloading…" is even visible, every real click lands
		// during the ~190MB parallel file transfer. This reproduces that:
		// `bundle.json` resolves immediately, then one of the real files'
		// `reader.read()` call hangs until the request's `AbortSignal` fires
		// — mirroring the real `fetch`/Streams API contract (a pending
		// `read()` rejects with an `AbortError` when its controller aborts),
		// which the hand-written `fakeReader` used elsewhere in this file
		// does not model.
		let signalRef: AbortSignal | undefined;
		global.fetch = jest.fn(
			async ( url: string, init?: { signal?: AbortSignal } ) => {
				if ( url === urlFor( 'bundle.json' ) ) {
					return fakeResponse( {
						url,
						contentLength: 40,
						jsonBody: MANIFEST,
					} );
				}
				signalRef = init?.signal;
				const response = fakeResponse( { url, contentLength: 100 } );
				response.body.getReader = () => ( {
					read: jest.fn(
						() =>
							new Promise( ( _resolve, reject ) => {
								// Never resolves on its own — only the abort below
								// settles it, exactly like a real in-flight network
								// read that the browser cancels out from under it.
								signalRef?.addEventListener( 'abort', () => {
									reject(
										new DOMException(
											'The operation was aborted.',
											'AbortError'
										)
									);
								} );
							} )
					),
				} );
				return response;
			}
		) as unknown as typeof fetch;

		const queue = createDownloadQueue();
		const states = collectStates( queue );

		queue.requestDownload( LANGUAGE );
		// Let the bundle.json fetch and the parallel file fetches' *headers*
		// resolve, so we're genuinely inside the streaming phase before
		// cancelling — matching where a real click always lands.
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		queue.cancelDownload( LANGUAGE );
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		expect( states[ states.length - 1 ] ).toEqual( [
			LANGUAGE,
			{ status: 'not-downloaded' },
		] );
		expect( cache.store.size ).toBe( 0 );
	} );

	it( "cancelling doesn't let a file that finishes independently land in the cache after cleanup already ran", async () => {
		// `Promise.all(responses.map(...))` rejects as soon as ONE file's
		// read rejects, but it does NOT cancel the other promises in that
		// same array — a file whose own read isn't blocked at the exact
		// abort instant (a fast/buffered chunk arriving right around then)
		// keeps running to its own `cache.put()` independently of the
		// cancellation. Without an explicit `signal.aborted` check before
		// that write, such a file can land in the cache *after* the cancel
		// handler's `deleteBundleFiles` cleanup already ran — exactly the
		// "Cache Storage still has orphaned bytes after Cancel" symptom.
		// Both files here are under manual control so the ordering is
		// deterministic: `voices.bin` rejects (simulating the abort), the
		// cleanup runs to completion, and only *then* does `tokenizer.json`
		// resolve its last chunk — reproducing a write landing strictly
		// after cleanup, not merely concurrent with it.
		let voicesReject: ( ( reason: unknown ) => void ) | undefined;
		let resolveTokenizerChunk: ( () => void ) | undefined;
		global.fetch = jest.fn( async ( url: string ) => {
			if ( url === urlFor( 'bundle.json' ) ) {
				return fakeResponse( {
					url,
					contentLength: 40,
					jsonBody: MANIFEST,
				} );
			}
			if ( url === urlFor( 'voices.bin' ) ) {
				const response = fakeResponse( { url, contentLength: 100 } );
				response.body.getReader = () => ( {
					read: jest.fn(
						() =>
							new Promise( ( _resolve, reject ) => {
								voicesReject = reject;
							} )
					),
				} );
				return response;
			}
			if ( url === urlFor( 'tokenizer.json' ) ) {
				const response = fakeResponse( { url, contentLength: 10 } );
				let delivered = false;
				response.body.getReader = () => ( {
					read: jest.fn(
						() =>
							new Promise( ( resolve ) => {
								if ( delivered ) {
									resolve( { done: true, value: undefined } );
									return;
								}
								resolveTokenizerChunk = () => {
									delivered = true;
									resolve( {
										done: false,
										value: new Uint8Array( 10 ),
									} );
								};
							} )
					),
				} );
				return response;
			}
			return fakeResponse( { url, contentLength: 10 } );
		} ) as unknown as typeof fetch;

		const queue = createDownloadQueue();
		const states = collectStates( queue );

		queue.requestDownload( LANGUAGE );
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		queue.cancelDownload( LANGUAGE );
		voicesReject?.(
			new DOMException( 'The operation was aborted.', 'AbortError' )
		);
		// Let cleanup (deleteBundleFiles + the not-downloaded emission) run
		// all the way to completion *before* tokenizer.json's chunk ever
		// arrives.
		for ( let i = 0; i < 5; i++ ) {
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		}
		expect( states[ states.length - 1 ] ).toEqual( [
			LANGUAGE,
			{ status: 'not-downloaded' },
		] );
		expect( cache.store.size ).toBe( 0 );

		// Only now does the straggling file's read resolve.
		resolveTokenizerChunk?.();
		for ( let i = 0; i < 5; i++ ) {
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		}

		expect( cache.store.size ).toBe( 0 );
	} );

	it( 'a failed download reports error with the classified reason', async () => {
		global.fetch = jest.fn( async ( url: string ) =>
			fakeResponse( { url, status: 500, contentLength: 0 } )
		) as unknown as typeof fetch;

		const queue = createDownloadQueue();
		const states = collectStates( queue );

		queue.requestDownload( LANGUAGE );
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		const last = states[ states.length - 1 ];
		expect( last[ 1 ] ).toEqual( {
			status: 'error',
			reason: 'network',
		} );
	} );

	it( 'removeBundle deletes the cache and reports not-downloaded', async () => {
		cache.store.set(
			urlFor( 'bundle.json' ),
			fakeResponse( {
				url: urlFor( 'bundle.json' ),
				contentLength: 10,
			} )
		);

		const queue = createDownloadQueue();
		const states = collectStates( queue );

		await queue.removeBundle( LANGUAGE );

		expect( await realBundleBytes( LANGUAGE ) ).toBe( 0 );
		expect( states[ states.length - 1 ] ).toEqual( [
			LANGUAGE,
			{ status: 'not-downloaded' },
		] );
	} );

	it( 'cancelling a language that is neither active nor queued is a safe no-op', async () => {
		// `active.controller.abort()` has no *synchronous* observable
		// effect — a version of cancelDownload that aborts whatever is
		// active regardless of the language argument would still leave the
		// very next emitted state looking exactly like the untouched case.
		// So this fetch mock actually honours the abort signal (like a real
		// fetch would), the same way test 4's does above, letting a wrong
		// abort actually surface as a rejected fetch once the microtask
		// queue drains.
		let capturedSignal: AbortSignal | undefined;
		global.fetch = jest.fn(
			async ( url: string, init?: { signal?: AbortSignal } ) => {
				capturedSignal = init?.signal;
				if ( url === urlFor( 'bundle.json' ) ) {
					await new Promise( ( resolve ) =>
						setTimeout( resolve, 0 )
					);
					if ( capturedSignal?.aborted ) {
						throw new DOMException( 'Aborted', 'AbortError' );
					}
					return fakeResponse( {
						url,
						contentLength: 10,
						jsonBody: MANIFEST,
					} );
				}
				return fakeResponse( { url, contentLength: 10 } );
			}
		) as unknown as typeof fetch;

		const queue = createDownloadQueue();
		const states = collectStates( queue );

		queue.requestDownload( LANGUAGE );
		queue.cancelDownload( 'spanish' );

		for ( let i = 0; i < 10; i++ ) {
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		}

		expect(
			states.some( ( [ language ] ) => language === 'spanish' )
		).toBe( false );
		const last = states[ states.length - 1 ];
		expect( last[ 0 ] ).toBe( LANGUAGE );
		expect( last[ 1 ].status ).toBe( 'downloaded' );
	} );

	it( 'unsubscribe stops delivering further state events to that listener', async () => {
		const queue = createDownloadQueue();
		const listener = jest.fn();
		const unsubscribe = queue.subscribe( listener );

		unsubscribe();
		queue.requestDownload( LANGUAGE );
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		expect( listener ).not.toHaveBeenCalled();
	} );
} );
