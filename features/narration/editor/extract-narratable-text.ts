const ELIGIBLE_BLOCK_NAMES = new Set( [
	'core/paragraph',
	'core/heading',
	'core/list',
	'core/list-item',
	'core/quote',
] );

export interface EditorBlock {
	name: string;
	attributes: Record< string, unknown >;
	innerBlocks: EditorBlock[];
}

/**
 * The handful of named entities WordPress actually emits. Numeric entities cover
 * the rest — `wptexturize()` produces those for typographic characters.
 */
const NAMED_ENTITIES: Record< string, string > = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	hellip: '…',
	mdash: '—',
	ndash: '–',
	lsquo: '‘',
	rsquo: '’',
	ldquo: '“',
	rdquo: '”',
};

/**
 * Decode HTML entities to the characters they represent.
 *
 * Without this the TTS engine receives literal entity text and reads it aloud —
 * "Tom &amp; Jerry" becomes "Tom ampersand a-m-p semicolon Jerry". This is not an
 * edge case: WordPress escapes every `&` in saved block content, and
 * `wptexturize()` rewrites straight quotes as `&#8217;`, so most real posts
 * contain entities.
 * @param text
 */
function decodeEntities( text: string ): string {
	return text
		.replace( /&#x([0-9a-f]+);/gi, ( _match, hex ) =>
			String.fromCodePoint( Number.parseInt( hex, 16 ) )
		)
		.replace( /&#(\d+);/g, ( _match, dec ) =>
			String.fromCodePoint( Number.parseInt( dec, 10 ) )
		)
		.replace(
			/&([a-z]+);/gi,
			( match, name ) => NAMED_ENTITIES[ name.toLowerCase() ] ?? match
		);
}

/**
 * Strip tags first, then decode entities — never the reverse. Decoding first
 * would turn `&lt;script&gt;` into a real tag that the tag-stripper then eats,
 * silently deleting text the author wrote.
 * @param html
 */
function stripHtml( html: string ): string {
	return decodeEntities( html.replace( /<[^>]*>/g, '' ) ).trim();
}

/**
 * Block content is usually a string, but WordPress can hand back a `RichTextData`
 * instance for rich-text attributes. Coercing rather than type-guarding avoids
 * silently dropping a whole paragraph from both the narration and the source hash.
 * @param content
 */
function contentToString( content: unknown ): string {
	if ( typeof content === 'string' ) {
		return content;
	}
	if ( content === null || content === undefined ) {
		return '';
	}
	return String( content );
}

function extractBlockText( block: EditorBlock ): string {
	const parts: string[] = [];

	if ( ELIGIBLE_BLOCK_NAMES.has( block.name ) ) {
		const content = contentToString( block.attributes?.content );
		if ( content.trim() ) {
			const text = stripHtml( content );
			if ( text ) {
				parts.push( text );
			}
		}
	}

	for ( const inner of block.innerBlocks ?? [] ) {
		const innerText = extractBlockText( inner );
		if ( innerText ) {
			parts.push( innerText );
		}
	}

	return parts.join( ' ' );
}

export function extractNarratableText( blocks: EditorBlock[] ): string {
	return blocks
		.map( extractBlockText )
		.filter( Boolean )
		.join( ' ' )
		.replace( /\s+/g, ' ' )
		.trim();
}
