---
paths:
  - "features/**/editor/**/*.{ts,tsx}"
  - "features/**/admin/**/*.{ts,tsx}"
  - "features/**/frontend/**/*.{ts,tsx}"
---

# Editor, admin e frontend

- TypeScript, não JavaScript. Os dois `.js` em `editor/engine/` são vendorizados e estão listados como desvio (ADR-0011).
- Nenhum import atravessa para outra feature; o que precisa ser compartilhado vai para `shared/`, a partir do segundo consumidor (ADR-0004, ADR-0005).
- Toda a síntese acontece aqui, num Web Worker: o PHP só recebe o áudio pronto (ADR-0002).
- O áudio é comprimido antes do upload (ADR-0009).
- Strings de UI passam por gettext com o domínio `post-voice`. A exceção deliberada é `SAMPLE_TEXTS` em `voice-catalog.ts`, que alimenta o modelo de fala e segue o idioma do bundle, não o locale do admin (ADR-0010).
