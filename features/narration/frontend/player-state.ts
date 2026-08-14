export interface PlayerState {
	playing: boolean;
	rate: number;
	closed: boolean;
}

const PLAYBACK_RATES = [ 1, 1.25, 1.5, 2, 0.75 ];

export function createInitialPlayerState(): PlayerState {
	return { playing: false, rate: 1, closed: false };
}

export function togglePlaying( state: PlayerState ): PlayerState {
	return { ...state, playing: ! state.playing };
}

export function cycleRate( state: PlayerState ): PlayerState {
	const currentIndex = PLAYBACK_RATES.indexOf( state.rate );
	const nextRate =
		PLAYBACK_RATES[ ( currentIndex + 1 ) % PLAYBACK_RATES.length ];
	return { ...state, rate: nextRate };
}

export function closePlayer( state: PlayerState ): PlayerState {
	return { ...state, playing: false, closed: true };
}
