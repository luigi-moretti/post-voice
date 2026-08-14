import {
	isValidEntry,
	mergeDictionaries,
	MAX_TERM_LENGTH,
} from '../../editor/dictionary-entry';

describe( 'isValidEntry', () => {
	it( 'accepts a complete entry in a supported language', () => {
		expect(
			isValidEntry( {
				term: 'BYD',
				replacement: 'Bi Iou Di',
				language: 'portuguese',
			} )
		).toBe( true );
	} );

	it( 'rejects an empty term', () => {
		expect(
			isValidEntry( {
				term: '  ',
				replacement: 'Bi Iou Di',
				language: 'portuguese',
			} )
		).toBe( false );
	} );

	it( 'rejects an empty replacement — dropping text is what block exclusion is for', () => {
		expect(
			isValidEntry( {
				term: 'BYD',
				replacement: '',
				language: 'portuguese',
			} )
		).toBe( false );
	} );

	it( 'rejects an unsupported language', () => {
		expect(
			isValidEntry( {
				term: 'BYD',
				replacement: 'Bi Iou Di',
				language: 'klingon',
			} )
		).toBe( false );
	} );

	it( 'rejects a term over the cap', () => {
		expect(
			isValidEntry( {
				term: 'a'.repeat( MAX_TERM_LENGTH + 1 ),
				replacement: 'b',
				language: 'portuguese',
			} )
		).toBe( false );
	} );

	it( 'rejects a non-object', () => {
		expect( isValidEntry( 'BYD' ) ).toBe( false );
		expect( isValidEntry( null ) ).toBe( false );
	} );
} );

describe( 'mergeDictionaries', () => {
	const global = [
		{ term: 'BYD', replacement: 'Bi Iou Di', language: 'portuguese' },
		{ term: 'ONNX', replacement: 'ó-nex', language: 'portuguese' },
	];

	it( 'lets a post entry win over the global one for the same term and language', () => {
		const merged = mergeDictionaries( global, [
			{ term: 'BYD', replacement: 'B Y D', language: 'portuguese' },
		] );
		expect( merged ).toContainEqual( {
			term: 'BYD',
			replacement: 'B Y D',
			language: 'portuguese',
		} );
		expect( merged ).not.toContainEqual( {
			term: 'BYD',
			replacement: 'Bi Iou Di',
			language: 'portuguese',
		} );
	} );

	it( 'keeps the global entry when the post overrides the same term in another language', () => {
		const merged = mergeDictionaries( global, [
			{
				term: 'BYD',
				replacement: 'Bee Why Dee',
				language: 'english_2026-04',
			},
		] );
		expect( merged ).toHaveLength( 3 );
	} );

	it( 'matches the term case-insensitively when deciding precedence', () => {
		const merged = mergeDictionaries( global, [
			{ term: 'byd', replacement: 'B Y D', language: 'portuguese' },
		] );
		expect( merged ).toHaveLength( 2 );
	} );

	it( 'drops invalid entries from either side', () => {
		const merged = mergeDictionaries(
			[
				...global,
				{ term: '', replacement: 'x', language: 'portuguese' },
			],
			[ { term: 'X', replacement: '', language: 'portuguese' } ]
		);
		expect( merged ).toHaveLength( 2 );
	} );
} );
