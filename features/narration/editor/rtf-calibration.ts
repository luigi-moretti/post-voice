export const SLOW_RTF_WARNING_THRESHOLD = 3; // RTF > 3x real-time triggers a non-blocking warning
export const LONG_TEXT_CONFIRMATION_ETA_SECONDS = 120; // ETA above this asks for explicit confirmation before generating
const AVERAGE_CHARACTERS_PER_SECOND_OF_SPEECH = 15; // rough heuristic; refined per-device by the real measured RTF

export function computeRtf( warmupAudioDurationSec: number, warmupElapsedMs: number ): number {
  if ( warmupElapsedMs <= 0 ) return 0;
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
