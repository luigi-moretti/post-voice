import {
	groupByLanguage,
	reassemble,
	withPrimaryLanguage,
} from '../../editor/group-segments';

describe( 'groupByLanguage', () => {
	it( 'puts every segment of a language in one group, keeping its position', () => {
		const groups = groupByLanguage( [
			{ text: 'um', language: 'portuguese' },
			{ text: 'two', language: 'english_2026-04' },
			{ text: 'três', language: 'portuguese' },
		] );

		expect( groups ).toHaveLength( 2 );
		expect( groups[ 0 ] ).toEqual( {
			language: 'portuguese',
			items: [
				{ index: 0, text: 'um' },
				{ index: 2, text: 'três' },
			],
		} );
		expect( groups[ 1 ].items ).toEqual( [ { index: 1, text: 'two' } ] );
	} );

	it( 'orders groups by first appearance, so the first bundle loaded is the one the post opens with', () => {
		const groups = groupByLanguage( [
			{ text: 'two', language: 'english_2026-04' },
			{ text: 'um', language: 'portuguese' },
		] );

		expect( groups.map( ( group ) => group.language ) ).toEqual( [
			'english_2026-04',
			'portuguese',
		] );
	} );

	it( 'returns nothing for no segments', () => {
		expect( groupByLanguage( [] ) ).toEqual( [] );
	} );
} );

describe( 'withPrimaryLanguage', () => {
	it( 'prepends the primary language when every block marked a different one', () => {
		// The all-blocks-marked scenario: a Portuguese-site post where every block
		// carries an explicit `english_2026-04` language, so `groupByLanguage`
		// never produces a group for `portuguese` at all. The server requires the
		// primary language to be one of the languages sent, so leaving it out here
		// would build a payload the endpoint always rejects.
		const groups = groupByLanguage( [
			{ text: 'one', language: 'english_2026-04' },
			{ text: 'two', language: 'english_2026-04' },
		] );

		expect( withPrimaryLanguage( 'portuguese', groups ) ).toEqual( [
			'portuguese',
			'english_2026-04',
		] );
	} );

	it( 'does not duplicate the primary language when it was already spoken', () => {
		const groups = groupByLanguage( [
			{ text: 'um', language: 'portuguese' },
			{ text: 'two', language: 'english_2026-04' },
		] );

		expect( withPrimaryLanguage( 'portuguese', groups ) ).toEqual( [
			'portuguese',
			'english_2026-04',
		] );
	} );

	it( 'lists the primary first even when it was spoken after another language', () => {
		const groups = groupByLanguage( [
			{ text: 'two', language: 'english_2026-04' },
			{ text: 'um', language: 'portuguese' },
		] );

		expect( withPrimaryLanguage( 'portuguese', groups ) ).toEqual( [
			'portuguese',
			'english_2026-04',
		] );
	} );
} );

describe( 'reassemble', () => {
	it( 'restores document order regardless of synthesis order', () => {
		const out = reassemble(
			[
				{ index: 2, audio: Float32Array.from( [ 0.3 ] ) },
				{ index: 0, audio: Float32Array.from( [ 0.1 ] ) },
				{ index: 1, audio: Float32Array.from( [ 0.2 ] ) },
			],
			0
		);

		expect( out ).toEqual( new Float32Array( [ 0.1, 0.2, 0.3 ] ) );
	} );

	it( 'inserts silence between segments', () => {
		const out = reassemble(
			[
				{ index: 0, audio: Float32Array.from( [ 0.1 ] ) },
				{ index: 1, audio: Float32Array.from( [ 0.2 ] ) },
			],
			2
		);

		expect( out ).toEqual( new Float32Array( [ 0.1, 0, 0, 0.2 ] ) );
	} );

	it( 'adds no trailing silence after the last segment', () => {
		const out = reassemble(
			[ { index: 0, audio: Float32Array.from( [ 0.1 ] ) } ],
			2
		);

		expect( out ).toHaveLength( 1 );
	} );

	it( 'allocates exactly once — the output length is the sum of the parts plus the gaps', () => {
		const out = reassemble(
			[
				{ index: 0, audio: new Float32Array( 100 ) },
				{ index: 1, audio: new Float32Array( 50 ) },
			],
			10
		);

		expect( out ).toHaveLength( 160 );
	} );
} );
