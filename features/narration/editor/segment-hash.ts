import type { ResolvedSegment } from './segment';

/**
 * Canonical serialisation of what will actually be synthesised.
 *
 * Tuples rather than objects, with a fixed field order: a hash is only useful if
 * the same narration always produces the same string, and object key order is a
 * property of how the object was built.
 *
 * @param segments Resolved segments, dictionary already applied.
 */
export function serializeSegments( segments: ResolvedSegment[] ): string {
	return JSON.stringify(
		segments.map( ( segment ) => [ segment.text, segment.language ] )
	);
}

/**
 * SHA-256 of the resolved segments, as lowercase hex.
 *
 * This is what the panel compares against `_narration_source_hash` to decide
 * whether the saved audio is still current. It covers the text, the languages
 * and the segment boundaries, so excluding a block, marking a run or fixing a
 * dictionary entry all mark the audio as possibly outdated — which is the truth.
 *
 * @param segments Resolved segments, dictionary already applied.
 */
export async function computeSegmentHash(
	segments: ResolvedSegment[]
): Promise< string > {
	const data = new TextEncoder().encode( serializeSegments( segments ) );
	const digest = await crypto.subtle.digest( 'SHA-256', data );
	return Array.from( new Uint8Array( digest ) )
		.map( ( byte ) => byte.toString( 16 ).padStart( 2, '0' ) )
		.join( '' );
}
