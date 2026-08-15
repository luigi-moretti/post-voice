import { bundleForLocale, DEFAULT_BUNDLE } from '../../editor/site-language';

describe( 'bundleForLocale', () => {
	it.each( [
		[ 'pt_BR', 'portuguese' ],
		[ 'pt_PT', 'portuguese' ],
		[ 'en_US', 'english_2026-04' ],
		[ 'en_GB', 'english_2026-04' ],
		[ 'de_DE', 'german' ],
		[ 'de_CH_informal', 'german' ],
		[ 'it_IT', 'italian' ],
		[ 'es_MX', 'spanish' ],
	] )( 'maps %s to %s', ( locale, expected ) => {
		expect( bundleForLocale( locale ) ).toBe( expected );
	} );

	it( 'falls back to English for a language with no bundle', () => {
		expect( bundleForLocale( 'ja' ) ).toBe( DEFAULT_BUNDLE );
	} );

	it( 'falls back to English for an empty or malformed locale', () => {
		expect( bundleForLocale( '' ) ).toBe( DEFAULT_BUNDLE );
		expect( bundleForLocale( '__' ) ).toBe( DEFAULT_BUNDLE );
	} );

	it( 'accepts a bare language code', () => {
		expect( bundleForLocale( 'es' ) ).toBe( 'spanish' );
	} );
} );
