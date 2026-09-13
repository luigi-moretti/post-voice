import { downloadBundle, DownloadError } from '../../admin/download-queue';
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
		match: jest.fn( async ( url: string ) => store.get( url ) ),
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
