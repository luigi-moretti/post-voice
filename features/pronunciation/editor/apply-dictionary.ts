import { isValidEntry, type DictionaryEntry } from './dictionary-entry';

/**
 * Compiled alternations, keyed by language and by the identity of the entry
 * array. Recompiling per call would put a regex build on the editor's
 * per-keystroke path, where the whole pipeline has a 50 ms budget.
 */
const cache = new WeakMap<
	DictionaryEntry[],
	Map< string, CompiledDictionary >
>();

interface CompiledDictionary {
	pattern: RegExp;
	replacements: Map< string, string >;
}

function escapeForRegex( term: string ): string {
	return term.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' );
}

/**
 * Word boundary that understands accents.
 *
 * JavaScript's `\b` is defined against `[A-Za-z0-9_]`, so `\bré\b` would happily
 * match the "ré" inside "réu". Lookaround against a Unicode letter class is the
 * portable fix — supported in every browser this plugin targets.
 * @param terms Dictionary entry terms to build pattern for.
 * @return A RegExp that matches these terms surrounded by word boundaries.
 */
function boundedPattern( terms: string[] ): RegExp {
	// Expand terms to include case variants: multi-character uppercase terms
	// should match both uppercase and lowercase versions.
	const expandedTerms = terms.flatMap( ( term ) => {
		if (
			term.length > 1 &&
			term === term.toUpperCase() &&
			/[A-Z]/u.test( term )
		) {
			return [ term, term.toLowerCase() ];
		}
		return [ term ];
	} );

	const alternation = expandedTerms
		// Longest first: with "machine" and "machine learning" both present, the
		// shorter one would otherwise win and leave " learning" unspoken-for.
		.sort( ( a, b ) => b.length - a.length )
		.map( escapeForRegex )
		.join( '|' );
	return new RegExp(
		`(?<![\\p{L}\\p{N}_])(?:${ alternation })(?![\\p{L}\\p{N}_])`,
		'gu'
	);
}

function compile(
	entries: DictionaryEntry[],
	language: string
): CompiledDictionary | null {
	const applicable = entries.filter(
		( entry ) => isValidEntry( entry ) && entry.language === language
	);
	if ( applicable.length === 0 ) {
		return null;
	}
	const replacements = new Map< string, string >();
	for ( const entry of applicable ) {
		replacements.set(
			entry.term.trim().toLowerCase(),
			entry.replacement.trim()
		);
	}
	return {
		pattern: boundedPattern(
			applicable.map( ( entry ) => entry.term.trim() )
		),
		replacements,
	};
}

function compiledFor(
	entries: DictionaryEntry[],
	language: string
): CompiledDictionary | null {
	let byLanguage = cache.get( entries );
	if ( ! byLanguage ) {
		byLanguage = new Map();
		cache.set( entries, byLanguage );
	}
	if ( ! byLanguage.has( language ) ) {
		const compiled = compile( entries, language );
		if ( compiled ) {
			byLanguage.set( language, compiled );
		} else {
			return null;
		}
	}
	return byLanguage.get( language ) ?? null;
}

/**
 * Apply every entry that belongs to `language` to one segment's text.
 *
 * Single pass over the text: one alternation for the whole dictionary, so a
 * replacement can never be matched again by a later entry.
 *
 * @param text     Segment text, already stripped of markup.
 * @param language Resolved language of that segment.
 * @param entries  Merged dictionary (site entries plus this post's).
 */
export function applyDictionary(
	text: string,
	language: string,
	entries: DictionaryEntry[]
): string {
	const compiled = compiledFor( entries, language );
	if ( ! compiled ) {
		return text;
	}
	return text.replace(
		compiled.pattern,
		( match ) => compiled.replacements.get( match.toLowerCase() ) ?? match
	);
}
