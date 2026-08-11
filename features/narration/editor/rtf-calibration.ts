export const SLOW_RTF_WARNING_THRESHOLD = 3; // RTF > 3x real-time triggers a non-blocking warning
export const LONG_TEXT_CONFIRMATION_ETA_SECONDS = 120; // ETA above this asks for explicit confirmation before generating

/**
 * Derived from a ~150 wpm narration pace at ~5 characters per word:
 * 150 * 5 / 60 = 12.5 characters per second. Only used to guess how long a post
 * will take *before* synthesising it; the per-device RTF measured from the real
 * warm-up audio is what actually scales the estimate.
 */
const AVERAGE_CHARACTERS_PER_SECOND_OF_SPEECH = 12.5;

export function computeRtf( warmupAudioDurationSec: number, warmupElapsedMs: number ): number {
  // Both guards matter. A zero-length warm-up (failed synthesis returning an
  // empty buffer) would otherwise yield Infinity, and Infinity * 0 duration is
  // NaN — and `NaN > 120` is false, silently disabling the confirmation prompt
  // in exactly the broken state it exists to catch.
  if ( warmupElapsedMs <= 0 || warmupAudioDurationSec <= 0 ) return 0;
  return warmupElapsedMs / 1000 / warmupAudioDurationSec;
}

export function estimateAudioDurationSeconds( textLength: number ): number {
  if ( textLength <= 0 ) return 0;
  return textLength / AVERAGE_CHARACTERS_PER_SECOND_OF_SPEECH;
}

export function estimateEtaSeconds( rtf: number, estimatedAudioDurationSec: number ): number {
  if ( rtf <= 0 ) return 0;
  return rtf * estimatedAudioDurationSec;
}

export function shouldWarnSlowDevice( rtf: number ): boolean {
  return rtf > SLOW_RTF_WARNING_THRESHOLD;
}

export function requiresLongTextConfirmation( etaSeconds: number ): boolean {
  return etaSeconds > LONG_TEXT_CONFIRMATION_ETA_SECONDS;
}
