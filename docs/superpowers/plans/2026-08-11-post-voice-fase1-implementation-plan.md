# Post Voice — Fase 1 (MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Post Voice WordPress plugin Fase 1 — an editor panel that generates client-side (Pocket TTS, WASM) narration audio for a post, saves it to the Media Library, and plays it back through a sticky mobile-first player on the frontend.

**Architecture:** Feature-based plugin (`features/narration/{php,editor,frontend,tests}/`), PHP orchestrates only (never runs TTS), all inference happens in a Web Worker in the browser. REST endpoint is a thin "here's a finished audio blob, attach it to this post" upsert. See [`docs/superpowers/specs/2026-08-08-wp-narration-plugin-mvp-design.md`](../specs/2026-08-08-wp-narration-plugin-mvp-design.md) (approved spec, "Aprovado para planejamento de implementação") for full rationale — this plan implements it task by task and does not re-litigate decisions already closed there.

**Tech Stack:** PHP 8.2+ (no runtime Composer deps — WP core only), TypeScript/React (`@wordpress/scripts`), Web Workers + ONNX Runtime Web (CDN, not an npm dependency), `lamejs` for MP3 encoding, Playwright + `@wordpress/e2e-test-utils-playwright` for E2E, PHPUnit (`wp-phpunit`) for PHP, Jest for TS.

**Repo location:** New, separate repository at `/home/luigi/Documentos/projects/post-voice/` (repo root == plugin folder, matches the spec's architecture tree). The `pocket-tts` repo (where this plan and the spec live) stays reference-only — it is never the plugin's codebase, per the spec's Contexto section. All file paths below are relative to that new repo root unless stated otherwise.

**Source material ported from `pocket-tts` (reference repo):**
- `inference-worker.js` → vendored into `features/narration/editor/engine/pocket-tts.worker.js` with one targeted diff (Task 2).
- `float32ToWavBlob()` math (`onnx-streaming.js`) → reused as the Float32→Int16 conversion inside `mp3-encoder.ts` (Task 6), MP3 instead of WAV per the spec's "Formato de áudio salvo" decision.

## Global Constraints

- PHP minimum: **8.2**. WP minimum: **6.6** (spec: "WP/PHP mínimos suportados").
- Text domain: `post-voice`. REST namespace: `post-voice/v1`. PHP class prefix: `Post_Voice_*`. No PSR-4/Composer autoload for runtime code — plain `require_once` in bootstrap (spec: "Nome/slug real do plugin").
- Post type: **`post` only**. No `page`/CPT support in Fase 1 (spec: "Quais post types").
- Exactly **1 audio per post**, always upsert — saving replaces and deletes the previous attachment (spec: "Áudio por post").
- Audio format saved to Media Library: **MP3, 64kbps mono, fixed (not configurable)**, encoded client-side via `lamejs` right before upload (spec: "Formato de áudio salvo"). Model output is Float32 PCM @ 24kHz mono.
- REST contract: `POST /wp-json/post-voice/v1/posts/{post_id}/narration`, `multipart/form-data` (`audio`, `language`, `source_hash`), `X-WP-Nonce` auth. `permission_callback` requires `edit_post` **and** `upload_files`, and rejects `auto-draft` posts with 409 (spec: "Contrato do endpoint REST", "Capability `upload_files`", "Post sem ID ainda").
- Post meta keys (exactly these 3, no others): `_narration_attachment_id`, `_narration_language`, `_narration_source_hash`. `post_parent` of the attachment = the post ID (spec: "`post_parent` do attachment").
- Symmetric cleanup: `before_delete_post` deletes the attachment; `delete_attachment` clears the post's narration meta (spec: "`post_parent` do attachment", flow steps 8–9).
- Coverage gates (CI-enforced): PHP (`features/*/php/`) ≥85% line; TS pure functions (block-filter, hash, RTF/ETA, MP3 encode, player state machine) ≥80% line; TS glue (worker wrapper, React panel, REST client, worker itself) has **no** % target — verified by the 8 mandatory E2E scenarios instead (spec: "Qualidade e testes", coverage table).
- 8 mandatory E2E scenarios gate CI: happy path · fallback without `crossOriginIsolated` · cancel mid-generation · insufficient storage · regenerate replaces/cleans attachment · axe zero serious/critical violations (editor + frontend) · full keyboard navigation of the player · respects `prefers-reduced-motion` (spec: "Cenários E2E obrigatórios").
- Every user-facing string goes through `__()`/`_x()` from the first commit; `.pot` generated in CI (spec: "i18n").
- Dependency audit thresholds (spec: "Auditoria de dependências"): `npm audit --omit=dev` → 0 critical/0 high; full `npm audit` → 1 critical/5 high/10 moderate; `composer audit` → 0 critical/0 high. CI always uses `npm ci`/`composer install`, never bare `install`.
- Model source: our own Hugging Face mirror, pinned to a commit SHA, never `KevinAHM/pocket-tts-onnx` directly and never `resolve/main` (spec: "Pin de versão do modelo").
- **One manual, non-automatable step this whole plan needs from you:** running Task 1's `hf upload` yourself (needs your own HF login) and pasting the resulting commit SHA into `model-source.ts`. Namespace is already known — `luigi-moretti`. Nothing else in this plan requires manual decisions — everything else is fully specified.

---

## Execution Order

**Task numbers below are stable identifiers, not the running order.** Execute in the sequence in this table — it is dependency-correct. Task 11 builds the toolchain (`package.json`, `jest.config.js`, `tsconfig.json`, `webpack.config.js`, `composer.json`) that every other task's verification commands invoke, so it runs first; the numbering stayed put so task IDs remain stable across the plan's cross-references.

| Order | Task | Why here |
|---|---|---|
| 1 | **11** — tooling scaffold + bootstrap | Everything else runs `npm run test:unit` / `npx tsc` / `composer run test`. Nothing can be verified before this exists. |
| 2 | **1** — model mirror + `model-source.ts` | Needs Jest (Task 11). Blocks the worker. |
| 3 | **2** — vendor the worker | Imports `MODEL_BASE_URL`. |
| 4 | **3** — `tts-engine.ts` | Wraps the worker. |
| 5 | **4** — `extract-narratable-text.ts` | Pure, independent. |
| 6 | **5** — `source-hash.ts` | Pure, independent. |
| 7 | **6** — `rtf-calibration.ts` | Pure, independent. |
| 8 | **25** — `storage-check.ts` | Pure, independent. New task (closes the storage-precheck gap Task 19 tests for). |
| 9 | **7** — `mp3-encoder.ts` | Pure, independent. |
| 10 | **8** — `player-state.ts` | Pure, independent. |
| 11 | **9** — `narration-api.ts` | Needs the REST contract to be settled (it is — Global Constraints). |
| 12 | **12** — `class-post-meta.php` | First PHP class; appends its own bootstrap wiring. |
| 13 | **13** — `class-rest-api.php` | Consumes post meta. |
| 14 | **14** — `class-attachment-cleanup.php` | Consumes post meta. |
| 15 | **15** — `class-assets.php` | Needs build output names pinned (Task 11's `webpack.config.js`). |
| 16 | **16** — `class-frontend-render.php` | Consumes post meta. |
| 17 | **10** — `index.tsx` editor panel | Consumes nearly every TS module above. |
| 18 | **17** — `player.ts` | Consumes `player-state.ts` + Task 16's markup. |
| 19 | **18** — `.wp-env.json` + COOP/COEP | Needed before any E2E run. |
| 20 | **19** — E2E core scenarios | Needs the full stack built. |
| 21 | **20** — E2E accessibility | Needs the full stack built. |
| 22 | **21** — audit scripts | Independent tooling. |
| 23 | **22** — PHP coverage gate | Needs the PHPUnit suite to exist. |
| 24 | **23** — CI workflow | Wires up everything above. |
| 25 | **24** — i18n + `readme.txt` | Needs the panel's strings to exist. |

**Incremental bootstrap wiring:** `post-voice.php` (Task 11) ships with constants only — no `require_once` of feature classes. Each PHP task (12, 13, 14, 15, 16) appends its own `require_once` line and its own registration call as part of that task. A bootstrap that requires files which don't exist yet is a fatal error the moment PHPUnit's bootstrap loads the plugin, which is exactly what Task 12's test run does.

---

## File Structure

```
post-voice/
├── post-voice.php
├── composer.json, composer.lock, phpcs.xml.dist, phpstan.neon, phpunit.xml.dist
├── package.json, tsconfig.json, webpack.config.js, .eslintrc.js, .prettierrc.js, jest.config.js
├── test/jest.setup.js
├── .wp-env.json
├── .github/workflows/ci.yml
├── scripts/
│   ├── audit-check.mjs
│   ├── audit-check-composer.mjs
│   └── check-coverage-threshold.php
├── docs/mirror-readme-template.md
├── features/narration/
│   ├── php/
│   │   ├── class-post-meta.php
│   │   ├── class-rest-api.php
│   │   ├── class-assets.php
│   │   ├── class-attachment-cleanup.php
│   │   └── class-frontend-render.php
│   ├── editor/
│   │   ├── index.tsx
│   │   ├── narration-api.ts
│   │   ├── extract-narratable-text.ts
│   │   ├── source-hash.ts
│   │   ├── rtf-calibration.ts
│   │   ├── storage-check.ts
│   │   ├── mp3-encoder.ts
│   │   ├── model-source.ts
│   │   └── engine/
│   │       ├── tts-engine.ts
│   │       └── pocket-tts.worker.js
│   ├── frontend/
│   │   ├── player.ts
│   │   └── player-state.ts
│   └── tests/
│       ├── php/ (+ fixtures/sample.mp3, fixtures/asset-editor-fixture/)
│       └── js/
├── e2e/
│   ├── mu-plugins/coop-coep-headers.php (mapped via .wp-env.json)
│   ├── fixtures/sample.mp3
│   ├── narration.spec.ts
│   ├── narration-fallbacks.spec.ts
│   └── narration-a11y.spec.ts
├── languages/.gitkeep
└── readme.txt
```

Each PHP class in `features/narration/php/` has one responsibility (meta, REST, assets, cleanup, frontend render), matching the spec's "só orquestra" principle — none of them contain TTS logic. `shared/` is **not** created in Fase 1: only one feature exists, so there is nothing to share yet (spec: "Não cria pasta vazia... enfeite morto até a fase existir de fato" — same YAGNI principle applied here).

---

### Task 1: Model mirror on Hugging Face + `model-source.ts`

**Files:**
- Create: `docs/mirror-readme-template.md`
- Create: `features/narration/editor/model-source.ts`
- Test: `features/narration/tests/js/model-source.test.ts`

**Interfaces:**
- Produces: `MODEL_BASE_URL: string`, `SUPPORTED_LANGUAGES: readonly string[]`, `SupportedLanguage` type — consumed by Task 2 (worker) and Task 9 (editor panel language selector).

This task requires your own Hugging Face account — it can't be scripted end-to-end by an agent. Everything else in the plan is pure code.

- [ ] **Step 1: Write the mirror README template**

```md
# Pocket TTS ONNX — Post Voice mirror

Mirror of the 5 language bundles (`english_2026-04`, `german`, `italian`, `portuguese`, `spanish`) used by the [Post Voice](https://github.com/<org>/post-voice) WordPress plugin.

- Base model weights: [kyutai/pocket-tts](https://huggingface.co/kyutai/pocket-tts), licensed CC-BY-4.0.
- ONNX export code (not mirrored here — offline conversion tooling, never runs in the browser): [KevinAHM/pocket-tts-onnx](https://huggingface.co/KevinAHM/pocket-tts-onnx), licensed Apache-2.0.

This mirror exists so the plugin has a version-pinned, self-controlled source for the model files instead of depending on a third party's personal repo staying available forever — see the Fase 1 spec's "Pin de versão do modelo" section for the full rationale.
```

Save to `docs/mirror-readme-template.md`.

Namespace confirmed (`hf auth whoami`): **`luigi-moretti`**. CLI installed via the official install script (`curl -LsSf https://hf.co/cli/install.sh | bash`), so commands below use the current `hf` entry point, not the older `huggingface-cli` (same tool, renamed).

**Mirror source is the local `pocket-tts` reference checkout, not a fresh download from upstream.** Verified against the upstream repo's file listing on 2026-08-11, which changed this step materially:

- Upstream stores bundles under `onnx/<language>/`, not `<language>/` at the repo root.
- Upstream ships **both** fp32 and int8 variants of all five models (13 files/language). The worker loads only the `_int8.onnx` set (`MODEL_STEMS` in `pocket-tts.worker.js`), so mirroring upstream verbatim would roughly double the mirror for files that are never fetched.
- Upstream has **no `voices.bin`**. That file is generated locally by `scripts/export_voice_bins.py`, and the worker needs it: without it `predefinedVoiceRecords` stays empty, `defaultVoice` is null, and generation dies with "Voice conditioning cache missing".

The local checkout at `/home/luigi/Documentos/projects/test/pocket-tts/onnx/` already contains exactly the right shape — int8 models only, plus `voices.bin` — at 190MB per language, 950MB total for the five.

- [ ] **Step 2: Verify the local bundles are complete before uploading**

```bash
SRC=/home/luigi/Documentos/projects/test/pocket-tts/onnx
for lang in english_2026-04 german italian portuguese spanish; do
  echo "== $lang =="
  ls "$SRC/$lang" | sort
done
```

Expected, for every one of the five: `bos_before_voice.npy`, `bundle.json`, `flow_lm_flow_int8.onnx`, `flow_lm_main_int8.onnx`, `mimi_decoder_int8.onnx`, `mimi_encoder_int8.onnx`, `text_conditioner_int8.onnx`, `tokenizer.model`, `voices.bin` — nine files, ~190MB. A language missing `voices.bin` cannot produce audio; stop and regenerate it with `scripts/export_voice_bins.py` before continuing.

- [ ] **Step 3: Stage the mirror and upload**

```bash
STAGE=~/post-voice-mirror-stage
SRC=/home/luigi/Documentos/projects/test/pocket-tts/onnx
mkdir -p "$STAGE"
for lang in english_2026-04 german italian portuguese spanish; do
  cp -r "$SRC/$lang" "$STAGE/$lang"
done
cp docs/mirror-readme-template.md "$STAGE/README.md"

hf repo create luigi-moretti/pocket-tts-onnx-mirror --type model -y
hf upload luigi-moretti/pocket-tts-onnx-mirror "$STAGE" . \
  --commit-message "Initial mirror: 5 supported language bundles (int8 + voices.bin)"
```

This publishes ~950MB to a public repo and can take a long time on a home connection; run it detached rather than blocking on it.

Note the layout deliberately flattens `onnx/<lang>/` to `<lang>/` at the mirror root, because `MODEL_BASE_URL` already ends in a slash and the worker appends `<language>/<file>` directly.

- [ ] **Step 4: Capture the pinned commit SHA**

```bash
curl -s https://huggingface.co/api/models/luigi-moretti/pocket-tts-onnx-mirror | \
  python3 -c "import json,sys; print(json.load(sys.stdin)['sha'])"
```

That SHA is what `model-source.ts` pins. Do not use `main`.

- [ ] **Step 5: Write `model-source.ts` with the real pinned SHA**

```ts
// Pinned to our own Hugging Face mirror, never upstream `KevinAHM/pocket-tts-onnx`
// directly and never `resolve/main` — see "Pin de versão do modelo" in the Fase 1 spec.
// Bumping this is a deliberate action: new PR, smoke test all 5 languages + E2E, then merge.
export const MODEL_BASE_URL =
  'https://huggingface.co/luigi-moretti/pocket-tts-onnx-mirror/resolve/<COMMIT_SHA_FROM_STEP_4>/';

export const SUPPORTED_LANGUAGES = [
  'english_2026-04',
  'german',
  'italian',
  'portuguese',
  'spanish',
] as const;

export type SupportedLanguage = ( typeof SUPPORTED_LANGUAGES )[ number ];
```

Replace `<COMMIT_SHA_FROM_STEP_4>` with the real SHA captured in Step 4 before committing — this file must never contain a literal placeholder token in the committed version. The namespace is already resolved.

- [ ] **Step 6: Write the test**

```ts
import { MODEL_BASE_URL, SUPPORTED_LANGUAGES } from '../../editor/model-source';

describe( 'model-source', () => {
  it( 'points at a pinned commit on our own mirror, not upstream or `resolve/main`', () => {
    expect( MODEL_BASE_URL ).toMatch( /^https:\/\/huggingface\.co\/[^/]+\/pocket-tts-onnx-mirror\/resolve\/[0-9a-f]{7,40}\/$/ );
    expect( MODEL_BASE_URL ).not.toContain( 'KevinAHM' );
    expect( MODEL_BASE_URL ).not.toContain( '/resolve/main' );
  } );

  it( 'lists exactly the 5 supported languages', () => {
    expect( SUPPORTED_LANGUAGES ).toEqual( [
      'english_2026-04', 'german', 'italian', 'portuguese', 'spanish',
    ] );
  } );
} );
```

- [ ] **Step 7: Run the test**

Run: `npm run test:unit -- model-source`
Expected: PASS (2/2). If it fails on the SHA regex, double-check Step 5's replacement.

- [ ] **Step 8: Commit**

```bash
git add docs/mirror-readme-template.md features/narration/editor/model-source.ts features/narration/tests/js/model-source.test.ts
git commit -m "feat: pin Pocket TTS model source to our own HF mirror"
```

---

### Task 2: Vendor the inference worker

**Files:**
- Create: `features/narration/editor/engine/pocket-tts.worker.js`

**Interfaces:**
- Consumes: `MODEL_BASE_URL` from `../model-source.ts` (Task 1).
- Produces: `postMessage` contract consumed by `tts-engine.ts` (Task 3) — message types `status`, `voices_loaded`, `bundle_loaded`, `loaded`, `audio_chunk`, `stream_ended`, `error`; accepts `{type:'load'}`, `{type:'set_language', data:{language}}`, `{type:'generate', data:{text, voice}}`, `{type:'stop'}`.

This is a numeric ONNX inference pipeline that already works in the reference repo — it is copied verbatim, not rewritten, to avoid transcription risk. It's TS-glue-tier per the spec's coverage table (no Jest %, verified by E2E) since it's inseparable from a real ONNX Runtime + WASM environment.

- [ ] **Step 1: Copy the file verbatim**

```bash
cp /home/luigi/Documentos/projects/test/pocket-tts/inference-worker.js \
   features/narration/editor/engine/pocket-tts.worker.js
```

- [ ] **Step 2: Apply the one required diff — model URL comes from our pinned mirror, not a relative `./onnx/` path**

Find (near the top of the file):

```js
function bundleDir(language) {
    return `./onnx/${language}`;
}
```

Replace with:

```js
import { MODEL_BASE_URL } from '../model-source';

function bundleDir(language) {
    return `${MODEL_BASE_URL}${language}`;
}
```

The import is **extensionless on purpose**. `model-source` is a `.ts` file; `@wordpress/scripts`' webpack config sets `resolve.extensions` to include `.ts` but leaves `resolve.extensionAlias` undefined, so a `'../model-source.js'` specifier would look for a literal `model-source.js` and fail to resolve at build time.

No other line changes — `MODEL_STEMS`, `LANGUAGE_BUNDLES`, the tokenizer/voice-loading/generation pipeline are already correct as copied.

- [ ] **Step 3: Manual smoke check**

This file has no automated unit tests (glue-tier, per Global Constraints). Verify it loads syntactically:

Run: `node --check features/narration/editor/engine/pocket-tts.worker.js`
Expected: no output (valid syntax). Full behavioral verification happens in Task 3's manual check and the Task 19 E2E happy-path scenario.

- [ ] **Step 4: Commit**

```bash
git add features/narration/editor/engine/pocket-tts.worker.js
git commit -m "feat: vendor Pocket TTS inference worker, point at pinned model mirror"
```

---

### Task 3: `tts-engine.ts` — typed Promise wrapper around the worker

**Files:**
- Create: `features/narration/editor/engine/tts-engine.ts`

**Interfaces:**
- Consumes: the worker's message contract from Task 2.
- Produces: `class PocketTtsEngine` with `load(language: string): Promise<void>`, `calibrate(): Promise<{rtf: number}>`, `generate(text: string, options: GenerateOptions): Promise<Float32Array>`, `dispose(): void`, `sampleRate: number` — consumed by the React panel (Task 9).

Glue-tier per spec's coverage table (wraps ONNX Runtime/Worker — mocking it for a % number would test nothing real). No Jest steps here; verified by Task 19's E2E happy path and cancel scenario.

- [ ] **Step 1: Implement the engine wrapper**

```ts
export interface GenerateOptions {
  voice: string;
  signal?: AbortSignal;
}

export interface CalibrationResult {
  rtf: number;
}

const CALIBRATION_TEXT = 'Isto é um teste rápido de calibração de desempenho.';
const AVERAGE_CHARACTERS_PER_SECOND_OF_SPEECH = 15;

export class PocketTtsEngine {
  private worker: Worker | null = null;
  private ready = false;
  public sampleRate = 24000;

  async load( language: string ): Promise<void> {
    this.worker = new Worker(
      new URL( './pocket-tts.worker.js', import.meta.url ),
      { type: 'module' }
    );

    await new Promise<void>( ( resolve, reject ) => {
      if ( ! this.worker ) return reject( new Error( 'Worker not created' ) );
      const onMessage = ( e: MessageEvent ) => {
        const { type, sampleRate, error } = e.data;
        if ( type === 'loaded' ) {
          this.ready = true;
          if ( sampleRate ) this.sampleRate = sampleRate;
          this.worker?.removeEventListener( 'message', onMessage );
          resolve();
        } else if ( type === 'error' ) {
          this.worker?.removeEventListener( 'message', onMessage );
          reject( new Error( error ) );
        }
      };
      this.worker.addEventListener( 'message', onMessage );
      this.worker.postMessage( { type: 'load' } );
    } );

    if ( language !== 'english_2026-04' ) {
      await this.setLanguage( language );
    }
  }

  private setLanguage( language: string ): Promise<void> {
    return new Promise( ( resolve, reject ) => {
      if ( ! this.worker ) return reject( new Error( 'Engine not loaded' ) );
      const onMessage = ( e: MessageEvent ) => {
        if ( e.data.type === 'bundle_loaded' ) {
          this.worker?.removeEventListener( 'message', onMessage );
          resolve();
        } else if ( e.data.type === 'error' ) {
          this.worker?.removeEventListener( 'message', onMessage );
          reject( new Error( e.data.error ) );
        }
      };
      this.worker.addEventListener( 'message', onMessage );
      this.worker.postMessage( { type: 'set_language', data: { language } } );
    } );
  }

  async calibrate(): Promise<CalibrationResult> {
    const start = performance.now();
    await this.generate( CALIBRATION_TEXT, { voice: 'default' } );
    const elapsedMs = performance.now() - start;
    const estimatedDurationSec = CALIBRATION_TEXT.length / AVERAGE_CHARACTERS_PER_SECOND_OF_SPEECH;
    return { rtf: elapsedMs / 1000 / estimatedDurationSec };
  }

  generate( text: string, options: GenerateOptions ): Promise<Float32Array> {
    return new Promise( ( resolve, reject ) => {
      if ( ! this.worker || ! this.ready ) {
        return reject( new Error( 'Engine not loaded' ) );
      }

      const chunks: Float32Array[] = [];

      const cleanup = () => {
        this.worker?.removeEventListener( 'message', onMessage );
        options.signal?.removeEventListener( 'abort', onAbort );
      };

      const onAbort = () => {
        this.worker?.postMessage( { type: 'stop' } );
        cleanup();
        reject( new DOMException( 'Generation cancelled', 'AbortError' ) );
      };
      options.signal?.addEventListener( 'abort', onAbort, { once: true } );

      const onMessage = ( e: MessageEvent ) => {
        const { type, data, error } = e.data;
        if ( type === 'audio_chunk' ) {
          chunks.push( new Float32Array( data ) );
        } else if ( type === 'stream_ended' ) {
          cleanup();
          resolve( concatFloat32( chunks ) );
        } else if ( type === 'error' ) {
          cleanup();
          reject( new Error( error ) );
        }
      };

      this.worker.addEventListener( 'message', onMessage );
      this.worker.postMessage( { type: 'generate', data: { text, voice: options.voice } } );
    } );
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
  }
}

function concatFloat32( chunks: Float32Array[] ): Float32Array {
  const total = chunks.reduce( ( sum, c ) => sum + c.length, 0 );
  const out = new Float32Array( total );
  let offset = 0;
  for ( const chunk of chunks ) {
    out.set( chunk, offset );
    offset += chunk.length;
  }
  return out;
}
```

- [ ] **Step 2: Manual smoke check**

Run: `npx tsc --noEmit` (project-wide type check, `tsconfig.json` from Task 15).
Expected: no errors referencing `tts-engine.ts`. Full behavioral verification happens in Task 19 (E2E happy path + cancel scenario).

- [ ] **Step 3: Commit**

```bash
git add features/narration/editor/engine/tts-engine.ts
git commit -m "feat: typed Promise wrapper around the Pocket TTS worker"
```

---

### Task 4: `extract-narratable-text.ts` — pure block-filter

**Files:**
- Create: `features/narration/editor/extract-narratable-text.ts`
- Test: `features/narration/tests/js/extract-narratable-text.test.ts`

**Interfaces:**
- Produces: `extractNarratableText(blocks: EditorBlock[]): string` — consumed by the React panel (Task 9).

Pure function, ≥80% coverage target (spec: "TS lógica pura").

- [ ] **Step 1: Write the failing tests**

```ts
import { extractNarratableText } from '../../editor/extract-narratable-text';

describe( 'extractNarratableText', () => {
  it( 'includes paragraph and heading content, stripping inline markup', () => {
    const blocks = [
      { name: 'core/heading', attributes: { content: 'Title' }, innerBlocks: [] },
      { name: 'core/paragraph', attributes: { content: 'Hello <strong>world</strong>.' }, innerBlocks: [] },
    ];
    expect( extractNarratableText( blocks ) ).toBe( 'Title Hello world.' );
  } );

  it( 'excludes code, table, gallery and custom HTML blocks', () => {
    const blocks = [
      { name: 'core/code', attributes: { content: 'const x = 1;' }, innerBlocks: [] },
      { name: 'core/table', attributes: {}, innerBlocks: [] },
      { name: 'core/gallery', attributes: {}, innerBlocks: [] },
      { name: 'core/html', attributes: { content: '<div>raw</div>' }, innerBlocks: [] },
    ];
    expect( extractNarratableText( blocks ) ).toBe( '' );
  } );

  it( 'recurses into list items and quotes nested inside a group block', () => {
    const blocks = [
      {
        name: 'core/group',
        attributes: {},
        innerBlocks: [
          {
            name: 'core/list',
            attributes: {},
            innerBlocks: [
              { name: 'core/list-item', attributes: { content: 'First item' }, innerBlocks: [] },
              { name: 'core/list-item', attributes: { content: 'Second item' }, innerBlocks: [] },
            ],
          },
          {
            name: 'core/quote',
            attributes: {},
            innerBlocks: [
              { name: 'core/paragraph', attributes: { content: 'A quoted line.' }, innerBlocks: [] },
            ],
          },
        ],
      },
    ];
    expect( extractNarratableText( blocks ) ).toBe( 'First item Second item A quoted line.' );
  } );

  it( 'collapses whitespace and trims the final result', () => {
    const blocks = [
      { name: 'core/paragraph', attributes: { content: '  spaced   out  ' }, innerBlocks: [] },
    ];
    expect( extractNarratableText( blocks ) ).toBe( 'spaced out' );
  } );
} );
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- extract-narratable-text`
Expected: FAIL — module `extract-narratable-text` not found.

- [ ] **Step 3: Implement**

```ts
const ELIGIBLE_BLOCK_NAMES = new Set( [
  'core/paragraph',
  'core/heading',
  'core/list',
  'core/list-item',
  'core/quote',
] );

export interface EditorBlock {
  name: string;
  attributes: Record<string, unknown>;
  innerBlocks: EditorBlock[];
}

function stripHtml( html: string ): string {
  return html.replace( /<[^>]*>/g, '' ).replace( /&nbsp;/g, ' ' ).trim();
}

function extractBlockText( block: EditorBlock ): string {
  const parts: string[] = [];

  if ( ELIGIBLE_BLOCK_NAMES.has( block.name ) ) {
    const content = block.attributes?.content;
    if ( typeof content === 'string' && content.trim() ) {
      parts.push( stripHtml( content ) );
    }
  }

  for ( const inner of block.innerBlocks ?? [] ) {
    const innerText = extractBlockText( inner );
    if ( innerText ) parts.push( innerText );
  }

  return parts.join( ' ' );
}

export function extractNarratableText( blocks: EditorBlock[] ): string {
  return blocks
    .map( extractBlockText )
    .filter( Boolean )
    .join( ' ' )
    .replace( /\s+/g, ' ' )
    .trim();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- extract-narratable-text`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add features/narration/editor/extract-narratable-text.ts features/narration/tests/js/extract-narratable-text.test.ts
git commit -m "feat: extract narratable text from eligible block types"
```

---

### Task 5: `source-hash.ts` — pure hash function

**Files:**
- Create: `features/narration/editor/source-hash.ts`
- Test: `features/narration/tests/js/source-hash.test.ts`

**Interfaces:**
- Produces: `computeSourceHash(text: string): Promise<string>` (64-char lowercase hex SHA-256) — consumed by the editor panel (Task 10) and compared against the `_narration_source_hash` meta (Task 12) to detect staleness.

The Web Crypto polyfill this needs (`test/jest.setup.js`) already exists — Task 11 created it.

- [ ] **Step 1: Write the failing tests**

```ts
import { computeSourceHash } from '../../editor/source-hash';

describe( 'computeSourceHash', () => {
  it( 'produces a 64-character lowercase hex SHA-256 digest', async () => {
    const hash = await computeSourceHash( 'hello world' );
    expect( hash ).toMatch( /^[0-9a-f]{64}$/ );
  } );

  it( 'is deterministic for the same input', async () => {
    const a = await computeSourceHash( 'same text' );
    const b = await computeSourceHash( 'same text' );
    expect( a ).toBe( b );
  } );

  it( 'changes when input changes', async () => {
    const a = await computeSourceHash( 'text A' );
    const b = await computeSourceHash( 'text B' );
    expect( a ).not.toBe( b );
  } );
} );
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- source-hash`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
export async function computeSourceHash( text: string ): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode( text );
  const digest = await crypto.subtle.digest( 'SHA-256', data );
  return Array.from( new Uint8Array( digest ) )
    .map( ( b ) => b.toString( 16 ).padStart( 2, '0' ) )
    .join( '' );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- source-hash`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add features/narration/editor/source-hash.ts features/narration/tests/js/source-hash.test.ts
git commit -m "feat: SHA-256 source-hash for staleness detection"
```

---

### Task 6: `rtf-calibration.ts` — pure RTF/ETA math

**Files:**
- Create: `features/narration/editor/rtf-calibration.ts`
- Test: `features/narration/tests/js/rtf-calibration.test.ts`

**Interfaces:**
- Produces: `computeRtf`, `estimateAudioDurationSeconds`, `estimateEtaSeconds`, `shouldWarnSlowDevice`, `requiresLongTextConfirmation` — consumed by the React panel (Task 9). Implements spec's "Requisitos de hardware e calibração" (RTF>3 warns, ETA>120s requires confirmation).

- [ ] **Step 1: Write the failing tests**

```ts
import {
  computeRtf,
  estimateAudioDurationSeconds,
  estimateEtaSeconds,
  requiresLongTextConfirmation,
  shouldWarnSlowDevice,
} from '../../editor/rtf-calibration';

describe( 'computeRtf', () => {
  it( 'returns 1 when processing time equals audio duration (real-time)', () => {
    expect( computeRtf( 2, 2000 ) ).toBe( 1 );
  } );
  it( 'returns 0 for non-positive elapsed time', () => {
    expect( computeRtf( 2, 0 ) ).toBe( 0 );
  } );
} );

describe( 'estimateAudioDurationSeconds', () => {
  it( 'scales with text length', () => {
    expect( estimateAudioDurationSeconds( 150 ) ).toBe( 10 );
  } );
} );

describe( 'estimateEtaSeconds', () => {
  it( 'multiplies rtf by estimated audio duration', () => {
    expect( estimateEtaSeconds( 2, 30 ) ).toBe( 60 );
  } );
} );

describe( 'shouldWarnSlowDevice', () => {
  it( 'warns only above 3x real-time', () => {
    expect( shouldWarnSlowDevice( 3.1 ) ).toBe( true );
    expect( shouldWarnSlowDevice( 3 ) ).toBe( false );
  } );
} );

describe( 'requiresLongTextConfirmation', () => {
  it( 'requires confirmation only above 2 minutes ETA', () => {
    expect( requiresLongTextConfirmation( 121 ) ).toBe( true );
    expect( requiresLongTextConfirmation( 120 ) ).toBe( false );
  } );
} );
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- rtf-calibration`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
export const SLOW_RTF_WARNING_THRESHOLD = 3; // RTF > 3x real-time triggers a non-blocking warning
export const LONG_TEXT_CONFIRMATION_ETA_SECONDS = 120; // ETA above this asks for explicit confirmation before generating
const AVERAGE_CHARACTERS_PER_SECOND_OF_SPEECH = 15; // rough heuristic; refined per-device by the real measured RTF

export function computeRtf( warmupAudioDurationSec: number, warmupElapsedMs: number ): number {
  if ( warmupElapsedMs <= 0 ) return 0;
  return warmupElapsedMs / 1000 / warmupAudioDurationSec;
}

export function estimateAudioDurationSeconds( textLength: number ): number {
  if ( textLength <= 0 ) return 0;
  return textLength / AVERAGE_CHARACTERS_PER_SECOND_OF_SPEECH;
}

export function estimateEtaSeconds( rtf: number, estimatedAudioDurationSec: number ): number {
  if ( rtf <= 0 ) return 0;
  return rtf * estimatedAudioDurationSec;
}

export function shouldWarnSlowDevice( rtf: number ): boolean {
  return rtf > SLOW_RTF_WARNING_THRESHOLD;
}

export function requiresLongTextConfirmation( etaSeconds: number ): boolean {
  return etaSeconds > LONG_TEXT_CONFIRMATION_ETA_SECONDS;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- rtf-calibration`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add features/narration/editor/rtf-calibration.ts features/narration/tests/js/rtf-calibration.test.ts
git commit -m "feat: RTF/ETA calibration math"
```

---

### Task 7: `mp3-encoder.ts` — pure MP3 encoding via lamejs

**Files:**
- Modify: `package.json` (add `lamejs` dependency)
- Create: `features/narration/editor/mp3-encoder.ts`
- Test: `features/narration/tests/js/mp3-encoder.test.ts`

**Interfaces:**
- Produces: `floatTo16BitPCM(float32: Float32Array): Int16Array`, `encodeMp3(float32Audio: Float32Array, sampleRate: number): Blob` — consumed by the React panel (Task 9) between preview and save.

- [ ] **Step 1: Add the dependency**

```bash
npm install lamejs@^1.2.1
```

- [ ] **Step 2: Write the failing tests**

```ts
import { encodeMp3, floatTo16BitPCM } from '../../editor/mp3-encoder';

describe( 'floatTo16BitPCM', () => {
  it( 'scales and clamps float samples to the int16 range', () => {
    const input = new Float32Array( [ 0, 1, -1, 2, -2 ] );
    const output = floatTo16BitPCM( input );
    expect( output[ 0 ] ).toBe( 0 );
    expect( output[ 1 ] ).toBe( 0x7fff );
    expect( output[ 2 ] ).toBe( -0x8000 );
    expect( output[ 3 ] ).toBe( 0x7fff ); // clamped
    expect( output[ 4 ] ).toBe( -0x8000 ); // clamped
  } );
} );

describe( 'encodeMp3', () => {
  it( 'produces a non-empty MP3 blob with a valid frame sync word', async () => {
    const sampleRate = 24000;
    const samples = new Float32Array( sampleRate * 0.5 );
    for ( let i = 0; i < samples.length; i++ ) {
      samples[ i ] = Math.sin( ( 2 * Math.PI * 440 * i ) / sampleRate ) * 0.5;
    }

    const blob = encodeMp3( samples, sampleRate );
    expect( blob.size ).toBeGreaterThan( 0 );
    expect( blob.type ).toBe( 'audio/mpeg' );

    const bytes = new Uint8Array( await blob.arrayBuffer() );
    expect( bytes[ 0 ] ).toBe( 0xff );
    expect( bytes[ 1 ] & 0xe0 ).toBe( 0xe0 ); // MP3 frame sync word
  } );
} );
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test:unit -- mp3-encoder`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```ts
import lamejs from 'lamejs';

const MP3_BITRATE_KBPS = 64; // spec: "Formato de áudio salvo" — fixed, not configurable in Fase 1
const SAMPLES_PER_FRAME = 1152;

export function floatTo16BitPCM( float32: Float32Array ): Int16Array {
  const out = new Int16Array( float32.length );
  for ( let i = 0; i < float32.length; i++ ) {
    const s = Math.max( -1, Math.min( 1, float32[ i ] ) );
    out[ i ] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function encodeMp3( float32Audio: Float32Array, sampleRate: number ): Blob {
  const pcm = floatTo16BitPCM( float32Audio );
  const encoder = new lamejs.Mp3Encoder( 1, sampleRate, MP3_BITRATE_KBPS );
  const chunks: Int8Array[] = [];

  for ( let i = 0; i < pcm.length; i += SAMPLES_PER_FRAME ) {
    const chunk = pcm.subarray( i, i + SAMPLES_PER_FRAME );
    const encoded = encoder.encodeBuffer( chunk );
    if ( encoded.length > 0 ) chunks.push( encoded );
  }
  const finalChunk = encoder.flush();
  if ( finalChunk.length > 0 ) chunks.push( finalChunk );

  return new Blob( chunks, { type: 'audio/mpeg' } );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:unit -- mp3-encoder`
Expected: PASS (2/2).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json features/narration/editor/mp3-encoder.ts features/narration/tests/js/mp3-encoder.test.ts
git commit -m "feat: MP3 encoding (64kbps mono) via lamejs"
```

---

### Task 8: `player-state.ts` — pure frontend player state machine

**Files:**
- Create: `features/narration/frontend/player-state.ts`
- Test: `features/narration/tests/js/player-state.test.ts`

**Interfaces:**
- Produces: `PlayerState`, `createInitialPlayerState()`, `togglePlaying(state)`, `cycleRate(state)`, `closePlayer(state)` — consumed by `player.ts` (Task 13).

- [ ] **Step 1: Write the failing tests**

```ts
import { closePlayer, createInitialPlayerState, cycleRate, togglePlaying } from '../../frontend/player-state';

describe( 'player-state', () => {
  it( 'starts paused, at 1x, not closed', () => {
    expect( createInitialPlayerState() ).toEqual( { playing: false, rate: 1, closed: false } );
  } );

  it( 'toggles playing', () => {
    const state = togglePlaying( createInitialPlayerState() );
    expect( state.playing ).toBe( true );
    expect( togglePlaying( state ).playing ).toBe( false );
  } );

  it( 'cycles through playback rates and wraps around', () => {
    let state = createInitialPlayerState();
    const seen = [ state.rate ];
    for ( let i = 0; i < 5; i++ ) {
      state = cycleRate( state );
      seen.push( state.rate );
    }
    expect( seen ).toEqual( [ 1, 1.25, 1.5, 2, 0.75, 1 ] );
  } );

  it( 'closing stops playback and marks closed', () => {
    const playing = togglePlaying( createInitialPlayerState() );
    const closed = closePlayer( playing );
    expect( closed ).toEqual( { playing: false, rate: 1, closed: true } );
  } );
} );
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- player-state`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
export interface PlayerState {
  playing: boolean;
  rate: number;
  closed: boolean;
}

const PLAYBACK_RATES = [ 1, 1.25, 1.5, 2, 0.75 ];

export function createInitialPlayerState(): PlayerState {
  return { playing: false, rate: 1, closed: false };
}

export function togglePlaying( state: PlayerState ): PlayerState {
  return { ...state, playing: ! state.playing };
}

export function cycleRate( state: PlayerState ): PlayerState {
  const currentIndex = PLAYBACK_RATES.indexOf( state.rate );
  const nextRate = PLAYBACK_RATES[ ( currentIndex + 1 ) % PLAYBACK_RATES.length ];
  return { ...state, rate: nextRate };
}

export function closePlayer( state: PlayerState ): PlayerState {
  return { ...state, playing: false, closed: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- player-state`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add features/narration/frontend/player-state.ts features/narration/tests/js/player-state.test.ts
git commit -m "feat: pure player state machine (play/pause/rate/close)"
```

---

### Task 9: `narration-api.ts` — REST client

**Files:**
- Create: `features/narration/editor/narration-api.ts`

**Interfaces:**
- Produces: `saveNarration(postId: number, audio: Blob, language: string, sourceHash: string): Promise<SaveNarrationResponse>` — consumed by the React panel (Task 10). Talks to the REST contract from Task 12 (PHP).

Glue-tier (network call), no Jest unit test — verified by Task 19's E2E happy path, which exercises the real save round-trip.

- [ ] **Step 1: Implement**

```ts
export interface SaveNarrationResponse {
  attachment_id: number;
  url: string;
  generated_at: string;
  language: string;
}

declare const wpApiSettings: { root: string; nonce: string };

export async function saveNarration(
  postId: number,
  audio: Blob,
  language: string,
  sourceHash: string
): Promise<SaveNarrationResponse> {
  const formData = new FormData();
  formData.append( 'audio', audio, 'narration.mp3' );
  formData.append( 'language', language );
  formData.append( 'source_hash', sourceHash );

  const response = await fetch( `${ wpApiSettings.root }post-voice/v1/posts/${ postId }/narration`, {
    method: 'POST',
    headers: { 'X-WP-Nonce': wpApiSettings.nonce },
    body: formData,
  } );

  const data = await response.json();
  if ( ! response.ok ) {
    throw new Error( data.message || 'Failed to save narration.' );
  }
  return data as SaveNarrationResponse;
}
```

- [ ] **Step 2: Manual smoke check**

Run: `npx tsc --noEmit`
Expected: no errors referencing `narration-api.ts`.

- [ ] **Step 3: Commit**

```bash
git add features/narration/editor/narration-api.ts
git commit -m "feat: REST client for saving narration"
```

---

### Task 10: `index.tsx` — the "Narração" editor panel

**Files:**
- Create: `features/narration/editor/index.tsx`

**Interfaces:**
- Consumes: `PocketTtsEngine` (Task 3), `SUPPORTED_LANGUAGES` (Task 1), `extractNarratableText` (Task 4), `computeSourceHash` (Task 5), `estimateAudioDurationSeconds`/`estimateEtaSeconds`/`requiresLongTextConfirmation`/`shouldWarnSlowDevice` (Task 6), `hasEnoughStorage`/`formatBytes`/`LANGUAGE_BUNDLE_BYTES` (Task 25), `encodeMp3` (Task 7), `saveNarration` (Task 9).
- Produces: registers the `PluginSidebar` named `post-voice-panel`, rendering `.post-voice-panel` (targeted by the a11y E2E test in Task 20).

Glue-tier React UI, no Jest unit test — verified by the E2E suite (Tasks 19–20), matching the spec's own coverage tiering ("componentes React do painel" listed explicitly as E2E-only).

Three behaviours here are load-bearing for the spec's approved UI (see "UI/UX do painel 'Narração' (aprovado)") and for two mandatory E2E scenarios — do not drop them while simplifying:

1. **Storage pre-check before the model downloads.** `navigator.storage.estimate()` runs *before* `engine.load()`, and a failing check aborts with a visible error instead of spending ~190MB of the author's bandwidth. This is the implementation the "insufficient storage" E2E scenario asserts against.
2. **Stale badge.** The panel recomputes the current text's hash on every render and compares it to the saved `_narration_source_hash` meta; a mismatch shows "may be out of date". Non-blocking, never auto-regenerates (spec: "Fluxo de dados" step 7).
3. **Existing-audio state.** When the post already has narration, the panel shows the generation date, the badge, and an inline `<audio>` player, with the primary button reading "Generate again" (spec's approved Option C mockup).

- [ ] **Step 1: Implement the panel**

```tsx
import { registerPlugin } from '@wordpress/plugins';
import { PluginSidebar, PluginSidebarMoreMenuItem } from '@wordpress/editor';
import { useSelect, useDispatch } from '@wordpress/data';
import { useState, useRef, useEffect, useCallback } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { dateI18n } from '@wordpress/date';
import { store as noticesStore } from '@wordpress/notices';

import { PocketTtsEngine } from './engine/tts-engine';
import { SUPPORTED_LANGUAGES } from './model-source';
import { extractNarratableText } from './extract-narratable-text';
import { computeSourceHash } from './source-hash';
import {
  estimateAudioDurationSeconds,
  estimateEtaSeconds,
  requiresLongTextConfirmation,
  shouldWarnSlowDevice,
} from './rtf-calibration';
import { hasEnoughStorage, formatBytes, LANGUAGE_BUNDLE_BYTES } from './storage-check';
import { encodeMp3 } from './mp3-encoder';
import { saveNarration } from './narration-api';

type PanelState = 'idle' | 'calibrating' | 'confirming-long-text' | 'generating' | 'saving' | 'error';

interface ExistingNarration {
  url: string;
  generatedAt: string;
}

function NarrationPanel() {
  const [ state, setState ] = useState< PanelState >( 'idle' );
  const [ language, setLanguage ] = useState< string >( 'portuguese' );
  const [ etaSeconds, setEtaSeconds ] = useState< number | null >( null );
  const [ previewUrl, setPreviewUrl ] = useState< string | null >( null );
  const [ error, setError ] = useState< string | null >( null );
  const [ existing, setExisting ] = useState< ExistingNarration | null >( null );
  const [ isStale, setIsStale ] = useState( false );

  const previewBlobRef = useRef< Blob | null >( null );
  const abortRef = useRef< AbortController | null >( null );
  const engineRef = useRef< PocketTtsEngine | null >( null );

  const { postId, blocks, postStatus, meta } = useSelect( ( select ) => {
    const editor = select( 'core/editor' ) as any;
    return {
      postId: editor.getCurrentPostId(),
      blocks: ( select( 'core/block-editor' ) as any ).getBlocks(),
      postStatus: editor.getEditedPostAttribute( 'status' ),
      meta: editor.getEditedPostAttribute( 'meta' ) || {},
    };
  }, [] );

  const { createErrorNotice } = useDispatch( noticesStore );

  const attachmentId = meta._narration_attachment_id as number | undefined;
  const savedHash = meta._narration_source_hash as string | undefined;

  // Load the existing attachment's URL and date so the panel can show a real
  // inline player instead of just claiming audio exists.
  useEffect( () => {
    let cancelled = false;
    if ( ! attachmentId ) {
      setExisting( null );
      return;
    }
    apiFetch( { path: `/wp/v2/media/${ attachmentId }` } )
      .then( ( media: any ) => {
        if ( ! cancelled ) {
          setExisting( { url: media.source_url, generatedAt: media.date_gmt } );
        }
      } )
      .catch( () => {
        // Attachment vanished (deleted straight from the Media Library). The
        // delete_attachment hook clears the meta server-side; nothing to show here.
        if ( ! cancelled ) setExisting( null );
      } );
    return () => {
      cancelled = true;
    };
  }, [ attachmentId ] );

  // Recompute the current text hash and compare against what was saved.
  useEffect( () => {
    let cancelled = false;
    if ( ! savedHash ) {
      setIsStale( false );
      return;
    }
    computeSourceHash( extractNarratableText( blocks ) ).then( ( currentHash ) => {
      if ( ! cancelled ) setIsStale( currentHash !== savedHash );
    } );
    return () => {
      cancelled = true;
    };
  }, [ blocks, savedHash ] );

  const setPreview = useCallback( ( blob: Blob | null ) => {
    setPreviewUrl( ( previous ) => {
      if ( previous ) URL.revokeObjectURL( previous );
      return blob ? URL.createObjectURL( blob ) : null;
    } );
    previewBlobRef.current = blob;
  }, [] );

  const runGeneration = useCallback(
    async ( text: string ) => {
      setState( 'generating' );
      abortRef.current = new AbortController();
      const audio = await engineRef.current!.generate( text, {
        voice: 'default',
        signal: abortRef.current.signal,
      } );
      setPreview( encodeMp3( audio, engineRef.current!.sampleRate ) );
      setState( 'idle' );
    },
    [ setPreview ]
  );

  const startGeneration = useCallback( async () => {
    setError( null );
    setState( 'calibrating' );
    try {
      const text = extractNarratableText( blocks );
      if ( ! text ) {
        throw new Error( __( 'No readable text found in this post.', 'post-voice' ) );
      }

      // Check storage BEFORE downloading ~190MB of model, not after.
      if ( ! engineRef.current && navigator.storage?.estimate ) {
        const estimate = await navigator.storage.estimate();
        if ( ! hasEnoughStorage( estimate ) ) {
          throw new Error(
            sprintf(
              /* translators: %s: required free storage, e.g. "285 MB". */
              __(
                'Not enough free storage to download the voice model. About %s of free space is needed.',
                'post-voice'
              ),
              formatBytes( LANGUAGE_BUNDLE_BYTES * 1.5 )
            )
          );
        }
      }

      if ( ! engineRef.current ) {
        engineRef.current = new PocketTtsEngine();
        await engineRef.current.load( language );
      }

      const { rtf } = await engineRef.current.calibrate();
      const eta = estimateEtaSeconds( rtf, estimateAudioDurationSeconds( text.length ) );
      setEtaSeconds( eta );

      if ( requiresLongTextConfirmation( eta ) ) {
        setState( 'confirming-long-text' );
        return;
      }

      if ( shouldWarnSlowDevice( rtf ) ) {
        createErrorNotice(
          __( 'This device is slower than usual for narration — it may take a while.', 'post-voice' ),
          { type: 'snackbar' }
        );
      }

      await runGeneration( text );
    } catch ( err ) {
      if ( ( err as Error ).name === 'AbortError' ) {
        setState( 'idle' );
        return;
      }
      setState( 'error' );
      setError( ( err as Error ).message );
    }
  }, [ blocks, language, runGeneration, createErrorNotice ] );

  const cancelGeneration = useCallback( () => {
    abortRef.current?.abort();
    setState( 'idle' );
  }, [] );

  const confirmSave = useCallback( async () => {
    const blob = previewBlobRef.current;
    if ( ! blob ) return;
    setState( 'saving' );
    try {
      const sourceHash = await computeSourceHash( extractNarratableText( blocks ) );
      const saved = await saveNarration( postId, blob, language, sourceHash );
      setPreview( null );
      setExisting( { url: saved.url, generatedAt: saved.generated_at } );
      setIsStale( false );
      setState( 'idle' );
    } catch ( err ) {
      setState( 'error' );
      setError( ( err as Error ).message );
    }
  }, [ blocks, language, postId, setPreview ] );

  const isAutoDraft = postStatus === 'auto-draft';
  const isBusy = state !== 'idle' && state !== 'error';

  return (
    <>
      <PluginSidebarMoreMenuItem target="post-voice-panel">
        { __( 'Narration', 'post-voice' ) }
      </PluginSidebarMoreMenuItem>
      <PluginSidebar name="post-voice-panel" title={ __( 'Narration', 'post-voice' ) }>
        <div className="post-voice-panel">
          { error && <p role="alert">{ error }</p> }

          { isAutoDraft && <p>{ __( 'Save the post first to generate narration.', 'post-voice' ) }</p> }

          { existing && ! previewUrl && (
            <div className="post-voice-panel__status">
              <p>
                { sprintf(
                  /* translators: %s: date the narration audio was generated. */
                  __( 'Generated on %s', 'post-voice' ),
                  dateI18n( 'F j, Y', existing.generatedAt )
                ) }
              </p>
              <p className="post-voice-panel__badge">
                { isStale
                  ? __( 'May be out of date — the post text changed since this was generated.', 'post-voice' )
                  : __( 'Up to date', 'post-voice' ) }
              </p>
              <audio controls src={ existing.url } />
            </div>
          ) }

          { ! existing && ! previewUrl && ! isAutoDraft && (
            <p>{ __( 'No audio generated yet.', 'post-voice' ) }</p>
          ) }

          <select
            value={ language }
            onChange={ ( e ) => setLanguage( e.target.value ) }
            disabled={ isBusy }
            aria-label={ __( 'Narration language', 'post-voice' ) }
          >
            { SUPPORTED_LANGUAGES.map( ( lang ) => (
              <option key={ lang } value={ lang }>
                { lang }
              </option>
            ) ) }
          </select>

          { state === 'confirming-long-text' && (
            <div>
              <p>
                { sprintf(
                  /* translators: %d: estimated generation time in seconds. */
                  __( 'This text is long — estimated time: %d seconds.', 'post-voice' ),
                  Math.round( etaSeconds ?? 0 )
                ) }
              </p>
              <button onClick={ () => runGeneration( extractNarratableText( blocks ) ) }>
                { __( 'Generate anyway', 'post-voice' ) }
              </button>
              <button onClick={ () => setState( 'idle' ) }>{ __( 'Cancel', 'post-voice' ) }</button>
            </div>
          ) }

          { ( state === 'generating' || state === 'calibrating' ) && (
            <div>
              <p>{ __( 'Generating…', 'post-voice' ) }</p>
              <button onClick={ cancelGeneration }>{ __( 'Cancel', 'post-voice' ) }</button>
            </div>
          ) }

          { previewUrl && ! isBusy && (
            <div>
              <audio controls src={ previewUrl } />
              <button onClick={ confirmSave }>{ __( 'Save narration', 'post-voice' ) }</button>
            </div>
          ) }

          { ! previewUrl && ! isBusy && (
            <button onClick={ startGeneration } disabled={ isAutoDraft }>
              { existing
                ? __( 'Generate again', 'post-voice' )
                : __( 'Generate audio', 'post-voice' ) }
            </button>
          ) }
        </div>
      </PluginSidebar>
    </>
  );
}

registerPlugin( 'post-voice', { render: NarrationPanel, icon: 'microphone' } );
```

- [ ] **Step 2: Manual smoke check**

Run: `npx tsc --noEmit`
Expected: no errors referencing `index.tsx`. Full behavioral verification happens in Tasks 19–20's E2E suite, which exercises the storage pre-check, the stale badge, and the existing-audio state directly.

- [ ] **Step 3: Commit**

```bash
git add features/narration/editor/index.tsx
git commit -m "feat: Narration editor panel (PluginSidebar)"
```


---

### Task 11: `post-voice.php` bootstrap + build tooling scaffold

**Files:**
- Create: `post-voice.php`
- Create: `package.json`, `tsconfig.json`, `.eslintrc.js`, `.prettierrc.js`, `jest.config.js`
- Create: `composer.json`, `phpcs.xml.dist`, `phpstan.neon`

**Interfaces:**
- Produces: `POST_VOICE_VERSION`, `POST_VOICE_PATH`, `POST_VOICE_URL` constants — consumed by Task 15 (`class-assets.php`).

- [ ] **Step 1: Write the plugin bootstrap**

```php
<?php
/**
 * Plugin Name: Post Voice
 * Description: Gera narração em áudio de posts 100% no navegador (client-side TTS), com voice cloning via Pocket TTS.
 * Version: 0.1.0
 * Requires at least: 6.6
 * Requires PHP: 8.2
 * Text Domain: post-voice
 * Domain Path: /languages
 * License: GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

define( 'POST_VOICE_VERSION', '0.1.0' );
define( 'POST_VOICE_PATH', plugin_dir_path( __FILE__ ) );
define( 'POST_VOICE_URL', plugin_dir_url( __FILE__ ) );

// Feature classes are required and registered incrementally — Tasks 12-16 each
// append their own `require_once` + registration below as they land. Requiring a
// file that does not exist yet is a fatal error the moment PHPUnit's bootstrap
// loads this plugin, so this list only ever names files already committed.

- [ ] **Step 2: `package.json`**

```json
{
  "name": "post-voice",
  "version": "0.1.0",
  "private": true,
  "license": "GPL-2.0-or-later",
  "scripts": {
    "build": "wp-scripts build",
    "start": "wp-scripts start",
    "lint:js": "wp-scripts lint-js",
    "format": "wp-scripts format",
    "test:unit": "wp-scripts test-unit-js",
    "test:e2e": "playwright test",
    "i18n:pot": "wp-scripts build-language-pack post-voice --pot-only"
  },
  "devDependencies": {
    "@wordpress/scripts": "^30.0.0",
    "@wordpress/eslint-plugin": "^22.0.0",
    "@axe-core/playwright": "^4.10.0",
    "@playwright/test": "^1.48.0",
    "@wordpress/e2e-test-utils-playwright": "^1.16.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 3: `webpack.config.js` — pin the two entry names**

`wp-scripts build` with default config derives output filenames from entry basenames, which would emit `index.js`/`player.js`. The PHP enqueue in Task 15 expects `narration-editor.js` and `narration-player.js`, so the entry names are pinned explicitly here rather than left to a default the PHP would have to guess at.

```js
const defaultConfig = require( '@wordpress/scripts/config/webpack.config' );
const path = require( 'path' );

module.exports = {
  ...defaultConfig,
  entry: {
    'narration-editor': path.resolve( __dirname, 'features/narration/editor/index.tsx' ),
    'narration-player': path.resolve( __dirname, 'features/narration/frontend/player.ts' ),
  },
  output: {
    ...defaultConfig.output,
    path: path.resolve( __dirname, 'build' ),
  },
};
```

Verify after a real build (later, once entry files exist) that `build/` contains exactly `narration-editor.js`, `narration-editor.asset.php`, `narration-player.js`, `narration-player.asset.php`.

- [ ] **Step 4: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": [ "features" ]
}
```

- [ ] **Step 5: `.eslintrc.js` / `.prettierrc.js` (uses `@wordpress/eslint-plugin`'s recommended config, which already bundles `eslint-plugin-jsx-a11y` — spec: "A11y — enforcement automatizado em CI")**

```js
// .eslintrc.js
module.exports = {
  extends: [ 'plugin:@wordpress/eslint-plugin/recommended' ],
  parserOptions: {
    project: './tsconfig.json',
  },
};
```

```js
// .prettierrc.js
module.exports = require( '@wordpress/scripts/config/.prettierrc.js' );
```

- [ ] **Step 6: `test/jest.setup.js` — Web Crypto polyfill for the jsdom environment**

`crypto.subtle` is not exposed in Jest's jsdom environment by default; `source-hash.ts` (Task 5) needs it. Created here rather than in Task 5 because `jest.config.js` references it in the very next step — a config pointing at a missing setup file fails every test run, including tasks that land before Task 5.

```js
// test/jest.setup.js
const { webcrypto } = require( 'node:crypto' );
if ( ! globalThis.crypto ) {
  globalThis.crypto = webcrypto;
}
```

- [ ] **Step 7: `jest.config.js` — coverage gate at 80% for the pure-function tier**

```js
const defaultConfig = require( '@wordpress/scripts/config/jest-unit.config' );

module.exports = {
  ...defaultConfig,
  setupFiles: [ ...( defaultConfig.setupFiles || [] ), '<rootDir>/test/jest.setup.js' ],
  collectCoverageFrom: [
    'features/narration/editor/extract-narratable-text.ts',
    'features/narration/editor/source-hash.ts',
    'features/narration/editor/rtf-calibration.ts',
    'features/narration/editor/storage-check.ts',
    'features/narration/editor/mp3-encoder.ts',
    'features/narration/editor/model-source.ts',
    'features/narration/frontend/player-state.ts',
  ],
  coverageThreshold: {
    global: { lines: 80 },
  },
};
```

- [ ] **Step 8: `composer.json` (dev-only — no runtime PHP deps, per spec's audit rationale) + `phpcs.xml.dist` + `phpstan.neon`**

```json
{
  "name": "post-voice/post-voice",
  "description": "Post Voice WordPress plugin — dev tooling only, no runtime dependencies.",
  "license": "GPL-2.0-or-later",
  "require": {},
  "require-dev": {
    "php": ">=8.2",
    "squizlabs/php_codesniffer": "^3.10",
    "wp-coding-standards/wpcs": "^3.1",
    "phpcompatibility/phpcompatibility-wp": "^2.1",
    "phpstan/phpstan": "^1.12",
    "szepeviktor/phpstan-wordpress": "^1.3",
    "phpunit/phpunit": "^9.6",
    "yoast/phpunit-polyfills": "^3.0",
    "wp-phpunit/wp-phpunit": "^6.6"
  },
  "config": {
    "allow-plugins": {
      "dealerdirect/phpcodesniffer-composer-installer": true
    }
  },
  "scripts": {
    "lint": "phpcs",
    "stan": "phpstan analyse",
    "test": "phpunit"
  }
}
```

```xml
<!-- phpcs.xml.dist -->
<?xml version="1.0"?>
<ruleset name="Post Voice">
    <file>.</file>
    <exclude-pattern>/build/*</exclude-pattern>
    <exclude-pattern>/node_modules/*</exclude-pattern>
    <exclude-pattern>/vendor/*</exclude-pattern>
    <rule ref="WordPress"/>
    <rule ref="PHPCompatibilityWP"/>
    <config name="testVersion" value="8.2-"/>
    <config name="minimum_wp_version" value="6.6"/>
</ruleset>
```

```neon
# phpstan.neon
includes:
    - vendor/szepeviktor/phpstan-wordpress/extension.neon
parameters:
    level: 6
    paths:
        - features
    excludePaths:
        - build
```

- [ ] **Step 9: Install and verify the toolchain actually boots**

```bash
npm install
composer install
npx tsc --noEmit
npx jest --listTests
composer run lint -- --version
```

Expected: `npm install` and `composer install` complete. `npx jest --listTests` prints an empty list without crashing (proves `jest.config.js` and the setup file resolve). `composer run lint -- --version` prints a PHPCS version (proves WPCS installed and the ruleset parses). `composer run lint` itself must exit 0 — CI gates on it (Task 23), so a red lint here is a red build later; note that PHPCS must be scoped to `.php` files only, since JavaScript is ESLint's job in this project.

`npx tsc --noEmit` is expected to FAIL at this point with `TS18003: No inputs were found in config file` — `tsconfig.json` includes `features/`, which is still empty. This is real TypeScript behavior, not a misconfiguration, and it resolves itself the moment the first task adds a file under `features/`. Do not "fix" it by weakening `tsconfig.json`.

This is the gate for every later task: if any of these five commands fails here, no other task's verification steps can be trusted.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: plugin bootstrap + build/lint/test tooling scaffold"
```

---

### Task 12: `class-post-meta.php` — narration post meta

**Files:**
- Create: `features/narration/php/class-post-meta.php`
- Create: `tests/php/bootstrap.php`, `phpunit.xml.dist`
- Modify: `post-voice.php` (append this feature's `require_once` + `Post_Voice_Post_Meta::register()`)
- Test: `features/narration/tests/php/test-post-meta.php`

**Interfaces:**
- Produces: `Post_Voice_Post_Meta::ATTACHMENT_ID/LANGUAGE/SOURCE_HASH` constants, `register()`, `get_attachment_id(int): int`, `save(int, int, string, string): void`, `clear(int): void`, `auth_callback($allowed, $meta_key, $post_id): bool` — consumed by Task 13 (REST), Task 14 (assets), Task 15 (cleanup hooks), Task 16 (frontend render).

Exposes the 3 meta keys via `register_post_meta( ..., show_in_rest: true )` so the editor panel (Task 10) can read existing narration state straight from the post's own REST payload (`wp.data`) — no separate GET endpoint needed, matching "Backend só orquestra" and closing an otherwise-undiscussed gap (how does the panel know about existing audio on reopen) using an existing WP mechanism instead of new surface area.

- [ ] **Step 1: Write the PHPUnit bootstrap (wp-phpunit based, no full wp-env needed for unit tests)**

```php
<?php
// tests/php/bootstrap.php
$_tests_dir = getenv( 'WP_PHPUNIT__DIR' ) ?: __DIR__ . '/../../vendor/wp-phpunit/wp-phpunit';

require $_tests_dir . '/includes/functions.php';

function _post_voice_manually_load_plugin(): void {
    require dirname( __DIR__, 2 ) . '/post-voice.php';
}
tests_add_filter( 'muplugins_loaded', '_post_voice_manually_load_plugin' );

require $_tests_dir . '/includes/bootstrap.php';
```

```xml
<!-- phpunit.xml.dist -->
<?xml version="1.0"?>
<phpunit bootstrap="tests/php/bootstrap.php" colors="true">
    <testsuites>
        <testsuite name="post-voice">
            <directory>features/narration/tests/php</directory>
        </testsuite>
    </testsuites>
    <coverage>
        <include>
            <directory suffix=".php">features</directory>
        </include>
    </coverage>
    <logging>
        <log type="coverage-clover" target="coverage/clover.xml"/>
    </logging>
</phpunit>
```

- [ ] **Step 2: Write the failing test**

```php
<?php
// features/narration/tests/php/test-post-meta.php
class Test_Post_Voice_Post_Meta extends WP_UnitTestCase {
    public function test_save_writes_all_three_meta_keys(): void {
        $post_id = self::factory()->post->create();
        Post_Voice_Post_Meta::save( $post_id, 42, 'portuguese', str_repeat( 'a', 64 ) );

        $this->assertSame( 42, Post_Voice_Post_Meta::get_attachment_id( $post_id ) );
        $this->assertSame( 'portuguese', get_post_meta( $post_id, Post_Voice_Post_Meta::LANGUAGE, true ) );
        $this->assertSame( str_repeat( 'a', 64 ), get_post_meta( $post_id, Post_Voice_Post_Meta::SOURCE_HASH, true ) );
    }

    public function test_clear_removes_all_three_meta_keys(): void {
        $post_id = self::factory()->post->create();
        Post_Voice_Post_Meta::save( $post_id, 42, 'portuguese', str_repeat( 'a', 64 ) );

        Post_Voice_Post_Meta::clear( $post_id );

        $this->assertSame( 0, Post_Voice_Post_Meta::get_attachment_id( $post_id ) );
        $this->assertSame( '', get_post_meta( $post_id, Post_Voice_Post_Meta::LANGUAGE, true ) );
        $this->assertSame( '', get_post_meta( $post_id, Post_Voice_Post_Meta::SOURCE_HASH, true ) );
    }

    public function test_auth_callback_requires_edit_post_capability(): void {
        $post_id = self::factory()->post->create();

        $subscriber = self::factory()->user->create( [ 'role' => 'subscriber' ] );
        wp_set_current_user( $subscriber );
        $this->assertFalse( Post_Voice_Post_Meta::auth_callback( true, Post_Voice_Post_Meta::LANGUAGE, $post_id ) );

        $editor = self::factory()->user->create( [ 'role' => 'editor' ] );
        wp_set_current_user( $editor );
        $this->assertTrue( Post_Voice_Post_Meta::auth_callback( true, Post_Voice_Post_Meta::LANGUAGE, $post_id ) );
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `WP_PHPUNIT__DIR=vendor/wp-phpunit/wp-phpunit composer run test -- --filter Test_Post_Voice_Post_Meta`
Expected: FAIL — class `Post_Voice_Post_Meta` not found.

- [ ] **Step 4: Implement**

```php
<?php
declare(strict_types=1);

class Post_Voice_Post_Meta {
    public const ATTACHMENT_ID = '_narration_attachment_id';
    public const LANGUAGE      = '_narration_language';
    public const SOURCE_HASH   = '_narration_source_hash';

    public static function auth_callback( $allowed, $meta_key, $post_id ): bool {
        return current_user_can( 'edit_post', $post_id );
    }

    public static function register(): void {
        $args = [
            'single'        => true,
            'show_in_rest'  => true,
            'auth_callback' => [ self::class, 'auth_callback' ],
        ];

        register_post_meta( 'post', self::ATTACHMENT_ID, array_merge( $args, [ 'type' => 'integer' ] ) );
        register_post_meta( 'post', self::LANGUAGE, array_merge( $args, [ 'type' => 'string' ] ) );
        register_post_meta( 'post', self::SOURCE_HASH, array_merge( $args, [ 'type' => 'string' ] ) );
    }

    public static function get_attachment_id( int $post_id ): int {
        return (int) get_post_meta( $post_id, self::ATTACHMENT_ID, true );
    }

    public static function save( int $post_id, int $attachment_id, string $language, string $source_hash ): void {
        update_post_meta( $post_id, self::ATTACHMENT_ID, $attachment_id );
        update_post_meta( $post_id, self::LANGUAGE, $language );
        update_post_meta( $post_id, self::SOURCE_HASH, $source_hash );
    }

    public static function clear( int $post_id ): void {
        delete_post_meta( $post_id, self::ATTACHMENT_ID );
        delete_post_meta( $post_id, self::LANGUAGE );
        delete_post_meta( $post_id, self::SOURCE_HASH );
    }
}
```

- [ ] **Step 5: Wire the class into `post-voice.php`**

Append to `post-voice.php`, below the constants. Until this lands, `Post_Voice_Post_Meta` is undefined the moment PHPUnit's bootstrap loads the plugin, so this must happen before the tests can pass.

```php
require_once POST_VOICE_PATH . 'features/narration/php/class-post-meta.php';

add_action( 'plugins_loaded', static function (): void {
    Post_Voice_Post_Meta::register();
} );
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `WP_PHPUNIT__DIR=vendor/wp-phpunit/wp-phpunit composer run test -- --filter Test_Post_Voice_Post_Meta`
Expected: PASS (3/3).

- [ ] **Step 7: Commit**

```bash
git add post-voice.php tests/php/bootstrap.php phpunit.xml.dist features/narration/php/class-post-meta.php features/narration/tests/php/test-post-meta.php
git commit -m "feat: narration post meta (attachment id, language, source hash)"
```

---

### Task 13: `class-rest-api.php` — the narration REST endpoint

**Files:**
- Create: `features/narration/php/class-rest-api.php`
- Create: `features/narration/tests/php/fixtures/sample.mp3` (tiny silent MP3 fixture)
- Modify: `post-voice.php` (append this feature's `require_once` + the `rest_api_init` hook)
- Test: `features/narration/tests/php/test-rest-api.php`

**Interfaces:**
- Consumes: `Post_Voice_Post_Meta` (Task 12).
- Produces: `Post_Voice_Rest_Api::register_routes()`, `ALLOWED_LANGUAGES` — this is the concrete implementation of the REST contract from Global Constraints.

- [ ] **Step 1: Generate the MP3 fixture**

```bash
mkdir -p features/narration/tests/php/fixtures
ffmpeg -f lavfi -i anullsrc=r=24000:cl=mono -t 0.5 -b:a 64k \
  features/narration/tests/php/fixtures/sample.mp3
```

- [ ] **Step 2: Write the failing tests**

Note: uses `wp_tempnam()` + `copy()` to stage the fixture — the same pattern WP core's own REST attachments controller tests use, which avoids the "possible file upload attack" rejection that a bare `tmp_name` path outside the recognized upload-tmp location would trigger.

```php
<?php
// features/narration/tests/php/test-rest-api.php
class Test_Post_Voice_Rest_Api extends WP_UnitTestCase {
    private int $post_id;
    private int $editor_id;

    public function set_up(): void {
        parent::set_up();
        Post_Voice_Post_Meta::register();
        Post_Voice_Rest_Api::register_routes();

        $this->editor_id = self::factory()->user->create( [ 'role' => 'editor' ] );
        $this->post_id   = self::factory()->post->create( [ 'post_author' => $this->editor_id ] );
        wp_set_current_user( $this->editor_id );
    }

    private function staged_audio_fixture(): array {
        $source   = __DIR__ . '/fixtures/sample.mp3';
        $tmp_name = wp_tempnam( 'sample.mp3' );
        copy( $source, $tmp_name );

        return [
            'name'     => 'narration.mp3',
            'type'     => 'audio/mpeg',
            'tmp_name' => $tmp_name,
            'error'    => 0,
            'size'     => filesize( $source ),
        ];
    }

    public function test_rejects_request_without_upload_files_capability(): void {
        $contributor = self::factory()->user->create( [ 'role' => 'contributor' ] );
        wp_set_current_user( $contributor );

        $request  = new WP_REST_Request( 'POST', "/post-voice/v1/posts/{$this->post_id}/narration" );
        $response = rest_get_server()->dispatch( $request );

        $this->assertSame( 403, $response->get_status() );
        $this->assertSame( 'post_voice_forbidden', $response->as_error()->get_error_code() );
    }

    public function test_rejects_auto_draft_post_with_409(): void {
        $auto_draft_id = self::factory()->post->create( [ 'post_status' => 'auto-draft' ] );

        $request  = new WP_REST_Request( 'POST', "/post-voice/v1/posts/{$auto_draft_id}/narration" );
        $response = rest_get_server()->dispatch( $request );

        $this->assertSame( 409, $response->get_status() );
        $this->assertSame( 'post_voice_post_not_saved', $response->as_error()->get_error_code() );
    }

    public function test_rejects_missing_audio_file_with_400(): void {
        $request = new WP_REST_Request( 'POST', "/post-voice/v1/posts/{$this->post_id}/narration" );
        $request->set_param( 'language', 'portuguese' );
        $request->set_param( 'source_hash', str_repeat( 'a', 64 ) );
        $response = rest_get_server()->dispatch( $request );

        $this->assertSame( 400, $response->get_status() );
        $this->assertSame( 'post_voice_missing_audio', $response->as_error()->get_error_code() );
    }

    public function test_saves_attachment_and_meta_on_valid_request(): void {
        $request = new WP_REST_Request( 'POST', "/post-voice/v1/posts/{$this->post_id}/narration" );
        $request->set_param( 'language', 'portuguese' );
        $request->set_param( 'source_hash', str_repeat( 'a', 64 ) );
        $request->set_file_params( [ 'audio' => $this->staged_audio_fixture() ] );

        $response = rest_get_server()->dispatch( $request );
        $data     = $response->get_data();

        $this->assertSame( 200, $response->get_status() );
        $this->assertArrayHasKey( 'attachment_id', $data );
        $this->assertSame( 'portuguese', $data['language'] );
        $this->assertSame( $data['attachment_id'], Post_Voice_Post_Meta::get_attachment_id( $this->post_id ) );
    }

    public function test_regenerating_deletes_previous_attachment(): void {
        $first = new WP_REST_Request( 'POST', "/post-voice/v1/posts/{$this->post_id}/narration" );
        $first->set_param( 'language', 'portuguese' );
        $first->set_param( 'source_hash', str_repeat( 'a', 64 ) );
        $first->set_file_params( [ 'audio' => $this->staged_audio_fixture() ] );
        $first_id = rest_get_server()->dispatch( $first )->get_data()['attachment_id'];

        $second = new WP_REST_Request( 'POST', "/post-voice/v1/posts/{$this->post_id}/narration" );
        $second->set_param( 'language', 'spanish' );
        $second->set_param( 'source_hash', str_repeat( 'b', 64 ) );
        $second->set_file_params( [ 'audio' => $this->staged_audio_fixture() ] );
        $second_id = rest_get_server()->dispatch( $second )->get_data()['attachment_id'];

        $this->assertNotSame( $first_id, $second_id );
        $this->assertNull( get_post( $first_id ) );
        $this->assertSame( $second_id, Post_Voice_Post_Meta::get_attachment_id( $this->post_id ) );
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `WP_PHPUNIT__DIR=vendor/wp-phpunit/wp-phpunit composer run test -- --filter Test_Post_Voice_Rest_Api`
Expected: FAIL — class `Post_Voice_Rest_Api` not found.

- [ ] **Step 4: Implement**

```php
<?php
declare(strict_types=1);

class Post_Voice_Rest_Api {
    private const NAMESPACE = 'post-voice/v1';
    private const ROUTE     = '/posts/(?P<id>\d+)/narration';

    public const ALLOWED_LANGUAGES = [ 'english_2026-04', 'german', 'italian', 'portuguese', 'spanish' ];

    public static function register_routes(): void {
        register_rest_route( self::NAMESPACE, self::ROUTE, [
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => [ self::class, 'handle_save_narration' ],
            'permission_callback' => [ self::class, 'check_permission' ],
            'args'                => [
                'id' => [
                    'validate_callback' => static fn( $value ) => is_numeric( $value ),
                ],
            ],
        ] );
    }

    public static function check_permission( WP_REST_Request $request ) {
        $post_id = (int) $request->get_param( 'id' );

        if ( ! current_user_can( 'edit_post', $post_id ) || ! current_user_can( 'upload_files' ) ) {
            return new WP_Error(
                'post_voice_forbidden',
                __( 'Your role does not have permission to add media. Ask an administrator.', 'post-voice' ),
                [ 'status' => 403 ]
            );
        }

        if ( get_post_status( $post_id ) === 'auto-draft' ) {
            return new WP_Error(
                'post_voice_post_not_saved',
                __( 'Save the post before generating narration.', 'post-voice' ),
                [ 'status' => 409 ]
            );
        }

        return true;
    }

    public static function handle_save_narration( WP_REST_Request $request ) {
        $post_id = (int) $request->get_param( 'id' );
        $files   = $request->get_file_params();

        if ( empty( $files['audio']['tmp_name'] ) ) {
            return new WP_Error(
                'post_voice_missing_audio',
                __( 'No audio file was received.', 'post-voice' ),
                [ 'status' => 400 ]
            );
        }

        $language = (string) $request->get_param( 'language' );
        if ( ! in_array( $language, self::ALLOWED_LANGUAGES, true ) ) {
            return new WP_Error(
                'post_voice_invalid_language',
                __( 'Unsupported narration language.', 'post-voice' ),
                [ 'status' => 400 ]
            );
        }

        $source_hash = (string) $request->get_param( 'source_hash' );
        if ( ! preg_match( '/^[a-f0-9]{64}$/', $source_hash ) ) {
            return new WP_Error(
                'post_voice_invalid_hash',
                __( 'Malformed source hash.', 'post-voice' ),
                [ 'status' => 400 ]
            );
        }

        require_once ABSPATH . 'wp-admin/includes/image.php';
        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/media.php';

        $previous_attachment_id = Post_Voice_Post_Meta::get_attachment_id( $post_id );

        // Deliberately NOT media_handle_upload(): that reads the $_FILES
        // superglobal, which a REST request's file params never populate. This
        // is the path WP core's own attachments controller takes —
        // wp_handle_upload() on the file array from the request, then an
        // explicit wp_insert_attachment().
        $upload = wp_handle_upload(
            $files['audio'],
            [
                'test_form' => false,
                'mimes'     => [ 'mp3' => 'audio/mpeg' ],
            ]
        );

        if ( isset( $upload['error'] ) ) {
            return new WP_Error(
                'post_voice_upload_failed',
                $upload['error'],
                [ 'status' => 500 ]
            );
        }

        $attachment_id = wp_insert_attachment(
            [
                'post_mime_type' => $upload['type'],
                'post_title'     => sprintf(
                    /* translators: %s: title of the post being narrated. */
                    __( 'Narration — %s', 'post-voice' ),
                    get_the_title( $post_id )
                ),
                'post_content'   => '',
                'post_status'    => 'inherit',
                'post_parent'    => $post_id,
            ],
            $upload['file'],
            $post_id,
            true
        );

        if ( is_wp_error( $attachment_id ) ) {
            return new WP_Error(
                'post_voice_upload_failed',
                $attachment_id->get_error_message(),
                [ 'status' => 500 ]
            );
        }

        wp_update_attachment_metadata(
            $attachment_id,
            wp_generate_attachment_metadata( $attachment_id, $upload['file'] )
        );

        if ( $previous_attachment_id && $previous_attachment_id !== $attachment_id ) {
            wp_delete_attachment( $previous_attachment_id, true );
        }

        Post_Voice_Post_Meta::save( $post_id, $attachment_id, $language, $source_hash );

        return new WP_REST_Response( [
            'attachment_id' => $attachment_id,
            'url'           => wp_get_attachment_url( $attachment_id ),
            'generated_at'  => get_the_date( 'c', $attachment_id ),
            'language'      => $language,
        ], 200 );
    }
}
```

- [ ] **Step 5: Wire the class into `post-voice.php`**

Append to `post-voice.php`, below the constants. Until this lands, `Post_Voice_Rest_Api` is undefined the moment PHPUnit's bootstrap loads the plugin, so this must happen before the tests can pass.

```php
require_once POST_VOICE_PATH . 'features/narration/php/class-rest-api.php';

add_action( 'rest_api_init', [ 'Post_Voice_Rest_Api', 'register_routes' ] );
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `WP_PHPUNIT__DIR=vendor/wp-phpunit/wp-phpunit composer run test -- --filter Test_Post_Voice_Rest_Api`
Expected: PASS (5/5).

- [ ] **Step 7: Commit**

```bash
git add post-voice.php features/narration/php/class-rest-api.php features/narration/tests/php/test-rest-api.php features/narration/tests/php/fixtures/sample.mp3
git commit -m "feat: narration REST endpoint (upsert audio attachment)"
```

---

### Task 14: `class-attachment-cleanup.php` — symmetric delete hooks

**Files:**
- Create: `features/narration/php/class-attachment-cleanup.php`
- Modify: `post-voice.php` (append this feature's `require_once` + `Post_Voice_Attachment_Cleanup::register()`)
- Test: `features/narration/tests/php/test-attachment-cleanup.php`

**Interfaces:**
- Consumes: `Post_Voice_Post_Meta` (Task 12).
- Produces: `register()`, `delete_narration_on_post_delete(int)`, `clear_meta_on_attachment_delete(int)`.

Implements both directions from the spec's "`post_parent` do attachment" and "Fluxo de dados" steps 8–9: post deleted → attachment cleaned up; attachment deleted → post meta cleaned up.

- [ ] **Step 1: Write the failing tests**

```php
<?php
// features/narration/tests/php/test-attachment-cleanup.php
class Test_Post_Voice_Attachment_Cleanup extends WP_UnitTestCase {
    public function set_up(): void {
        parent::set_up();
        Post_Voice_Attachment_Cleanup::register();
    }

    public function test_deleting_post_deletes_its_narration_attachment(): void {
        $post_id       = self::factory()->post->create();
        $attachment_id = self::factory()->attachment->create_object( [
            'file'        => 'narration.mp3',
            'post_parent' => $post_id,
        ] );
        Post_Voice_Post_Meta::save( $post_id, $attachment_id, 'portuguese', str_repeat( 'a', 64 ) );

        wp_delete_post( $post_id, true );

        $this->assertNull( get_post( $attachment_id ) );
    }

    public function test_deleting_attachment_clears_post_meta(): void {
        $post_id       = self::factory()->post->create();
        $attachment_id = self::factory()->attachment->create_object( [
            'file'        => 'narration.mp3',
            'post_parent' => $post_id,
        ] );
        Post_Voice_Post_Meta::save( $post_id, $attachment_id, 'portuguese', str_repeat( 'a', 64 ) );

        wp_delete_attachment( $attachment_id, true );

        $this->assertSame( 0, Post_Voice_Post_Meta::get_attachment_id( $post_id ) );
    }

    public function test_deleting_unrelated_attachment_does_not_clear_meta(): void {
        $post_id      = self::factory()->post->create();
        $narration_id = self::factory()->attachment->create_object( [
            'file'        => 'narration.mp3',
            'post_parent' => $post_id,
        ] );
        $unrelated_id = self::factory()->attachment->create_object( [
            'file'        => 'featured.jpg',
            'post_parent' => $post_id,
        ] );
        Post_Voice_Post_Meta::save( $post_id, $narration_id, 'portuguese', str_repeat( 'a', 64 ) );

        wp_delete_attachment( $unrelated_id, true );

        $this->assertSame( $narration_id, Post_Voice_Post_Meta::get_attachment_id( $post_id ) );
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `WP_PHPUNIT__DIR=vendor/wp-phpunit/wp-phpunit composer run test -- --filter Test_Post_Voice_Attachment_Cleanup`
Expected: FAIL — class not found.

- [ ] **Step 3: Implement**

```php
<?php
declare(strict_types=1);

class Post_Voice_Attachment_Cleanup {
    public static function register(): void {
        add_action( 'before_delete_post', [ self::class, 'delete_narration_on_post_delete' ] );
        add_action( 'delete_attachment', [ self::class, 'clear_meta_on_attachment_delete' ] );
    }

    public static function delete_narration_on_post_delete( int $post_id ): void {
        $attachment_id = Post_Voice_Post_Meta::get_attachment_id( $post_id );
        if ( $attachment_id ) {
            wp_delete_attachment( $attachment_id, true );
        }
    }

    public static function clear_meta_on_attachment_delete( int $attachment_id ): void {
        $post_id = (int) get_post_field( 'post_parent', $attachment_id );
        if ( ! $post_id ) {
            return;
        }

        if ( Post_Voice_Post_Meta::get_attachment_id( $post_id ) === $attachment_id ) {
            Post_Voice_Post_Meta::clear( $post_id );
        }
    }
}
```

- [ ] **Step 4: Wire the class into `post-voice.php`**

Append to `post-voice.php`, below the constants. Until this lands, `Post_Voice_Attachment_Cleanup` is undefined the moment PHPUnit's bootstrap loads the plugin, so this must happen before the tests can pass.

```php
require_once POST_VOICE_PATH . 'features/narration/php/class-attachment-cleanup.php';

add_action( 'plugins_loaded', static function (): void {
    Post_Voice_Attachment_Cleanup::register();
} );
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `WP_PHPUNIT__DIR=vendor/wp-phpunit/wp-phpunit composer run test -- --filter Test_Post_Voice_Attachment_Cleanup`
Expected: PASS (3/3).

- [ ] **Step 6: Commit**

```bash
git add post-voice.php features/narration/php/class-attachment-cleanup.php features/narration/tests/php/test-attachment-cleanup.php
git commit -m "feat: symmetric post/attachment cleanup hooks"
```

---

### Task 15: `class-assets.php` — conditional enqueue

**Files:**
- Create: `features/narration/php/class-assets.php`
- Modify: `post-voice.php` (append this feature's `require_once` + `Post_Voice_Assets::register()`)
- Test: `features/narration/tests/php/test-assets.php`

Enqueued handles resolve to `build/narration-editor.js` and `build/narration-player.js` — the exact entry names pinned in Task 11's `webpack.config.js`. If those two names ever change, both files change together.

**Interfaces:**
- Consumes: `POST_VOICE_PATH`, `POST_VOICE_URL`, `POST_VOICE_VERSION` (Task 11), `Post_Voice_Post_Meta::get_attachment_id()` (Task 12).
- Produces: `register()`, `enqueue_editor_assets()`, `enqueue_frontend_assets()`.

- [ ] **Step 1: Write the failing tests (frontend enqueue only — deterministic in `WP_UnitTestCase`; editor enqueue is smoke-checked manually in Step 5 since it depends on `get_current_screen()` admin context that's brittle to fabricate reliably in unit tests)**

```php
<?php
// features/narration/tests/php/test-assets.php
class Test_Post_Voice_Assets extends WP_UnitTestCase {
    public function set_up(): void {
        parent::set_up();
        Post_Voice_Assets::register();
    }

    public function test_frontend_assets_enqueued_only_when_post_has_narration(): void {
        $post_id = self::factory()->post->create();
        $this->go_to( get_permalink( $post_id ) );

        Post_Voice_Assets::enqueue_frontend_assets();
        $this->assertFalse( wp_script_is( 'post-voice-player', 'enqueued' ) );

        $attachment_id = self::factory()->attachment->create_object( [ 'file' => 'n.mp3', 'post_parent' => $post_id ] );
        Post_Voice_Post_Meta::save( $post_id, $attachment_id, 'portuguese', str_repeat( 'a', 64 ) );

        Post_Voice_Assets::enqueue_frontend_assets();
        $this->assertTrue( wp_script_is( 'post-voice-player', 'enqueued' ) );
    }

    public function test_frontend_assets_not_enqueued_on_non_singular_pages(): void {
        $this->go_to( home_url( '/' ) );
        Post_Voice_Assets::enqueue_frontend_assets();
        $this->assertFalse( wp_script_is( 'post-voice-player', 'enqueued' ) );
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `WP_PHPUNIT__DIR=vendor/wp-phpunit/wp-phpunit composer run test -- --filter Test_Post_Voice_Assets`
Expected: FAIL — class not found.

- [ ] **Step 3: Implement**

```php
<?php
declare(strict_types=1);

class Post_Voice_Assets {
    public static function register(): void {
        add_action( 'enqueue_block_editor_assets', [ self::class, 'enqueue_editor_assets' ] );
        add_action( 'wp_enqueue_scripts', [ self::class, 'enqueue_frontend_assets' ] );
    }

    public static function enqueue_editor_assets(): void {
        $screen = get_current_screen();
        if ( ! $screen || 'post' !== $screen->post_type ) {
            return;
        }

        $asset_file = POST_VOICE_PATH . 'build/narration-editor.asset.php';
        if ( ! file_exists( $asset_file ) ) {
            return;
        }
        $asset = require $asset_file;

        wp_enqueue_script(
            'post-voice-editor',
            POST_VOICE_URL . 'build/narration-editor.js',
            $asset['dependencies'],
            $asset['version'],
            true
        );
        wp_set_script_translations( 'post-voice-editor', 'post-voice', POST_VOICE_PATH . 'languages' );

        wp_enqueue_style(
            'post-voice-editor',
            POST_VOICE_URL . 'build/narration-editor.css',
            [],
            $asset['version']
        );
    }

    public static function enqueue_frontend_assets(): void {
        if ( ! is_singular( 'post' ) ) {
            return;
        }
        $post_id = get_queried_object_id();
        if ( ! Post_Voice_Post_Meta::get_attachment_id( $post_id ) ) {
            return;
        }

        wp_enqueue_script(
            'post-voice-player',
            POST_VOICE_URL . 'build/narration-player.js',
            [],
            POST_VOICE_VERSION,
            true
        );
        wp_enqueue_style(
            'post-voice-player',
            POST_VOICE_URL . 'build/narration-player.css',
            [],
            POST_VOICE_VERSION
        );
    }
}
```

- [ ] **Step 4: Wire the class into `post-voice.php`**

Append to `post-voice.php`, below the constants. Until this lands, `Post_Voice_Assets` is undefined the moment PHPUnit's bootstrap loads the plugin, so this must happen before the tests can pass.

```php
require_once POST_VOICE_PATH . 'features/narration/php/class-assets.php';

add_action( 'plugins_loaded', static function (): void {
    Post_Voice_Assets::register();
} );
```

- [ ] **Step 5: Run tests to verify they pass, then manually smoke-check editor enqueue**

Run: `WP_PHPUNIT__DIR=vendor/wp-phpunit/wp-phpunit composer run test -- --filter Test_Post_Voice_Assets`
Expected: PASS (2/2).

Editor-enqueue manual check happens once Task 21 (`.wp-env.json`) and a real `npm run build` exist — deferred there, tracked as part of Task 19's happy-path E2E test opening the editor and confirming the panel renders (which can't happen unless the script actually enqueued).

- [ ] **Step 6: Commit**

```bash
git add post-voice.php features/narration/php/class-assets.php features/narration/tests/php/test-assets.php
git commit -m "feat: conditional editor/frontend asset enqueue"
```

---

### Task 16: `class-frontend-render.php` — progressive-enhancement player markup

**Files:**
- Create: `features/narration/php/class-frontend-render.php`
- Modify: `post-voice.php` (append this feature's `require_once` + `Post_Voice_Frontend_Render::register()`)
- Test: `features/narration/tests/php/test-frontend-render.php`

**Interfaces:**
- Consumes: `Post_Voice_Post_Meta::get_attachment_id()` (Task 12).
- Produces: `register()`, `append_player(string): string` — filters `the_content`.

Implements spec's "Fallback sem JS" decision: a real `<audio controls>` element ships server-rendered, JS only enhances it (pill controls, `data-role` hooks consumed by `player.ts`, Task 17).

- [ ] **Step 1: Write the failing test**

```php
<?php
// features/narration/tests/php/test-frontend-render.php
class Test_Post_Voice_Frontend_Render extends WP_UnitTestCase {
    public function set_up(): void {
        parent::set_up();
        Post_Voice_Frontend_Render::register();
    }

    public function test_appends_player_markup_when_post_has_narration(): void {
        $post_id       = self::factory()->post->create();
        $attachment_id = self::factory()->attachment->create_object( [ 'file' => 'n.mp3', 'post_parent' => $post_id ] );
        Post_Voice_Post_Meta::save( $post_id, $attachment_id, 'portuguese', str_repeat( 'a', 64 ) );

        $this->go_to( get_permalink( $post_id ) );
        global $post;
        $post = get_post( $post_id );
        setup_postdata( $post );
        the_post();

        $output = Post_Voice_Frontend_Render::append_player( 'Original content.' );

        $this->assertStringContainsString( 'Original content.', $output );
        $this->assertStringContainsString( 'post-voice-player', $output );
        $this->assertStringContainsString( '<audio controls', $output );
    }

    public function test_does_not_append_player_when_post_has_no_narration(): void {
        $post_id = self::factory()->post->create();
        $this->go_to( get_permalink( $post_id ) );
        global $post;
        $post = get_post( $post_id );
        setup_postdata( $post );
        the_post();

        $output = Post_Voice_Frontend_Render::append_player( 'Original content.' );

        $this->assertSame( 'Original content.', $output );
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `WP_PHPUNIT__DIR=vendor/wp-phpunit/wp-phpunit composer run test -- --filter Test_Post_Voice_Frontend_Render`
Expected: FAIL — class not found.

- [ ] **Step 3: Implement**

```php
<?php
declare(strict_types=1);

class Post_Voice_Frontend_Render {
    public static function register(): void {
        add_filter( 'the_content', [ self::class, 'append_player' ] );
    }

    public static function append_player( string $content ): string {
        if ( ! is_singular( 'post' ) || ! in_the_loop() || ! is_main_query() ) {
            return $content;
        }

        $post_id       = get_the_ID();
        $attachment_id = Post_Voice_Post_Meta::get_attachment_id( (int) $post_id );
        if ( ! $attachment_id ) {
            return $content;
        }

        $url = wp_get_attachment_url( $attachment_id );
        if ( ! $url ) {
            return $content;
        }

        ob_start();
        ?>
        <div class="post-voice-player" role="region" aria-label="<?php esc_attr_e( 'Post narration player', 'post-voice' ); ?>">
            <audio controls src="<?php echo esc_url( $url ); ?>"></audio>
            <button type="button" data-role="play" aria-pressed="false" aria-label="<?php esc_attr_e( 'Play narration', 'post-voice' ); ?>"
                data-label-playing="<?php esc_attr_e( 'Playing', 'post-voice' ); ?>"
                data-label-paused="<?php esc_attr_e( 'Paused', 'post-voice' ); ?>">▶</button>
            <button type="button" data-role="rate" aria-label="<?php esc_attr_e( 'Playback speed', 'post-voice' ); ?>">1×</button>
            <button type="button" data-role="close" aria-label="<?php esc_attr_e( 'Close player', 'post-voice' ); ?>">✕</button>
            <span data-role="live" aria-live="polite" class="screen-reader-text"></span>
        </div>
        <?php
        return $content . ob_get_clean();
    }
}
```

- [ ] **Step 4: Wire the class into `post-voice.php`**

Append to `post-voice.php`, below the constants. Until this lands, `Post_Voice_Frontend_Render` is undefined the moment PHPUnit's bootstrap loads the plugin, so this must happen before the tests can pass.

```php
require_once POST_VOICE_PATH . 'features/narration/php/class-frontend-render.php';

add_action( 'plugins_loaded', static function (): void {
    Post_Voice_Frontend_Render::register();
} );
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `WP_PHPUNIT__DIR=vendor/wp-phpunit/wp-phpunit composer run test -- --filter Test_Post_Voice_Frontend_Render`
Expected: PASS (2/2).

- [ ] **Step 6: Commit**

```bash
git add post-voice.php features/narration/php/class-frontend-render.php features/narration/tests/php/test-frontend-render.php
git commit -m "feat: server-rendered narration player markup (no-JS fallback)"
```

---

### Task 17: `player.ts` — frontend player DOM wiring

**Files:**
- Create: `features/narration/frontend/player.ts`

**Interfaces:**
- Consumes: `player-state.ts` (Task 8). DOM contract: `.post-voice-player` root with `audio`, `[data-role="play"|"rate"|"close"|"live"]` children (matches Task 16's server-rendered markup exactly).

Glue-tier DOM wiring, no Jest unit test (already covered structurally by Task 8's pure state machine) — behavior verified by the a11y/keyboard E2E suite (Task 20).

- [ ] **Step 1: Implement**

```ts
import { createInitialPlayerState, togglePlaying, cycleRate, closePlayer } from './player-state';

function initNarrationPlayer( root: HTMLElement ): void {
  const audio = root.querySelector( 'audio' ) as HTMLAudioElement;
  const playButton = root.querySelector( '[data-role="play"]' ) as HTMLButtonElement;
  const rateButton = root.querySelector( '[data-role="rate"]' ) as HTMLButtonElement;
  const closeButton = root.querySelector( '[data-role="close"]' ) as HTMLButtonElement;
  const liveRegion = root.querySelector( '[data-role="live"]' ) as HTMLElement;

  let state = createInitialPlayerState();

  if ( window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches ) {
    root.classList.add( 'post-voice-player--no-motion' );
  }

  playButton.addEventListener( 'click', () => {
    state = togglePlaying( state );
    if ( state.playing ) {
      audio.play();
      liveRegion.textContent = playButton.dataset.labelPlaying || 'Playing';
    } else {
      audio.pause();
      liveRegion.textContent = playButton.dataset.labelPaused || 'Paused';
    }
    playButton.setAttribute( 'aria-pressed', String( state.playing ) );
  } );

  rateButton.addEventListener( 'click', () => {
    state = cycleRate( state );
    audio.playbackRate = state.rate;
    rateButton.textContent = `${ state.rate }×`;
  } );

  closeButton.addEventListener( 'click', () => {
    state = closePlayer( state );
    audio.pause();
    root.hidden = true;
  } );

  audio.addEventListener( 'ended', () => {
    state = { ...state, playing: false };
    playButton.setAttribute( 'aria-pressed', 'false' );
  } );
}

document.querySelectorAll<HTMLElement>( '.post-voice-player' ).forEach( initNarrationPlayer );
```

- [ ] **Step 2: Manual smoke check**

Run: `npx tsc --noEmit`
Expected: no errors referencing `player.ts`. Full behavioral verification happens in Task 20's keyboard/reduced-motion E2E tests.

- [ ] **Step 3: Commit**

```bash
git add features/narration/frontend/player.ts
git commit -m "feat: wire the pill player to real DOM + prefers-reduced-motion"
```

---

### Task 18: `.wp-env.json` + COOP/COEP mu-plugin

**Files:**
- Create: `.wp-env.json`
- Create: `e2e/mu-plugins/coop-coep-headers.php`

**Interfaces:**
- Produces: a local WP instance for E2E, with COOP/COEP response headers so `self.crossOriginIsolated` is true by default (needed for the happy-path E2E test in Task 19; the fallback test in Task 19 explicitly strips these headers for its one scenario).

- [ ] **Step 1: Write the mu-plugin**

```php
<?php
// e2e/mu-plugins/coop-coep-headers.php
add_action( 'send_headers', static function (): void {
    header( 'Cross-Origin-Opener-Policy: same-origin' );
    header( 'Cross-Origin-Embedder-Policy: require-corp' );
} );
```

- [ ] **Step 2: Write `.wp-env.json`**

```json
{
  "core": "WordPress/WordPress#6.6",
  "plugins": [ "." ],
  "mappings": {
    "wp-content/mu-plugins/coop-coep-headers.php": "./e2e/mu-plugins/coop-coep-headers.php"
  },
  "config": {
    "WP_DEBUG": true
  }
}
```

- [ ] **Step 3: Manual verification**

```bash
npx wp-env start
curl -sI http://localhost:8888/ | grep -i cross-origin
npx wp-env stop
```

Expected: both `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` present.

- [ ] **Step 4: Commit**

```bash
git add .wp-env.json e2e/mu-plugins/coop-coep-headers.php
git commit -m "chore: wp-env config with COOP/COEP headers for E2E"
```

---

### Task 19: E2E — happy path, regenerate, cancel, fallback, storage

**Files:**
- Create: `e2e/narration.spec.ts`
- Create: `e2e/narration-fallbacks.spec.ts`

**Interfaces:**
- Consumes: the full stack built in Tasks 1–18, running against `wp-env` (Task 18).

Covers 5 of the 8 mandatory E2E scenarios (Global Constraints): happy path, regenerate replaces/cleans attachment, cancel mid-generation, `crossOriginIsolated` fallback, insufficient storage.

- [ ] **Step 1: Write `narration.spec.ts`**

```ts
import { test, expect } from '@wordpress/e2e-test-utils-playwright';

test.describe( 'Post Voice — narration generation', () => {
  test( 'author generates, previews, and saves narration end to end', async ( { admin, editor, page } ) => {
    await admin.createNewPost( { title: 'Narration happy path', content: 'Hello world, this is a test post.' } );
    await editor.openDocumentSettingsSidebar();
    await page.getByRole( 'button', { name: 'Narration' } ).click();
    await page.getByRole( 'button', { name: 'Generate audio' } ).click();
    await expect( page.getByRole( 'button', { name: 'Save narration' } ) ).toBeVisible( { timeout: 120_000 } );
    await page.getByRole( 'button', { name: 'Save narration' } ).click();
    await expect( page.getByRole( 'button', { name: 'Generate again' } ) ).toBeVisible();

    await editor.publishPost();
    const permalink = await page.locator( 'a.components-external-link' ).first().getAttribute( 'href' );
    await page.goto( permalink! );
    await expect( page.locator( '.post-voice-player audio' ) ).toHaveCount( 1 );
  } );

  test( 'regenerating replaces the previous attachment without leaving an orphan', async ( { admin, page, requestUtils } ) => {
    await admin.createNewPost( { title: 'Regenerate test', content: 'First version of the text.' } );
    await page.getByRole( 'button', { name: 'Narration' } ).click();
    await page.getByRole( 'button', { name: 'Generate audio' } ).click();
    await page.getByRole( 'button', { name: 'Save narration' } ).click( { timeout: 120_000 } );

    const mediaBefore = await requestUtils.rest( { path: '/wp/v2/media' } );

    await page.getByRole( 'button', { name: 'Generate again' } ).click();
    await page.getByRole( 'button', { name: 'Save narration' } ).click( { timeout: 120_000 } );

    const mediaAfter = await requestUtils.rest( { path: '/wp/v2/media' } );
    expect( mediaAfter.length ).toBe( mediaBefore.length );
  } );

  test( 'author can cancel generation mid-flight', async ( { admin, page } ) => {
    await admin.createNewPost( { title: 'Cancel test', content: 'Some text to narrate for cancellation.' } );
    await page.getByRole( 'button', { name: 'Narration' } ).click();
    await page.getByRole( 'button', { name: 'Generate audio' } ).click();
    await page.getByRole( 'button', { name: 'Cancel' } ).click();
    await expect( page.getByRole( 'button', { name: 'Generate audio' } ) ).toBeVisible();
  } );
} );
```

- [ ] **Step 2: Write `narration-fallbacks.spec.ts`**

```ts
import { test, expect } from '@wordpress/e2e-test-utils-playwright';

test( 'generates audio single-threaded when crossOriginIsolated is unavailable', async ( { admin, page } ) => {
  await page.route( '**/wp-admin/post-new.php*', async ( route ) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers[ 'cross-origin-opener-policy' ];
    delete headers[ 'cross-origin-embedder-policy' ];
    await route.fulfill( { response, headers } );
  } );

  await admin.createNewPost( { title: 'No isolation fallback', content: 'Short narration text.' } );
  expect( await page.evaluate( () => window.crossOriginIsolated ) ).toBe( false );

  await page.getByRole( 'button', { name: 'Narration' } ).click();
  await page.getByRole( 'button', { name: 'Generate audio' } ).click();
  await expect( page.getByRole( 'button', { name: 'Save narration' } ) ).toBeVisible( { timeout: 180_000 } );
} );

test( 'warns before downloading the model when storage is insufficient', async ( { admin, page } ) => {
  await page.addInitScript( () => {
    // @ts-expect-error test-only override of a read-only browser API
    navigator.storage.estimate = async () => ( { quota: 50_000_000, usage: 49_000_000 } );
  } );
  await admin.createNewPost( { title: 'Storage warning', content: 'Text.' } );
  await page.getByRole( 'button', { name: 'Narration' } ).click();
  await page.getByRole( 'button', { name: 'Generate audio' } ).click();
  await expect( page.getByRole( 'alert' ) ).toContainText( /storage|space/i );
} );
```

- [ ] **Step 3: Run the suite**

```bash
npm run build
npx wp-env start
npx playwright install --with-deps chromium
npm run test:e2e -- narration.spec.ts narration-fallbacks.spec.ts
npx wp-env stop
```

Expected: PASS (5/5). The storage-warning test asserts against the pre-check Task 10 runs before `engine.load()`, backed by `hasEnoughStorage()` from Task 25 — this scenario is what proves the check actually runs on the real path, not merely that the function exists.

- [ ] **Step 4: Commit**

```bash
git add e2e/narration.spec.ts e2e/narration-fallbacks.spec.ts
git commit -m "test: E2E happy path, regenerate, cancel, isolation fallback, storage warning"
```

---

### Task 20: E2E — accessibility (axe, keyboard, reduced motion)

**Files:**
- Create: `e2e/narration-a11y.spec.ts`
- Create: `e2e/fixtures/sample.mp3` (copy of the PHPUnit fixture — `cp features/narration/tests/php/fixtures/sample.mp3 e2e/fixtures/sample.mp3`)

**Interfaces:**
- Consumes: `@axe-core/playwright`, the DOM contracts from Task 16 (frontend markup) and Task 17 (player wiring).

The three frontend tests need a post that already has narration attached; a bare `createPost()` renders no player at all (Task 16 returns the content untouched when `_narration_attachment_id` is absent). The `createPostWithNarration` helper below builds that state. It relies on the three meta keys being `show_in_rest` — which Task 12 registered them as.

Covers the remaining 3 of the 8 mandatory E2E scenarios: axe zero serious/critical violations (editor + frontend), full keyboard navigation, `prefers-reduced-motion`.

- [ ] **Step 1: Write the test file**

```ts
import path from 'node:path';
import { test, expect } from '@wordpress/e2e-test-utils-playwright';
import AxeBuilder from '@axe-core/playwright';

test( 'editor panel has zero serious/critical accessibility violations', async ( { admin, page } ) => {
  await admin.createNewPost( { title: 'A11y editor' } );
  await page.getByRole( 'button', { name: 'Narration' } ).click();

  const results = await new AxeBuilder( { page } ).include( '.post-voice-panel' ).analyze();
  const blocking = results.violations.filter( ( v ) => [ 'serious', 'critical' ].includes( v.impact ?? '' ) );
  expect( blocking ).toEqual( [] );
} );

/**
 * The three frontend tests below need a post that ALREADY has narration —
 * Task 16 renders no player markup for a post without an attachment, so a
 * plain createPost() would leave nothing to assert against. This helper
 * publishes a post, uploads a real audio file, and writes the narration meta
 * through the REST API, producing exactly the state the frontend renderer
 * expects.
 */
async function createPostWithNarration( requestUtils, title ) {
  const post = await requestUtils.createPost( { title, status: 'publish' } );
  const media = await requestUtils.uploadMedia(
    path.join( __dirname, 'fixtures', 'sample.mp3' )
  );
  await requestUtils.rest( {
    method: 'POST',
    path: `/wp/v2/media/${ media.id }`,
    data: { post: post.id },
  } );
  await requestUtils.rest( {
    method: 'POST',
    path: `/wp/v2/posts/${ post.id }`,
    data: {
      meta: {
        _narration_attachment_id: media.id,
        _narration_language: 'portuguese',
        _narration_source_hash: 'a'.repeat( 64 ),
      },
    },
  } );
  return post;
}

test( 'frontend player has zero serious/critical accessibility violations', async ( { page, requestUtils } ) => {
  const post = await createPostWithNarration( requestUtils, 'A11y frontend' );
  await page.goto( `/?p=${ post.id }` );

  const results = await new AxeBuilder( { page } ).include( '.post-voice-player' ).analyze();
  const blocking = results.violations.filter( ( v ) => [ 'serious', 'critical' ].includes( v.impact ?? '' ) );
  expect( blocking ).toEqual( [] );
} );

test( 'player controls are fully operable by keyboard', async ( { page, requestUtils } ) => {
  const post = await createPostWithNarration( requestUtils, 'Keyboard nav' );
  await page.goto( `/?p=${ post.id }` );

  const playButton = page.locator( '[data-role="play"]' );
  await playButton.focus();
  await page.keyboard.press( 'Enter' );
  await expect( playButton ).toHaveAttribute( 'aria-pressed', 'true' );

  await page.keyboard.press( 'Tab' );
  await expect( page.locator( '[data-role="rate"]' ) ).toBeFocused();
  await page.keyboard.press( 'Enter' );
  await expect( page.locator( '[data-role="rate"]' ) ).toHaveText( '1.25×' );

  await page.keyboard.press( 'Tab' );
  await expect( page.locator( '[data-role="close"]' ) ).toBeFocused();
  await page.keyboard.press( 'Space' );
  await expect( page.locator( '.post-voice-player' ) ).toBeHidden();
} );

test( 'respects prefers-reduced-motion', async ( { page, requestUtils } ) => {
  await page.emulateMedia( { reducedMotion: 'reduce' } );
  const post = await createPostWithNarration( requestUtils, 'Reduced motion' );
  await page.goto( `/?p=${ post.id }` );

  await expect( page.locator( '.post-voice-player' ) ).toHaveClass( /post-voice-player--no-motion/ );
} );
```

- [ ] **Step 2: Add `@axe-core/playwright` if not already present (added in Task 11's `package.json`, verify it's installed)**

```bash
npm ls @axe-core/playwright
```

- [ ] **Step 3: Run the suite**

```bash
npx wp-env start
npm run test:e2e -- narration-a11y.spec.ts
npx wp-env stop
```

Expected: PASS (4/4).

- [ ] **Step 4: Commit**

```bash
git add e2e/narration-a11y.spec.ts e2e/fixtures/sample.mp3
git commit -m "test: E2E accessibility — axe, keyboard nav, reduced motion"
```

---

### Task 21: Dependency audit scripts

**Files:**
- Create: `scripts/audit-check.mjs`
- Create: `scripts/audit-check-composer.mjs`
- Modify: `package.json` (add `audit:npm` / `audit:npm:production` scripts)

**Interfaces:**
- Produces: CLI scripts, exit code 0 within threshold / 1 above threshold — wired into CI in Task 23.

Implements Global Constraints' audit thresholds exactly. CI-tooling-tier: verified by actually running against real `npm audit`/`composer audit` output in CI (Task 23), not a Jest unit target — the spec's coverage table doesn't list audit scripts among the pure-function buckets, and shelling out to a real audit command isn't meaningfully unit-testable in isolation.

- [ ] **Step 1: Implement `scripts/audit-check.mjs`**

```js
#!/usr/bin/env node
// Threshold-gated npm dependency audit — see "Auditoria de dependências
// (segurança)" in docs/superpowers/specs/2026-08-08-wp-narration-plugin-mvp-design.md.
import { execSync } from 'node:child_process';

const productionOnly = process.argv.includes( '--production' );

const THRESHOLDS = productionOnly
  ? { critical: 0, high: 0, moderate: Infinity, low: Infinity }
  : { critical: 1, high: 5, moderate: 10, low: Infinity };

function runAudit() {
  const cmd = productionOnly ? 'npm audit --omit=dev --json' : 'npm audit --json';
  try {
    return execSync( cmd, { encoding: 'utf8' } );
  } catch ( error ) {
    // npm audit exits non-zero when vulnerabilities are found; stdout still has the JSON.
    return error.stdout || '{}';
  }
}

function countBySeverity( json ) {
  const report = JSON.parse( json );
  const counts = { critical: 0, high: 0, moderate: 0, low: 0 };
  for ( const vuln of Object.values( report.vulnerabilities || {} ) ) {
    if ( counts[ vuln.severity ] !== undefined ) {
      counts[ vuln.severity ] += 1;
    }
  }
  return counts;
}

const counts = countBySeverity( runAudit() );
console.log( `npm audit (${ productionOnly ? 'production' : 'all' }):`, counts );

const failures = Object.entries( THRESHOLDS ).filter( ( [ severity, max ] ) => counts[ severity ] > max );
if ( failures.length > 0 ) {
  for ( const [ severity, max ] of failures ) {
    console.error( `✗ ${ severity }: ${ counts[ severity ] } found, threshold is ${ max }` );
  }
  process.exit( 1 );
}
console.log( '✓ within thresholds' );
```

- [ ] **Step 2: Implement `scripts/audit-check-composer.mjs`**

```js
#!/usr/bin/env node
// Threshold-gated composer dependency audit — 0 critical/0 high, matches
// npm's production threshold (no runtime PHP deps exist yet, gate stays
// ready for when that changes).
import { execSync } from 'node:child_process';

const THRESHOLDS = { critical: 0, high: 0, moderate: Infinity, low: Infinity };

function runAudit() {
  try {
    return execSync( 'composer audit --format=json', { encoding: 'utf8' } );
  } catch ( error ) {
    return error.stdout || '{}';
  }
}

function countBySeverity( json ) {
  const report = JSON.parse( json );
  const counts = { critical: 0, high: 0, moderate: 0, low: 0 };
  for ( const advisories of Object.values( report.advisories || {} ) ) {
    for ( const advisory of advisories ) {
      const severity = ( advisory.severity || 'low' ).toLowerCase();
      if ( counts[ severity ] !== undefined ) {
        counts[ severity ] += 1;
      }
    }
  }
  return counts;
}

const counts = countBySeverity( runAudit() );
console.log( 'composer audit:', counts );

const failures = Object.entries( THRESHOLDS ).filter( ( [ severity, max ] ) => counts[ severity ] > max );
if ( failures.length > 0 ) {
  for ( const [ severity, max ] of failures ) {
    console.error( `✗ ${ severity }: ${ counts[ severity ] } found, threshold is ${ max }` );
  }
  process.exit( 1 );
}
console.log( '✓ within thresholds' );
```

- [ ] **Step 3: Wire npm scripts**

Add to `package.json`'s `"scripts"`:
```json
"audit:npm": "node scripts/audit-check.mjs",
"audit:npm:production": "node scripts/audit-check.mjs --production"
```

- [ ] **Step 4: Manual verification**

```bash
npm run audit:npm:production
npm run audit:npm
composer install
node scripts/audit-check-composer.mjs
```

Expected: all three print counts and exit 0 (empty dependency trees at this point in the project should be within every threshold).

- [ ] **Step 5: Commit**

```bash
git add scripts/audit-check.mjs scripts/audit-check-composer.mjs package.json
git commit -m "chore: threshold-gated dependency audit scripts (npm + composer)"
```

---

### Task 22: PHP coverage-threshold script

**Files:**
- Create: `scripts/check-coverage-threshold.php`

**Interfaces:**
- Produces: CLI script reading a Clover XML report, exit 1 if line coverage < threshold — closes the gap that PHPUnit <10 has no native "fail below X%" flag, needed to enforce the 85% PHP gate from Global Constraints in CI (Task 23).

- [ ] **Step 1: Implement**

```php
<?php
declare(strict_types=1);

[ $script, $cloverPath, $thresholdArg ] = $argv + [ null, null, null ];
if ( ! $cloverPath || ! $thresholdArg ) {
    fwrite( STDERR, "Usage: check-coverage-threshold.php <clover.xml> <threshold-percent>\n" );
    exit( 1 );
}

$threshold = (float) $thresholdArg;
$xml = simplexml_load_file( $cloverPath );
if ( ! $xml ) {
    fwrite( STDERR, "Could not parse {$cloverPath}\n" );
    exit( 1 );
}

$metrics    = $xml->project->metrics;
$statements = (int) $metrics['statements'];
$covered    = (int) $metrics['coveredstatements'];
$percent    = $statements > 0 ? ( $covered / $statements ) * 100 : 100.0;

printf( "PHP line coverage: %.2f%% (threshold: %.2f%%)\n", $percent, $threshold );

if ( $percent < $threshold ) {
    fwrite( STDERR, "✗ below threshold\n" );
    exit( 1 );
}
echo "✓ within threshold\n";
```

- [ ] **Step 2: Manual verification (once Tasks 12–16's PHPUnit suite exists)**

```bash
WP_PHPUNIT__DIR=vendor/wp-phpunit/wp-phpunit composer run test -- --coverage-clover=coverage/clover.xml
php scripts/check-coverage-threshold.php coverage/clover.xml 85
```

Expected: exit 0, printed percentage ≥85 (the PHP written in Tasks 12–16 is fully exercised by its own tests, so this should already be well above 85%; if it's below, add the missing test cases before moving on rather than lowering the threshold).

- [ ] **Step 3: Commit**

```bash
git add scripts/check-coverage-threshold.php
git commit -m "chore: PHP line-coverage threshold gate for CI"
```

---

### Task 23: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: every script and test suite from Tasks 1–22.

- [ ] **Step 1: Implement the workflow**

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [ main ]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run lint:js
      - uses: shivammathur/setup-php@v2
        with: { php-version: '8.2', tools: composer }
      - run: composer install
      - run: composer run lint
      - run: composer run stan

  unit:
    runs-on: ubuntu-latest
    services:
      mysql:
        image: mysql:8.0
        env: { MYSQL_ALLOW_EMPTY_PASSWORD: yes, MYSQL_DATABASE: wordpress_test }
        ports: [ '3306:3306' ]
        options: >-
          --health-cmd="mysqladmin ping" --health-interval=10s --health-timeout=5s --health-retries=5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run test:unit -- --coverage
      - uses: shivammathur/setup-php@v2
        with: { php-version: '8.2', tools: composer }
      - run: composer install
      - run: |
          WP_PHPUNIT__DIR=vendor/wp-phpunit/wp-phpunit WP_TESTS_DB_HOST=127.0.0.1 \
          composer run test -- --coverage-clover=coverage/clover.xml
      - run: php scripts/check-coverage-threshold.php coverage/clover.xml 85

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run build
      - run: npx wp-env start
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
      - run: npx wp-env stop

  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run audit:npm:production
      - run: npm run audit:npm
      - uses: shivammathur/setup-php@v2
        with: { php-version: '8.2', tools: composer }
      - run: composer install
      - run: node scripts/audit-check-composer.mjs
```

- [ ] **Step 2: Push and verify all four jobs pass**

```bash
git push -u origin main   # or your working branch
```

Watch the Actions run in GitHub; expected: `lint`, `unit`, `e2e`, `audit` all green.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: lint, unit (coverage-gated), e2e, dependency audit"
```

---

### Task 24: i18n wiring + `readme.txt`

**Files:**
- Create: `languages/.gitkeep`
- Create: `readme.txt`

**Interfaces:**
- Produces: `.pot` generation via `npm run i18n:pot` (script already added in Task 11); `readme.txt` in wordpress.org format (spec: "Não-metas explícitas" — not publishing there yet, but format is ready).

- [ ] **Step 1: Create the languages folder placeholder**

```bash
mkdir -p languages && touch languages/.gitkeep
```

- [ ] **Step 2: Write `readme.txt`**

```
=== Post Voice ===
Contributors: (your wordpress.org username, once distributed)
Tags: text to speech, audio, accessibility, narration, voice
Requires at least: 6.6
Tested up to: 6.6
Requires PHP: 8.2
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Generate spoken-word narration for your posts, entirely in the visitor's browser — no server-side processing, no per-request cost.

== Description ==

Post Voice adds a "Narration" panel to the block editor. Authors pick a language, generate audio locally in the browser (Pocket TTS, WebAssembly), preview it, and save it as the post's narration. Readers get a small floating player that reads the post aloud.

== Installation ==

1. Upload the plugin files to `/wp-content/plugins/post-voice`.
2. Activate through the 'Plugins' screen.
3. Open any post, click the "Narration" icon in the editor sidebar.

== Changelog ==

= 0.1.0 =
* Initial MVP release: single-language narration per post, sticky mobile player.
```

- [ ] **Step 3: Generate the `.pot` and spot-check it's non-empty**

```bash
npm run i18n:pot
test -s languages/post-voice.pot && echo "pot generated"
```

Expected: `pot generated` printed, and opening `languages/post-voice.pot` shows the strings from Task 10's panel (e.g. `"Generate audio"`, `"Save narration"`).

- [ ] **Step 4: Commit**

```bash
git add languages readme.txt
git commit -m "chore: i18n scaffold + wordpress.org-format readme.txt"
```

---

### Task 25: `storage-check.ts` — pure storage pre-check math

**Files:**
- Create: `features/narration/editor/storage-check.ts`
- Test: `features/narration/tests/js/storage-check.test.ts`

**Interfaces:**
- Produces: `LANGUAGE_BUNDLE_BYTES`, `STORAGE_HEADROOM_MULTIPLIER`, `hasEnoughStorage(estimate, bundleBytes?)`, `formatBytes(bytes)` — consumed by the editor panel (Task 10), which must run this check *before* triggering the ~190MB model download (spec: "Requisitos de hardware e calibração", item 1: "Pré-checagem rápida, antes de baixar o modelo").

Pure function tier, ≥80% coverage. This module exists because the mandatory E2E scenario "insufficient storage" (Global Constraints) had no implementation to test against.

- [ ] **Step 1: Write the failing tests**

```ts
import { formatBytes, hasEnoughStorage, LANGUAGE_BUNDLE_BYTES } from '../../editor/storage-check';

const MB = 1024 * 1024;

describe( 'hasEnoughStorage', () => {
  it( 'accepts a quota with generous free space', () => {
    expect( hasEnoughStorage( { quota: 2000 * MB, usage: 100 * MB } ) ).toBe( true );
  } );

  it( 'rejects when free space is below the bundle plus headroom', () => {
    expect( hasEnoughStorage( { quota: 250 * MB, usage: 50 * MB } ) ).toBe( false );
  } );

  it( 'requires headroom above the raw bundle size, not just the bundle', () => {
    // Exactly one bundle free is not enough — the headroom multiplier is 1.5.
    expect( hasEnoughStorage( { quota: LANGUAGE_BUNDLE_BYTES, usage: 0 } ) ).toBe( false );
  } );

  it( 'treats missing quota/usage fields as no available space', () => {
    expect( hasEnoughStorage( {} ) ).toBe( false );
  } );
} );

describe( 'formatBytes', () => {
  it( 'formats megabyte-scale values', () => {
    expect( formatBytes( 190 * MB ) ).toBe( '190 MB' );
  } );

  it( 'formats gigabyte-scale values', () => {
    expect( formatBytes( 2 * 1024 * MB ) ).toBe( '2.0 GB' );
  } );
} );
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- storage-check`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/** Approximate on-disk size of one language bundle (5 .onnx files + tokenizer + voices). */
export const LANGUAGE_BUNDLE_BYTES = 190 * 1024 * 1024;

/**
 * Require half a bundle of slack on top of the bundle itself — the browser also
 * needs room for its own HTTP cache and the decode buffers during inference.
 * Checking for the exact bundle size would let a download start that cannot finish.
 */
export const STORAGE_HEADROOM_MULTIPLIER = 1.5;

export interface StorageEstimateLike {
  quota?: number;
  usage?: number;
}

export function hasEnoughStorage(
  estimate: StorageEstimateLike,
  bundleBytes: number = LANGUAGE_BUNDLE_BYTES
): boolean {
  const quota = estimate.quota ?? 0;
  const usage = estimate.usage ?? 0;
  return quota - usage >= bundleBytes * STORAGE_HEADROOM_MULTIPLIER;
}

export function formatBytes( bytes: number ): string {
  const MB = 1024 * 1024;
  const GB = 1024 * MB;
  if ( bytes >= GB ) {
    return `${ ( bytes / GB ).toFixed( 1 ) } GB`;
  }
  return `${ Math.round( bytes / MB ) } MB`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- storage-check`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add features/narration/editor/storage-check.ts features/narration/tests/js/storage-check.test.ts
git commit -m "feat: storage pre-check before model download"
```

---

## Self-Review

**Spec coverage** — every named decision in the spec maps to a task:
Nome/slug → Global Constraints + Task 1/11. Contrato REST → Task 13. Formato de áudio → Task 7. Capability `upload_files` → Task 13. Post types → Task 13/14/15/16 all scope to `post`. Auto-draft guard (client + server) → Task 10 (disabled button) + Task 13 (409). `post_parent`/symmetric cleanup → Task 14. WP/PHP mínimos → Task 11 plugin header + `phpcs.xml.dist`/`phpstan.neon`. Player UI/UX (pílula) → Task 16 (markup) + Task 17 (behavior). A11y enforcement → Task 11 (`jsx-a11y` via `@wordpress/eslint-plugin`) + Task 20 (axe/keyboard/reduced-motion E2E). E2E scenarios → Tasks 19–20 (all 8). Pin de versão do modelo → Task 1. Auditoria de dependências → Task 21. Multisite/no-JS-fallback/preview-discard-silently → no code needed, already true by construction (client-side cache, server-rendered `<audio>`, in-memory blob never persisted before confirm) — correctly not turned into tasks.

**Placeholder scan** — the only literal placeholder token left in any file is `<COMMIT_SHA_FROM_STEP_4>` inside Task 1 (namespace is already resolved to `luigi-moretti`), explicitly called out as a required manual replacement before that task's own commit step — not an unresolved design gap.

**Type/interface consistency** — checked across tasks: `PocketTtsEngine.generate()` signature in Task 3 matches every call site in Task 10. `encodeMp3(float32Audio, sampleRate)` in Task 7 matches its call in Task 10. `Post_Voice_Post_Meta::save(int, int, string, string)` signature in Task 12 matches every call site in Tasks 13, 14, 15, 16 tests. REST response shape (`attachment_id`, `url`, `generated_at`, `language`) in Task 13 matches `SaveNarrationResponse` in Task 9. `data-role` attribute values (`play`/`rate`/`close`/`live`) match exactly between Task 16 (PHP-rendered markup) and Task 17 (TS selectors) and Task 20 (E2E locators).

**One process note carried over from the spec, not a code gap:** Task 1 is the single manual, non-agent-executable step in this plan (creating your own Hugging Face mirror repo) — flagged there and in Global Constraints so it isn't missed when work starts.

### Revision 2026-08-11 — pre-execution conflict scan

A dependency and correctness scan before dispatching Task 1 found nine defects in the first draft of this plan. All are fixed above; recorded here so the reasoning isn't lost:

1. **Task ordering** — Tasks 1, 4–8 ran `npm run test:unit` and Tasks 3, 9, 10, 17 ran `npx tsc` before Task 11 created `package.json`/`jest.config.js`/`tsconfig.json`. Fixed by the **Execution Order** section: Task 11 runs first, task IDs stay stable.
2. **Fatal bootstrap** — Task 11's `post-voice.php` `require_once`'d five class files created in Tasks 12–16; Task 12's PHPUnit bootstrap loads the plugin, so those tests could never run. Fixed: bootstrap ships constants only, each PHP task appends its own require + registration (new "Wire the class into `post-voice.php`" step in Tasks 12–16).
3. **REST upload never worked** — Task 13 called `media_handle_upload()`, which reads `$_FILES`; REST file params never populate that superglobal. Replaced with `wp_handle_upload()` + `wp_insert_attachment()`, the path WP core's own attachments controller takes.
4. **Build output name mismatch** — `wp-scripts build` would emit `index.js`/`player.js` while Task 15's PHP enqueued `narration-editor.js`/`narration-player.js`. Fixed with an explicit `webpack.config.js` pinning both entry names.
5. **A11y E2E tested nothing** — three frontend tests created posts with no narration, so Task 16 rendered no player and the locators could never match. Fixed with a `createPostWithNarration` helper plus an `e2e/fixtures/sample.mp3`.
6. **Storage pre-check was fictional** — Task 19 asserted against a `navigator.storage.estimate()` check that no task implemented, and the plan hand-waved "if it fails, wire it in". Fixed: new **Task 25** (`storage-check.ts`, pure + tested) and a real pre-check in Task 10 that runs before `engine.load()`.
7. **Stale badge missing** — the spec requires comparing the current text hash against `_narration_source_hash`; Task 10 never did. Now implemented.
8. **Existing-audio state missing** — the approved Option C mockup requires generation date + badge + inline player; Task 10 rendered a bare button. Now implemented.
9. **Dead fixture reference** — Task 15 listed `tests/php/fixtures/build/narration-editor.asset.php`, used by no step. Removed.

---

Plan complete and saved to `docs/superpowers/plans/2026-08-11-post-voice-fase1-implementation-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
