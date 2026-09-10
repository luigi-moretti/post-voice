import { splitMinutesSeconds } from '../../editor/generation-time-hint';

describe( 'splitMinutesSeconds', () => {
	it( 'splits whole seconds into minutes and seconds', () => {
		expect( splitMinutesSeconds( 0 ) ).toEqual( {
			minutes: 0,
			seconds: 0,
		} );
		expect( splitMinutesSeconds( 59 ) ).toEqual( {
			minutes: 0,
			seconds: 59,
		} );
		expect( splitMinutesSeconds( 60 ) ).toEqual( {
			minutes: 1,
			seconds: 0,
		} );
		expect( splitMinutesSeconds( 61 ) ).toEqual( {
			minutes: 1,
			seconds: 1,
		} );
		expect( splitMinutesSeconds( 125 ) ).toEqual( {
			minutes: 2,
			seconds: 5,
		} );
	} );

	it( 'renders 0/0 for non-finite or negative input, same guard as formatTime', () => {
		expect( splitMinutesSeconds( Number.NaN ) ).toEqual( {
			minutes: 0,
			seconds: 0,
		} );
		expect( splitMinutesSeconds( Number.POSITIVE_INFINITY ) ).toEqual( {
			minutes: 0,
			seconds: 0,
		} );
		expect( splitMinutesSeconds( -1 ) ).toEqual( {
			minutes: 0,
			seconds: 0,
		} );
	} );
} );
