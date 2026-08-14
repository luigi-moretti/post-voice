import { useState, useRef, useEffect } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

import { formatTime } from '../format-time';

interface MiniPlayerProps {
	src: string;
}

/**
 * The compact audio player from the approved panel mockup: a round play button,
 * a progress bar and the remaining time.
 *
 * Not `<audio controls>`, for the same reason the reader player is not: every
 * browser draws that control differently, and the panel is supposed to look like
 * one designed thing. The element is still what plays the audio — it is only
 * hidden — so seeking, buffering and media keys keep working.
 *
 * @param props     Component props.
 * @param props.src URL of the audio to play.
 */
export function MiniPlayer( { src }: MiniPlayerProps ) {
	const audioRef = useRef< HTMLAudioElement >( null );
	const [ playing, setPlaying ] = useState( false );
	const [ currentTime, setCurrentTime ] = useState( 0 );
	const [ duration, setDuration ] = useState( 0 );

	// A new src is a different recording: reset rather than carry the previous
	// one's position and length into it.
	useEffect( () => {
		setPlaying( false );
		setCurrentTime( 0 );
		setDuration( 0 );
	}, [ src ] );

	const toggle = () => {
		const audio = audioRef.current;
		if ( ! audio ) {
			return;
		}
		if ( audio.paused ) {
			audio.play();
		} else {
			audio.pause();
		}
	};

	return (
		<div className="post-voice-mini-player">
			<audio
				ref={ audioRef }
				src={ src }
				onPlay={ () => setPlaying( true ) }
				onPause={ () => setPlaying( false ) }
				onEnded={ () => setPlaying( false ) }
				onLoadedMetadata={ ( event ) =>
					setDuration( event.currentTarget.duration )
				}
				onTimeUpdate={ ( event ) =>
					setCurrentTime( event.currentTarget.currentTime )
				}
			/>

			<button
				type="button"
				className="post-voice-mini-player__play"
				onClick={ toggle }
				aria-pressed={ playing }
				aria-label={
					playing
						? __( 'Pause narration', 'post-voice' )
						: __( 'Play narration', 'post-voice' )
				}
			>
				{ playing ? '⏸' : '▶' }
			</button>

			<input
				type="range"
				className="post-voice-mini-player__seek"
				min={ 0 }
				max={ Number.isFinite( duration ) ? duration : 0 }
				step={ 0.1 }
				value={ currentTime }
				onChange={ ( event ) => {
					const next = Number( event.target.value );
					setCurrentTime( next );
					if ( audioRef.current ) {
						audioRef.current.currentTime = next;
					}
				} }
				aria-label={ __( 'Seek within narration', 'post-voice' ) }
			/>

			<span className="post-voice-mini-player__time">
				{ formatTime( duration - currentTime ) }
			</span>
		</div>
	);
}
