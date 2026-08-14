---
license: cc-by-4.0
tags:
  - text-to-speech
  - onnx
  - pocket-tts
---

# Pocket TTS ONNX — Post Voice mirror

Version-pinned mirror of the five language bundles used by the **Post Voice** WordPress plugin, which runs text-to-speech entirely in the reader's browser via ONNX Runtime Web.

## Contents

Five languages — `english_2026-04`, `german`, `italian`, `portuguese`, `spanish` — each ~190MB:

| File | Purpose |
|---|---|
| `bundle.json` | Bundle metadata: sample rate, state manifests, voice list |
| `mimi_encoder_int8.onnx` | Audio encoder (voice cloning) |
| `text_conditioner_int8.onnx` | Text conditioning |
| `flow_lm_main_int8.onnx` | Autoregressive backbone |
| `flow_lm_flow_int8.onnx` | Flow-matching head |
| `mimi_decoder_int8.onnx` | Audio decoder |
| `tokenizer.model` | SentencePiece tokenizer |
| `bos_before_voice.npy` | BOS embedding prepended to voice conditioning |
| `voices.bin` | Pre-encoded predefined voice states |

Only the INT8 quantized models are mirrored — those are the ones the browser runtime loads. The fp32 variants that exist upstream are omitted deliberately: they are never fetched, and carrying them would roughly double the mirror for no benefit.

## Why this mirror exists

The plugin pins its model URL to a specific commit of *this* repository rather than fetching from a third party's repo at `main`. Pinning a commit protects against file contents changing underneath a released plugin; mirroring protects against the upstream repo becoming unavailable. Bumping the pinned commit is a deliberate, reviewed change, never automatic.

## Attribution and license

Everything in this repository is licensed **CC-BY-4.0** (Creative Commons Attribution 4.0 International), inherited from both upstream sources:

- [`kyutai/pocket-tts`](https://huggingface.co/kyutai/pocket-tts) — the original Pocket TTS model. Declared `cc-by-4.0`.
- [`KevinAHM/pocket-tts-onnx`](https://huggingface.co/KevinAHM/pocket-tts-onnx) — the ONNX export these files come from. Declared `cc-by-4.0`, and its bundled `LICENSE` is the Attribution 4.0 text.

The offline Python conversion tooling in the upstream export repo is not mirrored here — it never runs in a browser and is of no use to the plugin.

`voices.bin` is generated from the upstream bundles by the `export_voice_bins.py` script that ships with the Pocket TTS web demo; it is not distributed upstream.

**A note on a licensing discrepancy found upstream:** the Pocket TTS web demo Space distributes a file named `ONNX-LICENSE` containing the Creative Commons Attribution-**NonCommercial** 4.0 text. That text conflicts with the Space's own README metadata (`license: cc-by-4.0`), with `kyutai/pocket-tts`, and with `KevinAHM/pocket-tts-onnx` — all three of which declare plain CC-BY-4.0, and the export repo's own `LICENSE` file contains the Attribution 4.0 text. This mirror therefore carries the Attribution 4.0 license that the actual model sources declare, and does not redistribute the NonCommercial file.

## Acceptable use

The CC-BY-4.0 grant on the upstream weights carries a use restriction that follows this mirror: do not use these models for unlawful or deceptive purposes, and do not clone a person's voice without that person's consent.
