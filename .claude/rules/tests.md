---
paths:
  - "features/**/tests/**"
  - "e2e/**"
  - "**/*.test.ts"
---

# Testes

- TypeScript puro vai para Jest; o que envolve Worker, ONNX ou navegador real vai para E2E (ADR-0012).
- Antes de criar cenário E2E, pergunte se ele estaria só fixando a saída de uma função pura. Se estiver, extraia a função para um módulo próprio e escreva Jest — `tokenizer-sanitize.ts` é o precedente (ADR-0012).
- `e2e/segment-pipeline-perf.spec.ts` continua E2E de propósito: o `DOMParser` do jsdom é ordens de grandeza mais lento e dava números não confiáveis. Está no cabeçalho do arquivo (ADR-0012).
- Classe de teste PHPUnit declara `@covers`; sem ela a cobertura credita colaboradores à classe sob teste (ADR-0013).
- Gates: 80% de linhas em JS, 85% em PHP. Nenhum dos dois desce para um PR passar (ADR-0013).
