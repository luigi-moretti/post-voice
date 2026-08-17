import { extractSegments } from '../../editor/extract-segments';
import type { EditorBlock } from '../../editor/segment';

const paragraph = (
	content: string,
	attributes: Record< string, unknown > = {}
): EditorBlock => ( {
	name: 'core/paragraph',
	attributes: { content, ...attributes },
	innerBlocks: [],
} );

describe( 'extractSegments', () => {
	it( 'returns one segment with no language for a plain paragraph', () => {
		expect( extractSegments( [ paragraph( 'A BYD cresceu.' ) ] ) ).toEqual(
			[ { text: 'A BYD cresceu.', language: null } ]
		);
	} );

	it( 'skips a block the author excluded', () => {
		expect(
			extractSegments( [
				paragraph( 'Fica.' ),
				paragraph( 'Sai.', { pvNarrate: false } ),
			] )
		).toEqual( [ { text: 'Fica.', language: null } ] );
	} );

	it( 'carries the block language onto its segments', () => {
		expect(
			extractSegments( [
				paragraph( 'Hello there.', {
					pvLanguage: 'english_2026-04',
				} ),
			] )
		).toEqual( [ { text: 'Hello there.', language: 'english_2026-04' } ] );
	} );

	it( 'splits an inline marked run out of its paragraph', () => {
		expect(
			extractSegments( [
				paragraph(
					'Ele disse <span data-pv-lang="english_2026-04">batteries with wheels</span> e sentou.'
				),
			] )
		).toEqual( [
			{ text: 'Ele disse', language: null },
			{ text: 'batteries with wheels', language: 'english_2026-04' },
			{ text: 'e sentou.', language: null },
		] );
	} );

	it( 'inherits the block language for the unmarked parts around an inline run', () => {
		const segments = extractSegments( [
			paragraph(
				'Hola <span data-pv-lang="portuguese">tudo bem</span> adiós',
				{ pvLanguage: 'spanish' }
			),
		] );
		expect( segments.map( ( s ) => s.language ) ).toEqual( [
			'spanish',
			'portuguese',
			'spanish',
		] );
	} );

	it( 'decodes entities and drops markup', () => {
		expect(
			extractSegments( [ paragraph( 'Tom &amp; Jerry <em>hoje</em>' ) ] )
		).toEqual( [ { text: 'Tom & Jerry hoje', language: null } ] );
	} );

	it( 'ignores blocks that are not narratable at all', () => {
		expect(
			extractSegments( [
				{
					name: 'core/code',
					attributes: { content: 'const a = 1;' },
					innerBlocks: [],
				},
			] )
		).toEqual( [] );
	} );

	it( 'walks inner blocks', () => {
		expect(
			extractSegments( [
				{
					name: 'core/quote',
					attributes: { content: '' },
					innerBlocks: [ paragraph( 'Citado.' ) ],
				},
			] )
		).toEqual( [ { text: 'Citado.', language: null } ] );
	} );

	it( 'excludes inner blocks of an excluded parent', () => {
		expect(
			extractSegments( [
				{
					name: 'core/quote',
					attributes: { content: '', pvNarrate: false },
					innerBlocks: [ paragraph( 'Citado.' ) ],
				},
			] )
		).toEqual( [] );
	} );

	it( 'coerces non-string content with toString method', () => {
		expect(
			extractSegments( [
				{
					name: 'core/paragraph',
					attributes: {
						content: { toString: () => 'From RichTextData' },
					},
					innerBlocks: [],
				},
			] )
		).toEqual( [ { text: 'From RichTextData', language: null } ] );
	} );

	it( 'flattens nested markup inside a marked span', () => {
		expect(
			extractSegments( [
				paragraph(
					'Ele disse <span data-pv-lang="english_2026-04">batteries <em>with</em> wheels</span> e sentou.'
				),
			] )
		).toEqual( [
			{ text: 'Ele disse', language: null },
			{ text: 'batteries with wheels', language: 'english_2026-04' },
			{ text: 'e sentou.', language: null },
		] );
	} );

	it( 'handles a marked span nested inside other inline markup', () => {
		expect(
			extractSegments( [
				paragraph(
					'Ele <strong>disse <span data-pv-lang="english_2026-04">batteries with wheels</span> agora</strong> e sentou.'
				),
			] )
		).toEqual( [
			{ text: 'Ele disse', language: null },
			{ text: 'batteries with wheels', language: 'english_2026-04' },
			{ text: 'agora e sentou.', language: null },
		] );
	} );

	it( 'decodes numeric character entities', () => {
		// U+2019, the right single quotation mark wptexturize() emits for every
		// straight apostrophe. Both sides are escaped so the file stays pure ASCII.
		const entity = 'It&#' + '8217;s here';
		const segments = extractSegments( [ paragraph( entity ) ] );
		expect( segments[ 0 ].text ).toBe(
			'It' + String.fromCharCode( 0x2019 ) + 's here'
		);
	} );

	it( 'decodes named character entities', () => {
		const segments = extractSegments( [ paragraph( 'Caf&eacute;' ) ] );
		expect( segments[ 0 ].text ).toBe(
			'Caf' + String.fromCharCode( 0xe9 )
		);
	} );
} );
