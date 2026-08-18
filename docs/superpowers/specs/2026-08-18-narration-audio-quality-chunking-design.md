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
   `, : ; ) ] ” »` — fechamento, nunca abertura. Aspa reta (`"`) fica de fora
   de propósito: é o mesmo glyph pra abrir e fechar, então o regex não
   consegue distinguir as duas — testado e confirmado que incluí-la corta
   logo **depois da abertura** da citação, pior que o corte bruto que isso
   deveria substituir. Aspas curvas (`”`) e guillemet (`»`) entram porque são
   inequívocas e o worker atende 5 idiomas (en/de/it/pt/es). Caso raro de
   aspas retas sobreviverem no texto (o Gutenberg converte `"`→`"`/`"` ao
   digitar, por padrão) cai no fallback do passo 3 abaixo, sem regressão. Ex.:
   `/[^,:;)\]”»]+[,:;)\]”»]+\s*|[^,:;)\]”»]+$/g`.
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

## 2026-08-18 (parte B) — QA manual pós-implementação: carry-over de `flowLmState` reintroduz o bug que deveria corrigir

**Contexto.** Depois da Task 1/Task 2 implementadas, revisadas e enviadas
nesta branch (PR aberto, ainda não mergeado), QA manual (dois posts reais,
`post=74` e `post=5`) encontrou
áudio cortado sempre por volta de 10s, independente do tamanho do post.
Investigação sistemática (`superpowers:systematic-debugging`) nesta sessão,
resumida abaixo — tentativas, evidência, e o que ficou provado impossível
dentro do escopo desta branch.

### Causa raiz confirmada

Instrumentado o worker com log por chunk/step (`console.log` temporário,
removido antes de cada commit) e reproduzido via Playwright com texto real
multi-chunk. Evidência: com `flowLmState` carregado entre chunks (o que a
Task 1 implementou), todo chunk após o primeiro atinge `eos_logit` no
`step=0`, não importa o texto novo injetado na passagem de condicionamento
daquele chunk. Chunk 0 sempre se comporta corretamente (state fresco).

`eos_logit` é saída da mesma sessão ONNX (`flow_lm_main_int8.onnx`) que
consome o `flowLmState` carregado — é uma função desse estado, não do texto
isolado. O modelo, ao ver estado que já registrou um evento de fim de fala,
volta a sinalizar fim imediatamente diante de texto novo — comportamento
consistente com um modelo cuja cabeça de EOS foi treinada/calibrada para
tratar essa condição como terminal dentro de uma única sessão de decode, não
para retomar depois de já ter sinalizado o fim. A hipótese de que fosse
esgotamento da capacidade do cache de atenção (1000 posições, ver seção
"Causa raiz" acima) foi **descartada**: o total de posições usadas nos casos
testados (~100-150) fica bem abaixo de 1000; o EOS prematuro acontece mesmo
com cache quase vazio.

### Investigação de arquitetura (acesso ao fork HF do usuário)

A pedido do usuário — que criou o fork `luigi-moretti/pocket-tts-onnx-mirror`
justamente para permitir essa investigação — os grafos ONNX reais (não só o
manifest de runtime em `bundle.json`) foram baixados e inspecionados
(`onnx` Python, `hf download`). Achados:

- `flow_lm_main_int8.onnx`: 6 camadas de self-attention, cada uma com cache
  KV `[2,1,1000,16,64]` e contador de posição (`step`), confirmando a leitura
  do manifest de runtime.
- **`sequence` e `text_embeddings` têm eixo dinâmico** (`seq_len`,
  `text_len`) — o grafo não impõe limite fixo de tokens por chamada.
  `max_token_per_chunk=50` em `bundle.json` é recomendação do autor do
  bundle, não restrição do grafo exportado.
- O grafo não tem nenhum input de controle tipo "ignore o EOS anterior,
  continue" — é uma função pura de `(sequence, text_embeddings, estado) →
  (conditioning, eos_logit, novo estado)`. Qualquer decisão de "continuar
  apesar do EOS" teria que vir inteiramente do lado do worker.

Essa investigação **descartou** a hipótese de que `max_token_per_chunk=50`
fosse um limite físico do grafo — mas também não revelou nenhum mecanismo
do grafo que sustente continuação pós-EOS. A arquitetura do loop (cada chunk
= sua própria passagem de condicionamento + sua própria decisão de EOS) é
uma escolha do wrapper/demo, não do grafo em si — mas o comportamento
aprendido do modelo (a função `(sequence, text_embeddings, estado) →
(conditioning, eos_logit, novo estado)` citada acima) trata essa escolha
como não-opcional na prática.

### Tentativa 1 (rejeitada): manter `flowLmState` completo entre chunks

A implementação original da Task 1. Falha: reproduz o bug de truncamento
acima. Único aspecto que se sustenta: `mimiState` (decoder/vocoder — nenhuma
decisão de EOS lê esse estado) pode continuar compartilhado sem esse
problema, porque é uma sessão ONNX inteiramente separada
(`mimi_decoder_int8.onnx`), sem `eos_logit` nem cache que a etapa de decisão
de fim consulte.

### Tentativa 2 (rejeitada): ignorar `eos_logit` nos chunks internos, orçamento de steps calibrado pelo chunk 0

Testada por completo, com áudio real gerado e ouvido pelo usuário (não só
inspeção de log). Mecanismo: chunk 0 roda normalmente (EOS real, confiável),
calibra uma razão passos-por-caractere a partir do seu próprio EOS real;
chunks seguintes ignoram `eos_logit` e decodificam um número fixo de passos
proporcional ao tamanho do texto daquele chunk.

Resultado: não trunca, não erra — mas a fala fica incoerente a partir da
fronteira do primeiro chunk que usa o orçamento (confirmado em dois idiomas,
PT e EN, com áudio gerado e ouvido pelo usuário; o ponto onde a fala "fica
esquisita" bate, minuto a minuto, com o fim do chunk 0 real em ambos os
testes — evidência de que o problema é exatamente na transição, não
espalhado). Conclusão: o grafo tecnicamente aceita continuar decodificando
depois do ponto onde sinalizaria fim, mas o conteúdo gerado ali não é fala
coerente — não é só a decisão de parar que quebra ao carregar estado
pós-EOS, é a geração em si.

**Ruído lateral descoberto durante os testes desta tentativa, sem relação
com o worker:** o primeiro teste em português usou por engano o idioma
inglês (script de teste nunca selecionou "Português" no seletor do painel —
o plugin não detecta idioma pelo conteúdo, precisa de seleção explícita).
Produziu áudio em português lido pelo bundle errado ("tentando ler em
inglês"). Corrigido selecionando o idioma explicitamente; não é bug do
plugin, é lição para desenho de teste manual/automatizado futuro.

### Fix final adotado (o que está no código)

- `flowLmState` volta a resetar a cada chunk interno (comportamento
  original, pré-Task-1) — necessário porque `eos_logit` depende dele.
- `mimiState` continua compartilhado entre chunks (não quebra nada, sem
  decisão de EOS o lendo).
- `CHUNK_GAP_SEC` continua em `0.06` (a suavização de transição que o
  `mimiState` compartilhado + gap menor entregam ainda vale, mesmo sem a
  continuidade de prosódia do flow-LM).
- Task 2 (split em pausa natural para sentença estourando o limite de
  token) segue intacta e válida — não depende de nada disto.

### Limitação residual confirmada, não resolvida nesta branch

QA manual em conteúdo real (`post=5`, produção) relatou, após o fix acima:
uma palavra quase-repetida perto de "...sobre essa pergunta: [...] É a
pergunta que faço..." e uma pausa estranha entre duas cláusulas entre aspas.
Rastreado o texto exato entregue a cada chunk (via trace, reproduzindo o
mesmo conteúdo por Playwright): **confirmado que não há duplicação nem corte
de texto** — os chunks reconstroem a entrada original palavra por palavra.
As duas ocorrências problemáticas caem exatamente sobre fronteiras de chunk
novo (onde `flowLmState` reseta). Não foi possível confirmar (sem ouvir o
áudio) se o artefato é duplicação literal no áudio decodificado ou apenas o
reset de prosódia soando mal ali — mas está descartado que seja bug de
texto/split. É a mesma limitação arquitetural das duas tentativas acima,
apenas mais perceptível em texto de produção do que nos fixtures curtos do
E2E automatizado.

**Atribuição parcial, não totalmente estabelecida.** O reset de `flowLmState`
a cada chunk sempre existiu — isso não é novo desta branch. Mas a
configuração que está no ar agora não é idêntica à de antes desta branch:
`CHUNK_GAP_SEC` caiu de 0.25s para 0.06s, e a própria tabela de decisão deste
spec (seção "Decisão" acima) registra que o gap de 250ms existia
especificamente para mascarar o reset — com o reset de volta e o gap
reduzido, essa máscara não está mais lá. E `mimiState` agora fica
compartilhado atravessando uma descontinuidade dura do flow-LM, combinação
que o demo original nunca rodou (ele resetava os dois juntos). Ou seja: reset
do flow-LM não é novo; a combinação reset-do-flow-LM + `mimiState`
compartilhado + gap de 60ms É nova desta branch, e foi validada por audição
só nessa configuração — não existe um teste de controle (mesmo conteúdo,
gap de 0.25s, `mimiState` também resetado) que isole se o gap/mimiState
contribuem para o artefato relatado. Até esse controle ser rodado, o correto
é dizer: não atribuível ao reset do flow-LM isoladamente; a contribuição do
gap/mimiState não foi descartada.

### Ideia não testada para uma próxima rodada

Proposta do usuário, registrada para investigação futura, fora do escopo
desta branch: sanitizar caracteres sem valor fonético (aspas, parênteses,
travessão) do texto **só no que é enviado ao tokenizer/modelo**, mantendo o
texto original intacto para a decisão de onde cortar
(`splitSentenceAtNaturalBreaks` continua precisando da pontuação real).
Hipótese: parte do artefato relatado como "estranho perto de aspas" pode ser
o modelo tentando vocalizar pontuação sem equivalente fonético, não (só) o
reset de chunk. Não implementado, não testado — precisa de spec própria
antes de qualquer código.
