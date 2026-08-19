# Narration Punctuation Sanitization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Pocket TTS worker from feeding the tokenizer punctuation it cannot represent (curly/low quotes, guillemets, ellipsis — confirmed byte-fallback/OOV in all 5 shipped tokenizers) and, separately, try removing parentheses/dashes as an unverified prosody bet — without ever changing what text the split/chunking logic sees.

**Architecture:** One new pure function, `sanitizeForTokenizer(text)`, in its own module (`tokenizer-sanitize.ts`) rather than inline in `pocket-tts.worker.js` — the worker file fires `self.postMessage()` at import time, which is what forces the rest of that file into E2E-only testing, and this function has no such coupling. The worker imports it and wraps every `tokenizerProcessor.encodeIds(...)` call site (6 total) with it; the regex-based split functions (`splitTextIntoSentences`, `splitIntoClauses`) keep reading the original, unsanitized text so the closing-quote/paren split signal from the chunking spec is untouched.

**Tech Stack:** TypeScript (`tokenizer-sanitize.ts`, Jest-tested like the rest of `features/narration/editor/`), vanilla JS (`pocket-tts.worker.js`, unchanged toolchain — webpack/ESLint/tsc all ignore it), Playwright E2E for the integration-level regression check.

**Spec:** `docs/superpowers/specs/2026-08-18-narration-punctuation-sanitization-design.md`

## Global Constraints

- `tokenizer-sanitize.ts` is a normal TypeScript module — it is **not** in the ESLint/Prettier/webpack ignore list the way `pocket-tts.worker.js`/`sentencepiece.js` are. It must pass `npm run lint:js` and `npx tsc --noEmit`, and it is added to `collectCoverageFrom` in `jest.config.js` (≥80% lines, same gate as every other file in that list).
- `pocket-tts.worker.js` itself stays excluded from ESLint/Prettier/tsc (`.eslintrc.js`, `.prettierignore`) — editing it does not run those tools, and its existing style/formatting is not to be "fixed" as a side effect.
- `sanitizeForTokenizer` is called at **all 6** `tokenizerProcessor.encodeIds(...)` call sites in `pocket-tts.worker.js`, and **nowhere else**. In particular, never inside `splitTextIntoSentences()` or `splitIntoClauses()` — those two read the raw text via regex (`SENTENCE_SPLIT_RE`, `NATURAL_BREAK_RE`) to decide where to cut, and a curly closing quote/paren surviving there is the split signal the chunking spec relies on.
- Step order inside `sanitizeForTokenizer` is fixed: dash removal (with the numeric-range digit guard) runs first, against the pristine input, **before** the ellipsis `…`→`...` mapping — that mapping is the only step that changes string length, and the digit guard must never read post-substitution indices. Parens/brackets removal and the glyph map may run in either order relative to each other (disjoint character sets), but both after the dash step.
- ASCII hyphen (`-`, U+002D) is never touched by any step, under any condition. Only the literal glyphs `—` (U+2014) and `–` (U+2013) are in the dash-removal set. This is what keeps Portuguese enclisis/mesoclisis words (`mantenha-se`, `trata-se`, `absteu-se`) intact.
- `CREDITS.md`'s numbered "Modifications made" list under `features/narration/editor/engine/pocket-tts.worker.js` is the Apache-2.0 §4(b) record of record — every change to that vendored file needs an entry there, not just the top-of-file comment (which is a human-readable pointer to it).
- No new E2E fixture. `e2e/narration-audio-quality.spec.ts` (2 scenarios) is the existing integration-level regression check; this plan re-verifies its 12-second duration guard (added in `ffed8a4`) still holds once token counts shrink.
- This plan implements the punctuation-sanitization spec only. It does not touch the chunking work (`2026-08-18-narration-audio-quality-chunking-design.md`), which already shipped.

---

## Task 1: `sanitizeForTokenizer` — pure module, Jest-covered

**Files:**
- Create: `features/narration/editor/engine/tokenizer-sanitize.ts`
- Create: `features/narration/tests/js/tokenizer-sanitize.test.ts`
- Modify: `jest.config.js` (`collectCoverageFrom`)
- Modify: `TESTING.md` (Jest — pure TypeScript section)

**Interfaces:**
- Consumes: nothing — pure string function, no other module in this codebase.
- Produces: `sanitizeForTokenizer(text: string): string`, named export from `features/narration/editor/engine/tokenizer-sanitize.ts`. Task 2 imports this exact name from this exact path.

- [ ] **Step 1: Write the failing test file**

Create `features/narration/tests/js/tokenizer-sanitize.test.ts`:

```ts
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
		expect( sanitizeForTokenizer( '‘' ) ).toBe( "'" );
		expect( sanitizeForTokenizer( '’' ) ).toBe( "'" );
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
		// U+2019, the same glyph Gutenberg's RichText inserts for a typed "it's".
		expect( sanitizeForTokenizer( 'it’s' ) ).toBe( "it's" );
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
		expect(
			sanitizeForTokenizer( 'The plan—a good one—worked.' )
		).toBe( 'The plan a good one worked.' );
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
} );
```

- [ ] **Step 2: Run the test file and confirm it fails**

```bash
npx jest features/narration/tests/js/tokenizer-sanitize.test.ts
```

Expected: FAIL — `Cannot find module '../../editor/engine/tokenizer-sanitize'`.

- [ ] **Step 3: Write the implementation**

Create `features/narration/editor/engine/tokenizer-sanitize.ts`:

```ts
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
 * Called only where text is about to be tokenized
 * (`tokenizerProcessor.encodeIds(...)` in `pocket-tts.worker.js`) — never in
 * the regex-based split functions (`splitTextIntoSentences`,
 * `splitIntoClauses`, near `NATURAL_BREAK_RE`), which still need the real
 * closing quote/paren characters to decide where to cut. See the comment
 * next to `NATURAL_BREAK_RE` for the other half of this boundary.
 *
 * @param text Raw text, as authored, about to be encoded by the tokenizer.
 */
export function sanitizeForTokenizer( text: string ): string {
	const withDashesHandled = replaceDashes( text );
	const withBracketsRemoved = withDashesHandled.replace(
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
	'“': '"', // “ curly double open
	'”': '"', // ” curly double close
	'„': '"', // „ low double open (German-style)
	'‘': "'", // ‘ curly single open
	'’': "'", // ’ curly single close / curly apostrophe
	'‚': "'", // ‚ low single open
	'«': '"', // « guillemet open
	'»': '"', // » guillemet close
	'…': '...', // … ellipsis
};

const GLYPH_RE = new RegExp(
	'[' + Object.keys( GLYPH_MAP ).join( '' ) + ']',
	'g'
);

function applyGlyphMap( text: string ): string {
	return text.replace( GLYPH_RE, ( char ) => GLYPH_MAP[ char ] );
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
 * `GLYPH_MAP` is the only step that changes string length, and the digit
 * guard below must never read an index that step has shifted.
 */
const DASH_RE = /[—–]/g;

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
```

- [ ] **Step 4: Run the test file and confirm it passes**

```bash
npx jest features/narration/tests/js/tokenizer-sanitize.test.ts
```

Expected: PASS (20 tests).

- [ ] **Step 5: Add the new file to the Jest coverage gate**

In `jest.config.js`, `collectCoverageFrom` is an alphabetically-grouped list of pure-logic files under `features/narration/editor/`. Add the new entry after `'features/narration/editor/environment.ts',` (keeping the existing list's order otherwise unchanged):

```js
	collectCoverageFrom: [
		'features/narration/editor/environment.ts',
		'features/narration/editor/extract-segments.ts',
		'features/narration/editor/rtf-calibration.ts',
		'features/narration/editor/segment-hash.ts',
		'features/narration/editor/storage-check.ts',
		'features/narration/editor/mp3-encoder.ts',
		'features/narration/editor/model-source.ts',
		'features/narration/editor/site-language.ts',
		'features/narration/editor/language-labels.ts',
		'features/narration/editor/segment.ts',
		'features/narration/editor/voice-catalog.ts',
		'features/narration/editor/bundle-cache-status.ts',
		'features/narration/editor/group-segments.ts',
		'features/narration/editor/engine/tokenizer-sanitize.ts',
		'features/narration/frontend/player-state.ts',
```

(Only the new line is added; everything else in the array is unchanged.)

- [ ] **Step 6: Run the full coverage gate and confirm it's green**

```bash
npm run test:unit -- --coverage
```

Expected: PASS, ≥80% lines overall, `tokenizer-sanitize.ts` reads at or near 100% given the test file above.

- [ ] **Step 7: Type-check and lint the new file**

```bash
npx tsc --noEmit
npm run lint:js
```

Expected: both PASS. Unlike `pocket-tts.worker.js`, `tokenizer-sanitize.ts` is not in either tool's ignore list.

- [ ] **Step 8: Update `TESTING.md`'s Jest section to name the new file**

`TESTING.md`'s "### Jest — pure TypeScript" section lists every pure-function file this gate measures, in prose. Find:

```
Only pure functions are measured: block filtering, segment extraction and
resolution, segment hashing, dictionary application, RTF/ETA math, the storage
pre-check, the MP3 encoder, the voice catalogue, the WebAssembly detect, the
player state machine, time formatting. The list lives in `jest.config.js` under
`collectCoverageFrom`.
```

Replace with:

```
Only pure functions are measured: block filtering, segment extraction and
resolution, segment hashing, dictionary application, RTF/ETA math, the storage
pre-check, the MP3 encoder, the voice catalogue, the WebAssembly detect, the
player state machine, time formatting, and — as of issue #5's
punctuation-sanitization fix — the text sanitized ahead of the tokenizer
(`tokenizer-sanitize.ts`). The list lives in `jest.config.js` under
`collectCoverageFrom`.
```

- [ ] **Step 9: Commit**

```bash
git add features/narration/editor/engine/tokenizer-sanitize.ts \
        features/narration/tests/js/tokenizer-sanitize.test.ts \
        jest.config.js TESTING.md
git commit -m "feat: add sanitizeForTokenizer, a pure module for tokenizer-safe text

Confirmed by probing the real tokenizer.model of all 5 shipped bundles:
curly/low quotes, guillemets and the ellipsis character have no
dedicated vocab piece — SentencePiece falls back to raw UTF-8 bytes
that individually decode to U+FFFD. Mapped to their plain-ASCII
equivalent instead. Parens/brackets/em-en-dash removal rides along as
an unverified prosody bet, guarded against numeric ranges and never
touching the ASCII hyphen (Portuguese enclisis/mesoclisis words).

Standalone module, not inline in pocket-tts.worker.js: that file fires
self.postMessage() at import time, which is what forces its other
helpers into E2E-only testing. This function has no such coupling, so
it gets a real Jest suite instead.

Part of issue #5. Spec:
docs/superpowers/specs/2026-08-18-narration-punctuation-sanitization-design.md

Claude-Session: https://claude.ai/code/session_012J34gzAmX3j4CLb3zRFcDf"
```

---

## Task 2: Wire `sanitizeForTokenizer` into the worker, verify end to end

**Files:**
- Modify: `features/narration/editor/engine/pocket-tts.worker.js:1-19` (attribution header), `:21-22` (imports), `:485-497` (`NATURAL_BREAK_RE` — cross-reference comment only), `:526`, `:546`, `:577`, `:608`, `:631`, `:949` (the 6 `encodeIds` call sites)
- Modify: `CREDITS.md` (Modifications list under `pocket-tts.worker.js`)

**Interfaces:**
- Consumes: `sanitizeForTokenizer` from `./tokenizer-sanitize` (Task 1).
- Produces: nothing new for later tasks — this is the last task in this plan.

- [ ] **Step 1: Add the import**

In `features/narration/editor/engine/pocket-tts.worker.js`, current lines 21-22:

```js
import { MODEL_BASE_URL } from '../model-source';
import { installModelCache } from './model-cache';
```

become:

```js
import { MODEL_BASE_URL } from '../model-source';
import { installModelCache } from './model-cache';
import { sanitizeForTokenizer } from './tokenizer-sanitize';
```

- [ ] **Step 2: Update the file's attribution header**

Current lines 1-19:

```js
/*
 * Derived from `inference-worker.js` in the Pocket TTS ONNX web demo,
 * licensed Apache-2.0. Modified for Post Voice: model files are fetched from a
 * pinned Hugging Face mirror via MODEL_BASE_URL instead of a relative ./onnx/
 * path, the tokenizer import no longer carries a ?v=3 query string, and the
 * ONNX Runtime CDN import is marked webpackIgnore so the bundler leaves it as a
 * runtime URL, and model files are routed through a Cache API interceptor
 * installed by `installModelCache()` below, because Hugging Face serves them
 * with no Cache-Control at all. See CREDITS.md for full attribution.
 *
 * Also modified: the mimi decoder's state now carries forward across a
 * segment's internal chunks (flow-LM state still resets per chunk — carrying
 * it forward was tried and reverted, see below), the gap between chunks is
 * shorter, and an oversized sentence is split at a punctuation pause instead
 * of a raw token boundary. See
 * docs/superpowers/specs/2026-08-18-narration-audio-quality-chunking-design.md
 * for why — the demo's defaults were tuned for short standalone phrases, not
 * whole posts.
 */
```

Replace with:

```js
/*
 * Derived from `inference-worker.js` in the Pocket TTS ONNX web demo,
 * licensed Apache-2.0. Modified for Post Voice: model files are fetched from a
 * pinned Hugging Face mirror via MODEL_BASE_URL instead of a relative ./onnx/
 * path, the tokenizer import no longer carries a ?v=3 query string, and the
 * ONNX Runtime CDN import is marked webpackIgnore so the bundler leaves it as a
 * runtime URL, and model files are routed through a Cache API interceptor
 * installed by `installModelCache()` below, because Hugging Face serves them
 * with no Cache-Control at all. See CREDITS.md for full attribution.
 *
 * Also modified: the mimi decoder's state now carries forward across a
 * segment's internal chunks (flow-LM state still resets per chunk — carrying
 * it forward was tried and reverted, see below), the gap between chunks is
 * shorter, an oversized sentence is split at a punctuation pause instead of a
 * raw token boundary, and text is run through sanitizeForTokenizer() before
 * every encodeIds() call — the tokenizer has no vocabulary piece for curly
 * quotes/guillemets/ellipsis, and falls back to raw bytes that decode to
 * U+FFFD. See
 * docs/superpowers/specs/2026-08-18-narration-audio-quality-chunking-design.md
 * and
 * docs/superpowers/specs/2026-08-18-narration-punctuation-sanitization-design.md
 * for why — the demo's defaults were tuned for short standalone phrases, not
 * whole posts.
 */
```

- [ ] **Step 3: Add the cross-reference comment next to `NATURAL_BREAK_RE`**

Current lines 485-497:

```js
// Cuts *after* a closing pause mark — comma, colon, semicolon, closing
// paren/bracket, curly closing quote, guillemet — never at an opening one.
// Straight ASCII '"' is deliberately excluded: it is the same glyph for open
// and close, so a single regex cannot tell them apart, and including it cuts
// right after the OPENING quote — worse than the raw-token fallback this
// function replaces. Verified by running this regex against a quoted clause:
// with '"' included, the split landed inside the quotation; without it, the
// whole quoted clause stays intact. Straight quotes surviving into narrated
// text is rare in practice — Gutenberg's RichText converts them to curly
// quotes as the author types, by default — and when one does survive, it
// falls through to the splitTokenIdsIntoChunks() fallback below, same as any
// clause with no usable pause point. No regression either way.
const NATURAL_BREAK_RE = /[^,:;)\]”»]+[,:;)\]”»]+\s*|[^,:;)\]”»]+$/g;
```

Add one paragraph before it, right after the existing comment block (so the constant definition itself doesn't move):

```js
// Cuts *after* a closing pause mark — comma, colon, semicolon, closing
// paren/bracket, curly closing quote, guillemet — never at an opening one.
// Straight ASCII '"' is deliberately excluded: it is the same glyph for open
// and close, so a single regex cannot tell them apart, and including it cuts
// right after the OPENING quote — worse than the raw-token fallback this
// function replaces. Verified by running this regex against a quoted clause:
// with '"' included, the split landed inside the quotation; without it, the
// whole quoted clause stays intact. Straight quotes surviving into narrated
// text is rare in practice — Gutenberg's RichText converts them to curly
// quotes as the author types, by default — and when one does survive, it
// falls through to the splitTokenIdsIntoChunks() fallback below, same as any
// clause with no usable pause point. No regression either way.
//
// This regex reads the RAW text on purpose, curly quote/paren included — it
// is the other half of the boundary tokenizer-sanitize.ts documents:
// splitting decisions use the real characters the author typed;
// sanitizeForTokenizer() only touches what gets handed to encodeIds().
// Normalizing here instead would erase this exact split signal.
const NATURAL_BREAK_RE = /[^,:;)\]”»]+[,:;)\]”»]+\s*|[^,:;)\]”»]+$/g;
```

- [ ] **Step 4: Wrap the 6 `encodeIds` call sites**

All 6 are one-line changes, `encodeIds(x)` → `encodeIds(sanitizeForTokenizer(x))`. Current → new, one at a time:

Line 526, inside `splitSentenceAtNaturalBreaks`:
```js
        return splitTokenIdsIntoChunks(tokenizerProcessor.encodeIds(sentenceText), maxTokens);
```
→
```js
        return splitTokenIdsIntoChunks(tokenizerProcessor.encodeIds(sanitizeForTokenizer(sentenceText)), maxTokens);
```

Line 546, inside `splitIntoClauses`'s candidate measurement:
```js
        const clauseTokenIds = tokenizerProcessor.encodeIds(clause.text);
```
→
```js
        const clauseTokenIds = tokenizerProcessor.encodeIds(sanitizeForTokenizer(clause.text));
```

Line 577, same function, the greedy-packing check:
```js
        const candidateTokens = tokenizerProcessor.encodeIds(candidateText).length;
```
→
```js
        const candidateTokens = tokenizerProcessor.encodeIds(sanitizeForTokenizer(candidateText)).length;
```

Line 608, inside `splitIntoBestSentences`:
```js
        const sentenceTokenIds = tokenizerProcessor.encodeIds(sentenceText);
```
→
```js
        const sentenceTokenIds = tokenizerProcessor.encodeIds(sanitizeForTokenizer(sentenceText));
```

Line 631, same function, the combine check:
```js
        const combinedTokens = tokenizerProcessor.encodeIds(combined).length;
```
→
```js
        const combinedTokens = tokenizerProcessor.encodeIds(sanitizeForTokenizer(combined)).length;
```

Line 949, the final encode before generating audio:
```js
        const tokenIds = tokenizerProcessor.encodeIds(chunkText);
```
→
```js
        const tokenIds = tokenizerProcessor.encodeIds(sanitizeForTokenizer(chunkText));
```

None of these lines' surrounding code changes — `chunkText`, `sentenceText`, `clause.text`, `candidateText`, `combined` all keep carrying the original, unsanitized text everywhere else they're used (chunk reconstruction, logging). Only the argument passed to `encodeIds` changes.

- [ ] **Step 5: Add the `CREDITS.md` entry**

In `CREDITS.md`, the numbered "Modifications made" list under
`features/narration/editor/engine/pocket-tts.worker.js` currently ends at item 8:

```
8. Added `splitSentenceAtNaturalBreaks()`, which splits an oversized sentence at
   a punctuation pause (comma, colon, semicolon, closing bracket/quote) instead
   of a raw token boundary, so a forced cut lands somewhere a speaker would
   actually pause.
```

Add item 9 immediately after it:

```
9. Text is now run through `sanitizeForTokenizer()` (a separate first-party
   module, `tokenizer-sanitize.ts`) before every `encodeIds()` call. The
   tokenizer has no vocabulary piece for curly/low quotes, guillemets or the
   ellipsis character — it falls back to raw UTF-8 bytes that individually
   decode to U+FFFD — so those are mapped to a plain-ASCII equivalent.
   Parentheses, brackets and em/en dashes are also removed, as an unverified
   prosody bet validated by ear, never touching the ASCII hyphen. See
   `docs/superpowers/specs/2026-08-18-narration-punctuation-sanitization-design.md`.
```

- [ ] **Step 6: Build and run the existing audio-quality E2E suite**

```bash
npm run build && npx playwright test e2e/narration-audio-quality.spec.ts
```

Expected: PASS (2 tests), including the 12-second duration-floor assertion
added in `ffed8a4`. If either test now falls under that floor, the
sanitized text is producing measurably fewer tokens per chunk than the
fixture was tuned for — extend `LONG_PARAGRAPH` or
`OVERSIZED_PUNCTUATED_SENTENCE` in `e2e/narration-audio-quality.spec.ts`
with more text (not more punctuation-removal-worthy characters, which
would just make the test measure this change instead of the pipeline)
until the floor holds again. Do not lower the 12-second guard itself —
it exists specifically to catch a truncation regression.

- [ ] **Step 7: Human step — listen to real narration, before/after, note the result for the PR**

Not agent-executable. Generate narration for text containing the
`post=5` pattern (a curly-quoted phrase nested in a parenthetical) and
for a sentence with an em-dash aside, before and after this task's
change, and listen:

1. Confirm the near-repeated-word/odd-pause artifact from `post=5` is
   reduced or gone around the quoted clause.
2. Judge whether removing the parentheses/dashes reads better, the same,
   or worse than keeping them. This half has no tokenizer evidence behind
   it — per the spec, if it doesn't sound clearly better, the plan is to
   revert only the parens/dash removal (keep the glyph-mapping half,
   which does have evidence) and record that as a dated amendment to
   `docs/superpowers/specs/2026-08-18-narration-punctuation-sanitization-design.md`
   before the PR closes.

Note both results in the PR description.

- [ ] **Step 8: Commit**

```bash
git add features/narration/editor/engine/pocket-tts.worker.js CREDITS.md
git commit -m "fix: sanitize text for the tokenizer's vocabulary before encoding

Wraps all 6 tokenizerProcessor.encodeIds() call sites in
pocket-tts.worker.js with sanitizeForTokenizer(). Split-decision code
(splitTextIntoSentences, splitIntoClauses/NATURAL_BREAK_RE) is
untouched and keeps reading the original text — this only changes
what the tokenizer itself receives.

Part of issue #5. Spec:
docs/superpowers/specs/2026-08-18-narration-punctuation-sanitization-design.md

Claude-Session: https://claude.ai/code/session_012J34gzAmX3j4CLb3zRFcDf"
```

---

## After both tasks

Run the full pre-PR gate from `CLAUDE.md` before opening any pull request —
this plan only covers the two tasks above, not the gate itself:

```bash
npm run lint:js
npx tsc --noEmit
composer run lint
composer run stan
npm run test:unit -- --coverage
npm run test:php
npm run test:php:coverage
npm run i18n:check
npm run audit:npm:production && npm run audit:npm && npm run audit:composer
npm run build && npm run test:e2e
```

If anything fails, stop and present correction options per `CLAUDE.md`; do
not weaken a check to get it green. If Step 7's listening verdict on
parens/dash removal is negative, make that revert (and the spec amendment
it requires) before running this gate, not after.
