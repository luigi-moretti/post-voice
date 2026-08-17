import { applyDictionary } from '../../editor/apply-dictionary';
import type { DictionaryEntry } from '../../editor/dictionary-entry';

const pt = ( term: string, replacement: string ): DictionaryEntry => ( {
	term,
	replacement,
	language: 'portuguese',
} );

describe( 'applyDictionary', () => {
	it( 'replaces a whole word regardless of case', () => {
		const entries = [ pt( 'BYD', 'Bi Iou Di' ) ];
		expect(
			applyDictionary(
				'A byd cresceu. A BYD vendeu.',
				'portuguese',
				entries
			)
		).toBe( 'A Bi Iou Di cresceu. A Bi Iou Di vendeu.' );
	} );

	it( 'leaves the term alone inside a longer word', () => {
		expect(
			applyDictionary( 'embydado e BYDzinho', 'portuguese', [
				pt( 'BYD', 'Bi Iou Di' ),
			] )
		).toBe( 'embydado e BYDzinho' );
	} );

	it( 'treats an accented letter as part of the word', () => {
		expect(
			applyDictionary( 'a ré e o réu', 'portuguese', [
				pt( 'ré', 'rê' ),
			] )
		).toBe( 'a rê e o réu' );
	} );

	it( 'matches a multi-word term', () => {
		expect(
			applyDictionary( 'sobre machine learning hoje', 'portuguese', [
				pt( 'machine learning', 'mérrin lârnin' ),
			] )
		).toBe( 'sobre mérrin lârnin hoje' );
	} );

	it( 'ignores entries belonging to another language', () => {
		const entries = [
			pt( 'BYD', 'Bi Iou Di' ),
			{
				term: 'BYD',
				replacement: 'Bee Why Dee',
				language: 'english_2026-04',
			},
		];
		expect( applyDictionary( 'the BYD', 'english_2026-04', entries ) ).toBe(
			'the Bee Why Dee'
		);
	} );

	it( 'treats a regex metacharacter in the term as literal text', () => {
		expect(
			applyDictionary( 'o C++ e o C', 'portuguese', [
				pt( 'C++', 'cê mais mais' ),
			] )
		).toBe( 'o cê mais mais e o C' );
	} );

	it( 'never re-applies an entry to its own replacement', () => {
		// The replacement contains the term, so a second pass would keep growing it.
		// Deliberately not a single letter: matching is case-insensitive, so a term
		// of "A" would also rewrite every standalone "a" in the text and this test
		// would be about something else.
		expect(
			applyDictionary( 'a BYD hoje', 'portuguese', [
				pt( 'BYD', 'BYD Motors' ),
			] )
		).toBe( 'a BYD Motors hoje' );
	} );

	it( 'returns the text untouched when no entry applies', () => {
		expect( applyDictionary( 'nada aqui', 'portuguese', [] ) ).toBe(
			'nada aqui'
		);
	} );

	it( 'skips invalid entries instead of throwing', () => {
		expect(
			applyDictionary( 'a BYD', 'portuguese', [
				{ term: '', replacement: 'x', language: 'portuguese' },
				pt( 'BYD', 'Bi Iou Di' ),
			] )
		).toBe( 'a Bi Iou Di' );
	} );
} );
