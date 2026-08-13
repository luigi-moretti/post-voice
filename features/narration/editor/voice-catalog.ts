import { SUPPORTED_LANGUAGES } from './model-source';

/**
 * The predefined voices every Pocket TTS bundle ships in its `voices.bin`.
 *
 * Verified identical across all five mirrored bundles — each `bundle.json`
 * lists exactly these eight under `predefined_voices` — which is why the panel
 * can render the selector before the model is downloaded, and why changing
 * language never invalidates the chosen voice. The worker is still the
 * authority: it throws `Unknown built-in voice` for anything absent from the
 * loaded bundle, so a future bundle that drops a voice fails loudly instead of
 * silently synthesising with the wrong one.
 */
export const VOICES = [
	'alba',
	'azelma',
	'cosette',
	'eponine',
	'fantine',
	'javert',
	'jean',
	'marius',
] as const;

export type Voice = ( typeof VOICES )[ number ];

/**
 * Matches the worker's own fallback: it prefers `alba` when the bundle offers
 * it, so naming the same default here keeps the panel's label honest about what
 * will actually be synthesised.
 */
export const DEFAULT_VOICE: Voice = 'alba';

/**
 * The phrase spoken when previewing a voice — one per model bundle.
 *
 * Deliberately NOT translated through `__()`. Gettext follows the *admin
 * interface* locale, but this text is fed to a *speech model* whose language is
 * whatever bundle the author picked. An admin running WordPress in Portuguese
 * while generating an English narration would otherwise hear the English voice
 * read Portuguese text — mispronounced, and useless as a sample of that voice.
 * The bundle is the only correct key.
 *
 * Kept short on purpose. Sample latency is the text length times the device's
 * RTF, so every phrase here stays under ~60 characters (~4s of speech) to hold
 * the sample near a couple of seconds on a normal machine — the whole point of
 * the sample button over generating the real post.
 */
export const SAMPLE_TEXTS: Record< string, string > = {
	'english_2026-04': 'This is the voice that will narrate your post.',
	german: 'Das ist die Stimme, die deinen Beitrag vorliest.',
	italian: 'Questa è la voce che leggerà il tuo articolo.',
	portuguese: 'Esta é a voz que vai narrar o seu post.',
	spanish: 'Esta es la voz que narrará tu publicación.',
};

/**
 * Sample phrase for a bundle, falling back to English for an unknown one.
 *
 * @param language Model bundle identifier, e.g. `portuguese`.
 */
export function sampleTextFor( language: string ): string {
	return SAMPLE_TEXTS[ language ] ?? SAMPLE_TEXTS[ SUPPORTED_LANGUAGES[ 0 ] ];
}

/**
 * Whether a string names one of the predefined voices.
 *
 * Guards values coming back from post meta, which an older version of the
 * plugin — or a hand-edited database row — may have left holding anything.
 *
 * @param value Candidate voice name.
 */
export function isVoice( value: unknown ): value is Voice {
	return (
		typeof value === 'string' &&
		( VOICES as readonly string[] ).includes( value )
	);
}
