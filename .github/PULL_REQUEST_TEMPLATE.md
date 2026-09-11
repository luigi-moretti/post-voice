## O que muda

<!-- Descreva a mudança e por quê. Se resolve uma issue, referencie: Closes #N -->

## Origem do conteúdo

- [ ] Este PR foi gerado ou assistido por IA (ex: Claude Code, Copilot, Cursor) — se marcado, qual ferramenta: ____
- [ ] Revisei o diff linha a linha e assino como responsável pelo conteúdo, independente da origem.

## Checklist (obrigatório, `wp-env` rodando: `npx wp-env start`)

Rode em ordem — cada gate mais caro que o anterior, fail-fast:

- [ ] `npm run lint:js && npm run lint:arch`
- [ ] `npx tsc --noEmit`
- [ ] `composer run lint && composer run stan`
- [ ] `npm run test:unit -- --coverage`
- [ ] `npm run test:php && npm run test:php:coverage`
- [ ] `npm run i18n:check`
- [ ] `npm run audit:npm:production && npm run audit:npm && npm run audit:composer`
- [ ] `npm run build && npm run test:e2e` (baixa o modelo na primeira vez;
      o CI pula e2e para PRs que não tocam `features/narration|pronunciation|player-style/`,
      `shared/`, `e2e/` etc — veja o job `changes` em `.github/workflows/ci.yml`.
      Se seu PR toca esses caminhos, rode local mesmo assim)
- [ ] `npm run doctor`

Tudo verde localmente antes de abrir o PR — um PR vermelho custa mais tempo
de review do que rodar isso antes. Detalhes de cada gate e limiares:
`TESTING.md`.

Se você usa Claude Code: rode `superpowers:requesting-code-review` antes
de abrir o PR (CLAUDE.md pede isso). Sem Claude Code, não tem problema —
a revisão do mantenedor cobre esse papel.

## Documentos relevantes

<!-- Esta mudança tocou alguma decisão de arquitetura (docs/adr/), o spec
     do MVP, ou o plano de implementação? Se sim, foram atualizados junto? -->

## Notas para quem revisa

<!-- Algo que facilite a revisão: trade-off feito, alternativa descartada,
     área que merece atenção extra. -->
