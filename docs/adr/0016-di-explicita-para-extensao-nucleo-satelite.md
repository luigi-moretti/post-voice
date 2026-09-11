---
id: 0016
titulo: Injeção explícita no bootstrap, não filtro do WordPress, para arestas núcleo→satélite
status: aceita
data: 2026-09-11
origem: superpowers/specs/2026-09-11-topologia-nucleo-extensoes-design.md#mecanismo-1-di-explícita-para-arestas-1-e-2-php
enforced_by: [ review-manual ]
revisar_quando: uma aresta núcleo→satélite exigir narration rodando com a extensão desligada
desvios: []
---

## Contexto

A ADR-0005 mediu cinco arestas onde o núcleo (`narration`) lê uma extensão
(`pronunciation`, `player-style`) diretamente, e decidiu não inverter sem um
requisito real puxando. O `docs/research/2026-08-27-custo-inversao-arestas-cross-feature.md`
mediu duas famílias de mecanismo para quando alguém decidisse resolver: um
filtro do WordPress (`apply_filters`/`add_filter`, ou `@wordpress/hooks` do
lado TypeScript) e injeção de dependência explícita no bootstrap. As duas
resolvem a aresta; só uma foi escolhida, e a razão nunca tinha sido
registrada — a próxima aresta do mesmo tipo reabriria a mesma pergunta sem
achado nenhum pra consultar.

## Decisão

Quando o núcleo precisa de algo que só uma extensão provê, a extensão é
injetada explicitamente, nunca via registro global de string. Em PHP: um
`callable` guardado numa propriedade estática do núcleo, atribuído uma vez em
`post-voice.php` (`Post_Voice_Assets::set_dictionary_provider(...)`), nunca
`apply_filters`. Em TypeScript: um módulo de porta que o núcleo publica
(`registerDictionaryExtension`/`getDictionaryExtension`), preenchido por um
único import de efeito colateral que a extensão fornece, nunca
`@wordpress/hooks`.

## Consequências

Fica mais fácil: nenhuma das duas pontas vira superfície pública — só o
próprio `post-voice.php` (PHP) ou o próprio bundle (`index.tsx`, TS) decide
quem provê a porta, então um tema ou plugin de terceiro não pode registrar
nada sem editar o código do próprio Post Voice. Remover uma extensão sem
atualizar o wiring continua fatal error imediato (PHP) ou import quebrado
(TS) — a mesma falha alta que o projeto já tinha antes de qualquer aresta ser
resolvida, preservada de propósito.

Fica mais difícil: crescer ou remover uma extensão sempre toca o ponto de
wiring (um `post-voice.php`/`register-*-extension.ts` por porta) — não é
zero-touch para código de terceiro, ao contrário do que um filtro daria. É o
trade-off deliberado: ver "Alternativas rejeitadas".

## Como verificar

`review-manual` — não há regex que distinja DI explícita de acoplamento
direto disfarçado de DI. O que `feature-deps` (ADR-0005) já verifica
continua sendo a âncora mecânica: a aresta não pode crescer além do que
`desvios:` lista. Em review, perguntar: o wiring novo mora em
`post-voice.php` ou num módulo de registro explícito da própria extensão —
nunca em `apply_filters`/`add_filter`/`@wordpress/hooks` cruzando feature?

## Alternativas rejeitadas

**Filtro do WordPress** (`apply_filters`/`add_filter`, ou `@wordpress/hooks`
do lado TS). Resolve a aresta, mas é registro global por string: qualquer
tema ou plugin de terceiro pode hookar sem saber do projeto, e a falha muda
de fatal error imediato para degradação silenciosa (o recurso desaparece sem
log quando o registro não roda). Nenhum requisito do projeto pede
compatibilidade externa nesse ponto.

**Deixar as arestas congeladas indefinidamente**, sem nenhum mecanismo
padrão. É o que a ADR-0005 já fazia; esta ADR existe porque a pergunta "como
resolver quando alguém decidir resolver" apareceu de novo e vale a pena
responder uma vez.
