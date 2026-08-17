import type { ResolvedSegment } from './segment';

export interface SegmentGroup {
	language: string;
	items: Array< { index: number; text: string } >;
}

/**
 * Collect segments by language, remembering where each one belongs.
 *
 * The worker holds one bundle at a time, so synthesising in document order would
 * reload the model at every language change — ten swaps for a post that
 * alternates ten times. Grouping caps the swaps at the number of languages.
 *
 * Groups come back in order of first appearance, so the bundle loaded first is
 * the one the post opens with — usually the one already cached.
 *
 * @param segments Resolved segments in document order.
 */
export function groupByLanguage( segments: ResolvedSegment[] ): SegmentGroup[] {
	const groups = new Map< string, SegmentGroup >();
	segments.forEach( ( segment, index ) => {
		const group = groups.get( segment.language ) ?? {
			language: segment.language,
			items: [],
		};
		group.items.push( { index, text: segment.text } );
		groups.set( segment.language, group );
	} );
	return Array.from( groups.values() );
}

/**
 * Every language this narration should be recorded against, primary first.
 *
 * `groupByLanguage` reports only what was actually said — a post where every
 * block carries an explicit foreign language can produce a list that never
 * includes the post's own selector value at all. The server requires the
 * primary language to be a member of the list it is sent (see
 * `class-rest-api.php`'s save handler), so a segments-only list is not merely
 * incomplete, it is a payload the endpoint always rejects. `languages`
 * therefore means "the post's primary language plus every language actually
 * spoken", not just the second half — deduped, with the primary first so the
 * status card names it first too.
 *
 * @param primaryLanguage The post's selected language.
 * @param groups          Segment groups the narration was actually built from.
 */
export function withPrimaryLanguage(
	primaryLanguage: string,
	groups: SegmentGroup[]
): string[] {
	return Array.from(
		new Set( [
			primaryLanguage,
			...groups.map( ( group ) => group.language ),
		] )
	);
}

/**
 * Put the synthesised parts back in document order, with silence at the seams.
 *
 * Sums the lengths first and writes into a single pre-allocated buffer. Building
 * this by spreading arrays would double the peak memory, which for a ten-minute
 * narration is already ~57 MB.
 *
 * @param parts      Synthesised audio, each carrying its document index.
 * @param gapSamples Silence to insert between consecutive segments.
 */
export function reassemble(
	parts: Array< { index: number; audio: Float32Array } >,
	gapSamples: number
): Float32Array {
	const ordered = [ ...parts ].sort( ( a, b ) => a.index - b.index );
	const audioLength = ordered.reduce(
		( sum, part ) => sum + part.audio.length,
		0
	);
	const gaps = Math.max( 0, ordered.length - 1 ) * gapSamples;
	const out = new Float32Array( audioLength + gaps );

	let offset = 0;
	ordered.forEach( ( part, position ) => {
		out.set( part.audio, offset );
		offset += part.audio.length;
		if ( position < ordered.length - 1 ) {
			// Float32Array is zero-filled on allocation, so the gap is already
			// silence — just step over it.
			offset += gapSamples;
		}
	} );

	return out;
}
