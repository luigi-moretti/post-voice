---
paths:
  - "docs/adr/**/*.md"
---

# Escrevendo uma ADR

- Vira ADR só se **as duas** forem verdadeiras: orienta código ainda não escrito, e reverter custa mais que um PR (ADR-0001).
- Registre a restrição, nunca o valor: "o áudio é comprimido no cliente" é ADR; "MP3 64 kbps" é spec (ADR-0001).
- O front-matter é a configuração do `lint:arch`. `enforced_by` é sempre lista; `desvios:` usa `arquivo → alvo`, sem número de linha, que apodrece (ADR-0001).
- `revisar_quando` é uma condição observável, nunca uma data: data vira TODO morto (ADR-0001).
- Contexto, Decisão, Consequências e Alternativas não se editam. Mudou de ideia → ADR nova, e a antiga recebe `status: superada-por-NNNN` (ADR-0001).
- Alvo de 40 a 80 linhas, teto de 120. Acrescente a linha em `README.md` no mesmo commit (ADR-0001).
