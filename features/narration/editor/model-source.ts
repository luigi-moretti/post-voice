// Pinned to our own Hugging Face mirror, never upstream `KevinAHM/pocket-tts-onnx`
// directly and never `resolve/main` — see "Pin de versão do modelo" in the Fase 1 spec.
// Bumping this is a deliberate action: new PR, smoke test all 5 languages + E2E, then merge.
export const MODEL_BASE_URL =
  'https://huggingface.co/luigi-moretti/pocket-tts-onnx-mirror/resolve/b18a05128c4f727ead5b23a643b65b93eaf8ee5d/';

export const SUPPORTED_LANGUAGES = [
  'english_2026-04',
  'german',
  'italian',
  'portuguese',
  'spanish',
] as const;

export type SupportedLanguage = ( typeof SUPPORTED_LANGUAGES )[ number ];
