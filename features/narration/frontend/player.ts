import {
	createInitialPlayerState,
	togglePlaying,
	cycleRate,
	closePlayer,
} from './player-state';

import './style.scss';

const PLAY_GLYPH = '▶'; // ▶
const PAUSE_GLYPH = '⏸'; // ⏸

function initNarrationPlayer( root: HTMLElement ): void {
	const audio = root.querySelector< HTMLAudioElement >( 'audio' );
	const playButton =
		root.querySelector< HTMLButtonElement >( '[data-role="play"]' );
	const seek = root.querySelector< HTMLInputElement >( '[data-role="seek"]' );
	const rateButton =
		root.querySelector< HTMLButtonElement >( '[data-role="rate"]' );
	const closeButton = root.querySelector< HTMLButtonElement >(
		'[data-role="close"]'
	);
	const liveRegion =
		root.querySelector< HTMLElement >( '[data-role="live"]' );

	// Bail out whole rather than in pieces. Enhancement takes the native control
	// away, so half-wiring it — say, after a theme or a cached template drops one
	// element — would leave a player that neither draws its own controls nor
	// offers the browser's. Doing nothing at least leaves a working <audio>.
	if (
		! audio ||
		! playButton ||
		! seek ||
		! rateButton ||
		! closeButton ||
		! liveRegion
	) {
		return;
	}

	let state = createInitialPlayerState();

	// Hand over from the server-rendered native control to our own. The <audio>
	// element keeps doing the playing, it just stops drawing itself: native
	// controls look completely different across browsers, which is the reason the
	// approved design draws its own. Everything below only runs with JavaScript,
	// so the no-JS reader still gets the native control untouched.
	audio.controls = false;
	root.classList.add( 'post-voice-player--enhanced' );
	for ( const element of [ playButton, seek, rateButton, closeButton ] ) {
		element.hidden = false;
	}

	if ( window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches ) {
		root.classList.add( 'post-voice-player--no-motion' );
	}

	const render = () => {
		playButton.textContent = state.playing ? PAUSE_GLYPH : PLAY_GLYPH;
		playButton.setAttribute( 'aria-pressed', String( state.playing ) );
		liveRegion.textContent = state.playing
			? playButton.dataset.labelPlaying || 'Playing'
			: playButton.dataset.labelPaused || 'Paused';
	};

	const renderProgress = () => {
		// Both readings are NaN until metadata arrives; formatTime absorbs that and
		// the range simply stays at zero.
		seek.max = String(
			Number.isFinite( audio.duration ) ? audio.duration : 0
		);
		seek.value = String( audio.currentTime );
	};

	playButton.addEventListener( 'click', () => {
		state = togglePlaying( state );
		if ( state.playing ) {
			audio.play();
		} else {
			audio.pause();
		}
		render();
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

	seek.addEventListener( 'input', () => {
		audio.currentTime = Number( seek.value );
	} );

	audio.addEventListener( 'loadedmetadata', renderProgress );
	audio.addEventListener( 'timeupdate', renderProgress );

	// The native control stays reachable without JavaScript, and a reader may also
	// pause from an OS media key or a headset button. Mirror those events back
	// into state, or the button glyph and aria-pressed drift from what is audible.
	audio.addEventListener( 'play', () => {
		if ( ! state.playing ) {
			state = togglePlaying( state );
			render();
		}
	} );

	audio.addEventListener( 'pause', () => {
		if ( state.playing ) {
			state = togglePlaying( state );
			render();
		}
	} );

	audio.addEventListener( 'ended', () => {
		state = { ...state, playing: false };
		render();
	} );

	render();
	renderProgress();
}

document
	.querySelectorAll< HTMLElement >( '.post-voice-player' )
	.forEach( initNarrationPlayer );
