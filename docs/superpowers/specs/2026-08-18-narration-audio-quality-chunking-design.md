# Qualidade de áudio da narração — reset de estado e split de chunk

**Data:** 2026-08-18
**Status:** Aprovado para planejamento de implementação
**Issue:** https://github.com/luigi-moretti/post-voice/issues/5 (sub-projeto A — qualidade; sub-projeto B, performance/COOP-COEP, tem spec própria)
**Investigação relacionada:** análise completa de causa raiz no corpo da issue #5, confirmada por inspeção de código nesta sessão.

## Contexto

Fase 1 (MVP) ficou pronta e passou por 3 fases de implementação (ver
`docs/superpowers/specs/2026-08-08-wp-narration-plugin-mvp-design.md` e specs
subsequentes). Em uso real, três sintomas de qualidade de áudio foram
reportados na issue #5:

- Sentenças com aspas, parênteses, ou oração longa após dois-pontos são
  faladas com cortes e prosódia estranha.
- Parágrafos extensos saem robotizados: palavras cortadas, silêncios audíveis
  entre trechos.
- Posts longos degradam mais que posts curtos.

A investigação da issue estabeleceu que isso **não é limitação do modelo
Pocket TTS** — o próprio kyutai documenta suporte a *"infinitely long text
input"* via streaming contínuo. É comportamento do
`features/narration/editor/engine/pocket-tts.worker.js`, herdado sem revisão
dos defaults da demo do KevinAHM (pensada para frases curtas isoladas, não
posts inteiros). Este spec cobre a correção. O componente de performance
(threading/COOP-COEP) da mesma issue é tratado em spec e branch separados —
independente deste, sem dependência entre eles.

## Causa raiz (confirmada em código, `pocket-tts.worker.js`)

1. **Reset de estado a cada chunk interno** (linhas 38-39, 818-822). Um
   segmento (bloco/trecho de idioma escolhido pelo usuário) é dividido em
   chunks de até `max_token_per_chunk` (50 tokens — metadado do
   `bundle.json`, não constante nossa). `RESET_FLOW_STATE_EACH_CHUNK` e
   `RESET_MIMI_STATE_EACH_CHUNK` zeram o estado do flow-LM e do decoder mimi
   a cada chunk, reconditionando só a partir da voz-base, sem contexto do que
   veio antes. Parágrafo longo → muitos chunks → muitos "reinícios" de
   prosódia a cada ~8-12 palavras.
2. **Silêncio fixo entre chunks internos** (`CHUNK_GAP_SEC = 0.25`, linhas
   965-980). 250ms de silêncio inserido entre **todo** chunk interno do mesmo
   segmento, não só entre segmentos do usuário.
3. **Corte bruto quando uma sentença estoura 50 tokens**
   (`splitTokenIdsIntoChunks`, linha 468). Corta na fronteira de token pura,
   sem respeitar cláusula/pontuação interna — pode cortar no meio de palavra
   ou de uma cláusula entre aspas.

Estado tem tamanho fixo por geração (~63MB: flow-LM `[2,1,1000,16,64]`×6
camadas ≈ 47MB + mimi ≈ 16MB), não cresce com número de chunks — carregar
estado adiante entre chunks não tem custo extra de memória, os tensores já
são alocados hoje, só passam a ser reaproveitados em vez de zerados.

## Decisão

Escopo fechado nesta sessão de brainstorming:

| Ponto | Decisão |
|---|---|
| Alcance do carry-over de estado | Só dentro do mesmo segmento (= um `generate()` do worker = um `ResolvedSegment`/bloco de idioma do Fase 2). Reset continua no início de cada `generate()`. Carregar estado entre segmentos consecutivos de mesma voz/idioma foi considerado e descartado: fora do que a issue pede, mexeria no contrato de `generateSegments`/`reassemble` em `tts-engine.ts`. O gap **entre segmentos** é `SEGMENT_GAP_SECONDS = 0.12` (120ms), definido em `features/narration/editor/engine/tts-engine.ts:7` — arquivo diferente do tocado aqui, não muda. |
| `CHUNK_GAP_SEC` (gap **entre chunks internos do mesmo segmento**, em `pocket-tts.worker.js`) | Reduzir de `0.25` para `0.06` (60ms). Faixa aprovada foi 50-80ms; 60ms é o valor escolhido dentro dela, ajustável em code review se a audição indicar necessidade — não é um número já testado empiricamente. Motivo do gap original era mascarar o reset de estado; com estado preservado a razão prosódica desaparece, mantém-se pausa mínima de segurança contra artefato de borda. |
| Split de sentença > 50 tokens | Cortar em ponto de pausa natural — ver algoritmo decidido na seção "3. Split em ponto de pausa natural" abaixo. Sem nenhum ponto de pausa disponível, cai para o corte bruto atual (`splitTokenIdsIntoChunks`) como fallback — nunca regride o comportamento hoje. |
| Métrica de qualidade | Sem métrica objetiva automatizada de prosódia/continuidade (exigiria modelo de avaliação próprio, fora de escopo). Verificação é E2E black-box (não crasha/não trava em texto adversarial, player recebe áudio) + audição manual documentada no PR. |
| Ciclo de vida de tensores ORT | Verificado em código: zero chamadas `.dispose()` em `pocket-tts.worker.js`. Estado (`flowLmState`/`mimiState`) é objeto JS plano referenciando tensores, substituído por atribuição, sem free manual em nenhum lugar do arquivo hoje. Remover o reset por chunk não introduz vazamento nem exige disposal novo — confirma a afirmação da issue de custo de memória zero, não é só a palavra da issue. |

## Mudanças

Único arquivo tocado: `features/narration/editor/engine/pocket-tts.worker.js`.
Sem mudança de interface pública (mensagens do worker, REST, meta de post),
sem migração de dado.

### 1. Parar de resetar estado entre chunks do mesmo segmento

Remover as constantes `RESET_FLOW_STATE_EACH_CHUNK` / `RESET_MIMI_STATE_EACH_CHUNK`
(linhas 38-39) e os blocos que zeram `flowLmState`/`mimiState` quando
`chunkIdx > 0` (linhas 818-822). O estado inicial do segmento
(`baseFlowState`, `initStateFromManifest` no começo de `generate()`) continua
como está — só o zeramento *entre* chunks internos some.

### 2. Reduzir `CHUNK_GAP_SEC`

`CHUNK_GAP_SEC = 0.25` → `CHUNK_GAP_SEC = 0.06`.

### 3. Split em ponto de pausa natural

Sentença que estoura `currentMaxTokenPerChunk` (hoje sempre chamado com 50)
passa primeiro por uma tentativa de split em sub-cláusulas por pontuação de
pausa, operando em nível de **texto** (mais simples e robusto que mapear
posição de token para caractere). Algoritmo, em `splitSentenceAtNaturalBreaks`
(nome sugerido), chamada no lugar da chamada direta a `splitTokenIdsIntoChunks`
dentro de `splitIntoBestSentences` quando `sentenceTokens > currentMaxTokenPerChunk`:

1. **Dividir em candidatos de cláusula** por regex análoga a
   `SENTENCE_SPLIT_RE` já existente no arquivo, cortando **depois** de
   `, : ; ) ] ” " »` — fechamento, nunca abertura (aspas retas, curvas e
   guillemets porque o worker atende 5 idiomas: en/de/it/pt/es, não só
   inglês). Ex.: `/[^,:;)\]”"»]+[,:;)\]”"»]+\s*|[^,:;)\]”"»]+$/g`.
2. **Empacotar os candidatos gulosamente** até `currentMaxTokenPerChunk`,
   mesma lógica que o loop de `splitIntoBestSentences` já usa pra acumular
   sentenças inteiras (`currentChunk` + próximo candidato; se ultrapassar o
   limite, fecha o chunk atual e começa um novo com o candidato). Isso evita
   fragmentar em um chunk por vírgula — só quebra quando precisa.
3. Se um **candidato isolado** já estourar o limite sozinho (cláusula longa
   sem pontuação de pausa interna), só **esse candidato** cai para
   `splitTokenIdsIntoChunks` (corte bruto por token) como fallback local — o
   resto da sentença que já coube em cláusulas válidas não é afetado.

`splitTokenIdsIntoChunks` em si não muda — continua existindo, usado só como
fallback de último recurso (passo 3).

## Testes

Segue convenção do projeto (`CLAUDE.md`): código de Worker/ONNX não leva
mock/Jest, leva E2E. Nenhum teste unitário novo.

- **E2E novo, arquivo dedicado**: `e2e/narration-audio-quality.spec.ts`,
  seguindo o padrão de nome-por-tópico já usado (`narration-a11y.spec.ts`,
  `narration-fallbacks.spec.ts`, `narration-fase2.spec.ts`). Os specs de
  narração são **black-box via Playwright** — nenhum intercepta mensagens
  internas do worker (`audio_chunk`, contagem de chunk) hoje, e este não
  inaugura esse padrão. Asserções: geração completa sem erro/timeout (chega
  a estado salvo), player recebe `<audio>` com fonte válida, sem estado de
  erro na UI — mesmo padrão de `e2e/narration.spec.ts`.
- **Fixture**: um post com um bloco de texto contendo (a) parágrafo longo o
  bastante pra forçar vários chunks internos (múltiplas sentenças, ~40-60
  palavras) e (b) uma sentença deliberadamente > 50 tokens com vírgula,
  dois-pontos, aspas e parênteses juntos — texto exato finalizado na
  implementação, não precisa fixar aqui. Fixture curto o bastante pra não
  inflar o tempo do E2E (~9min hoje, CPU single-thread em CI — ver spec de
  performance) — não usar um post inteiro de tamanho real.
- **Verificação manual**: ouvir o áudio gerado antes/depois da mudança para
  os dois casos acima, documentar no PR (qualitativo — não é gate de CI).
- Gates normais de `TESTING.md` (lint, tsc, PHP — não tocado aqui mas roda
  mesmo assim, cobertura, build+E2E completo) continuam se aplicando antes do
  PR, conforme `CLAUDE.md`.

## Fora de escopo

- Performance (threading/COOP-COEP) — spec e branch próprios
  (`fix/issue-5-tts-performance`), sem dependência com este.
- WebGPU — já descartado na própria issue #5 (bundles são int8, ganho de GPU
  inconsistente até nativo, exigiria bundle fp16/fp32 paralelo).
- Métrica objetiva de prosódia/continuidade automatizada.
- Carry-over de estado entre segmentos consecutivos do usuário.
