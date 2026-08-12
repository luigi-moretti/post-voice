import { formatTime } from '../../format-time';

describe( 'formatTime', () => {
	it( 'formats seconds as m:ss with a zero-padded seconds field', () => {
		expect( formatTime( 102 ) ).toBe( '1:42' );
		expect( formatTime( 9 ) ).toBe( '0:09' );
		expect( formatTime( 60 ) ).toBe( '1:00' );
	} );

	it( 'truncates fractional seconds rather than rounding up past the duration', () => {
		expect( formatTime( 59.9 ) ).toBe( '0:59' );
	} );

	it( 'keeps counting minutes past an hour instead of wrapping', () => {
		expect( formatTime( 3661 ) ).toBe( '61:01' );
	} );

	it( 'renders 0:00 for the non-finite values an audio element reports', () => {
		// `audio.duration` is NaN until metadata loads and Infinity for a stream.
		expect( formatTime( Number.NaN ) ).toBe( '0:00' );
		expect( formatTime( Number.POSITIVE_INFINITY ) ).toBe( '0:00' );
		expect( formatTime( -1 ) ).toBe( '0:00' );
	} );
} );
