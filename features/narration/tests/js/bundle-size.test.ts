import { deleteBundleFiles, realBundleBytes } from '../../admin/bundle-size';
import { MODEL_BASE_URL } from '../../editor/model-source';

function fakeCache( sizes: Record< string, number > ) {
	const keys = Object.keys( sizes ).map( ( url ) => ( { url } ) );
	return {
		keys: jest.fn( async () => keys ),
		match: jest.fn( async ( request: { url: string } ) => ( {
			blob: async () => ( { size: sizes[ request.url ] } ),
		} ) ),
		delete: jest.fn( async () => true ),
	};
}

describe( 'realBundleBytes', () => {
	afterEach( () => {
		// @ts-expect-error — restoring the global the test replaced.
		delete global.caches;
	} );

	it( 'is 0 when the Cache API is unavailable', async () => {
		expect( await realBundleBytes( 'portuguese' ) ).toBe( 0 );
	} );

	it( "sums only the entries under this language's prefix", async () => {
		const cache = fakeCache( {
			[ `${ MODEL_BASE_URL }portuguese/bundle.json` ]: 100,
			[ `${ MODEL_BASE_URL }portuguese/voices.bin` ]: 900,
			[ `${ MODEL_BASE_URL }german/bundle.json` ]: 50,
		} );
		// @ts-expect-error — minimal CacheStorage stand-in.
		global.caches = { open: async () => cache };

		expect( await realBundleBytes( 'portuguese' ) ).toBe( 1000 );
	} );

	it( 'is 0 when nothing of that language is cached', async () => {
		const cache = fakeCache( {
			[ `${ MODEL_BASE_URL }german/bundle.json` ]: 50,
		} );
		// @ts-expect-error — minimal CacheStorage stand-in.
		global.caches = { open: async () => cache };

		expect( await realBundleBytes( 'portuguese' ) ).toBe( 0 );
	} );

	it( 'handles cache.match returning undefined for a URL', async () => {
		const cache = {
			keys: jest.fn( async () => [
				{ url: `${ MODEL_BASE_URL }portuguese/bundle.json` },
			] ),
			match: jest.fn( async () => undefined ),
		};
		// @ts-expect-error — minimal CacheStorage stand-in.
		global.caches = { open: async () => cache };

		expect( await realBundleBytes( 'portuguese' ) ).toBe( 0 );
	} );
} );

describe( 'deleteBundleFiles', () => {
	afterEach( () => {
		// @ts-expect-error — restoring the global the test replaced.
		delete global.caches;
	} );

	it( "deletes only entries under this language's prefix, leaving others", async () => {
		const cache = fakeCache( {
			[ `${ MODEL_BASE_URL }portuguese/bundle.json` ]: 100,
			[ `${ MODEL_BASE_URL }portuguese/voices.bin` ]: 900,
			[ `${ MODEL_BASE_URL }german/bundle.json` ]: 50,
		} );
		// @ts-expect-error — minimal CacheStorage stand-in.
		global.caches = { open: async () => cache };

		await deleteBundleFiles( 'portuguese' );

		expect( cache.delete ).toHaveBeenCalledTimes( 2 );
		expect( cache.delete ).not.toHaveBeenCalledWith(
			expect.objectContaining( {
				url: `${ MODEL_BASE_URL }german/bundle.json`,
			} )
		);
	} );

	it( 'is a no-op when the Cache API is unavailable', async () => {
		await expect(
			deleteBundleFiles( 'portuguese' )
		).resolves.toBeUndefined();
	} );
} );
