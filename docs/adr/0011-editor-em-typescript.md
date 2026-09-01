---
id: 0011
titulo: O editor é TypeScript
status: aceita-com-desvio
data: 2026-08-27
origem: superpowers/specs/2026-08-08-wp-narration-plugin-mvp-design.md
enforced_by: [ no-untyped-editor-code ]
revisar_quando: o worker vendorizado receber tipos upstream, ou for reescrito como código próprio
desvios:
  - features/narration/editor/engine/pocket-tts.worker.js
  - features/narration/editor/engine/sentencepiece.js
---

## Contexto

O editor conversa com APIs do Gutenberg cujo formato de dado não é óbvio, e o
pipeline de narração passa estruturas — segmentos, entradas de dicionário —
por uma dúzia de módulos entre a extração do texto e o Worker. Um erro de
forma nesse trajeto não aparece na hora de escrever o código: aparece em
runtime, no navegador do autor, depois que o build já publicou.

## Decisão

Todo código de produção sob `features/*/{editor,admin,frontend}/` é
TypeScript. `npx tsc --noEmit` é gate de CI.

## Consequências

Fica mais fácil: refatorar o pipeline sem caçar cada chamador manualmente, e
os tipos funcionam como documentação do formato que atravessa os módulos.
Fica mais difícil: código de terceiros vendorizado precisa de declaração de
tipos ou de exclusão explícita, e o build ganha um passo de checagem que
código JavaScript simples não teria.

## Como verificar

`no-untyped-editor-code` — nenhum arquivo `.js` sob esses diretórios fora da
lista de desvios acima. Os dois desvios são vendorizados:
`pocket-tts.worker.js` vem do repo de referência do pocket-tts e carrega
modificações próprias por cima (ver `CREDITS.md`); `sentencepiece.js` é um
bundle Emscripten de 3,9 MB, tomado verbatim. Ambos já constam de
`ignorePatterns` em `.eslintrc.js` — e é justamente por isso que esta regra
não pode viver no ESLint: o ESLint não enxerga esses arquivos.

## Alternativas rejeitadas

**JSDoc com `checkJs`.** Entrega a maior parte do ganho de tipos sem mudar a
extensão do arquivo, mas a sintaxe de tipos complexos (uniões, genéricos)
em comentário fica difícil de ler no pipeline de segmentos.

**JavaScript puro.** O pipeline tem estruturas demais atravessando módulos
demais para confiar em revisão manual sozinha.
