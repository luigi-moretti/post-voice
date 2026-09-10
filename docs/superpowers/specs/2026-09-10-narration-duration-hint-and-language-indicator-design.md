# Narração — duração em minutos no hint de geração e indicador de idioma selecionado no toolbar inline

**Data:** 2026-09-10
**Status:** Aprovado para implementação
**Classificação:** Bounded (duas correções de UX em fluxos já existentes do
painel de narração; spec escrita a pedido explícito do usuário para não
depender só do contexto da conversa — ver justificativa abaixo)

## Contexto

Dois problemas de UX reportados pelo usuário, com capturas de tela do painel
"Narration" e do toolbar inline do editor:

1. **Duração só em segundos.** Durante a geração (`~316s remaining`) e no
   aviso de texto longo (`estimated time: 345 seconds`), o painel mostra só
   segundos brutos. Acima de um minuto isso dificulta a leitura — o autor
   precisa fazer a conta de cabeça. Pedido: mostrar minutos quando a duração
   passar de 60 segundos.
2. **Sem indicador de idioma selecionado.** Ao selecionar um trecho de texto
   e abrir o dropdown de idioma no toolbar inline (`registerInlineLanguageFormat`),
   fechado o dropdown não sobra nenhum sinal visual de qual idioma está
   marcado no trecho — só o ícone genérico de tradução.

Por que este documento existe apesar da tarefa ser "bounded" (que por padrão
não gera spec, só design em chat — ver `superpowers:brainstorming`): o
usuário pediu registro físico explicitamente, por durabilidade — a conversa
pode ser encerrada, compactada ou perder contexto, e um arquivo é consultável
depois, desta ou de outra conversa. O conteúdo abaixo é o que já foi discutido
e fechado em chat; não há aqui uma nova rodada de "2-3 abordagens" —
decisões já convergidas.

## Decisão

| Ponto | Decisão |
|---|---|
| Threshold de formato | Acima de **60 segundos** (`> 60`, estrito), duração vira `Xm Ys`; até 60s inclusive, mantém `Xs`. Aplica-se independentemente às duas mensagens (hint de "restante" durante geração e mensagem de confirmação de texto longo) — cada uma decide sozinha, mesma regra. |
| `Intl.DurationFormat` / `Intl.NumberFormat` | **Rejeitado.** `Intl.DurationFormat` tem suporte de browser insuficiente (só Chromium recente; o plugin roda no navegador do autor sem controle de qual). `Intl.NumberFormat` com `style: 'unit'` formata uma unidade isolada, não combina minutos+segundos nativamente — juntar duas chamadas manualmente equivaleria a reimplementar o split na mão, sem ganho. Nenhum módulo do projeto usa `Intl.*` hoje (`LANGUAGE_LABELS` é mapa manual, não `Intl.DisplayNames`) — convenção existente é formatação explícita e testável. O locale usado no gettext do projeto é o do WP admin (`bundleForLocale`), não `navigator.language`; usar Intl exigiria mapear locale WP → BCP47 à toa. |
| Onde a lógica de split mora | **Não** em `features/narration/format-time.ts` (raiz da feature). Esse arquivo é raiz porque `formatTime` (m:ss) é consumido tanto pelo editor (`mini-player.tsx`) quanto pelo player do frontend (`frontend/player.ts`). O hint de "restante"/"tempo estimado" é exclusivo do editor — o player do frontend nunca mostra estimativa de geração. Fica em módulo novo, só do editor. |
| Onde a lógica de frase (i18n) mora | Também no módulo novo do editor, **não inline em `index.tsx`**. As funções são puras (determinísticas, sem React/store) e cabem em Jest por ADR-0012 ("pure TypeScript → Jest") — mesmo padrão já usado por `rtf-calibration.ts`, `group-segments.ts`, `segment-hash.ts`: lógica pura sai de `index.tsx` (component gigante, 1500+ linhas, sem teste unitário próprio) para módulo irmão testável. `__`/`sprintf` de `@wordpress/i18n` funcionam normalmente fora do runtime WP (retornam a string não traduzida), não bloqueiam o teste. |
| Indicador de idioma — mecanismo | `ToolbarDropdownMenu` tem prop `text` (texto visível ao lado do ícone no botão fechado), distinta de `label` (que vira só tooltip/texto de acessibilidade, invisível). A ausência de indicador visual hoje é porque só `label` é passado. Fix: passar `text={ current ? (LANGUAGE_LABELS[current] ?? current) : undefined }`. |
| Indicador de idioma — acessibilidade | `label` passa a ser dinâmico também, não só o `text` visível: com idioma marcado, `sprintf(__('Narrate in another language (currently %s)', 'post-voice'), languageLabel)`; sem marcação, mantém `__('Narrate in another language', 'post-voice')` genérico como hoje. Duas strings traduzíveis (não uma edição vaga de string existente). |
| Preview no hover do menu (antes de clicar) | Fora de escopo — não pedido, WP `ToolbarDropdownMenu` não suporta nativamente, feature própria não solicitada. |
| Cobertura de teste — E2E | **Sem cenário E2E novo** para o indicador de idioma, decisão explícita do usuário: a suíte E2E já é o passo mais lento do pipeline (baixa o modelo de ~190MB na primeira execução, `TESTING.md`), e a mudança é puramente visual/CSS-adjacente sobre um componente WP padrão (`ToolbarDropdownMenu.text`, usado do mesmo jeito em toolbars nativas do Gutenberg). Verificação fica manual, documentada no PR. Cobertura Jest cobre a parte que pode quebrar silenciosamente (o split numérico e a montagem das frases traduzidas), que é o que de fato tem lógica a testar. |
| CSS | Nenhuma mudança necessária. `.post-voice-panel__hint` não tem largura fixa nem `white-space: nowrap` — texto mais longo (`Xm Ys`) quebra normalmente. Confirmado lendo `style.scss`. |

## Mudanças

| Arquivo | Mudança |
|---|---|
| `features/narration/editor/generation-time-hint.ts` (**novo**) | Exporta `splitMinutesSeconds(totalSeconds: number): { minutes: number; seconds: number }` (puro, mesma guarda de `formatTime` para NaN/Infinity/negativo → `{ minutes: 0, seconds: 0 }`), `formatRemainingHint(wholeSeconds: number): string` e `formatEstimatedTimeMessage(wholeSeconds: number): string` — cada uma escolhe entre a frase `<=60s` (existente) e a nova frase `>60s`, via `splitMinutesSeconds`. |
| `features/narration/editor/index.tsx` | Dois call-sites trocam a montagem inline de `sprintf(__('~%ds remaining', ...))` e `sprintf(__('This text is long — estimated time: %d seconds.', ...))` por chamadas a `formatRemainingHint(Math.ceil(remainingSeconds))` e `formatEstimatedTimeMessage(Math.round(etaSeconds ?? 0))` — arredondamento de cada call-site é preservado como está hoje (`ceil` no remaining, `round` na confirmação), só o texto final muda. |
| `features/narration/editor/inline-language-format.ts` | `ToolbarDropdownMenu` ganha prop `text` (idioma atual ou `undefined`) e `label` passa a ser condicional (ver tabela de Decisão). |
| `features/narration/tests/js/generation-time-hint.test.ts` (**novo**) | Cobertura Jest — ver "Testes". |
| `jest.config.js` | Adiciona `features/narration/editor/generation-time-hint.ts` a `collectCoverageFrom` (gate de 80% linhas, `CLAUDE.md`). |
| `TESTING.md` | Registra o novo arquivo de teste unitário, mesmo padrão de specs anteriores que tocaram este arquivo. |

Sem mudança de interface pública (REST, meta de post, mensagens do worker),
sem migração de dado, sem alteração de contrato (`MODEL_BASE_URL`, mínimos de
WordPress/PHP).

## Testes

- **`features/narration/tests/js/generation-time-hint.test.ts`** (Jest, gate
  80% linhas via `jest.config.js`). Casos mínimos:
  - `splitMinutesSeconds`: `0` → `{0,0}`; `59` → `{0,59}`; `60` → `{1,0}`;
    `61` → `{1,1}`; `125` → `{2,5}`; `NaN`/`Infinity`/`-1` → `{0,0}` (mesma
    guarda de `formatTime`, `format-time.test.ts` como referência).
  - `formatRemainingHint`: `60` → forma `~60s remaining` (frase antiga, no
    limite inclusive); `61` → forma `~1m 1s remaining`.
  - `formatEstimatedTimeMessage`: mesmo par de casos de fronteira (60 e 61),
    frase própria de confirmação de texto longo.
  - Nota: como `LONG_TEXT_CONFIRMATION_ETA_SECONDS = 120` (`rtf-calibration.ts`),
    o card de confirmação de texto longo na prática só renderiza com ETA
    acima de 120 — o ramo `<=60s` de `formatEstimatedTimeMessage` é
    inatingível *nesse call-site específico* hoje, mas a função continua
    testada nos dois ramos por ser de uso geral e por não acoplar a um
    threshold de outro módulo que pode mudar.
- **Sem E2E novo** — decisão do usuário, ver tabela de Decisão.
- **Verificação manual (documentada no PR)**: gerar um áudio longo o
  suficiente para passar de 60s de estimativa e conferir a leitura de
  `~Xm Ys remaining` e da mensagem de confirmação; selecionar texto, marcar
  um idioma no toolbar inline e conferir que o nome aparece visível no botão
  fechado, em pelo menos dois idiomas diferentes (para checar que o mapa
  `LANGUAGE_LABELS` está sendo lido corretamente e que o texto não estoura o
  layout do toolbar).
- Gates normais de `TESTING.md` (lint, tsc, PHP, cobertura, `i18n:check`,
  build+E2E completo) continuam se aplicando, conforme `CLAUDE.md`.

## Fora de escopo

- Suporte a horas (`Hh Mm Ss`) para durações muito longas — não pedido;
  narração de post de blog não chega nessa ordem de grandeza na prática.
- Preview do idioma ao passar o mouse sobre um item do menu, antes de
  clicar — não pedido, sem suporte nativo do componente WP usado.
- `Intl.DurationFormat`/`Intl.NumberFormat` — avaliado e rejeitado, ver
  tabela de Decisão.
- Cenário E2E novo para o indicador de idioma — decisão explícita do
  usuário, ver tabela de Decisão.
