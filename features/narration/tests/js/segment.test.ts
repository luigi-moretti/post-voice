import {
	mergeAdjacent,
	resolveSegments,
	unknownLanguages,
} from '../../editor/segment';

describe( 'resolveSegments', () => {
	it( 'fills a null language with the post default', () => {
		expect(
			resolveSegments( [ { text: 'olá', language: null } ], 'portuguese' )
		).toEqual( [ { text: 'olá', language: 'portuguese' } ] );
	} );

	it( 'keeps an explicit language', () => {
		expect(
			resolveSegments(
				[ { text: 'hello', language: 'english_2026-04' } ],
				'portuguese'
			)
		).toEqual( [ { text: 'hello', language: 'english_2026-04' } ] );
	} );

	it( 'falls back to the post default for an unsupported language', () => {
		expect(
			resolveSegments(
				[ { text: 'salve', language: 'latin' } ],
				'portuguese'
			)
		).toEqual( [ { text: 'salve', language: 'portuguese' } ] );
	} );

	it( 'drops a segment that is only whitespace', () => {
		expect(
			resolveSegments(
				[
					{ text: '   ', language: null },
					{ text: 'olá', language: null },
				],
				'portuguese'
			)
		).toEqual( [ { text: 'olá', language: 'portuguese' } ] );
	} );
} );

describe( 'unknownLanguages', () => {
	it( 'lists a marked language with no bundle, once', () => {
		expect(
			unknownLanguages( [
				{ text: 'salve', language: 'latin' },
				{ text: 'iterum', language: 'latin' },
				{ text: 'olá', language: null },
			] )
		).toEqual( [ 'latin' ] );
	} );

	it( 'is empty when everything is supported', () => {
		expect(
			unknownLanguages( [ { text: 'olá', language: 'portuguese' } ] )
		).toEqual( [] );
	} );
} );

describe( 'mergeAdjacent', () => {
	it( 'joins neighbours sharing a language with a single space', () => {
		expect(
			mergeAdjacent( [
				{ text: 'Primeira frase.', language: 'portuguese' },
				{ text: 'Segunda frase.', language: 'portuguese' },
			] )
		).toEqual( [
			{ text: 'Primeira frase. Segunda frase.', language: 'portuguese' },
		] );
	} );

	it( 'keeps a language change as its own segment', () => {
		expect(
			mergeAdjacent( [
				{ text: 'Ele disse:', language: 'portuguese' },
				{ text: 'batteries with wheels', language: 'english_2026-04' },
				{ text: 'e sentou.', language: 'portuguese' },
			] )
		).toHaveLength( 3 );
	} );

	it( 'returns an empty array unchanged', () => {
		expect( mergeAdjacent( [] ) ).toEqual( [] );
	} );
} );
