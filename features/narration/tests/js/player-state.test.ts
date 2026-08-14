import {
	closePlayer,
	createInitialPlayerState,
	cycleRate,
	togglePlaying,
} from '../../frontend/player-state';

describe( 'player-state', () => {
	it( 'starts paused, at 1x, not closed', () => {
		expect( createInitialPlayerState() ).toEqual( {
			playing: false,
			rate: 1,
			closed: false,
		} );
	} );

	it( 'toggles playing', () => {
		const state = togglePlaying( createInitialPlayerState() );
		expect( state.playing ).toBe( true );
		expect( togglePlaying( state ).playing ).toBe( false );
	} );

	it( 'cycles through playback rates and wraps around', () => {
		let state = createInitialPlayerState();
		const seen = [ state.rate ];
		for ( let i = 0; i < 5; i++ ) {
			state = cycleRate( state );
			seen.push( state.rate );
		}
		expect( seen ).toEqual( [ 1, 1.25, 1.5, 2, 0.75, 1 ] );
	} );

	it( 'closing stops playback and marks closed', () => {
		const playing = togglePlaying( createInitialPlayerState() );
		const closed = closePlayer( playing );
		expect( closed ).toEqual( { playing: false, rate: 1, closed: true } );
	} );
} );
