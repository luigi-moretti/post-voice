# Third-party code and attribution

Post Voice is licensed GPL-2.0-or-later (see `LICENSE`). It bundles the third-party
code below.

## Vendored into this repository

### `features/narration/editor/engine/pocket-tts.worker.js`

Derived from `inference-worker.js` in the Pocket TTS ONNX web demo, licensed
**Apache-2.0**.

**Modifications made** (required by Apache-2.0 §4(b)):

1. Added an import of `MODEL_BASE_URL` from the plugin's `model-source` module.
2. `bundleDir()` now returns `` `${MODEL_BASE_URL}${language}` `` instead of the
   demo's relative `` `./onnx/${language}` `` — the plugin fetches model files from a
   pinned Hugging Face mirror rather than from files served next to the page.
3. Removed the `?v=3` cache-busting query string from the dynamic
   `./sentencepiece.js` import, which the bundler treats as a resource query.
4. Marked the ONNX Runtime CDN import `/* webpackIgnore: true */`. It is an
   absolute URL loaded at runtime by design; without the comment webpack tries to
   resolve it as a local path and the build fails.
5. Added an import and call of `installModelCache()` at the top of the file, so
   model files are stored in the Cache API. Hugging Face sends no `Cache-Control`
   header, so without it the ~190MB bundle is re-downloaded every editor session.
6. The mimi decoder's state now carries forward across a segment's internal
   chunks instead of resetting at every chunk boundary, smoothing the audio-level
   splice between chunks. Flow-LM state still resets per chunk as in the
   original demo — carrying it forward was tried and reverted; it breaks the
   model's own end-of-speech signal (`eos_logit` is a function of that same
   state). See
   `docs/superpowers/specs/2026-08-18-narration-audio-quality-chunking-design.md`,
   2026-08-18 (parte B), for the investigation.
7. `CHUNK_GAP_SEC`, the pause inserted between internal chunks, shrank from
   0.25s (the demo's default) to 0.06s.
8. Added `splitSentenceAtNaturalBreaks()`, which splits an oversized sentence at
   a punctuation pause (comma, colon, semicolon, closing bracket/quote) instead
   of a raw token boundary, so a forced cut lands somewhere a speaker would
   actually pause.
9. Text is now run through `sanitizeForTokenizer()` (a separate first-party
   module, `tokenizer-sanitize.ts`) before every `encodeIds()` call. The
   tokenizer has no vocabulary piece for curly/low quotes, guillemets or the
   ellipsis character — it falls back to raw UTF-8 bytes that individually
   decode to U+FFFD — so those are mapped to a plain-ASCII equivalent.
   Parentheses, brackets and em/en dashes are also removed, as an unverified
   prosody bet — pending validation by ear; per the design spec, if that
   listening test doesn't show a clear improvement, only this half should be
   reverted, keeping the glyph-mapping half (which has direct tokenizer
   evidence), never touching the ASCII hyphen. See
   `docs/superpowers/specs/2026-08-18-narration-punctuation-sanitization-design.md`.

See
`docs/superpowers/specs/2026-08-18-narration-audio-quality-chunking-design.md`
for why (issue #5): the demo's defaults were tuned for short standalone
phrases, not whole posts. Both vendored files are excluded from ESLint and
Prettier (`.eslintrc.js`, `.prettierignore`) so that tooling cannot silently
reformat them and invalidate this record.

### `features/narration/editor/engine/sentencepiece.js`

SentencePiece tokenizer build taken verbatim from the same demo, unmodified. It
embeds a `tslib` runtime notice (Copyright (c) Microsoft Corporation) granting
use, copying, modification and distribution without fee. That notice is preserved
inline in the file.

## Bundled from npm

### `@breezystack/lamejs`

MP3 encoder, licensed **LGPL-3.0**. A maintained fork of `lamejs`, used because
the original package's published modular build is broken: `src/js/Lame.js` reads
`MPEGMode` as a free global that nothing requires, so constructing an
`Mp3Encoder` throws. Same license, same encoder.

LGPL-3.0 permits use in a larger work under any license, provided the LGPL
portion stays LGPL and can be replaced. Combining it with GPL-2.0-or-later code
means the resulting distribution is effectively GPL-3.0-or-later — see the
compatibility note below.

## Downloaded at runtime, not bundled

Model weights are fetched from
[`luigi-moretti/pocket-tts-onnx-mirror`](https://huggingface.co/luigi-moretti/pocket-tts-onnx-mirror),
licensed **CC-BY-4.0**, mirrored from
[`KevinAHM/pocket-tts-onnx`](https://huggingface.co/KevinAHM/pocket-tts-onnx),
itself derived from [`kyutai/pocket-tts`](https://huggingface.co/kyutai/pocket-tts).

CC-BY-4.0 permits redistribution and derivative works with attribution. The
upstream model card also asks that the voice-cloning capability not be used to
impersonate anyone without their consent — surfaced to plugin users in `readme.txt`.

ONNX Runtime Web is loaded from a CDN at runtime (MIT, © Microsoft) and is not
redistributed by this plugin.

## License compatibility

Apache-2.0 is incompatible with GPL-2.0 alone, but compatible with GPL-3.0. The
same holds for LGPL-3.0. This plugin is GPL-2.0-**or-later**, so a recipient may
take it under GPL-3.0, under which both combinations are compatible. This mirrors
how WordPress core treats its own Apache-2.0-licensed dependencies.
