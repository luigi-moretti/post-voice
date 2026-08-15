import { cachedBundles } from '../../editor/bundle-cache-status';

describe( 'cachedBundles', () => {
	afterEach( () => {
		// @ts-expect-error — restoring the global the test replaced.
		delete global.caches;
	} );

	it( 'reports a bundle whose manifest is already cached', async () => {
		const match = jest.fn( async ( url: string ) =>
			url.includes( 'portuguese' ) ? {} : undefined
		);
		// @ts-expect-error — minimal CacheStorage stand-in.
		global.caches = { open: async () => ( { match } ) };

		const cached = await cachedBundles( [
			'portuguese',
			'english_2026-04',
		] );

		expect( cached.has( 'portuguese' ) ).toBe( true );
		expect( cached.has( 'english_2026-04' ) ).toBe( false );
	} );

	it( 'reports nothing cached when the Cache API is missing', async () => {
		const cached = await cachedBundles( [ 'portuguese' ] );

		expect( cached.size ).toBe( 0 );
	} );
} );
