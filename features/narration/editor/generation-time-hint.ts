import { __, sprintf } from '@wordpress/i18n';

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

/**
 * "~Ns remaining" during generation, becoming "~Nm Ns remaining" once the
 * estimate passes a minute — plain seconds reads as noise past that point.
 *
 * @param wholeSeconds Remaining seconds, already `Math.ceil`'d by the caller
 *                     (`index.tsx`), so this stays in step with the
 *                     countdown ticking down rather than skipping a second
 *                     early.
 */
export function formatRemainingHint( wholeSeconds: number ): string {
	if ( ! Number.isFinite( wholeSeconds ) || wholeSeconds < 0 ) {
		wholeSeconds = 0;
	}
	if ( wholeSeconds > MINUTE_THRESHOLD_SECONDS ) {
		const { minutes, seconds } = splitMinutesSeconds( wholeSeconds );
		return sprintf(
			/* translators: 1: minutes remaining; 2: seconds remaining. */
			__( '~%1$dm %2$ds remaining', 'post-voice' ),
			minutes,
			seconds
		);
	}
	return sprintf(
		/* translators: %d: seconds remaining until narration is ready. */
		__( '~%ds remaining', 'post-voice' ),
		wholeSeconds
	);
}

/**
 * The long-text confirmation card's estimate. Same threshold and split as
 * `formatRemainingHint`, worded as its own sentence rather than sharing one:
 * the two cards read naturally in their own context, and translators see
 * full sentences, not fragments.
 *
 * Note: since `LONG_TEXT_CONFIRMATION_ETA_SECONDS` in `rtf-calibration.ts`
 * is 120, the card this feeds only ever renders with an ETA above 120 in
 * practice — the `<= 60` branch below is unreachable from that one call
 * site today. Kept anyway: this function is general-purpose, and coupling
 * its branching to a threshold defined in another module would be a trap
 * for whoever changes that threshold later.
 *
 * @param wholeSeconds Estimated seconds, already `Math.round`'d by the caller.
 */
export function formatEstimatedTimeMessage( wholeSeconds: number ): string {
	if ( ! Number.isFinite( wholeSeconds ) || wholeSeconds < 0 ) {
		wholeSeconds = 0;
	}
	if ( wholeSeconds > MINUTE_THRESHOLD_SECONDS ) {
		const { minutes, seconds } = splitMinutesSeconds( wholeSeconds );
		return sprintf(
			/* translators: 1: estimated minutes; 2: estimated additional seconds. */
			__(
				'This text is long — estimated time: %1$dm %2$ds.',
				'post-voice'
			),
			minutes,
			seconds
		);
	}
	return sprintf(
		/* translators: %d: estimated generation time in seconds. */
		__( 'This text is long — estimated time: %d seconds.', 'post-voice' ),
		wholeSeconds
	);
}
