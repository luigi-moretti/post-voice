# Follow-ups

Findings that reviews raised and that were deliberately **not** fixed at the
time, with the reasoning. None of them is a blocker; each was judged smaller
than the risk of widening a change already under review.

Every entry was re-verified against the tree at `975bea2` (end of Fase 2) before
being written here — none is stale, and none describes work already done.

Format: what is wrong, where, why it was deferred, and what fixing it looks like.

---

## Correctness

### `mb_substr` without an explicit encoding

`features/pronunciation/php/class-dictionary-store.php:77-78` calls
`mb_substr( $term, 0, … )` without a third argument, so it relies on the default
encoding. Native mbstring reads `mb_internal_encoding()`, but WordPress's
polyfill reads `get_option( 'blog_charset' )` and **falls back to byte-wise
`substr` when the charset is not UTF-8** (`wp-includes/compat.php:128-137`). On a
site without mbstring and with a non-UTF-8 charset, the original defect returns:
an accented replacement is cut mid-codepoint.

*Fix:* pass `'UTF-8'` explicitly to both calls.

*Note:* the client caps in UTF-16 code units and `mb_substr` counts codepoints,
so astral characters (emoji) still disagree between the two sides — but in the
safe direction, since the server's cap is the looser one.

### `runGeneration` stores an unmeasured RTF where `startGeneration` refuses to

`features/narration/editor/index.tsx:658` does
`rtfByLanguageRef.current.set( calibratedLanguage, rtf )` with no `rtf > 0`
guard; the equivalent write at `:799` has one. A calibration that produces no
measurable audio therefore pins a `0` into the map, and `estimateMultiBundleEta`
prefers it over the fallback for the rest of the session
(`rtf-calibration.ts:81`) — a broken calibration reads as an infinitely fast
device and every duration guard silently stops firing.

Pre-existing; surfaced by the final review rather than introduced by it.

*Fix:* mirror the `rtf > 0` guard at `:658`.

### `cachedBundles()` has no `.catch` in the block inspector's effect

`features/narration/editor/block-narration-attributes.ts:57` calls
`cachedBundles( … ).then( … )` with no rejection handler, so a Cache Storage
failure surfaces as an unhandled rejection in the author's console. The dropdown
degrades correctly to its uncached labels, so this is noise rather than breakage.

*Fix:* `.catch( () => {} )`, matching the pattern used for the staleness effect
in `index.tsx`.

### The warm-up is once per code path, not once per engine

`index.tsx:782` calls `engine.calibrate( voice )` unconditionally without
consulting `rtfByLanguageRef`, so a second "Generate" on a live engine pays
another full sample-phrase synthesis whose audio `cacheSample` then discards (the
key is already present, `index.tsx:578-582`).

Commit `ed31866` removed the *duplicate per generation*; the per-session
duplicate remains. Its message and the spec heading ("Um warm-up por bundle")
both overstate what landed — worth correcting alongside the fix.

*Fix:* consult the memo before calibrating, as `generateSegments` now does.

---

## Test strength

These pass today and would keep passing if the behaviour they name broke. None
is wrong; each is weaker than its name implies.

- **The performance scenario's only functional assertion is
  `segmentCount > 0`** (`e2e/segment-pipeline-perf.spec.ts:126`). It would still
  pass if the dictionary silently stopped substituting. Pinning the expected
  segment count, or one substituted string, costs nothing.
- **The synchronous-seed assertion does not test the seed.** The scenario uses a
  post with one empty paragraph, where an *unseeded* state also reads 0 — so it
  passes identically with or without the `useState` initialiser it exists to
  cover. Settling it needs a saved post *with* content, asserting the
  "nothing to narrate" hint is never visible.
- **`reassemble( [], gap )` — the empty-parts case — has no test**
  (`features/narration/editor/group-segments.ts`).
- **Nothing asserts `mergeAdjacent` leaves the caller's array and objects
  unmutated** (`features/narration/editor/segment.ts`), though it is written to.
- **The a11y gate cannot see the defect it missed.** `narration-a11y.spec.ts:17`
  scopes axe to `.include( '.post-voice-panel' )`, which is exactly why a
  duplicated accessible name across the panel and the block inspector stayed
  green for five commits. The remedy chosen was a process rule in `TESTING.md`;
  the gate's blind spot is unchanged.

---

## Author-facing polish

### Language identifiers leak to the UI in three surfaces

`features/narration/editor/language-labels.ts` claims every surface that shows a
language goes through its map. Three do not:

- the settings screen prints raw codes
  (`features/pronunciation/php/class-settings-page.php:143`);
- the post dictionary's select does too
  (`features/pronunciation/editor/dictionary-panel.tsx:118`);
- the inline format's CSS superscripts `attr(data-pv-lang)`
  (`features/narration/editor/style.scss:278`), rendering `english_2026-04`
  inside the author's paragraph.

The PHP side needs its own label map — the TypeScript one is not reachable from
`class-settings-page.php`.

### The block inspector probes Cache Storage once per block

`block-narration-attributes.ts:52-57`'s effect runs for every eligible block
mounted, not only the selected one, so a 120-paragraph post issues ~120
`caches.open` plus ~600 `cache.match` calls on editor load — for a control only
one block can show at a time.

*Fix:* gate the effect on the block being selected, or hoist the probe to a
shared store.

---

## Documentation and housekeeping

- **The spec's architecture diagram is stale.**
  `docs/superpowers/specs/2026-08-14-post-voice-fase2-design.md` still lists
  `extract-narratable-text.ts`, which was deleted in Task 16 and replaced by
  `extract-segments.ts` + `segment.ts`, and does not list
  `features/pronunciation/admin/settings.ts` at all. The 2026-08-15 amendment
  does not cover this.
- **Scaffolding comments outlived their scaffolding.** `post-voice.php:27` still
  tells future tasks to append their `require_once` "as they land";
  `features/narration/editor/segment.ts:7` still says
  `extract-narratable-text.ts` "goes away in Task 16".
- **`CLAUDE.md:37` claims the local gate list "is the same set
  `.github/workflows/ci.yml` runs",** but CI has no `npx tsc --noEmit` step.
  Pre-existing, unchanged by Fase 2 — either add the step or soften the claim.
- **`build/segment-pipeline-harness.js` ships in a normal build.** It is the
  E2E-only performance harness; nothing enqueues it outside
  `e2e/mu-plugins/segment-pipeline-harness.php`, but this repo has no release
  packaging step that would strip it from a distribution zip. Worth handling if
  one is ever added.
- **An unreachable guard.** `index.tsx:450-452`'s `if ( cancelled ) return;`
  inside the timeout cannot fire — the cleanup clears the timer, so the callback
  never runs after cancellation.

---

## Open question, not a finding

Whether `getBlocks()` is already populated when `NarrationPanel` mounts at editor
boot, on every supported WordPress build. If it is not, the synchronous seed
reads 0 and the panel briefly shows "Nothing to narrate yet" with Generate
disabled until the debounced pass lands ~300 ms later. It is self-correcting —
the effect re-runs when `blocks` arrives — so the worst case is the flash the
seed exists to prevent, not a stuck state.

Settling it needs the E2E described under **Test strength** above.
