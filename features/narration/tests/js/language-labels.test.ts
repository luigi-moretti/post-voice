import { LANGUAGE_LABELS, languageLabel } from '../../editor/language-labels';

describe( 'languageLabel', () => {
	it( 'labels every supported bundle', () => {
		expect( languageLabel( 'english_2026-04' ) ).toBe(
			LANGUAGE_LABELS[ 'english_2026-04' ]
		);
		expect( languageLabel( 'portuguese' ) ).toBe(
			LANGUAGE_LABELS.portuguese
		);
	} );

	it( 'falls back to the bundle identifier when it has no label', () => {
		expect( languageLabel( 'klingon' ) ).toBe( 'klingon' );
	} );
} );
