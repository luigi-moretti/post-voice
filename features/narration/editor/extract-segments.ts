import type { EditorBlock, Segment } from './segment';

const ELIGIBLE_BLOCK_NAMES = new Set( [
	'core/paragraph',
	'core/heading',
	'core/list',
	'core/list-item',
	'core/quote',
] );

/** Attribute the inline format writes onto its span. */
export const INLINE_LANGUAGE_ATTRIBUTE = 'data-pv-lang';

export function isEligibleBlockName( name: string ): boolean {
	return ELIGIBLE_BLOCK_NAMES.has( name );
}

function contentToString( content: unknown ): string {
	if ( typeof content === 'string' ) {
		return content;
	}
	if ( content === null || content === undefined ) {
		return '';
	}
	return String( content );
}

/**
 * Split one block's HTML into segments, honouring inline language spans.
 *
 * Parsed with `DOMParser` rather than the regex the single-language extractor
 * used: that one only had to delete tags, and this one has to keep one. The
 * parser also decodes entities while building the tree, so the old
 * "strip first, decode second" ordering is no longer needed — `textContent`
 * never hands back markup.
 *
 * @param html          Block content.
 * @param blockLanguage Language marked on the block, or `null`.
 */
function segmentsFromHtml(
	html: string,
	blockLanguage: string | null
): Segment[] {
	const parsed = new DOMParser().parseFromString(
		`<body>${ html }</body>`,
		'text/html'
	);

	const segments: Segment[] = [];
	let buffer = '';

	const flush = ( language: string | null ) => {
		if ( buffer.trim() ) {
			segments.push( { text: buffer.trim(), language } );
		}
		buffer = '';
	};

	const walk = ( node: Node ) => {
		for ( const child of Array.from( node.childNodes ) ) {
			if ( child.nodeType === Node.TEXT_NODE ) {
				buffer += child.textContent ?? '';
				continue;
			}
			if ( child.nodeType !== Node.ELEMENT_NODE ) {
				continue;
			}
			const element = child as Element;
			const marked = element.getAttribute( INLINE_LANGUAGE_ATTRIBUTE );
			if ( marked ) {
				flush( blockLanguage );
				segments.push( {
					text: ( element.textContent ?? '' ).trim(),
					language: marked,
				} );
				continue;
			}
			walk( element );
		}
	};

	walk( parsed.body );
	flush( blockLanguage );

	return segments.filter( ( segment ) => segment.text.length > 0 );
}

function segmentsFromBlock( block: EditorBlock ): Segment[] {
	// An excluded block takes its children with it: excluding a quote and still
	// narrating the paragraph inside it would be indistinguishable from a bug.
	if ( block.attributes?.pvNarrate === false ) {
		return [];
	}

	const blockLanguage =
		typeof block.attributes?.pvLanguage === 'string' &&
		block.attributes.pvLanguage
			? ( block.attributes.pvLanguage as string )
			: null;

	const segments: Segment[] = [];

	if ( isEligibleBlockName( block.name ) ) {
		const content = contentToString( block.attributes?.content );
		if ( content.trim() ) {
			segments.push( ...segmentsFromHtml( content, blockLanguage ) );
		}
	}

	for ( const inner of block.innerBlocks ?? [] ) {
		segments.push( ...segmentsFromBlock( inner ) );
	}

	return segments;
}

/**
 * Every narratable run in the post, in document order.
 *
 * @param blocks Top-level blocks from `wp.data`.
 */
export function extractSegments( blocks: EditorBlock[] ): Segment[] {
	return blocks.flatMap( segmentsFromBlock );
}
