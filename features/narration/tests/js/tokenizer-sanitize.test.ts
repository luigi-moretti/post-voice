import { sanitizeForTokenizer } from '../../editor/engine/tokenizer-sanitize';

describe( 'sanitizeForTokenizer — confirmed byte-fallback glyphs (OOV in all 5 tokenizers)', () => {
	it( 'maps curly double quotes to a straight double quote', () => {
		expect( sanitizeForTokenizer( '“' ) ).toBe( '"' );
		expect( sanitizeForTokenizer( '”' ) ).toBe( '"' );
	} );

	it( 'maps low double quote (German-style) to a straight double quote', () => {
		expect( sanitizeForTokenizer( '„' ) ).toBe( '"' );
	} );

	it( 'maps curly single quotes to a straight apostrophe', () => {
		expect( sanitizeForTokenizer( String.fromCharCode( 0x2018 ) ) ).toBe(
			String.fromCharCode( 0x0027 )
		);
		expect( sanitizeForTokenizer( String.fromCharCode( 0x2019 ) ) ).toBe(
			String.fromCharCode( 0x0027 )
		);
	} );

	it( 'maps low single quote to a straight apostrophe', () => {
		expect( sanitizeForTokenizer( '‚' ) ).toBe( "'" );
	} );

	it( 'maps guillemets to a straight double quote', () => {
		expect( sanitizeForTokenizer( '«' ) ).toBe( '"' );
		expect( sanitizeForTokenizer( '»' ) ).toBe( '"' );
	} );

	it( 'maps the ellipsis character to three ASCII periods', () => {
		expect( sanitizeForTokenizer( '…' ) ).toBe( '...' );
	} );

	it( 'keeps a contraction readable when Gutenberg curls the apostrophe', () => {
		// U+2019, the same glyph Gutenberg’s RichText inserts for a typed "it’s".
		expect(
			sanitizeForTokenizer( 'it' + String.fromCharCode( 0x2019 ) + 's' )
		).toBe( 'it' + String.fromCharCode( 0x0027 ) + 's' );
	} );
} );

describe( 'sanitizeForTokenizer — parentheses/brackets removal (unverified prosody bet)', () => {
	it( 'removes parens with surrounding spaces without leaving a double space', () => {
		expect( sanitizeForTokenizer( 'WordPress (WP) powers it.' ) ).toBe(
			'WordPress WP powers it.'
		);
	} );

	it( 'removes parens with no surrounding space without merging the words', () => {
		expect( sanitizeForTokenizer( 'WordPress(WP) powers it.' ) ).toBe(
			'WordPress WP powers it.'
		);
	} );

	it( 'removes a bracketed footnote marker, leaving the number loose — accepted, not fixed', () => {
		expect( sanitizeForTokenizer( 'the fact[1].' ) ).toBe( 'the fact 1 .' );
	} );

	it( 'removes bracketed citation text the same way', () => {
		expect(
			sanitizeForTokenizer( 'the fact [citation needed] here.' )
		).toBe( 'the fact citation needed here.' );
	} );
} );

describe( 'sanitizeForTokenizer — dash removal, with the numeric-range guard', () => {
	it( 'removes an em/en dash aside with spaces around it', () => {
		expect(
			sanitizeForTokenizer( 'The plan — a good one — worked.' )
		).toBe( 'The plan a good one worked.' );
	} );

	it( 'removes an em/en dash aside with no spaces around it', () => {
		expect( sanitizeForTokenizer( 'The plan—a good one—worked.' ) ).toBe(
			'The plan a good one worked.'
		);
	} );

	it( 'keeps an en dash intact when it is a numeric range', () => {
		expect( sanitizeForTokenizer( 'Figures for 2020–2023 rose.' ) ).toBe(
			'Figures for 2020–2023 rose.'
		);
	} );

	it( 'keeps a numeric-range dash intact at the end of the string', () => {
		expect( sanitizeForTokenizer( 'Figures for 2020–2023.' ) ).toBe(
			'Figures for 2020–2023.'
		);
	} );

	it( 'never touches the ASCII hyphen in Portuguese enclisis/mesoclisis', () => {
		expect( sanitizeForTokenizer( 'mantenha-se firme.' ) ).toBe(
			'mantenha-se firme.'
		);
		expect( sanitizeForTokenizer( 'trata-se de um teste.' ) ).toBe(
			'trata-se de um teste.'
		);
		expect( sanitizeForTokenizer( 'absteu-se de votar.' ) ).toBe(
			'absteu-se de votar.'
		);
	} );
} );

describe( 'sanitizeForTokenizer — colon replacement, with the numeric-context guard', () => {
	it( 'replaces a list-header colon with a comma', () => {
		expect( sanitizeForTokenizer( 'Ingredients: sugar, flour.' ) ).toBe(
			'Ingredients, sugar, flour.'
		);
	} );

	it( 'replaces a colon with no space around it', () => {
		expect( sanitizeForTokenizer( 'Note:important.' ) ).toBe(
			'Note,important.'
		);
	} );

	it( 'keeps a colon intact in a time expression', () => {
		expect( sanitizeForTokenizer( 'The train leaves at 10:30.' ) ).toBe(
			'The train leaves at 10:30.'
		);
	} );

	it( 'keeps a colon intact in a numeric ratio', () => {
		expect( sanitizeForTokenizer( 'Mix it 3:2 and stir.' ) ).toBe(
			'Mix it 3:2 and stir.'
		);
	} );

	it( 'keeps a colon intact in a chapter:verse reference', () => {
		expect( sanitizeForTokenizer( 'Quoted John 3:16 from memory.' ) ).toBe(
			'Quoted John 3:16 from memory.'
		);
	} );

	it( 'keeps a numeric-context colon intact at the end of the string', () => {
		expect( sanitizeForTokenizer( 'Figures for 10:30.' ) ).toBe(
			'Figures for 10:30.'
		);
	} );

	it( 'replaces a colon with a digit on only one side', () => {
		// Digit before, non-digit after: not a time/ratio/reference, so the
		// guard must not treat this as numeric context.
		expect( sanitizeForTokenizer( 'At step 3: go.' ) ).toBe(
			'At step 3, go.'
		);
		// Non-digit before, digit after: same guard, other side.
		expect( sanitizeForTokenizer( 'Answer: 42.' ) ).toBe( 'Answer, 42.' );
	} );

	it( 'handles multiple colons in one string independently', () => {
		expect(
			sanitizeForTokenizer( 'See 3:16-3:18, then note: done.' )
		).toBe( 'See 3:16-3:18, then note, done.' );
	} );
} );

describe( 'sanitizeForTokenizer — edges and the combined real-world case', () => {
	it( 'returns an empty string unchanged', () => {
		expect( sanitizeForTokenizer( '' ) ).toBe( '' );
	} );

	it( 'collapses a string made only of removed characters to empty', () => {
		expect( sanitizeForTokenizer( '()[]' ) ).toBe( '' );
		expect( sanitizeForTokenizer( '—–' ) ).toBe( '' );
	} );

	it( 'leaves text with none of the sanitized characters unchanged', () => {
		const text = 'plain text with no special punctuation';
		expect( sanitizeForTokenizer( text ) ).toBe( text );
	} );

	it( 'handles a curly quote nested inside a parenthetical — the post=5 artifact pattern', () => {
		const input =
			'(the one the reviewer quoted directly as “impossible to sit through”), before finally admitting';
		expect( sanitizeForTokenizer( input ) ).toBe(
			'the one the reviewer quoted directly as "impossible to sit through" , before finally admitting'
		);
	} );

	it( 'handles a colon-introduced clause alongside a curly quote', () => {
		const input = 'The reviewer said: “impossible to sit through”.';
		expect( sanitizeForTokenizer( input ) ).toBe(
			'The reviewer said, "impossible to sit through".'
		);
	} );
} );
