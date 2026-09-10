// eslint-disable-next-line @typescript-eslint/no-unused-vars
const MINUTE_THRESHOLD_SECONDS = 60;

/**
 * Split a whole number of seconds into minutes and the seconds left over, for
 * callers that word a "N minutes M seconds" sentence themselves — `formatTime`
 * in `../format-time` is the m:ss playback scrubber/countdown, a different
 * shape and a different pair of consumers (editor mini-player and the
 * frontend player), not this file's audience.
 *
 * Same non-finite/negative guard as `formatTime`: `NaN`/`Infinity`/negative
 * input yields `{ minutes: 0, seconds: 0 }` rather than leaking `NaN`/`-1`
 * into a sentence.
 *
 * @param totalSeconds Whole seconds, already rounded by the caller.
 */
export function splitMinutesSeconds( totalSeconds: number ): {
	minutes: number;
	seconds: number;
} {
	if ( ! Number.isFinite( totalSeconds ) || totalSeconds < 0 ) {
		return { minutes: 0, seconds: 0 };
	}
	const whole = Math.floor( totalSeconds );
	return { minutes: Math.floor( whole / 60 ), seconds: whole % 60 };
}
