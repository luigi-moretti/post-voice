import { SUPPORTED_LANGUAGES } from './model-source';

/**
 * A block as `wp.data` hands it over.
 *
 * Lives here rather than in the extractor because the extractor's old home,
 * `extract-narratable-text.ts`, goes away in Task 16 — and a type that outlives
 * its file should not have to move twice.
 */
export interface EditorBlock {
	name: string;
	attributes: Record< string, unknown >;
	innerBlocks: EditorBlock[];
}

/** A run of narratable text, plus the language it should be read in. */
export interface Segment {
	/** Plain text — never markup. */
	text: string;
	/** `null` means "whatever the post's language selector says". */
	language: string | null;
}

/** A segment whose language has been decided. */
export interface ResolvedSegment {
	text: string;
	language: string;
}

/**
 * Turn author intent into synthesis instructions.
 *
 * An unknown language falls back to the post default rather than throwing: the
 * value lives in `post_content`, which survives a plugin downgrade and a
 * hand-edited database, and handing the worker a bundle name that does not exist
 * would fail the whole generation over one stale attribute.
 *
 * @param segments        Extracted segments.
 * @param defaultLanguage The post's language selection.
 */
export function resolveSegments(
	segments: Segment[],
	defaultLanguage: string
): ResolvedSegment[] {
	return segments
		.filter( ( segment ) => segment.text.trim().length > 0 )
		.map( ( segment ) => ( {
			text: segment.text.trim(),
			language:
				segment.language &&
				( SUPPORTED_LANGUAGES as readonly string[] ).includes(
					segment.language
				)
					? segment.language
					: defaultLanguage,
		} ) );
}

/**
 * Fuse neighbours that share a language.
 *
 * Three consecutive sentences in the same language are one utterance; splitting
 * them into three syntheses breaks the prosody at every seam.
 *
 * @param segments Resolved segments in document order.
 */
export function mergeAdjacent(
	segments: ResolvedSegment[]
): ResolvedSegment[] {
	const merged: ResolvedSegment[] = [];
	for ( const segment of segments ) {
		const previous = merged[ merged.length - 1 ];
		if ( previous && previous.language === segment.language ) {
			previous.text = `${ previous.text } ${ segment.text }`;
			continue;
		}
		merged.push( { ...segment } );
	}
	return merged;
}

/**
 * Languages marked in the post that no bundle answers to.
 *
 * `resolveSegments` silently substitutes the post default for these, which is
 * the right behaviour for synthesis and the wrong behaviour for the author: the
 * panel says so out loud instead of narrating something they did not ask for.
 *
 * @param segments Extracted segments, before resolution.
 */
export function unknownLanguages( segments: Segment[] ): string[] {
	const unknown = new Set< string >();
	for ( const segment of segments ) {
		if (
			segment.language &&
			! ( SUPPORTED_LANGUAGES as readonly string[] ).includes(
				segment.language
			)
		) {
			unknown.add( segment.language );
		}
	}
	return Array.from( unknown );
}
