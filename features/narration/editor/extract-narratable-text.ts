const ELIGIBLE_BLOCK_NAMES = new Set( [
  'core/paragraph',
  'core/heading',
  'core/list',
  'core/list-item',
  'core/quote',
] );

export interface EditorBlock {
  name: string;
  attributes: Record<string, unknown>;
  innerBlocks: EditorBlock[];
}

function stripHtml( html: string ): string {
  return html.replace( /<[^>]*>/g, '' ).replace( /&nbsp;/g, ' ' ).trim();
}

function extractBlockText( block: EditorBlock ): string {
  const parts: string[] = [];

  if ( ELIGIBLE_BLOCK_NAMES.has( block.name ) ) {
    const content = block.attributes?.content;
    if ( typeof content === 'string' && content.trim() ) {
      parts.push( stripHtml( content ) );
    }
  }

  for ( const inner of block.innerBlocks ?? [] ) {
    const innerText = extractBlockText( inner );
    if ( innerText ) parts.push( innerText );
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
