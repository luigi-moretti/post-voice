# Narration Audio Quality (Chunking) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Pocket TTS worker from producing robotic, cut-off narration on long paragraphs and punctuation-heavy sentences, without touching any public interface.

**Architecture:** All three fixes live inside `runGenerationPipeline`/`splitIntoBestSentences` in one vendored worker file: (1) stop reprocessing the flow-LM/mimi state from scratch at every internal chunk boundary — carry it forward within a segment instead — (2) shrink the fixed silence inserted between those chunks now that it no longer needs to mask a reset, and (3) when a sentence is too long for one chunk, prefer cutting it at a punctuation pause instead of at a raw token boundary. Verified via a new black-box Playwright E2E spec, matching how the rest of the Worker/ONNX code is tested in this project (no unit tests for this file — see Global Constraints).

**Tech Stack:** Vanilla JS (Web Worker, no bundler transform — this file is webpack-ignored/eslint-ignored on purpose), ONNX Runtime Web, Playwright (`@wordpress/e2e-test-utils-playwright`), WordPress editor (Gutenberg).

**Spec:** `docs/superpowers/specs/2026-08-18-narration-audio-quality-chunking-design.md`

## Global Constraints

- Single file touched for the fix itself: `features/narration/editor/engine/pocket-tts.worker.js`. No change to worker `postMessage` message shapes, no REST change, no post-meta change.
- `features/narration/editor/engine/pocket-tts.worker.js` is excluded from ESLint and from the webpack/TypeScript build (`.eslintrc.js` `ignorePatterns`) — do not expect `npm run lint:js` or `npx tsc --noEmit` to touch it, and do not "fix" its style to match the rest of the codebase.
- State carry-over is scoped to **within one segment only** (one `generate()` call = one `ResolvedSegment`). Do not touch `features/narration/editor/engine/tts-engine.ts` (`SEGMENT_GAP_SECONDS = 0.12`) or `features/narration/editor/group-segments.ts` (`reassemble`) — the gap *between* segments is out of scope.
- `CHUNK_GAP_SEC` (internal-chunk gap) goes from `0.25` to `0.06`. This is a chosen value inside an approved 50-80ms range, not an empirically tested optimum — do not "improve" it further without going back to the spec.
- No new automated metric for audio quality/prosody. The only new automated coverage is a black-box E2E proving the adversarial inputs (long paragraph, oversized punctuated sentence) generate without error/timeout. Audible quality is judged by a human listening to the output, reported in the PR description — not something an agent can execute or claim.
- Every narration E2E spec in this repo is black-box (Playwright driving the WordPress admin UI) — none of them intercept the worker's internal `postMessage` traffic (`audio_chunk`, chunk counts). Follow that pattern; do not add worker-message interception as a new test technique.
- This plan implements sub-project A (audio quality) of issue #5 only. Sub-project B (COOP/COEP performance) has its own spec/branch (`fix/issue-5-tts-performance`) and is not touched here.

---

## Task 1: Carry flow-LM/mimi state across chunks within a segment, shrink the internal chunk gap

**Files:**
- Modify: `features/narration/editor/engine/pocket-tts.worker.js:1-11` (attribution header), `:35` (`CHUNK_GAP_SEC`), `:38-39` (reset flags), `:798` (`mimiState` declaration), `:805` (`flowLmState` declaration), `:815-826` (the reset block inside the chunk loop)
- Create: `e2e/narration-audio-quality.spec.ts`

**Interfaces:**
- Consumes: nothing new — uses the existing `chunks`/`chunkIdx` loop, `cloneState`, `initStateFromManifest`, `updateStateFromManifestOutputs` already defined earlier in the file (unchanged).
- Produces: no new exported symbols. Downstream (Task 2) reads the same loop, now without the reset block, and the same `e2e/narration-audio-quality.spec.ts` file, appending a second `test()` to it.

- [ ] **Step 1: Update the file's attribution header to record this deviation from upstream**

Current text at the top of the file (lines 1-11):

```js
/*
 * Derived from `inference-worker.js` in the Pocket TTS ONNX web demo,
 * licensed Apache-2.0. Modified for Post Voice: model files are fetched from a
 * pinned Hugging Face mirror via MODEL_BASE_URL instead of a relative ./onnx/
 * path, the tokenizer import no longer carries a ?v=3 query string, and the
 * ONNX Runtime CDN import is marked webpackIgnore so the bundler leaves it as a
 * runtime URL, and model files are routed through a Cache API interceptor
 * installed by `installModelCache()` below, because Hugging Face serves them
 * with no Cache-Control at all. See CREDITS.md for full attribution. Otherwise
 * unchanged from upstream.
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
 * Also modified: the chunking pipeline no longer resets flow-LM/mimi state
 * between internal chunks of the same segment, the gap between those chunks
 * is shorter, and an oversized sentence is split at a punctuation pause
 * instead of a raw token boundary. See
 * docs/superpowers/specs/2026-08-18-narration-audio-quality-chunking-design.md
 * for why — the demo's defaults were tuned for short standalone phrases, not
 * whole posts.
 */
```

- [ ] **Step 2: Shrink the internal chunk gap**

At line 35:

```js
const CHUNK_GAP_SEC = 0.25;
```

becomes:

```js
const CHUNK_GAP_SEC = 0.06;
```

- [ ] **Step 3: Remove the per-chunk reset flags and the reset block, carry state forward**

At lines 38-39, delete these two lines entirely:

```js
const RESET_FLOW_STATE_EACH_CHUNK = true;
const RESET_MIMI_STATE_EACH_CHUNK = true;
```

At line 798, `mimiState` is never reassigned once the reset block below is gone — change `let` to `const`:

```js
let mimiState = initStateFromManifest(bundleMetadata.mimi_state_manifest);
```
becomes
```js
const mimiState = initStateFromManifest(bundleMetadata.mimi_state_manifest);
```

At line 805, same reasoning — `flowLmState` is mutated in place by `updateStateFromManifestOutputs` but never reassigned once the reset block is gone:

```js
let flowLmState = cloneState(baseFlowState);
```
becomes
```js
const flowLmState = cloneState(baseFlowState);
```

At lines 815-826, the loop currently reads:

```js
    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
        if (!isGenerating) break;

        if (RESET_FLOW_STATE_EACH_CHUNK && chunkIdx > 0) {
            flowLmState = cloneState(baseFlowState);
        }
        if (RESET_MIMI_STATE_EACH_CHUNK && chunkIdx > 0) {
            mimiState = initStateFromManifest(bundleMetadata.mimi_state_manifest);
        }

        const chunkText = chunks[chunkIdx];
        let isFirstAudioChunkOfTextChunk = true;
```

Replace with:

```js
    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
        if (!isGenerating) break;

        const chunkText = chunks[chunkIdx];
        let isFirstAudioChunkOfTextChunk = true;
```

- [ ] **Step 4: Rebuild the plugin so the worker file ships to wp-env**

No PHP is touched by this task, so `npm run refresh:php` (which only
rewrites `features/**/*.php` and `post-voice.php` — see
`scripts/refresh-php.sh`) does not apply here; it is CLAUDE.md's fix for a
different gotcha. `npm run build` alone is what `TESTING.md`'s own E2E
section uses (`npm run build && npm run test:e2e`):

```bash
npm run build
```

- [ ] **Step 5: Create the E2E spec file with the long-paragraph regression scenario**

This is not a red/green TDD test: the spec's own "Métrica de qualidade" decision is that there is no automated oracle for audio quality, so this black-box test passes both before and after the fix (it proves the pipeline doesn't error or hang on a paragraph that produces multiple internal chunks — the actual prosody improvement is judged by ear, see Step 7). Its job is regression coverage for adversarial-length input, following the same black-box pattern as every other file in `e2e/`.

Create `e2e/narration-audio-quality.spec.ts`:

```ts
import { test, expect } from '@wordpress/e2e-test-utils-playwright';
import type { Admin, Editor } from '@wordpress/e2e-test-utils-playwright';
import { openNarrationPanel } from './open-narration-panel';

// Long enough on purpose: this suite exists to exercise multi-chunk paths
// (features/narration/editor/engine/pocket-tts.worker.js splits at ~50 tokens
// per bundle.json's max_token_per_chunk), which "Hello world" style fixtures
// used by every other narration spec never reach.
const LONG_PARAGRAPH =
	'The narrator reads long paragraphs every day, and every day the ' +
	'result sounds a little more mechanical near the middle, as if ' +
	'something quietly resets between each breath. Listeners notice the ' +
	'seams even when they cannot name them, and short posts never show ' +
	'the same problem at all.';

async function createNarratableDraft(
	admin: Admin,
	editor: Editor,
	title: string,
	content: string
) {
	await admin.createNewPost( { title } );
	await editor.insertBlock( {
		name: 'core/paragraph',
		attributes: { content },
	} );
	await editor.saveDraft();
}

test.describe( 'Post Voice — narration audio quality (issue #5)', () => {
	test( 'a long multi-sentence paragraph generates without error across multiple internal chunks', async ( {
		admin,
		editor,
		page,
	} ) => {
		await createNarratableDraft(
			admin,
			editor,
			'Long paragraph narration',
			LONG_PARAGRAPH
		);
		await editor.openDocumentSettingsSidebar();
		await openNarrationPanel( page );
		await page
			.getByRole( 'button', { name: 'Generate audio', exact: true } )
			.click();
		await expect(
			page.getByRole( 'button', { name: 'Save narration', exact: true } )
		).toBeVisible( { timeout: 180_000 } );
		await expect(
			page.locator( '.components-notice.is-error' )
		).toHaveCount( 0 );

		await page
			.getByRole( 'button', { name: 'Save narration', exact: true } )
			.click();
		await expect(
			page.getByRole( 'button', { name: 'Generate again', exact: true } )
		).toBeVisible();

		const postId = await page.evaluate( () =>
			(
				window as unknown as {
					wp: {
						data: {
							select: ( s: string ) => {
								getCurrentPostId: () => number;
							};
						};
					};
				}
			).wp.data.select( 'core/editor' ).getCurrentPostId()
		);
		await page.goto( `/?p=${ postId }` );
		await expect(
			page.locator( '.post-voice-player audio' )
		).toHaveCount( 1 );
	} );
} );
```

- [ ] **Step 6: Run the new test and confirm it passes**

wp-env must already be running (`npx wp-env start`). Run just this file, not the full suite, for fast iteration:

```bash
npx playwright test e2e/narration-audio-quality.spec.ts
```

Expected: PASS (1 test). First run downloads the ~190MB model bundle — expect several minutes; subsequent runs reuse the Cache API storage.

- [ ] **Step 7: Human step — listen to the generated audio, note the result for the PR description**

Not agent-executable: open the published post from the test above (or generate the same `LONG_PARAGRAPH` text through the editor manually) before and after this task's changes, and listen for the seams the issue described — robotic reset and audible gaps every ~8-12 words. Write one or two sentences of what changed for the PR description. This is a manual gate, not a step to mark done from reading code.

- [ ] **Step 8: Commit**

```bash
git add features/narration/editor/engine/pocket-tts.worker.js e2e/narration-audio-quality.spec.ts
git commit -m "fix: carry flow-LM/mimi state across internal chunks, shrink chunk gap

Stops re-conditioning from the base voice at every ~50-token chunk
boundary within a segment — the state tensors are already the right
fixed size (~63MB) and were only ever being thrown away, not reused.
CHUNK_GAP_SEC drops from 250ms to 60ms now that the gap no longer
needs to mask a reset.

Part of issue #5, sub-project A (quality). Spec:
docs/superpowers/specs/2026-08-18-narration-audio-quality-chunking-design.md

Claude-Session: https://claude.ai/code/session_018QM3MK7XcADH5qiW2dbYSA"
```

---

## Task 2: Split oversized sentences at a natural pause instead of a raw token boundary

**Files:**
- Modify: `features/narration/editor/engine/pocket-tts.worker.js:468` (add new function after `splitTokenIdsIntoChunks`), `:497-509` (call site inside `splitIntoBestSentences`)
- Modify: `e2e/narration-audio-quality.spec.ts` (append second test)
- Modify: `TESTING.md:41` (scenario count), `:129-131` (new scenario description — line numbers approximate after Task 1 lands; find by the quoted text, not the number)

**Interfaces:**
- Consumes: `tokenizerProcessor.encodeIds(text: string): number[]` and `splitTokenIdsIntoChunks(tokenIds: number[], maxTokens: number): string[]`, both already defined earlier in the file (Task 1 does not change either).
- Produces: `splitSentenceAtNaturalBreaks(sentenceText: string, maxTokens: number): string[]` — internal to the file, called once, from `splitIntoBestSentences`.

- [ ] **Step 1: Add the natural-break splitting function**

Insert immediately after `splitTokenIdsIntoChunks` (which ends at line 477) and before `splitIntoBestSentences` (which starts at line 479):

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

function splitIntoClauses(text) {
    const matches = text.match(NATURAL_BREAK_RE);
    if (!matches) return [];
    return matches.map((clause) => clause.trim()).filter(Boolean);
}

// Same greedy-accumulation shape as the sentence-combining loop in
// splitIntoBestSentences below, one level down: pack pause-delimited clauses
// into a chunk until the next one would overflow, then start a new chunk.
// A single clause that overflows on its own (no internal pause) falls back to
// splitTokenIdsIntoChunks — the old raw-token cut — for that clause only; the
// rest of the sentence is unaffected.
function splitSentenceAtNaturalBreaks(sentenceText, maxTokens) {
    const clauses = splitIntoClauses(sentenceText);
    if (!clauses.length) {
        return [];
    }

    const chunks = [];
    let currentChunk = "";

    for (const clause of clauses) {
        const clauseTokenIds = tokenizerProcessor.encodeIds(clause);

        if (clauseTokenIds.length > maxTokens) {
            if (currentChunk) {
                chunks.push(currentChunk.trim());
                currentChunk = "";
            }
            for (const rawChunk of splitTokenIdsIntoChunks(clauseTokenIds, maxTokens)) {
                if (rawChunk) {
                    chunks.push(rawChunk.trim());
                }
            }
            continue;
        }

        if (!currentChunk) {
            currentChunk = clause;
            continue;
        }

        const combined = `${currentChunk} ${clause}`;
        const combinedTokens = tokenizerProcessor.encodeIds(combined).length;
        if (combinedTokens > maxTokens) {
            chunks.push(currentChunk.trim());
            currentChunk = clause;
        } else {
            currentChunk = combined;
        }
    }

    if (currentChunk) {
        chunks.push(currentChunk.trim());
    }

    return chunks;
}
```

- [ ] **Step 2: Wire it into `splitIntoBestSentences`, replacing the raw-token call**

At lines 497-509, current code:

```js
        if (sentenceTokens > currentMaxTokenPerChunk) {
            if (currentChunk) {
                chunks.push(currentChunk.trim());
                currentChunk = "";
            }
            const splitChunks = splitTokenIdsIntoChunks(sentenceTokenIds, currentMaxTokenPerChunk);
            for (const splitChunk of splitChunks) {
                if (splitChunk) {
                    chunks.push(splitChunk.trim());
                }
            }
            continue;
        }
```

Replace with:

```js
        if (sentenceTokens > currentMaxTokenPerChunk) {
            if (currentChunk) {
                chunks.push(currentChunk.trim());
                currentChunk = "";
            }
            const splitChunks = splitSentenceAtNaturalBreaks(sentenceText, currentMaxTokenPerChunk);
            for (const splitChunk of splitChunks) {
                if (splitChunk) {
                    chunks.push(splitChunk.trim());
                }
            }
            continue;
        }
```

Note `sentenceTokenIds` (the pre-tokenized array) is no longer read by this branch — `splitSentenceAtNaturalBreaks` re-tokenizes per clause, per the spec's decision to operate on text, not token offsets. `sentenceTokenIds` is still used above this block (to compute `sentenceTokens` for the `if` condition itself), so it stays declared.

- [ ] **Step 3: Rebuild**

No PHP is touched by this task either — same reasoning as Task 1 Step 4,
`npm run refresh:php` does not apply:

```bash
npm run build
```

- [ ] **Step 4: Append the oversized-sentence scenario to the E2E spec**

Add a second `test()` inside the same `test.describe` block in `e2e/narration-audio-quality.spec.ts` (after the one from Task 1), and add this constant near `LONG_PARAGRAPH`:

```ts
// Deliberately over the ~50-token max_token_per_chunk with no early pause:
// comma-heavy clauses, a colon-introduced clause, a parenthetical, and a
// quoted phrase — the exact combination issue #5 reported as cutting mid-word
// or mid-clause under the old raw-token split.
const OVERSIZED_PUNCTUATED_SENTENCE =
	'The engineer explained the failure calmly, in careful detail, ' +
	'walking through each step of the process: the model loaded ' +
	'correctly, the voice cache warmed up as expected, and only then did ' +
	'the narrator turn to the paragraph that had been flagged as ' +
	'suspicious (the one the reviewer quoted directly as "impossible to ' +
	'sit through"), before finally admitting the real cause had been ' +
	'hiding in plain sight the whole time.';
```

New test, appended inside the existing `describe`:

```ts
	test( 'a sentence with commas, a colon, a parenthetical, and a quote past the token limit generates without error', async ( {
		admin,
		editor,
		page,
	} ) => {
		await createNarratableDraft(
			admin,
			editor,
			'Punctuated long sentence narration',
			OVERSIZED_PUNCTUATED_SENTENCE
		);
		await editor.openDocumentSettingsSidebar();
		await openNarrationPanel( page );
		await page
			.getByRole( 'button', { name: 'Generate audio', exact: true } )
			.click();
		await expect(
			page.getByRole( 'button', { name: 'Save narration', exact: true } )
		).toBeVisible( { timeout: 180_000 } );
		await expect(
			page.locator( '.components-notice.is-error' )
		).toHaveCount( 0 );

		await page
			.getByRole( 'button', { name: 'Save narration', exact: true } )
			.click();
		await expect(
			page.getByRole( 'button', { name: 'Generate again', exact: true } )
		).toBeVisible();

		const postId = await page.evaluate( () =>
			(
				window as unknown as {
					wp: {
						data: {
							select: ( s: string ) => {
								getCurrentPostId: () => number;
							};
						};
					};
				}
			).wp.data.select( 'core/editor' ).getCurrentPostId()
		);
		await page.goto( `/?p=${ postId }` );
		await expect(
			page.locator( '.post-voice-player audio' )
		).toHaveCount( 1 );
	} );
```

- [ ] **Step 5: Run the file and confirm both tests pass**

```bash
npx playwright test e2e/narration-audio-quality.spec.ts
```

Expected: PASS (2 tests).

- [ ] **Step 6: Update `TESTING.md`'s E2E scenario count and description**

`TESTING.md` is the document of record for what the E2E suite covers — it
names every scenario and the current total (`npm run test:e2e` | Playwright,
30 scenarios). Leaving it unrevised would put it out of sync with the two
scenarios this plan adds, in a file whose entire job is being that count.

At line 41, the summary table row:

```
| `npm run test:e2e` | Playwright, 30 scenarios | all pass | ~9min |
```
becomes
```
| `npm run test:e2e` | Playwright, 32 scenarios | all pass | ~9min |
```

After the paragraph describing Fase 2's eleven scenarios (ends "...one per
debounced pass rather than one per keystroke — the last two count calls
rather than timing them, so they fail loudly instead of flaking.") and before
the paragraph starting "The thirtieth is the performance ceiling...", insert:

```
Two more, in `narration-audio-quality.spec.ts`, are issue #5's audio-quality
fix: a long multi-sentence paragraph that spans several of the worker's
internal ~50-token chunks, and a single sentence past that limit with commas,
a colon, a parenthetical and a quoted phrase — the combination that used to
cut mid-word under a raw token boundary. Both are black-box like the rest of
this suite: they prove the pipeline completes without error on adversarial
input, not that the audio sounds better — that part is judged by ear and
reported in the PR, per the spec's decision not to chase an automated
prosody metric.
```

Renumber "The thirtieth" to "The thirty-second" in that following paragraph's
opening sentence, since it now describes the 32nd scenario, not the 30th.

- [ ] **Step 7: Human step — listen to the oversized-sentence audio, note the result for the PR description**

Not agent-executable, same caveat as Task 1 Step 7: generate `OVERSIZED_PUNCTUATED_SENTENCE` through the editor before and after this task's change and listen for a clean cut at a pause rather than a cut mid-word or mid-clause. Note the result for the PR description.

- [ ] **Step 8: Commit**

```bash
git add features/narration/editor/engine/pocket-tts.worker.js e2e/narration-audio-quality.spec.ts TESTING.md
git commit -m "fix: split oversized sentences at a punctuation pause, not a raw token cut

splitSentenceAtNaturalBreaks() packs comma/colon/semicolon/closing-quote
/closing-paren-delimited clauses greedily up to the token limit, the
same accumulation shape splitIntoBestSentences already uses for whole
sentences. A clause with no internal pause still falls back to the old
splitTokenIdsIntoChunks() raw-token cut, so this never regresses the
worst case — it only improves the common one.

Part of issue #5, sub-project A (quality). Spec:
docs/superpowers/specs/2026-08-18-narration-audio-quality-chunking-design.md

Claude-Session: https://claude.ai/code/session_018QM3MK7XcADH5qiW2dbYSA"
```

---

## After both tasks

Run the full pre-PR gate from `CLAUDE.md` before opening any pull request — this plan only covers the two tasks above, not the gate itself. If anything in that gate fails, stop and present correction options per `CLAUDE.md`; do not weaken a check to get it green.
