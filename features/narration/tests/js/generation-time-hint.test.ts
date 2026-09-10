import {
	splitMinutesSeconds,
	formatRemainingHint,
	formatEstimatedTimeMessage,
} from '../../editor/generation-time-hint';

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

describe( 'formatRemainingHint', () => {
	it( 'stays seconds-only at and below the one-minute threshold', () => {
		expect( formatRemainingHint( 9 ) ).toBe( '~9s remaining' );
		expect( formatRemainingHint( 60 ) ).toBe( '~60s remaining' );
	} );

	it( 'switches to minutes+seconds above the threshold', () => {
		expect( formatRemainingHint( 61 ) ).toBe( '~1m 1s remaining' );
		expect( formatRemainingHint( 316 ) ).toBe( '~5m 16s remaining' );
	} );
} );

describe( 'formatEstimatedTimeMessage', () => {
	it( 'stays seconds-only at and below the one-minute threshold', () => {
		expect( formatEstimatedTimeMessage( 60 ) ).toBe(
			'This text is long — estimated time: 60 seconds.'
		);
	} );

	it( 'switches to minutes+seconds above the threshold', () => {
		expect( formatEstimatedTimeMessage( 345 ) ).toBe(
			'This text is long — estimated time: 5m 45s.'
		);
	} );
} );
