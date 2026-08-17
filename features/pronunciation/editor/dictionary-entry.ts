import { SUPPORTED_LANGUAGES } from '../../narration/editor/model-source';

/**
 * One pronunciation correction: read `term` as `replacement`, but only when the
 * segment being synthesised is in `language`.
 *
 * Respelling is phonetic and phonetics belong to the bundle: "Bi Iou Di" read by
 * the English model is not a correction, it is a second mistake.
 */
export interface DictionaryEntry {
	term: string;
	replacement: string;
	language: string;
}

/**
 * Caps, enforced here and again in PHP. The list travels to the editor of
 * everyone who opens a post, so an unbounded option is an unbounded payload.
 */
export const MAX_ENTRIES = 200;
export const MAX_TERM_LENGTH = 100;
export const MAX_REPLACEMENT_LENGTH = 200;

export function isValidEntry( value: unknown ): value is DictionaryEntry {
	if ( typeof value !== 'object' || value === null ) {
		return false;
	}
	const entry = value as Partial< DictionaryEntry >;
	if (
		typeof entry.term !== 'string' ||
		typeof entry.replacement !== 'string' ||
		typeof entry.language !== 'string'
	) {
		return false;
	}
	const term = entry.term.trim();
	const replacement = entry.replacement.trim();
	return (
		term.length > 0 &&
		term.length <= MAX_TERM_LENGTH &&
		// An empty replacement would silently delete the term from the narration.
		// Removing text is what block exclusion does, visibly.
		replacement.length > 0 &&
		replacement.length <= MAX_REPLACEMENT_LENGTH &&
		( SUPPORTED_LANGUAGES as readonly string[] ).includes( entry.language )
	);
}

function keyOf( entry: DictionaryEntry ): string {
	// Matching is case-insensitive, so precedence has to be too — otherwise a post
	// entry for "byd" would sit alongside the global "BYD" and the winner would be
	// decided by array order.
	return `${ entry.language } ${ entry.term.trim().toLowerCase() }`;
}

/**
 * Post entries win over site entries for the same (term, language) pair.
 *
 * @param global Entries from the site option.
 * @param post   Entries from this post's meta.
 */
export function mergeDictionaries(
	global: DictionaryEntry[],
	post: DictionaryEntry[]
): DictionaryEntry[] {
	const merged = new Map< string, DictionaryEntry >();
	for ( const entry of global.filter( isValidEntry ) ) {
		merged.set( keyOf( entry ), entry );
	}
	for ( const entry of post.filter( isValidEntry ) ) {
		merged.set( keyOf( entry ), entry );
	}
	return Array.from( merged.values() ).slice( 0, MAX_ENTRIES );
}
