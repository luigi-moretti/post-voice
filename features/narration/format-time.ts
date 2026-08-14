/**
 * Format a duration in seconds as `m:ss`, the way both players label audio.
 *
 * Lives at the feature root because the editor panel (React) and the reader
 * player (plain TypeScript, no framework) both need it and neither can import
 * the other's module.
 *
 * Non-finite input — `audio.duration` is `NaN` until metadata loads, and
 * `Infinity` for a stream — formats as `0:00` rather than leaking "NaN:aN" into
 * the UI.
 *
 * @param totalSeconds Duration in seconds.
 */
export function formatTime( totalSeconds: number ): string {
	if ( ! Number.isFinite( totalSeconds ) || totalSeconds < 0 ) {
		return '0:00';
	}

	const whole = Math.floor( totalSeconds );
	const minutes = Math.floor( whole / 60 );
	const seconds = whole % 60;

	return `${ minutes }:${ String( seconds ).padStart( 2, '0' ) }`;
}
