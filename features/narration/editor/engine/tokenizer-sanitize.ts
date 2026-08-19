/**
 * Sanitizes text for pocket-tts's tokenizer.
 *
 * Confirmed by probing the real `tokenizer.model` of all 5 shipped bundles
 * (en/de/it/pt/es) with the same `SentencePieceProcessor` class
 * `pocket-tts.worker.js` uses in production — see
 * `docs/superpowers/specs/2026-08-18-narration-audio-quality-chunking-design.md`,
 * "2026-08-18 (parte C)": curly/low quotes, guillemets and the ellipsis
 * character have no dedicated vocabulary piece in any of the 5 tokenizers.
 * SentencePiece falls back to raw UTF-8 byte tokens for them, and each byte
 * decodes alone to U+FFFD (the replacement character) — the model is being
 * asked to vocalize fragments it was never given a coherent embedding for.
 * Mapping them to their plain-ASCII equivalent keeps the same syntactic role
 * (a quotation still reads as a quotation) using a token the vocabulary
 * actually has.
 *
 * Parentheses, brackets and em/en dashes are a different, unverified bet:
 * they tokenize cleanly (no OOV evidence), so removing them is a prosody
 * guess, not a fix for a confirmed problem. See
 * `docs/superpowers/specs/2026-08-18-narration-punctuation-sanitization-design.md`
 * for the full reasoning and how this is validated by ear before it is kept.
 *
 * Colon (`:`) is a third category, added 2026-08-19: also tokenizes cleanly
 * (no OOV evidence) but reported noisy by ear outside a numeric context.
 * Replaced with a comma, guarded so a time/ratio/chapter:verse colon survives
 * intact — see `replaceColons` below and the dated amendment in the spec
 * above for the `remove_semicolons` bundle precedent this follows.
 *
 * Called only to decide what the tokenizer receives
 * (`tokenizerProcessor.encodeIds(...)` in `pocket-tts.worker.js`) — never in
 * the regex-based split functions (`splitTextIntoSentences`,
 * `splitIntoClauses`, near `NATURAL_BREAK_RE`), which still need the real
 * closing quote/paren characters to decide where to cut. See the comment
 * next to `NATURAL_BREAK_RE` for the other half of this boundary.
 *
 * One exception to "only decides what the tokenizer receives": the raw-token
 * fallback path in `pocket-tts.worker.js` (`splitTokenIdsIntoChunks`, reached
 * from `splitSentenceAtNaturalBreaks`) decodes the *sanitized* token ids back
 * into text via `decodeIds`, and that decoded text becomes real chunk text
 * that is pushed onward. This is harmless — re-sanitizing already-sanitized
 * text is a no-op, the same idempotency property this module's tests cover —
 * but it is a real propagation, not merely a tokenizer-input decision.
 *
 * @param text Raw text, as authored, about to be encoded by the tokenizer.
 */
export function sanitizeForTokenizer( text: string ): string {
	const withDashesHandled = replaceDashes( text );
	const withColonsHandled = replaceColons( withDashesHandled );
	const withBracketsRemoved = withColonsHandled.replace(
		PAREN_BRACKET_RE,
		' '
	);
	const withGlyphsMapped = applyGlyphMap( withBracketsRemoved );
	return withGlyphsMapped.replace( /\s{2,}/g, ' ' ).trim();
}

/**
 * Curly/low quotes, guillemets and the ellipsis character — confirmed
 * byte-fallback (OOV) in all 5 tokenizers, mapped to a clean-token ASCII
 * equivalent that keeps the same syntactic role.
 */
const GLYPH_MAP: Record< string, string > = {
	[ String.fromCharCode( 0x201c ) ]: String.fromCharCode( 0x0022 ), // U+201C to U+0022
	[ String.fromCharCode( 0x201d ) ]: String.fromCharCode( 0x0022 ), // U+201D to U+0022
	[ String.fromCharCode( 0x201e ) ]: String.fromCharCode( 0x0022 ), // U+201E to U+0022
	[ String.fromCharCode( 0x2018 ) ]: String.fromCharCode( 0x0027 ), // U+2018 to U+0027
	[ String.fromCharCode( 0x2019 ) ]: String.fromCharCode( 0x0027 ), // U+2019 to U+0027
	[ String.fromCharCode( 0x201a ) ]: String.fromCharCode( 0x0027 ), // U+201A to U+0027
	[ String.fromCharCode( 0x00ab ) ]: String.fromCharCode( 0x0022 ), // U+00AB to U+0022
	[ String.fromCharCode( 0x00bb ) ]: String.fromCharCode( 0x0022 ), // U+00BB to U+0022
	[ String.fromCharCode( 0x2026 ) ]:
		String.fromCharCode( 0x002e ) +
		String.fromCharCode( 0x002e ) +
		String.fromCharCode( 0x002e ), // U+2026 to three periods
};

function applyGlyphMap( text: string ): string {
	return Object.entries( GLYPH_MAP ).reduce(
		( result, [ glyph, replacement ] ) =>
			result.split( glyph ).join( replacement ),
		text
	);
}

/**
 * Parentheses and square brackets. Replaced with a space, not deleted
 * outright — deleting the bare character merges words when the author left
 * no surrounding space (`"WordPress(WP)"` would otherwise become the
 * nonsense word `"WordPressWP"`). The `\s{2,}` collapse in
 * `sanitizeForTokenizer` cleans up the resulting extra spaces.
 */
const PAREN_BRACKET_RE = /[()[\]]/g;

/**
 * Em dash (U+2014) and en dash (U+2013) only — never the ASCII hyphen
 * (U+002D), which is a different character and is never touched by this
 * module. Replaced with a space, same word-merging reasoning as parens,
 * except when the dash sits between two digits (a numeric range, e.g.
 * `2020–2023`): that dash is left untouched.
 *
 * Runs first, against the untouched input `text`, before any other
 * substitution in `sanitizeForTokenizer` — the ellipsis mapping in
 * `GLYPH_MAP` is the only step in the whole pipeline that changes string
 * length (dash and colon both replace one character with another single
 * character), and the digit guards in this function and in `replaceColons`
 * below must never read an index that step has shifted.
 */
const DASH_RE = /[—–]/g;

// The callback below destructures `offset` positionally as the 2nd argument,
// which is only correct because DASH_RE has no capture groups — with one,
// `replace()` would insert the captured substring there instead, and `offset`
// would silently become that string rather than the numeric match offset.
function replaceDashes( text: string ): string {
	return text.replace( DASH_RE, ( match, offset: number ) => {
		const before = text[ offset - 1 ];
		const after = text[ offset + match.length ];
		const isNumericRange =
			before !== undefined &&
			after !== undefined &&
			/\d/.test( before ) &&
			/\d/.test( after );
		return isNumericRange ? match : ' ';
	} );
}

/**
 * Colon (`:`) — confirmed non-OOV (single dedicated vocab piece, all 5
 * tokenizers), but reported noisy in synthesized audio outside a numeric
 * context. Same category as the `remove_semicolons` flag already shipped in
 * the German bundle (`onnx/german/bundle.json`), applied unconditionally by
 * `prepareTextPrompt()` in `pocket-tts.worker.js`: a punctuation mark can
 * tokenize cleanly and still be under-represented in the model's spoken
 * training data. See the 2026-08-19 amendment in
 * `docs/superpowers/specs/2026-08-18-narration-punctuation-sanitization-design.md`
 * for the full reasoning.
 *
 * Replaced with a comma — not a space — same substitution the German bundle
 * flag already applies to semicolons, and the reason a literal-comma-in-place
 * of colon reads naturally in most prose. Guarded against a numeric context
 * (time `10:30`, ratio `3:2`, chapter:verse reference `3:16`) using the same
 * digit-before/digit-after positional check as `replaceDashes` — replacing
 * those would change the reading (`"10:30"` read as "ten thirty" would become
 * "ten, thirty").
 */
const COLON_RE = /:/g;

// Same footgun as replaceDashes above: the callback destructures `offset`
// positionally as the 2nd argument, which is only correct because COLON_RE
// has no capture groups — with one, `replace()` would insert the captured
// substring there instead, and `offset` would silently become that string
// rather than the numeric match offset.
function replaceColons( text: string ): string {
	return text.replace( COLON_RE, ( match, offset: number ) => {
		const before = text[ offset - 1 ];
		const after = text[ offset + match.length ];
		const isNumericContext =
			before !== undefined &&
			after !== undefined &&
			/\d/.test( before ) &&
			/\d/.test( after );
		return isNumericContext ? match : ',';
	} );
}
