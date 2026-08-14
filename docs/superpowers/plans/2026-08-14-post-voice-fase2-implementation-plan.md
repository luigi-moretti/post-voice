# Post Voice Fase 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an author exclude blocks from a narration, read a block or an inline run in another language, and correct pronunciation through a dictionary — still producing exactly one MP3 per post, generated entirely in the browser.

**Architecture:** The narration pipeline stops passing a single string around and starts passing `Segment[]` (`{ text, language }`). Four pure stages — extract, apply dictionary, hash, group by language — each testable in Jest without a Worker or ONNX. The engine gains `generateSegments()`, which loads one bundle per language group instead of one per segment. PHP keeps only orchestrating: it sanitises and stores the dictionary, validates the languages it is handed, and records meta.

**Tech Stack:** TypeScript + React (`@wordpress/scripts`, `@wordpress/components`, `@wordpress/rich-text`), vanilla TS for the admin screen, PHP 8.2 (WordPress 6.6+), Jest, PHPUnit, Playwright.

**Spec of record:** [`docs/superpowers/specs/2026-08-14-post-voice-fase2-design.md`](../specs/2026-08-14-post-voice-fase2-design.md). Where this plan and the spec disagree, the spec wins — amend it with a dated section rather than letting them drift.

## Global Constraints

- **PHP 8.2+, WordPress 6.6+.** Never raise or lower either floor as a side effect.
- **PHP class prefix `Post_Voice_`**, one class per file, filenames `class-*.php`, `declare(strict_types=1)`, WPCS clean, PHPStan clean.
- **Feature-based layout:** `features/<feature>/{php,editor,frontend,admin,tests}/`. Code moves to `shared/` only when a second feature actually needs it — this phase creates no `shared/` files.
- **REST namespace `post-voice/v1`.** Every value the endpoint accepts is validated server-side even when the UI already constrains it.
- **i18n:** every user-facing string through `__()`/`_x()` with text domain `post-voice`. Regenerate the `.pot` with `npm run i18n:pot` whenever strings change; `npm run i18n:check` enforces it. The one deliberate exception stays `SAMPLE_TEXTS` in `voice-catalog.ts`. Dictionary content is user data, never translated.
- **Tests:** pure TypeScript gets Jest; every PHPUnit test class carries one `@covers`; anything touching the Worker, ONNX or a real browser gets an E2E scenario instead of a mock.
- **Coverage gates, unchanged:** 80% lines for pure TS (`npm run test:unit -- --coverage`), 85% lines for PHP (`npm run test:php:coverage`). Every new pure TS file must be added to `collectCoverageFrom` in `jest.config.js` in the same task that creates it.
- **Dependencies:** `npm ci`, never `npm install`. This phase adds **no** new npm or Composer dependency.
- **Never change contract-like pins:** `MODEL_BASE_URL`'s commit SHA, the WordPress and PHP minimums.
- **Never `--no-verify`**, never weaken a gate to get a commit through.
- **PHP edits not showing up in the browser:** run `npm run refresh:php` (the container serves a stale copy otherwise).
- **Bundle size constant:** ~199 MB per language. `LANGUAGE_BUNDLE_BYTES` currently says `190 * 1024 * 1024` and is corrected in Task 8.
- **Commit style:** Conventional Commits, imperative subject, body explaining *why* when it is not obvious.

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `features/pronunciation/editor/apply-dictionary.ts` | Pure: apply dictionary entries to one segment's text, per language |
| `features/pronunciation/editor/dictionary-entry.ts` | Pure: the `DictionaryEntry` type, validation and post-over-global merge |
| `features/pronunciation/editor/dictionary-panel.tsx` | React: the post's dictionary table inside the narration panel |
| `features/pronunciation/admin/settings.ts` | Vanilla TS: add/remove rows on the site settings screen |
| `features/pronunciation/php/class-dictionary-store.php` | Sanitisation, validation and caps for both option and meta |
| `features/pronunciation/php/class-settings-page.php` | `Configurações → Narração` screen, option registration, enqueue |
| `features/pronunciation/tests/js/apply-dictionary.test.ts` | Jest |
| `features/pronunciation/tests/js/dictionary-entry.test.ts` | Jest |
| `features/pronunciation/tests/php/test-dictionary-store.php` | PHPUnit |
| `features/pronunciation/tests/php/test-settings-page.php` | PHPUnit |
| `features/narration/editor/segment.ts` | Pure: `Segment` type, resolution and neighbour merging |
| `features/narration/editor/extract-segments.ts` | Pure: blocks → `Segment[]` via `DOMParser` |
| `features/narration/editor/segment-hash.ts` | Pure: canonical serialisation + SHA-256 |
| `features/narration/editor/group-segments.ts` | Pure: group by language, preserve reassembly order |
| `features/narration/editor/site-language.ts` | Pure: WP locale → model bundle |
| `features/narration/editor/bundle-cache-status.ts` | Which bundles are already in Cache Storage |
| `features/narration/editor/block-narration-attributes.ts` | Block attributes + `InspectorControls` |
| `features/narration/editor/inline-language-format.ts` | `registerFormatType` for the inline run |
| `features/narration/tests/js/*.test.ts` | Jest, one file per pure module above |
| `features/narration/tests/js/segment-pipeline-perf.test.ts` | The 50 ms ceiling |
| `e2e/narration-fase2.spec.ts` | Playwright scenarios for this phase |

**Modified**

| File | Change |
|---|---|
| `features/narration/editor/extract-narratable-text.ts` | Keeps `extractNarratableText` (used by nothing after Task 13 — deleted there) |
| `features/narration/editor/engine/tts-engine.ts` | Adds `generateSegments()` |
| `features/narration/editor/storage-check.ts` | 199 MB constant, multi-bundle sum |
| `features/narration/editor/rtf-calibration.ts` | Per-bundle ETA sum + download time |
| `features/narration/editor/narration-api.ts` | `saveNarration` takes `languages` |
| `features/narration/editor/index.tsx` | Wires segments, debounce, guards, status card |
| `features/narration/php/class-post-meta.php` | `_narration_languages`, `_narration_dictionary` |
| `features/narration/php/class-rest-api.php` | Validates `languages` |
| `features/narration/php/class-assets.php` | Localises site language + global dictionary |
| `post-voice.php` | Requires and registers the two new PHP classes |
| `webpack.config.js` | New `dictionary-admin` entry |
| `jest.config.js` | New files in `collectCoverageFrom` |

## Execution Order

Three blocks, cheapest and least risky first. Each block ends with software that works and is testable on its own.

- **Block A — dictionary (Tasks 1-6).** Text in, text out. Touches no audio code.
- **Block B — segments and block marking (Tasks 7-12).** Changes what gets narrated; still one language per post at synthesis time.
- **Block C — multi-language synthesis (Tasks 13-18).** The expensive, risky part.

---

## Block A — Pronunciation dictionary

### Task 1: The dictionary entry type and merge rules

**Files:**
- Create: `features/pronunciation/editor/dictionary-entry.ts`
- Test: `features/pronunciation/tests/js/dictionary-entry.test.ts`
- Modify: `jest.config.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface DictionaryEntry { term: string; replacement: string; language: string }`; `MAX_ENTRIES = 200`; `MAX_TERM_LENGTH = 100`; `MAX_REPLACEMENT_LENGTH = 200`; `isValidEntry( value: unknown ): value is DictionaryEntry`; `mergeDictionaries( global: DictionaryEntry[], post: DictionaryEntry[] ): DictionaryEntry[]`.

- [ ] **Step 1: Write the failing test**

Create `features/pronunciation/tests/js/dictionary-entry.test.ts`:

```ts
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
			[ ...global, { term: '', replacement: 'x', language: 'portuguese' } ],
			[ { term: 'X', replacement: '', language: 'portuguese' } ]
		);
		expect( merged ).toHaveLength( 2 );
	} );
} );
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- features/pronunciation/tests/js/dictionary-entry.test.ts`
Expected: FAIL — `Cannot find module '../../editor/dictionary-entry'`.

- [ ] **Step 3: Write the implementation**

Create `features/pronunciation/editor/dictionary-entry.ts`:

```ts
import { SUPPORTED_LANGUAGES } from '../../narration/editor/model-source';

/**
 * One pronunciation correction: read `term` as `replacement`, but only when the
 * segment being synthesised is in `language`.
 *
 * Respelling is phonetic and phonetics belong to the bundle: "Bi Iou Di" read by
 * the English model is not a correction, it is a second mistake.
 */
export interface DictionaryEntry {
	term: string;
	replacement: string;
	language: string;
}

/**
 * Caps, enforced here and again in PHP. The list travels to the editor of
 * everyone who opens a post, so an unbounded option is an unbounded payload.
 */
export const MAX_ENTRIES = 200;
export const MAX_TERM_LENGTH = 100;
export const MAX_REPLACEMENT_LENGTH = 200;

export function isValidEntry( value: unknown ): value is DictionaryEntry {
	if ( typeof value !== 'object' || value === null ) {
		return false;
	}
	const entry = value as Partial< DictionaryEntry >;
	if (
		typeof entry.term !== 'string' ||
		typeof entry.replacement !== 'string' ||
		typeof entry.language !== 'string'
	) {
		return false;
	}
	const term = entry.term.trim();
	const replacement = entry.replacement.trim();
	return (
		term.length > 0 &&
		term.length <= MAX_TERM_LENGTH &&
		// An empty replacement would silently delete the term from the narration.
		// Removing text is what block exclusion does, visibly.
		replacement.length > 0 &&
		replacement.length <= MAX_REPLACEMENT_LENGTH &&
		( SUPPORTED_LANGUAGES as readonly string[] ).includes( entry.language )
	);
}

function keyOf( entry: DictionaryEntry ): string {
	// Matching is case-insensitive, so precedence has to be too — otherwise a post
	// entry for "byd" would sit alongside the global "BYD" and the winner would be
	// decided by array order.
	return `${ entry.language } ${ entry.term.trim().toLowerCase() }`;
}

/**
 * Post entries win over site entries for the same (term, language) pair.
 *
 * @param global Entries from the site option.
 * @param post   Entries from this post's meta.
 */
export function mergeDictionaries(
	global: DictionaryEntry[],
	post: DictionaryEntry[]
): DictionaryEntry[] {
	const merged = new Map< string, DictionaryEntry >();
	for ( const entry of global.filter( isValidEntry ) ) {
		merged.set( keyOf( entry ), entry );
	}
	for ( const entry of post.filter( isValidEntry ) ) {
		merged.set( keyOf( entry ), entry );
	}
	return Array.from( merged.values() ).slice( 0, MAX_ENTRIES );
}
```

- [ ] **Step 4: Add the file to coverage collection**

In `jest.config.js`, add to `collectCoverageFrom`:

```js
		'features/pronunciation/editor/dictionary-entry.ts',
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:unit -- features/pronunciation/tests/js/dictionary-entry.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add features/pronunciation/editor/dictionary-entry.ts \
        features/pronunciation/tests/js/dictionary-entry.test.ts \
        jest.config.js
git commit -m "feat: define the pronunciation dictionary entry and its precedence rules"
```

---

### Task 2: Applying the dictionary to a segment

**Files:**
- Create: `features/pronunciation/editor/apply-dictionary.ts`
- Test: `features/pronunciation/tests/js/apply-dictionary.test.ts`
- Modify: `jest.config.js`

**Interfaces:**
- Consumes: `DictionaryEntry` from Task 1.
- Produces: `applyDictionary( text: string, language: string, entries: DictionaryEntry[] ): string`; `clearDictionaryCache(): void` (tests only).

- [ ] **Step 1: Write the failing test**

Create `features/pronunciation/tests/js/apply-dictionary.test.ts`:

```ts
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
			applyDictionary( 'A byd cresceu. A BYD vendeu.', 'portuguese', entries )
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
			applyDictionary( 'a ré e o réu', 'portuguese', [ pt( 'ré', 'rê' ) ] )
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
			applyDictionary( 'o C++ e o C', 'portuguese', [ pt( 'C++', 'cê mais mais' ) ] )
		).toBe( 'o cê mais mais e o C' );
	} );

	it( 'never re-applies an entry to its own replacement', () => {
		expect(
			applyDictionary( 'a A vira AA', 'portuguese', [ pt( 'A', 'AA' ) ] )
		).toBe( 'a AA vira AA' );
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- features/pronunciation/tests/js/apply-dictionary.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `features/pronunciation/editor/apply-dictionary.ts`:

```ts
import { isValidEntry, type DictionaryEntry } from './dictionary-entry';

/**
 * Compiled alternations, keyed by language and by the identity of the entry
 * array. Recompiling per call would put a regex build on the editor's
 * per-keystroke path, where the whole pipeline has a 50 ms budget.
 */
const cache = new WeakMap< DictionaryEntry[], Map< string, CompiledDictionary > >();

interface CompiledDictionary {
	pattern: RegExp;
	replacements: Map< string, string >;
}

/** Drop the compiled cache. Tests only — production keys on array identity. */
export function clearDictionaryCache(): void {
	// WeakMap has no clear(); replacing the entries array is what invalidates in
	// production, so tests that need a cold cache pass a fresh array literal.
}

function escapeForRegex( term: string ): string {
	return term.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' );
}

/**
 * Word boundary that understands accents.
 *
 * JavaScript's `\b` is defined against `[A-Za-z0-9_]`, so `\bré\b` would happily
 * match the "ré" inside "réu". Lookaround against a Unicode letter class is the
 * portable fix — supported in every browser this plugin targets.
 */
function boundedPattern( terms: string[] ): RegExp {
	const alternation = terms
		// Longest first: with "machine" and "machine learning" both present, the
		// shorter one would otherwise win and leave " learning" unspoken-for.
		.sort( ( a, b ) => b.length - a.length )
		.map( escapeForRegex )
		.join( '|' );
	return new RegExp(
		`(?<![\\p{L}\\p{N}_])(?:${ alternation })(?![\\p{L}\\p{N}_])`,
		'giu'
	);
}

function compile(
	entries: DictionaryEntry[],
	language: string
): CompiledDictionary | null {
	const applicable = entries.filter(
		( entry ) => isValidEntry( entry ) && entry.language === language
	);
	if ( applicable.length === 0 ) {
		return null;
	}
	const replacements = new Map< string, string >();
	for ( const entry of applicable ) {
		replacements.set( entry.term.trim().toLowerCase(), entry.replacement.trim() );
	}
	return {
		pattern: boundedPattern( applicable.map( ( entry ) => entry.term.trim() ) ),
		replacements,
	};
}

function compiledFor(
	entries: DictionaryEntry[],
	language: string
): CompiledDictionary | null {
	let byLanguage = cache.get( entries );
	if ( ! byLanguage ) {
		byLanguage = new Map();
		cache.set( entries, byLanguage );
	}
	if ( ! byLanguage.has( language ) ) {
		const compiled = compile( entries, language );
		if ( compiled ) {
			byLanguage.set( language, compiled );
		} else {
			return null;
		}
	}
	return byLanguage.get( language ) ?? null;
}

/**
 * Apply every entry that belongs to `language` to one segment's text.
 *
 * Single pass over the text: one alternation for the whole dictionary, so a
 * replacement can never be matched again by a later entry.
 *
 * @param text     Segment text, already stripped of markup.
 * @param language Resolved language of that segment.
 * @param entries  Merged dictionary (site entries plus this post's).
 */
export function applyDictionary(
	text: string,
	language: string,
	entries: DictionaryEntry[]
): string {
	const compiled = compiledFor( entries, language );
	if ( ! compiled ) {
		return text;
	}
	return text.replace(
		compiled.pattern,
		( match ) => compiled.replacements.get( match.toLowerCase() ) ?? match
	);
}
```

- [ ] **Step 4: Add the file to coverage collection**

In `jest.config.js`, add to `collectCoverageFrom`:

```js
		'features/pronunciation/editor/apply-dictionary.ts',
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:unit -- features/pronunciation/tests/js`
Expected: PASS, both suites.

- [ ] **Step 6: Commit**

```bash
git add features/pronunciation/editor/apply-dictionary.ts \
        features/pronunciation/tests/js/apply-dictionary.test.ts \
        jest.config.js
git commit -m "feat: apply pronunciation entries to a segment in one pass

Single compiled alternation per language, memoised on the entry array's
identity: the editor recomputes this on every keystroke, and recompiling a
200-term regex there would eat the pipeline's whole budget. Terms are escaped
before they reach the pattern — an entry containing '(' would otherwise throw
for every author who opened the post."
```

---

### Task 3: Server-side dictionary storage

**Files:**
- Create: `features/pronunciation/php/class-dictionary-store.php`
- Test: `features/pronunciation/tests/php/test-dictionary-store.php`

**Interfaces:**
- Consumes: nothing.
- Produces: `Post_Voice_Dictionary_Store::OPTION` (`'post_voice_dictionary'`); `::META` (`'_narration_dictionary'`); `::MAX_ENTRIES` (200); `::MAX_TERM_LENGTH` (100); `::MAX_REPLACEMENT_LENGTH` (200); `::sanitize( $value ): array`; `::get_global(): array`; `::get_for_post( int $post_id ): array`; `::register(): void`.

- [ ] **Step 1: Write the failing test**

Create `features/pronunciation/tests/php/test-dictionary-store.php`:

```php
<?php
/**
 * Dictionary sanitisation tests.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

/**
 * @covers Post_Voice_Dictionary_Store
 */
class Test_Post_Voice_Dictionary_Store extends WP_UnitTestCase {

	public function test_sanitize_keeps_a_complete_entry(): void {
		$result = Post_Voice_Dictionary_Store::sanitize(
			array(
				array(
					'term'        => 'BYD',
					'replacement' => 'Bi Iou Di',
					'language'    => 'portuguese',
				),
			)
		);

		$this->assertSame(
			array(
				array(
					'term'        => 'BYD',
					'replacement' => 'Bi Iou Di',
					'language'    => 'portuguese',
				),
			),
			$result
		);
	}

	public function test_sanitize_drops_an_entry_with_an_unsupported_language(): void {
		$result = Post_Voice_Dictionary_Store::sanitize(
			array(
				array(
					'term'        => 'BYD',
					'replacement' => 'Bi Iou Di',
					'language'    => 'klingon',
				),
			)
		);

		$this->assertSame( array(), $result );
	}

	public function test_sanitize_drops_an_empty_term_or_replacement(): void {
		$result = Post_Voice_Dictionary_Store::sanitize(
			array(
				array(
					'term'        => '   ',
					'replacement' => 'x',
					'language'    => 'portuguese',
				),
				array(
					'term'        => 'BYD',
					'replacement' => '',
					'language'    => 'portuguese',
				),
			)
		);

		$this->assertSame( array(), $result );
	}

	public function test_sanitize_strips_tags_from_both_fields(): void {
		$result = Post_Voice_Dictionary_Store::sanitize(
			array(
				array(
					'term'        => '<b>BYD</b>',
					'replacement' => 'Bi <script>alert(1)</script>Iou Di',
					'language'    => 'portuguese',
				),
			)
		);

		$this->assertSame( 'BYD', $result[0]['term'] );
		$this->assertStringNotContainsString( '<', $result[0]['replacement'] );
	}

	public function test_sanitize_truncates_beyond_the_length_caps(): void {
		$result = Post_Voice_Dictionary_Store::sanitize(
			array(
				array(
					'term'        => str_repeat( 'a', 200 ),
					'replacement' => str_repeat( 'b', 400 ),
					'language'    => 'portuguese',
				),
			)
		);

		$this->assertSame(
			Post_Voice_Dictionary_Store::MAX_TERM_LENGTH,
			strlen( $result[0]['term'] )
		);
		$this->assertSame(
			Post_Voice_Dictionary_Store::MAX_REPLACEMENT_LENGTH,
			strlen( $result[0]['replacement'] )
		);
	}

	public function test_sanitize_caps_the_number_of_entries(): void {
		$entries = array();
		for ( $i = 0; $i < Post_Voice_Dictionary_Store::MAX_ENTRIES + 10; $i++ ) {
			$entries[] = array(
				'term'        => 'termo' . $i,
				'replacement' => 'valor' . $i,
				'language'    => 'portuguese',
			);
		}

		$this->assertCount(
			Post_Voice_Dictionary_Store::MAX_ENTRIES,
			Post_Voice_Dictionary_Store::sanitize( $entries )
		);
	}

	public function test_sanitize_rejects_a_non_array(): void {
		$this->assertSame( array(), Post_Voice_Dictionary_Store::sanitize( 'BYD' ) );
		$this->assertSame( array(), Post_Voice_Dictionary_Store::sanitize( null ) );
	}

	public function test_get_global_returns_the_sanitised_option(): void {
		update_option(
			Post_Voice_Dictionary_Store::OPTION,
			array(
				array(
					'term'        => 'ONNX',
					'replacement' => 'ó-nex',
					'language'    => 'portuguese',
				),
			)
		);

		$this->assertSame( 'ONNX', Post_Voice_Dictionary_Store::get_global()[0]['term'] );
	}

	public function test_get_for_post_returns_an_empty_array_when_unset(): void {
		$post_id = self::factory()->post->create();

		$this->assertSame( array(), Post_Voice_Dictionary_Store::get_for_post( $post_id ) );
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:php -- --filter Test_Post_Voice_Dictionary_Store`
Expected: FAIL — `Class "Post_Voice_Dictionary_Store" not found`.

- [ ] **Step 3: Write the implementation**

Create `features/pronunciation/php/class-dictionary-store.php`:

```php
<?php
/**
 * Pronunciation dictionary storage.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Owns both dictionaries: the site-wide option and the per-post meta.
 *
 * Sanitisation lives here rather than in each caller because the same shape
 * arrives from two directions — a settings form POST and a block editor meta
 * write — and a rule enforced in only one of them is not a rule.
 */
class Post_Voice_Dictionary_Store {

	public const OPTION = 'post_voice_dictionary';
	public const META   = '_narration_dictionary';

	public const MAX_ENTRIES            = 200;
	public const MAX_TERM_LENGTH        = 100;
	public const MAX_REPLACEMENT_LENGTH = 200;

	/**
	 * Coerce anything into a valid list of entries, dropping what cannot be saved.
	 *
	 * Dropping beats erroring: this runs on a settings save and on a meta write,
	 * and a single malformed row should not cost the author the other 199.
	 *
	 * @param mixed $value Raw value from a form post or a meta write.
	 * @return array<int, array{term: string, replacement: string, language: string}>
	 */
	public static function sanitize( $value ): array {
		if ( ! is_array( $value ) ) {
			return array();
		}

		$clean = array();
		foreach ( $value as $entry ) {
			if ( ! is_array( $entry ) ) {
				continue;
			}

			$language = isset( $entry['language'] ) ? (string) $entry['language'] : '';
			if ( ! in_array( $language, Post_Voice_Rest_Api::ALLOWED_LANGUAGES, true ) ) {
				continue;
			}

			$term        = trim( sanitize_text_field( (string) ( $entry['term'] ?? '' ) ) );
			$replacement = trim( sanitize_text_field( (string) ( $entry['replacement'] ?? '' ) ) );

			if ( '' === $term || '' === $replacement ) {
				continue;
			}

			$clean[] = array(
				'term'        => substr( $term, 0, self::MAX_TERM_LENGTH ),
				'replacement' => substr( $replacement, 0, self::MAX_REPLACEMENT_LENGTH ),
				'language'    => $language,
			);

			if ( count( $clean ) >= self::MAX_ENTRIES ) {
				break;
			}
		}

		return $clean;
	}

	/**
	 * Register the per-post meta. The option is registered by the settings page.
	 */
	public static function register(): void {
		register_post_meta(
			'post',
			self::META,
			array(
				'single'            => true,
				'type'              => 'array',
				'show_in_rest'      => array(
					'schema' => array(
						'type'  => 'array',
						'items' => array(
							'type'       => 'object',
							'properties' => array(
								'term'        => array( 'type' => 'string' ),
								'replacement' => array( 'type' => 'string' ),
								'language'    => array( 'type' => 'string' ),
							),
						),
					),
				),
				'sanitize_callback' => array( self::class, 'sanitize' ),
				'auth_callback'     => array( 'Post_Voice_Post_Meta', 'auth_callback' ),
				'default'           => array(),
			)
		);
	}

	/**
	 * The site dictionary, sanitised on the way out.
	 *
	 * Sanitising on read as well as on write costs nothing measurable and covers
	 * a row written directly to the database by a migration or by hand.
	 *
	 * @return array<int, array{term: string, replacement: string, language: string}>
	 */
	public static function get_global(): array {
		return self::sanitize( get_option( self::OPTION, array() ) );
	}

	/**
	 * This post's dictionary.
	 *
	 * @param int $post_id Post to read.
	 * @return array<int, array{term: string, replacement: string, language: string}>
	 */
	public static function get_for_post( int $post_id ): array {
		return self::sanitize( get_post_meta( $post_id, self::META, true ) );
	}
}
```

- [ ] **Step 4: Wire it into the bootstrap**

In `post-voice.php`, add the require next to the others and register the meta inside the existing `init` action:

```php
require_once POST_VOICE_PATH . 'features/pronunciation/php/class-dictionary-store.php';
```

```php
add_action(
	'init',
	static function (): void {
		Post_Voice_Post_Meta::register();
		Post_Voice_Dictionary_Store::register();
	}
);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:php -- --filter Test_Post_Voice_Dictionary_Store`
Expected: PASS, 9 tests.

- [ ] **Step 6: Run the PHP gates**

Run: `composer run lint && composer run stan`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add features/pronunciation/php/class-dictionary-store.php \
        features/pronunciation/tests/php/test-dictionary-store.php \
        post-voice.php
git commit -m "feat: store and sanitise the pronunciation dictionary

One sanitiser for both the site option and the per-post meta: the same shape
arrives from a settings form and from a block editor meta write, and a rule
enforced in only one of them is not a rule. Malformed rows are dropped rather
than rejected wholesale so one bad entry cannot cost the author the other 199."
```

---

### Task 4: The site settings screen

**Files:**
- Create: `features/pronunciation/php/class-settings-page.php`
- Create: `features/pronunciation/admin/settings.ts`
- Test: `features/pronunciation/tests/php/test-settings-page.php`
- Modify: `webpack.config.js`, `post-voice.php`

**Interfaces:**
- Consumes: `Post_Voice_Dictionary_Store` from Task 3.
- Produces: `Post_Voice_Settings_Page::register(): void`; `::MENU_SLUG` (`'post-voice'`); `::render(): void`; build entry `dictionary-admin`.

- [ ] **Step 1: Write the failing test**

Create `features/pronunciation/tests/php/test-settings-page.php`:

```php
<?php
/**
 * Settings screen tests.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

/**
 * @covers Post_Voice_Settings_Page
 */
class Test_Post_Voice_Settings_Page extends WP_UnitTestCase {

	public function test_register_adds_the_options_page_for_an_administrator(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		set_current_screen( 'dashboard' );

		Post_Voice_Settings_Page::register();
		do_action( 'admin_menu' );

		$this->assertNotFalse(
			menu_page_url( Post_Voice_Settings_Page::MENU_SLUG, false )
		);
	}

	public function test_option_is_registered_with_the_store_sanitiser(): void {
		Post_Voice_Settings_Page::register();
		do_action( 'admin_init' );

		$registered = get_registered_settings();

		$this->assertArrayHasKey( Post_Voice_Dictionary_Store::OPTION, $registered );
		$this->assertSame(
			array( 'Post_Voice_Dictionary_Store', 'sanitize' ),
			$registered[ Post_Voice_Dictionary_Store::OPTION ]['sanitize_callback']
		);
	}

	public function test_saving_the_option_runs_the_sanitiser(): void {
		Post_Voice_Settings_Page::register();
		do_action( 'admin_init' );

		update_option(
			Post_Voice_Dictionary_Store::OPTION,
			array(
				array(
					'term'        => 'BYD',
					'replacement' => 'Bi Iou Di',
					'language'    => 'klingon',
				),
			)
		);

		$this->assertSame( array(), Post_Voice_Dictionary_Store::get_global() );
	}

	public function test_render_outputs_the_existing_entries(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		update_option(
			Post_Voice_Dictionary_Store::OPTION,
			array(
				array(
					'term'        => 'ONNX',
					'replacement' => 'ó-nex',
					'language'    => 'portuguese',
				),
			)
		);

		ob_start();
		Post_Voice_Settings_Page::render();
		$html = (string) ob_get_clean();

		$this->assertStringContainsString( 'ONNX', $html );
		$this->assertStringContainsString( 'ó-nex', $html );
	}

	public function test_render_refuses_a_user_without_manage_options(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'author' ) ) );

		ob_start();
		Post_Voice_Settings_Page::render();
		$html = (string) ob_get_clean();

		$this->assertSame( '', $html );
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:php -- --filter Test_Post_Voice_Settings_Page`
Expected: FAIL — class not found.

- [ ] **Step 3: Write the settings page**

Create `features/pronunciation/php/class-settings-page.php`:

```php
<?php
/**
 * Site-wide pronunciation dictionary screen.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * `Settings → Narration`: the site dictionary, plus the home for Fase 3's
 * player styling.
 *
 * A plain settings page rather than the Customizer or Global Styles: the
 * per-site values here are not theme concerns, and tying them to `theme.json`
 * would tie the plugin to whatever the active theme supports.
 */
class Post_Voice_Settings_Page {

	public const MENU_SLUG    = 'post-voice';
	private const OPTION_GROUP = 'post_voice_settings';

	/**
	 * Hook the menu, the setting and the screen's own script.
	 */
	public static function register(): void {
		add_action( 'admin_menu', array( self::class, 'add_page' ) );
		add_action( 'admin_init', array( self::class, 'register_setting' ) );
		add_action( 'admin_enqueue_scripts', array( self::class, 'enqueue' ) );
	}

	/**
	 * Add the options page.
	 */
	public static function add_page(): void {
		add_options_page(
			__( 'Narration', 'post-voice' ),
			__( 'Narration', 'post-voice' ),
			'manage_options',
			self::MENU_SLUG,
			array( self::class, 'render' )
		);
	}

	/**
	 * Register the dictionary option against the store's sanitiser.
	 */
	public static function register_setting(): void {
		register_setting(
			self::OPTION_GROUP,
			Post_Voice_Dictionary_Store::OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( 'Post_Voice_Dictionary_Store', 'sanitize' ),
				'default'           => array(),
			)
		);
	}

	/**
	 * Load the row-editing script, on this screen only.
	 *
	 * @param string $hook_suffix Current admin page.
	 */
	public static function enqueue( $hook_suffix ): void {
		if ( 'settings_page_' . self::MENU_SLUG !== $hook_suffix ) {
			return;
		}

		$asset_file = POST_VOICE_PATH . 'build/dictionary-admin.asset.php';
		if ( ! file_exists( $asset_file ) ) {
			return;
		}
		$asset = require $asset_file;

		wp_enqueue_script(
			'post-voice-dictionary-admin',
			POST_VOICE_URL . 'build/dictionary-admin.js',
			$asset['dependencies'],
			$asset['version'],
			true
		);
		wp_set_script_translations( 'post-voice-dictionary-admin', 'post-voice', POST_VOICE_PATH . 'languages' );
	}

	/**
	 * Render the screen.
	 */
	public static function render(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$entries   = Post_Voice_Dictionary_Store::get_global();
		$languages = Post_Voice_Rest_Api::ALLOWED_LANGUAGES;
		$option    = Post_Voice_Dictionary_Store::OPTION;
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Narration', 'post-voice' ); ?></h1>
			<h2><?php esc_html_e( 'Pronunciation dictionary', 'post-voice' ); ?></h2>
			<p>
				<?php
				esc_html_e(
					'Read a term aloud as something else. Entries apply to the language you choose, because a respelling is phonetic: the same correction read by another language model is a new mistake.',
					'post-voice'
				);
				?>
			</p>
			<form method="post" action="options.php">
				<?php settings_fields( self::OPTION_GROUP ); ?>
				<table class="widefat striped" id="post-voice-dictionary">
					<thead>
						<tr>
							<th scope="col"><?php esc_html_e( 'Term', 'post-voice' ); ?></th>
							<th scope="col"><?php esc_html_e( 'Read as', 'post-voice' ); ?></th>
							<th scope="col"><?php esc_html_e( 'Language', 'post-voice' ); ?></th>
							<th scope="col"><span class="screen-reader-text"><?php esc_html_e( 'Actions', 'post-voice' ); ?></span></th>
						</tr>
					</thead>
					<tbody>
						<?php foreach ( $entries as $index => $entry ) : ?>
						<tr>
							<td>
								<input type="text" name="<?php echo esc_attr( $option . '[' . $index . '][term]' ); ?>"
									value="<?php echo esc_attr( $entry['term'] ); ?>"
									maxlength="<?php echo esc_attr( (string) Post_Voice_Dictionary_Store::MAX_TERM_LENGTH ); ?>"
									aria-label="<?php esc_attr_e( 'Term', 'post-voice' ); ?>" />
							</td>
							<td>
								<input type="text" name="<?php echo esc_attr( $option . '[' . $index . '][replacement]' ); ?>"
									value="<?php echo esc_attr( $entry['replacement'] ); ?>"
									maxlength="<?php echo esc_attr( (string) Post_Voice_Dictionary_Store::MAX_REPLACEMENT_LENGTH ); ?>"
									aria-label="<?php esc_attr_e( 'Read as', 'post-voice' ); ?>" />
							</td>
							<td>
								<select name="<?php echo esc_attr( $option . '[' . $index . '][language]' ); ?>"
									aria-label="<?php esc_attr_e( 'Language', 'post-voice' ); ?>">
									<?php foreach ( $languages as $language ) : ?>
									<option value="<?php echo esc_attr( $language ); ?>" <?php selected( $entry['language'], $language ); ?>>
										<?php echo esc_html( $language ); ?>
									</option>
									<?php endforeach; ?>
								</select>
							</td>
							<td>
								<button type="button" class="button-link post-voice-remove-row">
									<?php esc_html_e( 'Remove', 'post-voice' ); ?>
								</button>
							</td>
						</tr>
						<?php endforeach; ?>
					</tbody>
				</table>
				<p>
					<button type="button" class="button" id="post-voice-add-row"
						data-option="<?php echo esc_attr( $option ); ?>"
						data-next-index="<?php echo esc_attr( (string) count( $entries ) ); ?>"
						data-languages="<?php echo esc_attr( (string) wp_json_encode( $languages ) ); ?>">
						<?php esc_html_e( 'Add entry', 'post-voice' ); ?>
					</button>
				</p>
				<?php submit_button(); ?>
			</form>
		</div>
		<?php
	}
}
```

- [ ] **Step 4: Write the row-editing script**

Create `features/pronunciation/admin/settings.ts`:

```ts
import { __ } from '@wordpress/i18n';

/**
 * Add and remove dictionary rows on the settings screen.
 *
 * Vanilla TS, not React: this screen is a plain WordPress settings form posted
 * to `options.php`, and pulling the editor's React runtime into `wp-admin` for
 * two buttons would be a large dependency for a small job.
 */
function optionRow(
	option: string,
	index: number,
	languages: string[]
): HTMLTableRowElement {
	const row = document.createElement( 'tr' );

	const cell = ( child: HTMLElement ): HTMLTableCellElement => {
		const td = document.createElement( 'td' );
		td.appendChild( child );
		return td;
	};

	const text = ( field: string, label: string, maxLength: number ) => {
		const input = document.createElement( 'input' );
		input.type = 'text';
		input.name = `${ option }[${ index }][${ field }]`;
		input.maxLength = maxLength;
		input.setAttribute( 'aria-label', label );
		return input;
	};

	const select = document.createElement( 'select' );
	select.name = `${ option }[${ index }][language]`;
	select.setAttribute( 'aria-label', __( 'Language', 'post-voice' ) );
	for ( const language of languages ) {
		const optionEl = document.createElement( 'option' );
		optionEl.value = language;
		optionEl.textContent = language;
		select.appendChild( optionEl );
	}

	const remove = document.createElement( 'button' );
	remove.type = 'button';
	remove.className = 'button-link post-voice-remove-row';
	remove.textContent = __( 'Remove', 'post-voice' );

	row.appendChild( cell( text( 'term', __( 'Term', 'post-voice' ), 100 ) ) );
	row.appendChild(
		cell( text( 'replacement', __( 'Read as', 'post-voice' ), 200 ) )
	);
	row.appendChild( cell( select ) );
	row.appendChild( cell( remove ) );
	return row;
}

function init(): void {
	const table = document.getElementById( 'post-voice-dictionary' );
	const addButton = document.getElementById( 'post-voice-add-row' );
	if ( ! table || ! addButton ) {
		return;
	}
	const body = table.querySelector( 'tbody' );
	if ( ! body ) {
		return;
	}

	const option = addButton.dataset.option ?? '';
	const languages: string[] = JSON.parse( addButton.dataset.languages ?? '[]' );
	let nextIndex = Number.parseInt( addButton.dataset.nextIndex ?? '0', 10 );

	addButton.addEventListener( 'click', () => {
		const row = optionRow( option, nextIndex, languages );
		nextIndex += 1;
		body.appendChild( row );
		row.querySelector< HTMLInputElement >( 'input' )?.focus();
	} );

	// Delegated: rows added after load need it too, and re-binding per row would
	// leave the newest row dead until the next page load.
	body.addEventListener( 'click', ( event ) => {
		const target = event.target as HTMLElement;
		if ( ! target.classList.contains( 'post-voice-remove-row' ) ) {
			return;
		}
		target.closest( 'tr' )?.remove();
	} );
}

document.addEventListener( 'DOMContentLoaded', init );
```

- [ ] **Step 5: Add the build entry**

In `webpack.config.js`, add to `entry`:

```js
		'dictionary-admin': path.resolve(
			__dirname,
			'features/pronunciation/admin/settings.ts'
		),
```

- [ ] **Step 6: Wire the class into the bootstrap**

In `post-voice.php`:

```php
require_once POST_VOICE_PATH . 'features/pronunciation/php/class-settings-page.php';
```

```php
Post_Voice_Settings_Page::register();
```

- [ ] **Step 7: Run the tests and the gates**

Run: `npm run test:php -- --filter Test_Post_Voice_Settings_Page && composer run lint && composer run stan && npm run lint:js && npx tsc --noEmit && npm run build`
Expected: PASS and no errors; `build/dictionary-admin.js` exists.

- [ ] **Step 8: Commit**

```bash
git add features/pronunciation/php/class-settings-page.php \
        features/pronunciation/admin/settings.ts \
        features/pronunciation/tests/php/test-settings-page.php \
        webpack.config.js post-voice.php
git commit -m "feat: add the site pronunciation dictionary screen

Settings → Narration, behind manage_options, saving through the store's own
sanitiser. Row editing is vanilla TS: the screen is a plain options.php form,
and pulling the editor's React runtime into wp-admin for two buttons would be a
large dependency for a small job. This is also the screen Fase 3's player
styling will live on."
```

---

### Task 5: Ship both dictionaries to the editor

**Files:**
- Modify: `features/narration/php/class-assets.php`
- Test: `features/narration/tests/php/test-assets.php`

**Interfaces:**
- Consumes: `Post_Voice_Dictionary_Store::get_global()`.
- Produces: the `postVoiceData` JS global, shape `{ dictionary: Entry[], siteLanguage: string }`.

- [ ] **Step 1: Write the failing test**

Append to `features/narration/tests/php/test-assets.php`, inside the existing test class:

```php
	public function test_editor_assets_localise_the_global_dictionary(): void {
		update_option(
			Post_Voice_Dictionary_Store::OPTION,
			array(
				array(
					'term'        => 'BYD',
					'replacement' => 'Bi Iou Di',
					'language'    => 'portuguese',
				),
			)
		);
		set_current_screen( 'post' );

		Post_Voice_Assets::enqueue_editor_assets();
		$data = wp_scripts()->get_data( 'post-voice-editor', 'data' );

		$this->assertIsString( $data );
		$this->assertStringContainsString( 'Bi Iou Di', $data );
	}

	public function test_editor_assets_localise_the_site_language(): void {
		set_current_screen( 'post' );

		Post_Voice_Assets::enqueue_editor_assets();
		$data = wp_scripts()->get_data( 'post-voice-editor', 'data' );

		$this->assertIsString( $data );
		$this->assertStringContainsString( 'siteLanguage', $data );
		$this->assertStringContainsString( get_locale(), $data );
	}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:php -- --filter Test_Post_Voice_Assets`
Expected: FAIL — the two new tests fail, the existing ones pass.

- [ ] **Step 3: Add the localisation**

In `features/narration/php/class-assets.php`, inside `enqueue_editor_assets()`, after `wp_set_script_translations(...)`:

```php
		// The dictionary is read-only in the editor and small by construction
		// (capped at 200 entries), so it rides along with the script rather than
		// costing every panel open a REST round trip. The raw locale travels with
		// it: mapping it to a bundle is the editor's job, and PHP has no business
		// knowing the bundle names.
		wp_localize_script(
			'post-voice-editor',
			'postVoiceData',
			array(
				'dictionary'   => Post_Voice_Dictionary_Store::get_global(),
				'siteLanguage' => get_locale(),
			)
		);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:php -- --filter Test_Post_Voice_Assets`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/narration/php/class-assets.php \
        features/narration/tests/php/test-assets.php
git commit -m "feat: hand the editor the site dictionary and the site locale"
```

---

### Task 6: The post's dictionary in the narration panel

**Files:**
- Create: `features/pronunciation/editor/dictionary-panel.tsx`
- Modify: `features/narration/editor/index.tsx`
- Test: covered by E2E in Task 17 (React glue carries no Jest coverage target — see the spec's coverage table)

**Interfaces:**
- Consumes: `DictionaryEntry`, `mergeDictionaries` (Task 1); meta key `_narration_dictionary` (Task 3); `postVoiceData` (Task 5).
- Produces: `<DictionaryPanel entries={...} onChange={...} />`; `usePostDictionary(): [ DictionaryEntry[], ( next: DictionaryEntry[] ) => void ]`.

- [ ] **Step 1: Write the component**

Create `features/pronunciation/editor/dictionary-panel.tsx`:

```tsx
import {
	Button,
	PanelBody,
	SelectControl,
	TextControl,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { SUPPORTED_LANGUAGES } from '../../narration/editor/model-source';
import {
	MAX_ENTRIES,
	MAX_REPLACEMENT_LENGTH,
	MAX_TERM_LENGTH,
	type DictionaryEntry,
} from './dictionary-entry';

interface DictionaryPanelProps {
	entries: DictionaryEntry[];
	defaultLanguage: string;
	onChange: ( next: DictionaryEntry[] ) => void;
	settingsUrl: string | null;
}

/**
 * The post's own pronunciation entries.
 *
 * Site-wide entries are not editable here: they belong to another capability
 * (`manage_options`) and changing one from a post screen would silently rewrite
 * every other post's narration.
 */
export function DictionaryPanel( {
	entries,
	defaultLanguage,
	onChange,
	settingsUrl,
}: DictionaryPanelProps ) {
	const update = ( index: number, patch: Partial< DictionaryEntry > ) => {
		onChange(
			entries.map( ( entry, i ) =>
				i === index ? { ...entry, ...patch } : entry
			)
		);
	};

	return (
		<PanelBody
			title={ __( 'Pronunciation for this post', 'post-voice' ) }
			initialOpen={ false }
		>
			{ entries.length === 0 && (
				<p>
					{ __(
						'Nothing here yet. Add a term when the narration mispronounces a name or an acronym.',
						'post-voice'
					) }
				</p>
			) }
			{ entries.map( ( entry, index ) => (
				<div
					className="post-voice-dictionary-row"
					key={ `${ index }-${ entry.language }` }
				>
					<TextControl
						label={ __( 'Term', 'post-voice' ) }
						value={ entry.term }
						maxLength={ MAX_TERM_LENGTH }
						onChange={ ( term ) => update( index, { term } ) }
					/>
					<TextControl
						label={ __( 'Read as', 'post-voice' ) }
						value={ entry.replacement }
						maxLength={ MAX_REPLACEMENT_LENGTH }
						onChange={ ( replacement ) =>
							update( index, { replacement } )
						}
					/>
					<SelectControl
						label={ __( 'Language', 'post-voice' ) }
						value={ entry.language }
						options={ SUPPORTED_LANGUAGES.map( ( language ) => ( {
							label: language,
							value: language,
						} ) ) }
						onChange={ ( language ) =>
							update( index, { language } )
						}
					/>
					<Button
						variant="link"
						isDestructive
						onClick={ () =>
							onChange( entries.filter( ( _, i ) => i !== index ) )
						}
					>
						{ __( 'Remove', 'post-voice' ) }
					</Button>
				</div>
			) ) }
			<Button
				variant="secondary"
				disabled={ entries.length >= MAX_ENTRIES }
				onClick={ () =>
					onChange( [
						...entries,
						{
							term: '',
							replacement: '',
							language: defaultLanguage,
						},
					] )
				}
			>
				{ __( 'Add term', 'post-voice' ) }
			</Button>
			{ settingsUrl && (
				<p>
					<a href={ settingsUrl }>
						{ __(
							'Edit the site-wide dictionary',
							'post-voice'
						) }
					</a>
				</p>
			) }
		</PanelBody>
	);
}
```

- [ ] **Step 2: Read and write the meta from the panel**

In `features/narration/editor/index.tsx`, the panel already destructures `meta` from `useSelect` and has a `useDispatch` on the editor store. Add next to the existing meta reads:

```tsx
	const postDictionary = ( meta._narration_dictionary ??
		[] ) as DictionaryEntry[];

	const setPostDictionary = useCallback(
		( next: DictionaryEntry[] ) => {
			editPost( { meta: { _narration_dictionary: next } } );
		},
		[ editPost ]
	);
```

Where `editPost` comes from the editor store dispatch:

```tsx
	const { editPost } = useDispatch( editorStore );
```

- [ ] **Step 3: Render the panel**

Inside the existing `PluginSidebar`, below the status card and above the generation controls:

```tsx
				<DictionaryPanel
					entries={ postDictionary }
					defaultLanguage={ language }
					onChange={ setPostDictionary }
					settingsUrl={
						window.postVoiceData?.canManageOptions
							? 'options-general.php?page=post-voice'
							: null
					}
				/>
```

- [ ] **Step 4: Add `canManageOptions` to the localised data**

In `features/narration/php/class-assets.php`, extend the `wp_localize_script` array:

```php
				'canManageOptions' => current_user_can( 'manage_options' ),
```

And in `features/narration/tests/php/test-assets.php`:

```php
	public function test_editor_assets_report_whether_the_user_manages_options(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		set_current_screen( 'post' );

		Post_Voice_Assets::enqueue_editor_assets();
		$data = wp_scripts()->get_data( 'post-voice-editor', 'data' );

		$this->assertStringContainsString( 'canManageOptions', (string) $data );
	}
```

- [ ] **Step 5: Verify the build and the gates**

Run: `npm run lint:js && npx tsc --noEmit && npm run test:php -- --filter Test_Post_Voice_Assets && npm run build`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add features/pronunciation/editor/dictionary-panel.tsx \
        features/narration/editor/index.tsx \
        features/narration/php/class-assets.php \
        features/narration/tests/php/test-assets.php
git commit -m "feat: let an author correct pronunciation from the post itself

Site entries stay read-only here: they are another capability's data, and
editing one from a post screen would silently rewrite every other post's
narration."
```

---

## Block B — Segments and block marking

### Task 7: The `Segment` type and neighbour merging

**Files:**
- Create: `features/narration/editor/segment.ts`
- Test: `features/narration/tests/js/segment.test.ts`
- Modify: `jest.config.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface Segment { text: string; language: string | null }`; `interface ResolvedSegment { text: string; language: string }`; `resolveSegments( segments: Segment[], defaultLanguage: string ): ResolvedSegment[]`; `mergeAdjacent( segments: ResolvedSegment[] ): ResolvedSegment[]`.

- [ ] **Step 1: Write the failing test**

Create `features/narration/tests/js/segment.test.ts`:

```ts
import { mergeAdjacent, resolveSegments } from '../../editor/segment';

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- features/narration/tests/js/segment.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `features/narration/editor/segment.ts`:

```ts
import { SUPPORTED_LANGUAGES } from './model-source';

/** A run of narratable text, plus the language it should be read in. */
export interface Segment {
	/** Plain text — never markup. */
	text: string;
	/** `null` means "whatever the post's language selector says". */
	language: string | null;
}

/** A segment whose language has been decided. */
export interface ResolvedSegment {
	text: string;
	language: string;
}

/**
 * Turn author intent into synthesis instructions.
 *
 * An unknown language falls back to the post default rather than throwing: the
 * value lives in `post_content`, which survives a plugin downgrade and a
 * hand-edited database, and handing the worker a bundle name that does not exist
 * would fail the whole generation over one stale attribute.
 *
 * @param segments        Extracted segments.
 * @param defaultLanguage The post's language selection.
 */
export function resolveSegments(
	segments: Segment[],
	defaultLanguage: string
): ResolvedSegment[] {
	return segments
		.filter( ( segment ) => segment.text.trim().length > 0 )
		.map( ( segment ) => ( {
			text: segment.text.trim(),
			language:
				segment.language &&
				( SUPPORTED_LANGUAGES as readonly string[] ).includes(
					segment.language
				)
					? segment.language
					: defaultLanguage,
		} ) );
}

/**
 * Fuse neighbours that share a language.
 *
 * Three consecutive sentences in the same language are one utterance; splitting
 * them into three syntheses breaks the prosody at every seam.
 *
 * @param segments Resolved segments in document order.
 */
export function mergeAdjacent( segments: ResolvedSegment[] ): ResolvedSegment[] {
	const merged: ResolvedSegment[] = [];
	for ( const segment of segments ) {
		const previous = merged[ merged.length - 1 ];
		if ( previous && previous.language === segment.language ) {
			previous.text = `${ previous.text } ${ segment.text }`;
			continue;
		}
		merged.push( { ...segment } );
	}
	return merged;
}
```

- [ ] **Step 4: Add to coverage collection**

In `jest.config.js`, add `'features/narration/editor/segment.ts'` to `collectCoverageFrom`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:unit -- features/narration/tests/js/segment.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add features/narration/editor/segment.ts \
        features/narration/tests/js/segment.test.ts jest.config.js
git commit -m "feat: introduce the narration segment and its resolution rules"
```

---

### Task 8: Extracting segments from blocks

**Files:**
- Create: `features/narration/editor/extract-segments.ts`
- Test: `features/narration/tests/js/extract-segments.test.ts`
- Modify: `jest.config.js`

**Interfaces:**
- Consumes: `Segment` (Task 7); `EditorBlock` from `extract-narratable-text.ts`.
- Produces: `extractSegments( blocks: EditorBlock[] ): Segment[]`; `ELIGIBLE_BLOCK_NAMES` re-exported; `INLINE_LANGUAGE_ATTRIBUTE = 'data-pv-lang'`.

- [ ] **Step 1: Write the failing test**

Create `features/narration/tests/js/extract-segments.test.ts`:

```ts
import { extractSegments } from '../../editor/extract-segments';
import type { EditorBlock } from '../../editor/extract-narratable-text';

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
		expect( extractSegments( [ paragraph( 'A BYD cresceu.' ) ] ) ).toEqual( [
			{ text: 'A BYD cresceu.', language: null },
		] );
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
} );
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- features/narration/tests/js/extract-segments.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `features/narration/editor/extract-segments.ts`:

```ts
import type { EditorBlock } from './extract-narratable-text';
import type { Segment } from './segment';

const ELIGIBLE_BLOCK_NAMES = new Set( [
	'core/paragraph',
	'core/heading',
	'core/list',
	'core/list-item',
	'core/quote',
] );

/** Attribute the inline format writes onto its span. */
export const INLINE_LANGUAGE_ATTRIBUTE = 'data-pv-lang';

export function isEligibleBlockName( name: string ): boolean {
	return ELIGIBLE_BLOCK_NAMES.has( name );
}

function contentToString( content: unknown ): string {
	if ( typeof content === 'string' ) {
		return content;
	}
	if ( content === null || content === undefined ) {
		return '';
	}
	return String( content );
}

/**
 * Split one block's HTML into segments, honouring inline language spans.
 *
 * Parsed with `DOMParser` rather than the regex the single-language extractor
 * used: that one only had to delete tags, and this one has to keep one. The
 * parser also decodes entities while building the tree, so the old
 * "strip first, decode second" ordering is no longer needed — `textContent`
 * never hands back markup.
 *
 * @param html          Block content.
 * @param blockLanguage Language marked on the block, or `null`.
 */
function segmentsFromHtml(
	html: string,
	blockLanguage: string | null
): Segment[] {
	const parsed = new DOMParser().parseFromString(
		`<body>${ html }</body>`,
		'text/html'
	);

	const segments: Segment[] = [];
	let buffer = '';

	const flush = ( language: string | null ) => {
		if ( buffer.trim() ) {
			segments.push( { text: buffer.trim(), language } );
		}
		buffer = '';
	};

	const walk = ( node: Node ) => {
		for ( const child of Array.from( node.childNodes ) ) {
			if ( child.nodeType === Node.TEXT_NODE ) {
				buffer += child.textContent ?? '';
				continue;
			}
			if ( child.nodeType !== Node.ELEMENT_NODE ) {
				continue;
			}
			const element = child as Element;
			const marked = element.getAttribute( INLINE_LANGUAGE_ATTRIBUTE );
			if ( marked ) {
				flush( blockLanguage );
				segments.push( {
					text: ( element.textContent ?? '' ).trim(),
					language: marked,
				} );
				continue;
			}
			walk( element );
		}
	};

	walk( parsed.body );
	flush( blockLanguage );

	return segments.filter( ( segment ) => segment.text.length > 0 );
}

function segmentsFromBlock( block: EditorBlock ): Segment[] {
	// An excluded block takes its children with it: excluding a quote and still
	// narrating the paragraph inside it would be indistinguishable from a bug.
	if ( block.attributes?.pvNarrate === false ) {
		return [];
	}

	const blockLanguage =
		typeof block.attributes?.pvLanguage === 'string' &&
		block.attributes.pvLanguage
			? ( block.attributes.pvLanguage as string )
			: null;

	const segments: Segment[] = [];

	if ( isEligibleBlockName( block.name ) ) {
		const content = contentToString( block.attributes?.content );
		if ( content.trim() ) {
			segments.push( ...segmentsFromHtml( content, blockLanguage ) );
		}
	}

	for ( const inner of block.innerBlocks ?? [] ) {
		segments.push( ...segmentsFromBlock( inner ) );
	}

	return segments;
}

/**
 * Every narratable run in the post, in document order.
 *
 * @param blocks Top-level blocks from `wp.data`.
 */
export function extractSegments( blocks: EditorBlock[] ): Segment[] {
	return blocks.flatMap( segmentsFromBlock );
}
```

- [ ] **Step 4: Add to coverage collection**

In `jest.config.js`, add `'features/narration/editor/extract-segments.ts'`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:unit -- features/narration/tests/js/extract-segments.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add features/narration/editor/extract-segments.ts \
        features/narration/tests/js/extract-segments.test.ts jest.config.js
git commit -m "feat: extract narration segments, honouring block and inline marking

DOMParser replaces the tag-stripping regex: the old one only had to delete
markup, this one has to keep one span. Excluding a block excludes its inner
blocks too — narrating the paragraph inside an excluded quote would be
indistinguishable from a bug."
```

---

### Task 9: Hashing the resolved segments

**Files:**
- Create: `features/narration/editor/segment-hash.ts`
- Test: `features/narration/tests/js/segment-hash.test.ts`
- Modify: `jest.config.js`

**Interfaces:**
- Consumes: `ResolvedSegment` (Task 7).
- Produces: `serializeSegments( segments: ResolvedSegment[] ): string`; `computeSegmentHash( segments: ResolvedSegment[] ): Promise< string >`.

- [ ] **Step 1: Write the failing test**

Create `features/narration/tests/js/segment-hash.test.ts`:

```ts
import {
	computeSegmentHash,
	serializeSegments,
} from '../../editor/segment-hash';

describe( 'serializeSegments', () => {
	it( 'writes fields in a fixed order', () => {
		expect(
			serializeSegments( [ { text: 'olá', language: 'portuguese' } ] )
		).toBe( '[["olá","portuguese"]]' );
	} );

	it( 'distinguishes the same text in two languages', () => {
		expect(
			serializeSegments( [ { text: 'no', language: 'portuguese' } ] )
		).not.toBe(
			serializeSegments( [ { text: 'no', language: 'english_2026-04' } ] )
		);
	} );
} );

describe( 'computeSegmentHash', () => {
	it( 'returns a 64-character hex digest', async () => {
		const hash = await computeSegmentHash( [
			{ text: 'olá', language: 'portuguese' },
		] );
		expect( hash ).toMatch( /^[a-f0-9]{64}$/ );
	} );

	it( 'is stable across calls for the same segments', async () => {
		const segments = [ { text: 'olá', language: 'portuguese' } ];
		expect( await computeSegmentHash( segments ) ).toBe(
			await computeSegmentHash( segments )
		);
	} );

	it( 'changes when a segment language changes', async () => {
		expect(
			await computeSegmentHash( [
				{ text: 'olá', language: 'portuguese' },
			] )
		).not.toBe(
			await computeSegmentHash( [
				{ text: 'olá', language: 'spanish' },
			] )
		);
	} );

	it( 'changes when the text changes — including a dictionary substitution', async () => {
		expect(
			await computeSegmentHash( [
				{ text: 'a BYD', language: 'portuguese' },
			] )
		).not.toBe(
			await computeSegmentHash( [
				{ text: 'a Bi Iou Di', language: 'portuguese' },
			] )
		);
	} );

	it( 'changes when segment boundaries move but the joined text does not', async () => {
		expect(
			await computeSegmentHash( [
				{ text: 'um dois', language: 'portuguese' },
			] )
		).not.toBe(
			await computeSegmentHash( [
				{ text: 'um', language: 'portuguese' },
				{ text: 'dois', language: 'portuguese' },
			] )
		);
	} );
} );
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- features/narration/tests/js/segment-hash.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `features/narration/editor/segment-hash.ts`:

```ts
import type { ResolvedSegment } from './segment';

/**
 * Canonical serialisation of what will actually be synthesised.
 *
 * Tuples rather than objects, with a fixed field order: a hash is only useful if
 * the same narration always produces the same string, and object key order is a
 * property of how the object was built.
 *
 * @param segments Resolved segments, dictionary already applied.
 */
export function serializeSegments( segments: ResolvedSegment[] ): string {
	return JSON.stringify(
		segments.map( ( segment ) => [ segment.text, segment.language ] )
	);
}

/**
 * SHA-256 of the resolved segments, as lowercase hex.
 *
 * This is what the panel compares against `_narration_source_hash` to decide
 * whether the saved audio is still current. It covers the text, the languages
 * and the segment boundaries, so excluding a block, marking a run or fixing a
 * dictionary entry all mark the audio as possibly outdated — which is the truth.
 *
 * @param segments Resolved segments, dictionary already applied.
 */
export async function computeSegmentHash(
	segments: ResolvedSegment[]
): Promise< string > {
	const data = new TextEncoder().encode( serializeSegments( segments ) );
	const digest = await crypto.subtle.digest( 'SHA-256', data );
	return Array.from( new Uint8Array( digest ) )
		.map( ( byte ) => byte.toString( 16 ).padStart( 2, '0' ) )
		.join( '' );
}
```

- [ ] **Step 4: Add to coverage collection**

In `jest.config.js`, add `'features/narration/editor/segment-hash.ts'`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:unit -- features/narration/tests/js/segment-hash.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add features/narration/editor/segment-hash.ts \
        features/narration/tests/js/segment-hash.test.ts jest.config.js
git commit -m "feat: hash the resolved segments rather than the raw text

The staleness badge now covers languages, segment boundaries and dictionary
substitutions, so excluding a block or fixing a pronunciation marks the audio as
possibly outdated instead of leaving a green badge over stale audio. Narrations
generated before this phase all read as outdated once — the spec records that as
accepted, since there is no installed base to protect."
```

---

### Task 10: Site locale to model bundle

**Files:**
- Create: `features/narration/editor/site-language.ts`
- Test: `features/narration/tests/js/site-language.test.ts`
- Modify: `jest.config.js`

**Interfaces:**
- Consumes: `SUPPORTED_LANGUAGES` from `model-source.ts`.
- Produces: `bundleForLocale( locale: string ): string`; `DEFAULT_BUNDLE = 'english_2026-04'`.

- [ ] **Step 1: Write the failing test**

Create `features/narration/tests/js/site-language.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- features/narration/tests/js/site-language.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `features/narration/editor/site-language.ts`:

```ts
/**
 * The bundle used when the site's locale has none — and the value the panel
 * opened on before this existed was a hardcoded `portuguese`, which was honest
 * on exactly one site.
 */
export const DEFAULT_BUNDLE = 'english_2026-04';

const BY_LANGUAGE_CODE: Record< string, string > = {
	pt: 'portuguese',
	en: DEFAULT_BUNDLE,
	de: 'german',
	it: 'italian',
	es: 'spanish',
};

/**
 * Map a WordPress locale (`pt_BR`, `de_CH_informal`, `en`) to a model bundle.
 *
 * Only the language subtag matters: the bundles are per language, not per
 * region, and `pt_PT` narrated by the Portuguese bundle is the intended
 * behaviour, not a compromise.
 *
 * @param locale Locale string from `get_locale()`.
 */
export function bundleForLocale( locale: string ): string {
	const code = locale.split( '_' )[ 0 ].toLowerCase();
	return BY_LANGUAGE_CODE[ code ] ?? DEFAULT_BUNDLE;
}
```

- [ ] **Step 4: Add to coverage collection**

In `jest.config.js`, add `'features/narration/editor/site-language.ts'`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:unit -- features/narration/tests/js/site-language.test.ts`
Expected: PASS, 12 assertions across 4 tests.

- [ ] **Step 6: Commit**

```bash
git add features/narration/editor/site-language.ts \
        features/narration/tests/js/site-language.test.ts jest.config.js
git commit -m "feat: derive the default narration language from the site locale"
```

---

### Task 11: Bundle cache status and multi-bundle storage checks

**Files:**
- Create: `features/narration/editor/bundle-cache-status.ts`
- Modify: `features/narration/editor/storage-check.ts`
- Test: `features/narration/tests/js/bundle-cache-status.test.ts`, `features/narration/tests/js/storage-check.test.ts`
- Modify: `jest.config.js`

**Interfaces:**
- Consumes: `MODEL_BASE_URL` from `model-source.ts`.
- Produces: `cachedBundles( languages: string[] ): Promise< Set< string > >`; `LANGUAGE_BUNDLE_BYTES` (corrected to 199 MB); `hasEnoughStorage( estimate, bundleBytes? )` (unchanged signature); `bytesForBundles( count: number ): number`.

- [ ] **Step 1: Write the failing tests**

Create `features/narration/tests/js/bundle-cache-status.test.ts`:

```ts
import { cachedBundles } from '../../editor/bundle-cache-status';

describe( 'cachedBundles', () => {
	afterEach( () => {
		// @ts-expect-error — restoring the global the test replaced.
		delete global.caches;
	} );

	it( 'reports a bundle whose manifest is already cached', async () => {
		const match = jest.fn( async ( url: string ) =>
			url.includes( 'portuguese' ) ? new Response( '{}' ) : undefined
		);
		// @ts-expect-error — minimal CacheStorage stand-in.
		global.caches = { open: async () => ( { match } ) };

		const cached = await cachedBundles( [
			'portuguese',
			'english_2026-04',
		] );

		expect( cached.has( 'portuguese' ) ).toBe( true );
		expect( cached.has( 'english_2026-04' ) ).toBe( false );
	} );

	it( 'reports nothing cached when the Cache API is missing', async () => {
		const cached = await cachedBundles( [ 'portuguese' ] );

		expect( cached.size ).toBe( 0 );
	} );
} );
```

Append to `features/narration/tests/js/storage-check.test.ts`:

```ts
import { bytesForBundles, LANGUAGE_BUNDLE_BYTES } from '../../editor/storage-check';

describe( 'bytesForBundles', () => {
	it( 'is zero when every bundle is already cached', () => {
		expect( bytesForBundles( 0 ) ).toBe( 0 );
	} );

	it( 'scales with the number of bundles still to download', () => {
		expect( bytesForBundles( 2 ) ).toBe( 2 * LANGUAGE_BUNDLE_BYTES );
	} );

	it( 'uses the measured bundle size, not the old estimate', () => {
		expect( LANGUAGE_BUNDLE_BYTES ).toBe( Math.round( 198.6 * 1024 * 1024 ) );
	} );
} );
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:unit -- features/narration/tests/js/bundle-cache-status.test.ts features/narration/tests/js/storage-check.test.ts`
Expected: FAIL — module not found, and `LANGUAGE_BUNDLE_BYTES` still 190 MB.

- [ ] **Step 3: Write the cache-status module**

Create `features/narration/editor/bundle-cache-status.ts`:

```ts
import { MODEL_BASE_URL } from './model-source';

/**
 * Cache name, mirrored from `engine/model-cache.ts`. Duplicated deliberately:
 * importing that module would pull the fetch interceptor into the panel bundle,
 * and this only needs to read.
 */
const CACHE_NAME = 'post-voice-models-v1';

/**
 * Which of these bundles are already downloaded in this browser.
 *
 * Probes `bundle.json`, the first file the worker fetches for a language: it is
 * present exactly when that language was loaded to completion, and it costs a
 * single cache lookup instead of nine.
 *
 * @param languages Bundles to check.
 */
export async function cachedBundles(
	languages: string[]
): Promise< Set< string > > {
	const cached = new Set< string >();
	if ( typeof caches === 'undefined' ) {
		// No secure context, so no Cache API. Reporting "nothing cached" errs
		// towards warning the author about a download that may not happen, which is
		// the safe direction.
		return cached;
	}
	const cache = await caches.open( CACHE_NAME );
	await Promise.all(
		languages.map( async ( language ) => {
			const hit = await cache.match(
				`${ MODEL_BASE_URL }${ language }/bundle.json`
			);
			if ( hit ) {
				cached.add( language );
			}
		} )
	);
	return cached;
}
```

- [ ] **Step 4: Correct the bundle size and add the multi-bundle helper**

In `features/narration/editor/storage-check.ts`, replace the constant and add the helper:

```ts
/**
 * On-disk size of one language bundle, measured against the pinned mirror on
 * 2026-08-14: nine files totalling 198.6 MB, of which `flow_lm_main_int8.onnx`
 * is 76.3 MB and `voices.bin` is 52.4 MB. Nothing is shared between bundles —
 * every language ships its own copy of all nine, the eight voices included.
 */
export const LANGUAGE_BUNDLE_BYTES = Math.round( 198.6 * 1024 * 1024 );

/**
 * Bytes still to download for a generation.
 *
 * @param pendingBundleCount Bundles not yet in the browser's cache.
 */
export function bytesForBundles( pendingBundleCount: number ): number {
	return pendingBundleCount * LANGUAGE_BUNDLE_BYTES;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:unit -- features/narration/tests/js`
Expected: PASS.

- [ ] **Step 6: Add to coverage collection and commit**

In `jest.config.js`, add `'features/narration/editor/bundle-cache-status.ts'`.

```bash
git add features/narration/editor/bundle-cache-status.ts \
        features/narration/editor/storage-check.ts \
        features/narration/tests/js/bundle-cache-status.test.ts \
        features/narration/tests/js/storage-check.test.ts jest.config.js
git commit -m "feat: report which language bundles are already downloaded

Corrects the bundle constant to the measured 198.6MB and sums pending bundles
before a generation, so a post in two languages is checked against ~400MB rather
than 190MB. The panel labels each language with what it will cost."
```

---

### Task 12: Block attributes and the inspector control

**Files:**
- Create: `features/narration/editor/block-narration-attributes.ts`
- Modify: `features/narration/editor/index.tsx` (import for side effects)
- Test: E2E in Task 17 (block editor filters are browser glue, per the spec's coverage table)

**Interfaces:**
- Consumes: `isEligibleBlockName` (Task 8), `cachedBundles` (Task 11), `SUPPORTED_LANGUAGES`.
- Produces: block attributes `pvNarrate: boolean` (default `true`) and `pvLanguage: string` (default `''`); `registerBlockNarrationControls(): void`.

- [ ] **Step 1: Write the module**

Create `features/narration/editor/block-narration-attributes.ts`:

```ts
import { InspectorControls } from '@wordpress/block-editor';
import {
	PanelBody,
	SelectControl,
	ToggleControl,
} from '@wordpress/components';
import { createHigherOrderComponent } from '@wordpress/compose';
import { addFilter } from '@wordpress/hooks';
import { __, sprintf } from '@wordpress/i18n';
import { createElement, Fragment, useEffect, useState } from '@wordpress/element';
import { cachedBundles } from './bundle-cache-status';
import { isEligibleBlockName } from './extract-segments';
import { SUPPORTED_LANGUAGES } from './model-source';
import { LANGUAGE_BUNDLE_BYTES } from './storage-check';
import { formatBytes } from './storage-check';

interface BlockSettings {
	name?: string;
	attributes?: Record< string, unknown >;
}

/**
 * Add the two attributes to every narratable block type.
 *
 * Attributes rather than post meta: they live in `post_content`, so Gutenberg
 * saves, undoes and revisions them for free, and copying a block carries its
 * marking along.
 *
 * @param settings Block type settings.
 * @param name     Block name.
 */
function addAttributes( settings: BlockSettings, name: string ): BlockSettings {
	if ( ! isEligibleBlockName( name ) ) {
		return settings;
	}
	return {
		...settings,
		attributes: {
			...settings.attributes,
			pvNarrate: { type: 'boolean', default: true },
			pvLanguage: { type: 'string', default: '' },
		},
	};
}

const withNarrationControls = createHigherOrderComponent(
	( BlockEdit ) => ( props: any ) => {
		const [ cached, setCached ] = useState< Set< string > >( new Set() );
		const isEligible = isEligibleBlockName( props.name );

		useEffect( () => {
			if ( ! isEligible ) {
				return;
			}
			let cancelled = false;
			cachedBundles( [ ...SUPPORTED_LANGUAGES ] ).then( ( result ) => {
				if ( ! cancelled ) {
					setCached( result );
				}
			} );
			return () => {
				cancelled = true;
			};
		}, [ isEligible ] );

		if ( ! isEligible ) {
			return createElement( BlockEdit, props );
		}

		const { pvNarrate = true, pvLanguage = '' } = props.attributes;

		const options = [
			{
				label: __( 'Post default', 'post-voice' ),
				value: '',
			},
			...SUPPORTED_LANGUAGES.map( ( language ) => ( {
				value: language,
				label: cached.has( language )
					? sprintf(
							/* translators: %s: language bundle name. */
							__( '%s — already downloaded', 'post-voice' ),
							language
					  )
					: sprintf(
							/* translators: 1: language bundle name, 2: download size, e.g. "199 MB". */
							__( '%1$s — +%2$s to download', 'post-voice' ),
							language,
							formatBytes( LANGUAGE_BUNDLE_BYTES )
					  ),
			} ) ),
		];

		return createElement(
			Fragment,
			null,
			createElement( BlockEdit, props ),
			createElement(
				InspectorControls,
				null,
				createElement(
					PanelBody,
					{ title: __( 'Narration', 'post-voice' ) },
					createElement( ToggleControl, {
						label: __( 'Include in the narration', 'post-voice' ),
						help: __(
							'Turned off, this block is left out of the audio and out of the up-to-date check.',
							'post-voice'
						),
						checked: pvNarrate,
						onChange: ( value: boolean ) =>
							props.setAttributes( { pvNarrate: value } ),
					} ),
					createElement( SelectControl, {
						label: __( 'Language for this block', 'post-voice' ),
						value: pvLanguage,
						options,
						onChange: ( value: string ) =>
							props.setAttributes( { pvLanguage: value } ),
					} )
				)
			)
		);
	},
	'withNarrationControls'
);

/**
 * Install both filters. Called once, from the panel's entry point.
 */
export function registerBlockNarrationControls(): void {
	addFilter(
		'blocks.registerBlockType',
		'post-voice/narration-attributes',
		addAttributes
	);
	addFilter(
		'editor.BlockEdit',
		'post-voice/narration-controls',
		withNarrationControls
	);
}
```

- [ ] **Step 2: Call it from the entry point**

At the top level of `features/narration/editor/index.tsx`, next to the existing `registerPlugin` call:

```tsx
registerBlockNarrationControls();
```

- [ ] **Step 3: Verify the gates**

Run: `npm run lint:js && npx tsc --noEmit && npm run build`
Expected: no errors.

- [ ] **Step 4: Verify by hand in wp-env**

Run: `npx wp-env start && npm run refresh:php`
Open a post, select a paragraph, confirm the "Narration" panel appears in the block inspector with both controls, and that a code block shows no such panel.

- [ ] **Step 5: Commit**

```bash
git add features/narration/editor/block-narration-attributes.ts \
        features/narration/editor/index.tsx
git commit -m "feat: mark a block's narration language from the block inspector

Attributes rather than post meta: they live in post_content, so Gutenberg
handles saving, undo and revisions, and copying a block carries its marking.
Each language option is labelled with what selecting it costs — already
downloaded, or another 199MB."
```

---

## Block C — Multi-language synthesis

### Task 13: The inline language format

**Files:**
- Create: `features/narration/editor/inline-language-format.ts`
- Modify: `features/narration/editor/index.tsx`
- Test: E2E in Task 17

**Interfaces:**
- Consumes: `INLINE_LANGUAGE_ATTRIBUTE` (Task 8), `SUPPORTED_LANGUAGES`.
- Produces: format name `post-voice/language`; `registerInlineLanguageFormat(): void`.

- [ ] **Step 1: Write the module**

Create `features/narration/editor/inline-language-format.ts`:

```ts
import { BlockControls } from '@wordpress/block-editor';
import { ToolbarDropdownMenu, ToolbarGroup } from '@wordpress/components';
import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { applyFormat, registerFormatType, removeFormat } from '@wordpress/rich-text';
import type { RichTextValue } from '@wordpress/rich-text';
import { INLINE_LANGUAGE_ATTRIBUTE } from './extract-segments';
import { SUPPORTED_LANGUAGES } from './model-source';

const FORMAT_NAME = 'post-voice/language';

/**
 * Block types this format is offered on.
 *
 * The same list the extractor narrates. Offering the control on an image caption
 * would let an author mark text that never becomes audio — a control that
 * promises and does not deliver.
 */
const TAG_NAMES = [ 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote' ];

interface FormatProps {
	isActive: boolean;
	value: RichTextValue;
	onChange: ( value: RichTextValue ) => void;
	activeAttributes: Record< string, string >;
}

function Edit( { value, onChange, activeAttributes }: FormatProps ) {
	const current = activeAttributes.language ?? '';

	const controls = SUPPORTED_LANGUAGES.map( ( language ) => ( {
		title: language,
		isActive: current === language,
		onClick: () => {
			if ( current === language ) {
				// Re-applying the language the run already carries is how the author
				// clears it — there is no separate "none" entry to hunt for.
				onChange( removeFormat( value, FORMAT_NAME ) );
				return;
			}
			onChange(
				applyFormat( value, {
					type: FORMAT_NAME,
					attributes: { language },
				} )
			);
		},
	} ) );

	return createElement(
		BlockControls,
		{ group: 'inline' },
		createElement(
			ToolbarGroup,
			null,
			createElement( ToolbarDropdownMenu, {
				icon: 'translation',
				label: __( 'Narrate in another language', 'post-voice' ),
				controls,
			} )
		)
	);
}

/**
 * Register the inline format. Called once, from the panel's entry point.
 */
export function registerInlineLanguageFormat(): void {
	registerFormatType( FORMAT_NAME, {
		title: __( 'Narration language', 'post-voice' ),
		tagName: 'span',
		className: 'post-voice-lang',
		attributes: {
			language: INLINE_LANGUAGE_ATTRIBUTE,
		},
		interactive: false,
		tagNames: TAG_NAMES,
		edit: Edit,
	} );
}
```

- [ ] **Step 2: Style the marked run so it is visible unselected**

In `features/narration/editor/style.scss`:

```scss
// Marked runs have to read as marked without being selected, or the author
// forgets the marking exists and hears the surprise in the generated audio.
.post-voice-lang {
	text-decoration: underline dotted;
	text-underline-offset: 3px;

	&::after {
		content: attr(data-pv-lang);
		font-size: 0.7em;
		vertical-align: super;
		opacity: 0.7;
		margin-left: 2px;
	}
}
```

- [ ] **Step 3: Call it from the entry point**

In `features/narration/editor/index.tsx`, next to `registerBlockNarrationControls()`:

```tsx
registerInlineLanguageFormat();
```

- [ ] **Step 4: Verify the gates and the behaviour**

Run: `npm run lint:js && npx tsc --noEmit && npm run build && npm run refresh:php`
In wp-env: select a phrase inside a paragraph, apply "Narrate in another language → english_2026-04", confirm the dotted underline and the superscript code appear, and that re-applying the same language removes them.

- [ ] **Step 5: Commit**

```bash
git add features/narration/editor/inline-language-format.ts \
        features/narration/editor/style.scss \
        features/narration/editor/index.tsx
git commit -m "feat: mark an inline run to be narrated in another language

Registered only on the block types the extractor narrates: offering this on an
image caption would let an author mark text that never becomes audio. The run is
visible unselected, because a marking the author cannot see is a marking they
will only discover in the finished audio."
```

---

### Task 14: Grouping segments by language

**Files:**
- Create: `features/narration/editor/group-segments.ts`
- Test: `features/narration/tests/js/group-segments.test.ts`
- Modify: `jest.config.js`

**Interfaces:**
- Consumes: `ResolvedSegment` (Task 7).
- Produces: `interface SegmentGroup { language: string; items: { index: number; text: string }[] }`; `groupByLanguage( segments: ResolvedSegment[] ): SegmentGroup[]`; `reassemble( parts: { index: number; audio: Float32Array }[], gapSamples: number ): Float32Array`.

- [ ] **Step 1: Write the failing test**

Create `features/narration/tests/js/group-segments.test.ts`:

```ts
import { groupByLanguage, reassemble } from '../../editor/group-segments';

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

		expect( Array.from( out ) ).toEqual( [ 0.1, 0.2, 0.3 ] );
	} );

	it( 'inserts silence between segments', () => {
		const out = reassemble(
			[
				{ index: 0, audio: Float32Array.from( [ 0.1 ] ) },
				{ index: 1, audio: Float32Array.from( [ 0.2 ] ) },
			],
			2
		);

		expect( Array.from( out ) ).toEqual( [ 0.1, 0, 0, 0.2 ] );
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- features/narration/tests/js/group-segments.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `features/narration/editor/group-segments.ts`:

```ts
import type { ResolvedSegment } from './segment';

export interface SegmentGroup {
	language: string;
	items: Array< { index: number; text: string } >;
}

/**
 * Collect segments by language, remembering where each one belongs.
 *
 * The worker holds one bundle at a time, so synthesising in document order would
 * reload the model at every language change — ten swaps for a post that
 * alternates ten times. Grouping caps the swaps at the number of languages.
 *
 * Groups come back in order of first appearance, so the bundle loaded first is
 * the one the post opens with — usually the one already cached.
 *
 * @param segments Resolved segments in document order.
 */
export function groupByLanguage( segments: ResolvedSegment[] ): SegmentGroup[] {
	const groups = new Map< string, SegmentGroup >();
	segments.forEach( ( segment, index ) => {
		const group = groups.get( segment.language ) ?? {
			language: segment.language,
			items: [],
		};
		group.items.push( { index, text: segment.text } );
		groups.set( segment.language, group );
	} );
	return Array.from( groups.values() );
}

/**
 * Put the synthesised parts back in document order, with silence at the seams.
 *
 * Sums the lengths first and writes into a single pre-allocated buffer. Building
 * this by spreading arrays would double the peak memory, which for a ten-minute
 * narration is already ~57 MB.
 *
 * @param parts      Synthesised audio, each carrying its document index.
 * @param gapSamples Silence to insert between consecutive segments.
 */
export function reassemble(
	parts: Array< { index: number; audio: Float32Array } >,
	gapSamples: number
): Float32Array {
	const ordered = [ ...parts ].sort( ( a, b ) => a.index - b.index );
	const audioLength = ordered.reduce(
		( sum, part ) => sum + part.audio.length,
		0
	);
	const gaps = Math.max( 0, ordered.length - 1 ) * gapSamples;
	const out = new Float32Array( audioLength + gaps );

	let offset = 0;
	ordered.forEach( ( part, position ) => {
		out.set( part.audio, offset );
		offset += part.audio.length;
		if ( position < ordered.length - 1 ) {
			// Float32Array is zero-filled on allocation, so the gap is already
			// silence — just step over it.
			offset += gapSamples;
		}
	} );

	return out;
}
```

- [ ] **Step 4: Add to coverage collection**

In `jest.config.js`, add `'features/narration/editor/group-segments.ts'`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:unit -- features/narration/tests/js/group-segments.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add features/narration/editor/group-segments.ts \
        features/narration/tests/js/group-segments.test.ts jest.config.js
git commit -m "feat: group segments by language and reassemble them in order

The worker holds one bundle at a time, so document-order synthesis would reload
the model at every language change. Reassembly writes into a single pre-allocated
buffer: spreading arrays would double a peak that is already ~57MB for a
ten-minute narration."
```

---

### Task 15: `generateSegments` on the engine

**Files:**
- Modify: `features/narration/editor/engine/tts-engine.ts`
- Test: E2E in Task 17 (Worker/ONNX glue, per the spec's coverage table)

**Interfaces:**
- Consumes: `SegmentGroup`, `groupByLanguage`, `reassemble` (Task 14); `ResolvedSegment` (Task 7).
- Produces: `PocketTtsEngine.generateSegments( segments: ResolvedSegment[], options: GenerateSegmentsOptions ): Promise< Float32Array >`; `interface GenerateSegmentsOptions { voice?: string; signal?: AbortSignal; onProgress?: ( done: number, total: number ) => void }`; `SEGMENT_GAP_SECONDS = 0.12`.

- [ ] **Step 1: Add the method**

In `features/narration/editor/engine/tts-engine.ts`, add the import and the option type near the existing `GenerateOptions`:

```ts
import { groupByLanguage, reassemble } from '../group-segments';
import type { ResolvedSegment } from '../segment';

/** Silence inserted between consecutive segments, in seconds. */
export const SEGMENT_GAP_SECONDS = 0.12;

export interface GenerateSegmentsOptions extends GenerateOptions {
	/** Called after each segment finishes, for the panel's progress bar. */
	onProgress?: ( done: number, total: number ) => void;
}
```

And the method inside the class, next to `generate`:

```ts
	/**
	 * Synthesise a multi-language narration as a single buffer.
	 *
	 * Loads one bundle per language rather than one per segment: `ensureLanguage`
	 * tears down and rebuilds the ONNX sessions, which costs seconds, and a post
	 * that alternates languages ten times would pay that ten times.
	 *
	 * @param segments Resolved segments in document order.
	 * @param options  Voice, abort signal and progress callback.
	 */
	async generateSegments(
		segments: ResolvedSegment[],
		options: GenerateSegmentsOptions
	): Promise< Float32Array > {
		if ( segments.length === 0 ) {
			throw new Error( 'No segments to narrate' );
		}

		const groups = groupByLanguage( segments );
		const parts: Array< { index: number; audio: Float32Array } > = [];
		let done = 0;

		for ( const group of groups ) {
			// Abort between groups as well as inside generate(): loading a bundle is
			// the longest uninterruptible step, and starting one the author already
			// cancelled would hold the editor for seconds with nothing to show.
			if ( options.signal?.aborted ) {
				throw new DOMException( 'Generation cancelled', 'AbortError' );
			}
			await this.ensureLanguage( group.language );
			for ( const item of group.items ) {
				const audio = await this.generate( item.text, {
					voice: options.voice,
					signal: options.signal,
				} );
				parts.push( { index: item.index, audio } );
				done += 1;
				options.onProgress?.( done, segments.length );
			}
		}

		return reassemble(
			parts,
			Math.round( SEGMENT_GAP_SECONDS * this.sampleRate )
		);
	}
```

- [ ] **Step 2: Verify the gates**

Run: `npm run lint:js && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add features/narration/editor/engine/tts-engine.ts
git commit -m "feat: synthesise a multi-language narration in one pass

One bundle load per language, not per segment: ensureLanguage rebuilds the ONNX
sessions, and a post alternating ten times would pay that cost ten times. The
signal is checked between groups too — a cancelled generation should not start a
bundle load that holds the editor for seconds."
```

---

### Task 16: ETA across bundles, REST `languages`, and panel wiring

**Files:**
- Modify: `features/narration/editor/rtf-calibration.ts`, `features/narration/editor/narration-api.ts`, `features/narration/editor/index.tsx`, `features/narration/php/class-rest-api.php`, `features/narration/php/class-post-meta.php`
- Test: `features/narration/tests/js/rtf-calibration.test.ts`, `features/narration/tests/php/test-rest-api.php`, `features/narration/tests/php/test-post-meta.php`
- Delete: `features/narration/editor/extract-narratable-text.ts` is kept only for its `EditorBlock` type — move that type into `segment.ts` and delete the file

**Interfaces:**
- Consumes: everything from Tasks 7-15.
- Produces: `estimateMultiBundleEta( groups, rtfByLanguage, defaultRtf, pendingBundleCount, downloadBytesPerSecond ): number`; `saveNarration( postId, audio, language, languages, voice, sourceHash )`; `Post_Voice_Post_Meta::LANGUAGES` (`'_narration_languages'`).

- [ ] **Step 1: Write the failing ETA test**

Append to `features/narration/tests/js/rtf-calibration.test.ts`:

```ts
import { estimateMultiBundleEta } from '../../editor/rtf-calibration';

describe( 'estimateMultiBundleEta', () => {
	const groups = [
		{ language: 'portuguese', items: [ { index: 0, text: 'a'.repeat( 100 ) } ] },
		{
			language: 'english_2026-04',
			items: [ { index: 1, text: 'b'.repeat( 100 ) } ],
		},
	];

	it( 'sums the groups using each bundle measured RTF', () => {
		const withMeasured = estimateMultiBundleEta(
			groups,
			new Map( [
				[ 'portuguese', 1 ],
				[ 'english_2026-04', 2 ],
			] ),
			1,
			0,
			0
		);
		const withDefault = estimateMultiBundleEta(
			groups,
			new Map( [ [ 'portuguese', 1 ] ] ),
			1,
			0,
			0
		);

		expect( withMeasured ).toBeGreaterThan( withDefault );
	} );

	it( 'falls back to the default RTF for a bundle not yet measured', () => {
		expect(
			estimateMultiBundleEta( groups, new Map(), 2, 0, 0 )
		).toBeGreaterThan( 0 );
	} );

	it( 'adds download time for bundles still to fetch', () => {
		const withoutDownload = estimateMultiBundleEta(
			groups,
			new Map(),
			1,
			0,
			1_000_000
		);
		const withDownload = estimateMultiBundleEta(
			groups,
			new Map(),
			1,
			1,
			1_000_000
		);

		expect( withDownload - withoutDownload ).toBeGreaterThan( 100 );
	} );

	it( 'ignores download time when the connection speed is unknown', () => {
		expect( estimateMultiBundleEta( groups, new Map(), 1, 2, 0 ) ).toBe(
			estimateMultiBundleEta( groups, new Map(), 1, 0, 0 )
		);
	} );
} );
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- features/narration/tests/js/rtf-calibration.test.ts`
Expected: FAIL — `estimateMultiBundleEta` is not exported.

- [ ] **Step 3: Implement the ETA**

Append to `features/narration/editor/rtf-calibration.ts`:

```ts
import type { SegmentGroup } from './group-segments';
import { LANGUAGE_BUNDLE_BYTES } from './storage-check';

/**
 * Seconds this generation will take, across every language it uses.
 *
 * Each group is estimated with its own measured RTF, because a bundle that has
 * not been loaded yet has not been warmed up either — its group falls back to the
 * RTF of the bundle that was measured, marked as an estimate by the caller.
 *
 * Download time counts. Fetching 199 MB on a modest connection can outlast the
 * synthesis of a short post, and Fase 1 already established that the author gets
 * the number before deciding.
 *
 * @param groups                 Segment groups, in synthesis order.
 * @param rtfByLanguage          Measured RTF per bundle.
 * @param defaultRtf             RTF to use for a bundle not measured yet.
 * @param pendingBundleCount     Bundles still to download.
 * @param downloadBytesPerSecond Observed download speed; 0 means unknown.
 */
export function estimateMultiBundleEta(
	groups: SegmentGroup[],
	rtfByLanguage: Map< string, number >,
	defaultRtf: number,
	pendingBundleCount: number,
	downloadBytesPerSecond: number
): number {
	const synthesis = groups.reduce( ( total, group ) => {
		const characters = group.items.reduce(
			( sum, item ) => sum + item.text.length,
			0
		);
		const rtf = rtfByLanguage.get( group.language ) ?? defaultRtf;
		return (
			total +
			estimateEtaSeconds( rtf, estimateAudioDurationSeconds( characters ) )
		);
	}, 0 );

	const download =
		downloadBytesPerSecond > 0
			? ( pendingBundleCount * LANGUAGE_BUNDLE_BYTES ) /
			  downloadBytesPerSecond
			: 0;

	return synthesis + download;
}
```

- [ ] **Step 4: Write the failing PHP tests**

Append to `features/narration/tests/php/test-rest-api.php`:

```php
	public function test_save_rejects_a_languages_list_containing_an_unsupported_value(): void {
		$request = $this->build_save_request(
			array(
				'language'  => 'portuguese',
				'languages' => 'portuguese,klingon',
			)
		);

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'post_voice_invalid_language', $response->get_data()['code'] );
	}

	public function test_save_rejects_a_primary_language_missing_from_the_list(): void {
		$request = $this->build_save_request(
			array(
				'language'  => 'portuguese',
				'languages' => 'english_2026-04',
			)
		);

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'post_voice_invalid_language', $response->get_data()['code'] );
	}

	public function test_save_records_every_language_used(): void {
		$request = $this->build_save_request(
			array(
				'language'  => 'portuguese',
				'languages' => 'portuguese,english_2026-04',
			)
		);

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array( 'portuguese', 'english_2026-04' ),
			get_post_meta( $this->post_id, Post_Voice_Post_Meta::LANGUAGES, true )
		);
	}

	public function test_save_defaults_the_language_list_to_the_primary_language(): void {
		$request = $this->build_save_request( array( 'language' => 'portuguese' ) );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array( 'portuguese' ),
			get_post_meta( $this->post_id, Post_Voice_Post_Meta::LANGUAGES, true )
		);
	}
```

> The existing test class already builds save requests; reuse its helper. If it
> has no `build_save_request()` helper yet, extract one from the first existing
> save test in that file so these four can share it — the helper must set the
> file param, `voice`, and `source_hash`, and accept an array of overrides.

Append to `features/narration/tests/php/test-post-meta.php`:

```php
	public function test_save_records_the_language_list(): void {
		$post_id = self::factory()->post->create();

		Post_Voice_Post_Meta::save(
			$post_id,
			123,
			'portuguese',
			array( 'portuguese', 'english_2026-04' ),
			'alba',
			str_repeat( 'a', 64 )
		);

		$this->assertSame(
			array( 'portuguese', 'english_2026-04' ),
			get_post_meta( $post_id, Post_Voice_Post_Meta::LANGUAGES, true )
		);
	}

	public function test_clear_removes_the_language_list(): void {
		$post_id = self::factory()->post->create();
		Post_Voice_Post_Meta::save(
			$post_id,
			123,
			'portuguese',
			array( 'portuguese' ),
			'alba',
			str_repeat( 'a', 64 )
		);

		Post_Voice_Post_Meta::clear( $post_id );

		$this->assertSame( '', get_post_meta( $post_id, Post_Voice_Post_Meta::LANGUAGES, true ) );
	}
```

- [ ] **Step 5: Run the PHP tests to verify they fail**

Run: `npm run test:php -- --filter 'Test_Post_Voice_Rest_Api|Test_Post_Voice_Post_Meta'`
Expected: FAIL — `LANGUAGES` undefined, `save()` takes five arguments.

- [ ] **Step 6: Add the meta key**

In `features/narration/php/class-post-meta.php`: add the constant, register it, write it in `save()`, delete it in `clear()`.

```php
	public const LANGUAGES = '_narration_languages';
```

```php
		register_post_meta(
			'post',
			self::LANGUAGES,
			array_merge(
				$args,
				array(
					'type'         => 'array',
					'show_in_rest' => array(
						'schema' => array(
							'type'  => 'array',
							'items' => array( 'type' => 'string' ),
						),
					),
					'default'      => array(),
				)
			)
		);
```

```php
	/**
	 * Record a saved narration against the post.
	 *
	 * @param int      $post_id       Post the narration belongs to.
	 * @param int      $attachment_id Media Library attachment holding the MP3.
	 * @param string   $language      Default language bundle of the post.
	 * @param string[] $languages     Every bundle the audio was generated with.
	 * @param string   $voice         Predefined voice the audio was generated with.
	 * @param string   $source_hash   SHA-256 of the resolved segments.
	 */
	public static function save( int $post_id, int $attachment_id, string $language, array $languages, string $voice, string $source_hash ): void {
		update_post_meta( $post_id, self::ATTACHMENT_ID, $attachment_id );
		update_post_meta( $post_id, self::LANGUAGE, $language );
		update_post_meta( $post_id, self::LANGUAGES, $languages );
		update_post_meta( $post_id, self::VOICE, $voice );
		update_post_meta( $post_id, self::SOURCE_HASH, $source_hash );
	}
```

```php
		delete_post_meta( $post_id, self::LANGUAGES );
```

- [ ] **Step 7: Validate `languages` in the endpoint**

In `features/narration/php/class-rest-api.php`, in `handle_save_narration()`, right after the existing `$language` check:

```php
		// Absent means single-language, which is what every Fase 1 client sends.
		$languages_param = (string) $request->get_param( 'languages' );
		$languages       = '' === $languages_param
			? array( $language )
			: array_values( array_filter( array_map( 'trim', explode( ',', $languages_param ) ) ) );

		foreach ( $languages as $candidate ) {
			if ( ! in_array( $candidate, self::ALLOWED_LANGUAGES, true ) ) {
				return new WP_Error(
					'post_voice_invalid_language',
					__( 'Unsupported narration language.', 'post-voice' ),
					array( 'status' => 400 )
				);
			}
		}

		// The primary language names the bundle the panel opened on, so audio that
		// does not contain it means the client and the meta disagree about what was
		// generated — and the meta is what the panel trusts afterwards.
		if ( ! in_array( $language, $languages, true ) ) {
			return new WP_Error(
				'post_voice_invalid_language',
				__( 'The primary language must be one of the languages used.', 'post-voice' ),
				array( 'status' => 400 )
			);
		}
```

And pass it through at the `Post_Voice_Post_Meta::save(...)` call site:

```php
		Post_Voice_Post_Meta::save( $post_id, $attachment_id, $language, $languages, $voice, $source_hash );
```

- [ ] **Step 8: Send it from the client**

In `features/narration/editor/narration-api.ts`, add the parameter and the form field:

```ts
export async function saveNarration(
	postId: number,
	audio: Blob,
	language: string,
	languages: string[],
	voice: string,
	sourceHash: string
): Promise< SaveNarrationResponse > {
	const formData = new FormData();
	formData.append( 'audio', audio, 'narration.mp3' );
	formData.append( 'language', language );
	// Comma-separated rather than a repeated field: this body is multipart, where
	// repeated-field handling is a parser convention, and a single string is
	// unambiguous on both ends.
	formData.append( 'languages', languages.join( ',' ) );
	formData.append( 'voice', voice );
	formData.append( 'source_hash', sourceHash );
```

- [ ] **Step 9: Rewire the panel**

In `features/narration/editor/index.tsx`:

1. Replace the `extractNarratableText` import with `extractSegments`, `resolveSegments`, `mergeAdjacent`, `computeSegmentHash`, `groupByLanguage`, `applyDictionary`, `mergeDictionaries`, `bundleForLocale`, `cachedBundles`, `bytesForBundles`, `estimateMultiBundleEta`.

2. Add the pipeline helper next to the other `useCallback`s:

```tsx
	const buildSegments = useCallback( () => {
		const dictionary = mergeDictionaries(
			window.postVoiceData?.dictionary ?? [],
			postDictionary
		);
		const resolved = mergeAdjacent(
			resolveSegments( extractSegments( blocks ), language )
		);
		return resolved.map( ( segment ) => ( {
			...segment,
			text: applyDictionary( segment.text, segment.language, dictionary ),
		} ) );
	}, [ blocks, language, postDictionary ] );
```

3. Default the language selector from the site locale — replace `useState< string >( 'portuguese' )` with:

```tsx
	const [ language, setLanguage ] = useState< string >( () =>
		bundleForLocale( window.postVoiceData?.siteLanguage ?? '' )
	);
```

4. Debounce the staleness effect. Replace the body of the effect that currently calls `computeSourceHash( extractNarratableText( blocks ) )` with:

```tsx
	useEffect( () => {
		// 300ms: `blocks` changes on every keystroke, and this path now runs the
		// parser, the dictionary and the digest. Measured at ~18ms on a 64KB post —
		// small, but not small enough to pay per character.
		const timer = setTimeout( () => {
			void computeSegmentHash( buildSegments() ).then( ( hash ) => {
				setIsStale( Boolean( savedHash ) && hash !== savedHash );
			} );
		}, 300 );
		return () => clearTimeout( timer );
	}, [ buildSegments, savedHash ] );
```

5. In `startGeneration`, replace the text extraction and the empty-text guard:

```tsx
			const segments = buildSegments();
			if ( segments.length === 0 ) {
				throw new Error(
					__(
						'Nothing to narrate: every block is either excluded or not narratable.',
						'post-voice'
					)
				);
			}
			const groups = groupByLanguage( segments );
			const cached = await cachedBundles(
				groups.map( ( group ) => group.language )
			);
			const pending = groups.length - cached.size;
			if ( pending > 0 ) {
				const estimate = await navigator.storage.estimate();
				if (
					! hasEnoughStorage( estimate, bytesForBundles( pending ) )
				) {
					throw new Error(
						sprintf(
							/* translators: %s: required free space, e.g. "600 MB". */
							__(
								'Not enough free space: this narration needs %s for the language models it still has to download.',
								'post-voice'
							),
							formatBytes(
								bytesForBundles( pending ) *
									STORAGE_HEADROOM_MULTIPLIER
							)
						)
					);
				}
			}
```

6. In `runGeneration`, call the new engine method and remember the segments:

```tsx
	const runGeneration = useCallback(
		async ( segments: ResolvedSegment[] ) => {
			setState( 'generating' );
			abortRef.current = new AbortController();
			const audio = await engineRef.current!.generateSegments( segments, {
				voice,
				signal: abortRef.current.signal,
			} );
			generatedWithRef.current = {
				segments,
				voice,
				language,
				languages: groupByLanguage( segments ).map(
					( group ) => group.language
				),
			};
			setPreview( encodeMp3( audio, engineRef.current!.sampleRate ) );
			setState( 'idle' );
		},
		[ language, setPreview, voice ]
	);
```

7. In the save callback, hash the generated segments and send the language list:

```tsx
			const generated = generatedWithRef.current;
			const segments = generated?.segments ?? buildSegments();
			const sourceHash = await computeSegmentHash( segments );
			const saved = await saveNarration(
				postId,
				blob,
				generated?.language ?? language,
				generated?.languages ?? [ language ],
				generated?.voice ?? voice,
				sourceHash
			);
```

8. Show the languages in the status card, next to the voice:

```tsx
					{ sprintf(
						/* translators: 1: languages used, e.g. "portuguese + english_2026-04"; 2: voice name. */
						__( '%1$s · voice %2$s', 'post-voice' ),
						( ( meta._narration_languages as string[] ) ?? [
							savedLanguage,
						] ).join( ' + ' ),
						savedVoice
					) }
```

- [ ] **Step 10: Delete the superseded extractor**

Move the `EditorBlock` interface from `extract-narratable-text.ts` into `segment.ts`, update the import in `extract-segments.ts` and in the tests, then:

```bash
git rm features/narration/editor/extract-narratable-text.ts \
       features/narration/tests/js/extract-narratable-text.test.ts
```

Remove `'features/narration/editor/extract-narratable-text.ts'` from `collectCoverageFrom` in `jest.config.js`.

- [ ] **Step 11: Run everything**

Run: `npm run lint:js && npx tsc --noEmit && composer run lint && composer run stan && npm run test:unit -- --coverage && npm run test:php && npm run test:php:coverage`
Expected: all green, both coverage gates met.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: generate, estimate and save a multi-language narration

The panel now builds segments, applies both dictionaries, hashes what will
actually be synthesised and sends every language it used. The ETA sums the groups
with each bundle's own measured RTF and counts the download, since fetching
199MB can outlast the synthesis of a short post. The staleness recompute is
debounced by 300ms — it runs on every keystroke and now carries a parser and a
dictionary pass with it."
```

---

### Task 17: E2E scenarios

**Files:**
- Create: `e2e/narration-fase2.spec.ts`

**Interfaces:**
- Consumes: the whole feature.
- Produces: nothing importable.

> **Cost warning, decide before running in CI:** the multi-language scenario
> downloads a second ~199 MB bundle on first run, roughly doubling the E2E job's
> download and adding several minutes. That is the price of testing the thing the
> phase exists for; do not replace it with a mock, per the spec's testing rules.

- [ ] **Step 1: Write the scenarios**

Create `e2e/narration-fase2.spec.ts`, following the structure of the existing `e2e/narration.spec.ts` (same fixtures, same admin login, same helper for opening the narration panel):

```ts
import { test, expect } from '@wordpress/e2e-test-utils-playwright';

test.describe( 'Post Voice — Fase 2', () => {
	test( 'a block excluded in the inspector is left out of the narration', async ( {
		admin,
		editor,
		page,
	} ) => {
		await admin.createNewPost();
		await editor.insertBlock( {
			name: 'core/paragraph',
			attributes: { content: 'Primeiro parágrafo.' },
		} );
		await editor.insertBlock( {
			name: 'core/paragraph',
			attributes: { content: 'Segundo parágrafo.' },
		} );

		await editor.selectBlocks(
			editor.canvas.getByText( 'Segundo parágrafo.' )
		);
		await page
			.getByRole( 'checkbox', { name: 'Include in the narration' } )
			.uncheck();

		// The panel reports what it will narrate before generating, so the
		// assertion does not need a full synthesis to prove the exclusion took.
		await page.getByRole( 'button', { name: 'Narration' } ).click();
		await expect(
			page.getByText( 'Segundo parágrafo.' )
		).toHaveCount( 1 ); // only the canvas copy, not the panel summary
	} );

	test( 'an inline marked run survives a save as Author', async ( {
		admin,
		editor,
		page,
		requestUtils,
	} ) => {
		const author = await requestUtils.createUser( {
			username: 'pv-author',
			email: 'pv-author@example.com',
			password: 'pv-author-pass',
			roles: [ 'author' ],
		} );

		await admin.createNewPost();
		await editor.insertBlock( {
			name: 'core/paragraph',
			attributes: {
				content:
					'Ele disse <span data-pv-lang="english_2026-04">batteries with wheels</span> e sentou.',
			},
		} );
		await editor.publishPost();

		const content = await editor.getEditedPostContent();

		// kses strips unknown attributes for roles without unfiltered_html. If this
		// fails, the fix is wp_kses_allowed_html — not dropping the assertion.
		expect( content ).toContain( 'data-pv-lang="english_2026-04"' );

		await requestUtils.deleteUser( author.id );
	} );

	test( 'a dictionary entry changes what is narrated', async ( {
		admin,
		editor,
		page,
	} ) => {
		await admin.createNewPost();
		await editor.insertBlock( {
			name: 'core/paragraph',
			attributes: { content: 'A BYD cresceu.' },
		} );

		await page.getByRole( 'button', { name: 'Narration' } ).click();
		await page
			.getByRole( 'button', { name: 'Pronunciation for this post' } )
			.click();
		await page.getByRole( 'button', { name: 'Add term' } ).click();
		await page.getByLabel( 'Term' ).fill( 'BYD' );
		await page.getByLabel( 'Read as' ).fill( 'Bi Iou Di' );

		// Saving the post persists the meta; reopening proves it round-tripped
		// through the REST schema rather than living only in editor state.
		await editor.saveDraft();
		await page.reload();
		await page.getByRole( 'button', { name: 'Narration' } ).click();
		await page
			.getByRole( 'button', { name: 'Pronunciation for this post' } )
			.click();
		await expect( page.getByLabel( 'Read as' ) ).toHaveValue( 'Bi Iou Di' );
	} );

	test( 'editing the dictionary marks existing audio as possibly outdated', async ( {
		admin,
		editor,
		page,
	} ) => {
		await admin.createNewPost();
		await editor.insertBlock( {
			name: 'core/paragraph',
			attributes: { content: 'A BYD cresceu.' },
		} );
		await editor.saveDraft();

		await page.getByRole( 'button', { name: 'Narration' } ).click();
		await page.getByRole( 'button', { name: 'Generate audio' } ).click();
		await page.getByRole( 'button', { name: 'Save narration' } ).click();
		await expect( page.getByText( 'Up to date' ) ).toBeVisible( {
			timeout: 600_000,
		} );

		await page
			.getByRole( 'button', { name: 'Pronunciation for this post' } )
			.click();
		await page.getByRole( 'button', { name: 'Add term' } ).click();
		await page.getByLabel( 'Term' ).fill( 'BYD' );
		await page.getByLabel( 'Read as' ).fill( 'Bi Iou Di' );

		await expect( page.getByText( 'May be out of date' ) ).toBeVisible();
	} );

	test( 'a post in two languages produces one MP3', async ( {
		admin,
		editor,
		page,
	} ) => {
		test.setTimeout( 1_800_000 );

		await admin.createNewPost();
		await editor.insertBlock( {
			name: 'core/paragraph',
			attributes: { content: 'Uma frase curta.' },
		} );
		await editor.insertBlock( {
			name: 'core/paragraph',
			attributes: {
				content: 'A short sentence.',
				pvLanguage: 'english_2026-04',
			},
		} );
		await editor.saveDraft();

		await page.getByRole( 'button', { name: 'Narration' } ).click();
		await page.getByRole( 'button', { name: 'Generate audio' } ).click();
		await page.getByRole( 'button', { name: 'Save narration' } ).click();

		await expect(
			page.getByText( 'portuguese + english_2026-04' )
		).toBeVisible( { timeout: 1_500_000 } );

		const audio = page.locator( 'audio' );
		await expect( audio ).toHaveCount( 1 );
	} );
} );
```

- [ ] **Step 2: Run them**

Run: `npm run build && npm run test:e2e -- e2e/narration-fase2.spec.ts`
Expected: PASS. First run downloads the second bundle.

- [ ] **Step 3: If the kses assertion fails, fix it properly**

Add to `features/narration/php/class-assets.php` (or a small new class if it grows):

```php
		add_filter(
			'wp_kses_allowed_html',
			static function ( array $tags, $context ): array {
				if ( 'post' !== $context ) {
					return $tags;
				}
				$tags['span']                 = $tags['span'] ?? array();
				$tags['span']['data-pv-lang'] = true;
				return $tags;
			},
			10,
			2
		);
```

Then re-run the scenario. Commit the fix with the test in the same commit.

- [ ] **Step 4: Commit**

```bash
git add e2e/narration-fase2.spec.ts features/narration/php/class-assets.php
git commit -m "test: cover block exclusion, inline marking, dictionary and two-language output

The inline assertion runs as Author on purpose: kses strips unknown attributes
for roles without unfiltered_html, and a marking that silently disappears on save
is the failure mode worth catching in CI rather than in someone's post."
```

---

### Task 18: The performance ceiling, i18n and docs

**Files:**
- Create: `features/narration/tests/js/segment-pipeline-perf.test.ts`
- Modify: `languages/post-voice.pot`, `TESTING.md`, `docs/superpowers/specs/2026-08-14-post-voice-fase2-design.md`

**Interfaces:**
- Consumes: `extractSegments`, `resolveSegments`, `mergeAdjacent`, `applyDictionary`, `computeSegmentHash`.
- Produces: nothing importable.

- [ ] **Step 1: Write the ceiling test**

Create `features/narration/tests/js/segment-pipeline-perf.test.ts`:

```ts
import { applyDictionary } from '../../../pronunciation/editor/apply-dictionary';
import type { DictionaryEntry } from '../../../pronunciation/editor/dictionary-entry';
import { extractSegments } from '../../editor/extract-segments';
import { computeSegmentHash } from '../../editor/segment-hash';
import { mergeAdjacent, resolveSegments } from '../../editor/segment';

/**
 * The editor runs this whole path on a debounced keystroke. It measured ~18ms on
 * this fixture when it was written; the 50ms ceiling is deliberately slack so the
 * test does not flake on a loaded CI runner, while still catching the kind of
 * regression that recompiles a 200-term regex per call.
 */
const CEILING_MS = 50;

const paragraph = ( index: number ) => ( {
	name: 'core/paragraph',
	attributes: {
		content:
			'A BYD terminou o trimestre à frente de todas as concorrentes no mercado brasileiro e a diferença não veio de um único modelo. '.repeat(
				4
			) +
			( index % 7 === 0
				? '<span data-pv-lang="english_2026-04">This is the part read in English.</span>'
				: '' ),
	},
	innerBlocks: [],
} );

describe( 'segment pipeline performance', () => {
	it( `processes a 64KB post in under ${ CEILING_MS }ms`, async () => {
		const blocks = Array.from( { length: 120 }, ( _, i ) => paragraph( i ) );
		const dictionary: DictionaryEntry[] = Array.from(
			{ length: 200 },
			( _, i ) => ( {
				term: `termo${ i }`,
				replacement: `valor${ i }`,
				language: 'portuguese',
			} )
		);

		const start = performance.now();
		const segments = mergeAdjacent(
			resolveSegments( extractSegments( blocks ), 'portuguese' )
		).map( ( segment ) => ( {
			...segment,
			text: applyDictionary( segment.text, segment.language, dictionary ),
		} ) );
		await computeSegmentHash( segments );
		const elapsed = performance.now() - start;

		expect( segments.length ).toBeGreaterThan( 0 );
		expect( elapsed ).toBeLessThan( CEILING_MS );
	} );
} );
```

- [ ] **Step 2: Run it**

Run: `npm run test:unit -- features/narration/tests/js/segment-pipeline-perf.test.ts`
Expected: PASS, comfortably under the ceiling.

- [ ] **Step 3: Regenerate the translation template**

Run: `npm run i18n:pot && npm run i18n:check`
Expected: `.pot` updated, check passes.

- [ ] **Step 4: Document the new gates**

In `TESTING.md`, add a short section describing the performance ceiling test and the multi-language E2E's download cost, in the style of the existing entries.

- [ ] **Step 5: Record execution findings in the spec**

Append a dated section to `docs/superpowers/specs/2026-08-14-post-voice-fase2-design.md` listing anything execution discovered that contradicts or refines the design — including whether the kses filter from Task 17 turned out to be necessary.

- [ ] **Step 6: Run the full CI locally**

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

Expected: every gate green. If anything fails, stop and present correction plans — do not lower a threshold.

- [ ] **Step 7: Commit**

```bash
git add features/narration/tests/js/segment-pipeline-perf.test.ts \
        languages/post-voice.pot TESTING.md \
        docs/superpowers/specs/2026-08-14-post-voice-fase2-design.md
git commit -m "test: cap the segment pipeline at 50ms on a 64KB post

Measured at ~18ms when written. The slack keeps the test from flaking on a loaded
runner while still catching a regression that puts a 200-term regex compile back
on the editor's keystroke path."
```

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: block marking → 12; inline format → 13; dictionary global and per-post → 3, 4, 6; entry per language → 1, 2; whole-word case-insensitive matching → 2; hash over resolved segments → 9, 16; single voice → unchanged behaviour, no task needed; locale default → 10, 16; warn-on-mark / download-on-generate → 11, 12, 16; grouped synthesis with 120 ms gaps → 14, 15; metas and REST → 16; error table → 16 (empty segments, storage, unknown language) and 15 (abort between groups); security → 3, 4, 17; performance guards → 2 (memoised regex), 14 (single allocation), 16 (debounce), 18 (ceiling); tests → each task plus 17 and 18.

**Known gap, deliberate:** the spec's "download failure mid-generation aborts cleanly" is covered by the existing abort path rather than a dedicated scenario — a network failure on a 199 MB fetch is not reproducible in CI without stubbing the model host, which the spec's testing rules forbid mocking around. Worth a manual check during Task 16's wp-env verification.

**Type consistency:** `Segment`/`ResolvedSegment` (Task 7) are used unchanged in 8, 9, 14, 15, 16. `DictionaryEntry` (Task 1) is used in 2, 3 (PHP mirror), 6, 18. `saveNarration`'s new signature (16) matches the PHP handler's `languages` parsing (16). `Post_Voice_Post_Meta::save()` gains its fourth parameter in 16, and every existing caller is in that same file.

---

**Plan complete and saved to `docs/superpowers/plans/2026-08-14-post-voice-fase2-implementation-plan.md`.**
