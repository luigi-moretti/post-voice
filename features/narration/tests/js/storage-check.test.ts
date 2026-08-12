import {
	formatBytes,
	hasEnoughStorage,
	LANGUAGE_BUNDLE_BYTES,
} from '../../editor/storage-check';

const MB = 1024 * 1024;

describe( 'hasEnoughStorage', () => {
	it( 'accepts a quota with generous free space', () => {
		expect(
			hasEnoughStorage( { quota: 2000 * MB, usage: 100 * MB } )
		).toBe( true );
	} );

	it( 'rejects when free space is below the bundle plus headroom', () => {
		expect( hasEnoughStorage( { quota: 250 * MB, usage: 50 * MB } ) ).toBe(
			false
		);
	} );

	it( 'requires headroom above the raw bundle size, not just the bundle', () => {
		// Exactly one bundle free is not enough — the headroom multiplier is 1.5.
		expect(
			hasEnoughStorage( { quota: LANGUAGE_BUNDLE_BYTES, usage: 0 } )
		).toBe( false );
	} );

	it( 'treats missing quota/usage fields as no available space', () => {
		expect( hasEnoughStorage( {} ) ).toBe( false );
	} );
} );

describe( 'formatBytes', () => {
	it( 'formats megabyte-scale values', () => {
		expect( formatBytes( 190 * MB ) ).toBe( '190 MB' );
	} );

	it( 'formats gigabyte-scale values', () => {
		expect( formatBytes( 2 * 1024 * MB ) ).toBe( '2.0 GB' );
	} );
} );
