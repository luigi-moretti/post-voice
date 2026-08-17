/**
 * The bundle used when the site's locale has none — and the value the panel
 * opened on before this existed was a hardcoded `portuguese`, which was honest
 * on exactly one site.
 */
export const DEFAULT_BUNDLE = 'english_2026-04';

const BY_LANGUAGE_CODE: Record< string, string > = {
	pt: 'portuguese',
	en: DEFAULT_BUNDLE,
	de: 'german',
	it: 'italian',
	es: 'spanish',
};

/**
 * Map a WordPress locale (`pt_BR`, `de_CH_informal`, `en`) to a model bundle.
 *
 * Only the language subtag matters: the bundles are per language, not per
 * region, and `pt_PT` narrated by the Portuguese bundle is the intended
 * behaviour, not a compromise.
 *
 * @param locale Locale string from `get_locale()`.
 */
export function bundleForLocale( locale: string ): string {
	const code = locale.split( '_' )[ 0 ].toLowerCase();
	return BY_LANGUAGE_CODE[ code ] ?? DEFAULT_BUNDLE;
}
