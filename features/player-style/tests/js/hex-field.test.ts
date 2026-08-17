import { isValidHex, normalizeHex, expandHex } from '../../admin/hex-field';

describe( 'isValidHex', () => {
	it( 'accepts both hex forms, with the hash', () => {
		expect( isValidHex( '#abc' ) ).toBe( true );
		expect( isValidHex( '#AABBCC' ) ).toBe( true );
	} );

	it( 'rejects anything the server would also reject', () => {
		expect( isValidHex( 'abc' ) ).toBe( false );
		expect( isValidHex( '#ab' ) ).toBe( false );
		expect( isValidHex( '#gggggg' ) ).toBe( false );
		expect( isValidHex( '' ) ).toBe( false );
		expect( isValidHex( '#aabbccdd' ) ).toBe( false );
	} );
} );

describe( 'normalizeHex', () => {
	it( 'lowercases and keeps the short form as typed', () => {
		expect( normalizeHex( '#ABC' ) ).toBe( '#abc' );
	} );

	it( 'trims surrounding whitespace from a paste', () => {
		expect( normalizeHex( '  #C00000 ' ) ).toBe( '#c00000' );
	} );

	it( 'returns null for a value that is not a hex colour', () => {
		expect( normalizeHex( 'rebeccapurple' ) ).toBeNull();
	} );
} );

describe( 'expandHex', () => {
	it( 'lengthens the short form, because <input type="color"> needs six digits', () => {
		expect( expandHex( '#abc' ) ).toBe( '#aabbcc' );
	} );

	it( 'leaves the long form alone', () => {
		expect( expandHex( '#c00000' ) ).toBe( '#c00000' );
	} );
} );
