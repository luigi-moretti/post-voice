import type { SegmentGroup } from './group-segments';
import { LANGUAGE_BUNDLE_BYTES } from './storage-check';

export const SLOW_RTF_WARNING_THRESHOLD = 3; // RTF > 3x real-time triggers a non-blocking warning
export const LONG_TEXT_CONFIRMATION_ETA_SECONDS = 120; // ETA above this asks for explicit confirmation before generating

/**
 * Derived from a ~150 wpm narration pace at ~5 characters per word:
 * 150 * 5 / 60 = 12.5 characters per second. Only used to guess how long a post
 * will take *before* synthesising it; the per-device RTF measured from the real
 * warm-up audio is what actually scales the estimate.
 */
const AVERAGE_CHARACTERS_PER_SECOND_OF_SPEECH = 12.5;

export function computeRtf(
	warmupAudioDurationSec: number,
	warmupElapsedMs: number
): number {
	// Both guards matter. A zero-length warm-up (failed synthesis returning an
	// empty buffer) would otherwise yield Infinity, and Infinity * 0 duration is
	// NaN — and `NaN > 120` is false, silently disabling the confirmation prompt
	// in exactly the broken state it exists to catch.
	if ( warmupElapsedMs <= 0 || warmupAudioDurationSec <= 0 ) {
		return 0;
	}
	return warmupElapsedMs / 1000 / warmupAudioDurationSec;
}

export function estimateAudioDurationSeconds( textLength: number ): number {
	if ( textLength <= 0 ) {
		return 0;
	}
	return textLength / AVERAGE_CHARACTERS_PER_SECOND_OF_SPEECH;
}

export function estimateEtaSeconds(
	rtf: number,
	estimatedAudioDurationSec: number
): number {
	if ( rtf <= 0 ) {
		return 0;
	}
	return rtf * estimatedAudioDurationSec;
}

export function shouldWarnSlowDevice( rtf: number ): boolean {
	return rtf > SLOW_RTF_WARNING_THRESHOLD;
}

export function requiresLongTextConfirmation( etaSeconds: number ): boolean {
	return etaSeconds > LONG_TEXT_CONFIRMATION_ETA_SECONDS;
}

/**
 * Seconds this generation will take, across every language it uses.
 *
 * Each group is estimated with its own measured RTF, because a bundle that has
 * not been loaded yet has not been warmed up either — its group falls back to the
 * RTF of the bundle that was measured, marked as an estimate by the caller.
 *
 * Download time counts. Fetching 199 MB on a modest connection can outlast the
 * synthesis of a short post, and Fase 1 already established that the author gets
 * the number before deciding.
 *
 * @param groups             Segment groups, in synthesis order.
 * @param rtfByLanguage      Measured RTF per bundle.
 * @param defaultRtf         RTF to use for a bundle not measured yet.
 * @param pendingBundleCount Bundles still to download.
 * @param bytesPerSecond     Observed download speed; 0 means unknown.
 */
export function estimateMultiBundleEta(
	groups: SegmentGroup[],
	rtfByLanguage: Map< string, number >,
	defaultRtf: number,
	pendingBundleCount: number,
	bytesPerSecond: number
): number {
	const synthesis = groups.reduce( ( total, group ) => {
		const characters = group.items.reduce(
			( sum, item ) => sum + item.text.length,
			0
		);
		const rtf = rtfByLanguage.get( group.language ) ?? defaultRtf;
		return (
			total +
			estimateEtaSeconds(
				rtf,
				estimateAudioDurationSeconds( characters )
			)
		);
	}, 0 );

	const download =
		bytesPerSecond > 0
			? ( pendingBundleCount * LANGUAGE_BUNDLE_BYTES ) / bytesPerSecond
			: 0;

	return synthesis + download;
}

/**
 * Bytes per second to estimate downloads with, or 0 when unknown.
 *
 * `navigator.connection.downlink` is Chromium-only and deliberately coarse
 * (rounded, capped, and describing the link rather than this transfer). It is
 * used the same way `hardwareConcurrency` is used elsewhere in this plugin: as a
 * weak hint that improves a number, never as a gate. Where it is absent —
 * Safari, Firefox — the download term drops out and the ETA describes synthesis
 * only, which the panel labels as a floor rather than a estimate.
 */
export function downloadBytesPerSecond(): number {
	const connection = (
		navigator as Navigator & {
			connection?: { downlink?: number };
		}
	 ).connection;
	const downlinkMbps = connection?.downlink ?? 0;
	return downlinkMbps > 0 ? ( downlinkMbps * 1_000_000 ) / 8 : 0;
}
