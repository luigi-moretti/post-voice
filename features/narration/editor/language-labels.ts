/**
 * Human-readable names for the bundles. The identifiers are file paths in the
 * model mirror — "english_2026-04" is not something to show an author.
 *
 * Every surface that shows a language goes through this map: the panel
 * selector, the block inspector, the inline toolbar and the status card.
 */
export const LANGUAGE_LABELS: Record< string, string > = {
	'english_2026-04': 'English',
	german: 'Deutsch',
	italian: 'Italiano',
	portuguese: 'Português',
	spanish: 'Español',
};

/**
 * Label for a bundle, falling back to its identifier.
 *
 * @param language Bundle identifier.
 */
export function languageLabel( language: string ): string {
	return LANGUAGE_LABELS[ language ] ?? language;
}
