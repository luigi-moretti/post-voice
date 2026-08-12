import { createInitialPlayerState, togglePlaying, cycleRate, closePlayer } from './player-state';

import './style.scss';

function initNarrationPlayer( root: HTMLElement ): void {
	const audio = root.querySelector( 'audio' ) as HTMLAudioElement;
	const playButton = root.querySelector( '[data-role="play"]' ) as HTMLButtonElement;
	const rateButton = root.querySelector( '[data-role="rate"]' ) as HTMLButtonElement;
	const closeButton = root.querySelector( '[data-role="close"]' ) as HTMLButtonElement;
	const liveRegion = root.querySelector( '[data-role="live"]' ) as HTMLElement;

	let state = createInitialPlayerState();

	if ( window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches ) {
		root.classList.add( 'post-voice-player--no-motion' );
	}

	const announce = () => {
		liveRegion.textContent = state.playing
			? playButton.dataset.labelPlaying || 'Playing'
			: playButton.dataset.labelPaused || 'Paused';
		playButton.setAttribute( 'aria-pressed', String( state.playing ) );
	};

	playButton.addEventListener( 'click', () => {
		state = togglePlaying( state );
		if ( state.playing ) {
			audio.play();
		} else {
			audio.pause();
		}
		announce();
	} );

	rateButton.addEventListener( 'click', () => {
		state = cycleRate( state );
		audio.playbackRate = state.rate;
		rateButton.textContent = `${ state.rate }×`;
	} );

	closeButton.addEventListener( 'click', () => {
		state = closePlayer( state );
		audio.pause();
		root.hidden = true;
	} );

	// The server-rendered `<audio controls>` stays usable on its own — that is the
	// whole point of the no-JS fallback — so playback can start or stop without
	// the pill button ever being clicked. Mirror those events back into state, or
	// the pill's label and aria-pressed drift out of sync with what is audible.
	audio.addEventListener( 'play', () => {
		if ( ! state.playing ) {
			state = togglePlaying( state );
			announce();
		}
	} );

	audio.addEventListener( 'pause', () => {
		if ( state.playing ) {
			state = togglePlaying( state );
			announce();
		}
	} );

	audio.addEventListener( 'ended', () => {
		state = { ...state, playing: false };
		announce();
	} );
}

document.querySelectorAll< HTMLElement >( '.post-voice-player' ).forEach( initNarrationPlayer );
