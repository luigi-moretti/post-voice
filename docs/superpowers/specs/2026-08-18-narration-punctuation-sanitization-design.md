# Sanitização de pontuação para o tokenizer — normalizar aspas, remover parênteses/travessão

**Data:** 2026-08-18
**Status:** Aprovado para planejamento de implementação
**Issue:** https://github.com/luigi-moretti/post-voice/issues/5 (sub-projeto A — qualidade)
**Investigação relacionada:** `docs/superpowers/specs/2026-08-18-narration-audio-quality-chunking-design.md`,
seção "2026-08-18 (parte C)" — evidência de tokenizer que fundamenta esta spec.

## Contexto

A spec de chunking (`2026-08-18-narration-audio-quality-chunking-design.md`)
corrigiu reset de estado e split de sentença estourada, mas deixou registrado
um artefato residual em conteúdo real (`post=5`): palavra quase-repetida e
pausa estranha perto de cláusulas entre aspas. A seção "parte C" dessa mesma
spec investigou a causa, rodando o tokenizer real (`SentencePieceProcessor`
de `sentencepiece.js`, a mesma classe que `pocket-tts.worker.js` usa em
produção) contra os 5 `tokenizer.model` do projeto (en/de/it/pt/es), fora da
branch, só leitura. Achado, reproduzido nos 5 idiomas:

| Caractere | Encode | Classificação |
|---|---|---|
| Aspas curvas `“ ” ‘ ’`, aspas baixas `„ ‚`, guillemet `« »`, reticências `…` | 3-4 tokens, cada um decodificando isolado para `�` (replacement char) | **Byte-fallback — sem piece dedicada no vocab, OOV** |
| Aspa reta `"`, apóstrofo reto `'`, parênteses `( ) [ ]`, travessão `— –`, hífen `-`, vírgula, ponto, dois-pontos, ponto-e-vírgula | 1 token único (piece dedicada) | Token normal, não-OOV |

O apóstrofo curvo (`’`) é o mesmo glyph que o fecho de aspa simples — e é o
que Gutenberg usa também em contrações (`it’s`), então cai na mesma categoria
byte-fallback. Confirmado: `it’s` tokeniza em 5 ids incluindo a sequência de
byte crua; `it's` (reto) tokeniza em 3 ids limpos, em todos os idiomas
testados.

Parênteses e travessão **não têm** evidência de OOV — tokenizam limpo. A
ideia original da issue #5 (remover parênteses/travessão) segue registrada
aqui a pedido do usuário, mas como aposta de prosódia separada, sem o mesmo
lastro de evidência que a normalização de aspas tem — ver "Testes" para como
isso é validado antes de virar comportamento definitivo.

## Decisão

| Ponto | Decisão |
|---|---|
| Escopo | Duas famílias, mecanismos diferentes: (1) normalizar glyphs OOV confirmados para o equivalente ASCII de vocab limpo; (2) remover parênteses/colchetes/travessão como aposta de prosódia, sem evidência de tokenizer, validada por audição manual. |
| Onde a função vive | **Módulo próprio**, não inline em `pocket-tts.worker.js` — ver "Por que módulo separado" abaixo. `pocket-tts.worker.js` importa e chama. |
| Onde a sanitização entra | Chamada em **todo** call-site de `tokenizerProcessor.encodeIds(...)` em `pocket-tts.worker.js` (6, ver "Mudanças"). **Nunca** dentro de `splitTextIntoSentences`/`splitIntoClauses` — essas seguem lendo o texto original via regex, preservando o sinal de split que fecho de aspa/parêntese já fornece hoje (`NATURAL_BREAK_RE`, da spec de chunking). Alternativa rejeitada: normalizar `prepared.text` inteiro logo no início do pipeline — apaga o glyph antes do split enxergar o fecho de aspa/parêntese como ponto de corte, regressão na feature que o PR#6 entregou. |
| Mapeamento — família OOV | `“ ” „` → `"` · `‘ ’ ‚` → `'` · `« »` → `"` · `…` → `...`. Substituição 1-para-1 de conteúdo (o `...` de 3 chars é a única que muda o comprimento da string) — o glyph carrega papel sintático equivalente ao ASCII escolhido, informação não se perde. |
| Remoção — parênteses/colchetes | `( ) [ ]` viram espaço (não string vazia) — evita colar palavras quando o autor não deixou espaço ao redor (`"WordPress(WP)"` sem o espaço viraria `"WordPressWP"`, uma palavra inexistente, se a remoção fosse literal). Espaços múltiplos resultantes colapsam para um único, com trim nas pontas. Caso `[1]`/`[citação necessária]` (nota/citação numerada): número/texto fica solto no meio da frase depois da remoção — comportamento aceito, sem tratamento especial (fora do padrão comum de post de blog; ver "Fora de escopo"). |
| Remoção — travessão | `—`/`–` viram espaço, mesma regra de colapso — **exceto quando o caractere imediatamente antes e o imediatamente depois, no texto original recebido pela função, são dígitos** (range numérico, ex. `2020–2023`): nesse caso o travessão fica intacto. Verificação é posicional sobre o texto de entrada, não regex de lookaround — mais simples de auditar. |
| Exceção — hífen ASCII (`-`) | **Nunca** entra nesta sanitização, em nenhuma circunstância. Hífen de ênclise/mesóclise em português (`mantenha-se`, `trata-se`, `absteu-se`) é caractere diferente de travessão (`— –`) — já confirmado token limpo, sem problema de OOV. A implementação usa os glyphs Unicode exatos `—`/`–` no conjunto de remoção; hífen-minus nunca aparece nesse conjunto. Caso de teste dedicado garante que a palavra sobrevive intacta (ver "Testes"). |
| Vírgula, ponto, dois-pontos, ponto-e-vírgula | Fora de escopo — token limpo, nenhuma evidência de problema, e são o próprio sinal de pausa que `NATURAL_BREAK_RE` usa pra decidir onde cortar. Não tocados. |
| Medição de token vs. síntese real | A sanitização entra em toda chamada de `encodeIds`, medição (decide se cabe no chunk) e síntese final (vira áudio) igualmente — não só na síntese. Efeito colateral positivo: contagem de token passa a refletir o custo real pro modelo (aspa curva custava 4 tokens medidos, 1 real pós-normalização), então menos texto cai desnecessariamente no fallback de corte bruto por estourar limite. Efeito a verificar: os dois fixtures E2E existentes (`LONG_PARAGRAPH`, `OVERSIZED_PUNCTUATED_SENTENCE`) foram calibrados pra forçar múltiplos chunks sob a contagem antiga (inflada); contagem menor pode reduzir o número de chunks gerados. Não invalida os testes (ainda são plausíveis multi-chunk), mas o guard de duração mínima adicionado em `ffed8a4` (12s) precisa ser reconferido depois da mudança — ver "Testes". |

### Por que módulo separado, não inline em `pocket-tts.worker.js`

`sanitizeForTokenizer` é transformação de string pura — nenhuma dependência
de `self`, ONNX ou Worker. A regra do `CLAUDE.md` ("Worker, ONNX ou browser
real → E2E em vez de mock") é sobre **acoplamento**, não sobre em qual
arquivo o código mora; `pocket-tts.worker.js` só cai nela porque roda
`self.postMessage(...)` no top-level do módulo (linha 29), o que impede
importar qualquer coisa de lá no Jest sem mockar `self` inteiro. Extrair pra
módulo próprio remove essa barreira mecânica e segue o mesmo padrão já usado
por `model-cache.ts`/`tts-engine.ts` (módulos `.ts` importados pelo worker
`.js`) — mas ao contrário deles, que genuinamente mexem em Cache API/
postMessage e por isso continuam sem teste unitário, `sanitizeForTokenizer`
não tem essa desculpa. Mesma categoria de `segment-hash.ts`/
`rtf-calibration.ts`/`extract-segments.ts`: lógica pura, testada com Jest.

## Mudanças

| Arquivo | Mudança |
|---|---|
| `features/narration/editor/engine/tokenizer-sanitize.ts` (**novo**) | Exporta `sanitizeForTokenizer(text: string): string`. Implementação, ver abaixo. |
| `features/narration/editor/engine/pocket-tts.worker.js` | Importa `sanitizeForTokenizer` de `./tokenizer-sanitize`; troca `encodeIds(x)` por `encodeIds(sanitizeForTokenizer(x))` nos 6 call-sites (ver lista abaixo). Comentário de atribuição no topo do arquivo (linhas 1-18, já lista as mudanças da spec de chunking) ganha mais uma linha descrevendo esta mudança, mesmo padrão das anteriores. |
| `features/narration/tests/js/tokenizer-sanitize.test.ts` (**novo**) | Cobertura Jest — ver "Testes". |
| `jest.config.js` | Adiciona `features/narration/editor/engine/tokenizer-sanitize.ts` a `collectCoverageFrom` (gate de 80% linhas, `CLAUDE.md`). |
| `TESTING.md` | Registra o novo arquivo de teste unitário e o que mudou no E2E de qualidade de áudio, mesmo padrão do PR#6 (que também tocou este arquivo). |

Sem mudança de interface pública (mensagens do worker, REST, meta de post),
sem migração de dado.

### `sanitizeForTokenizer(text)` — algoritmo

Ordem fixa, **não intercambiável** (ao contrário de uma versão anterior desta
spec) — a guarda de range numérico do travessão precisa ler os vizinhos do
texto **antes** de qualquer substituição que mude o comprimento da string
(a reticência `…`→`...` é a única que muda), então roda primeiro:

1. **Travessão → espaço, com guarda de range numérico**, sobre o texto de
   entrada original. Percorre ocorrências de `—`/`–`; se o char imediatamente
   antes E o imediatamente depois, **no texto recebido pela função**, forem
   dígito (`/\d/`), mantém o travessão; caso contrário substitui por espaço.
2. **Parênteses/colchetes → espaço**: `/[()[\]]/g` → `' '`.
3. **Mapa de substituição direta** (glyph → ASCII), sobre o resultado dos
   passos 1-2: `“ ” „ → "`, `‘ ’ ‚ → '`, `« » → "`, `… → ...`.
4. **Colapso final**: `/\s{2,}/g` → `' '`, depois `.trim()` — limpa os
   espaços introduzidos pelos passos 1 e 2.

O valor de retorno é usado **só** como argumento de `encodeIds` no call-site
— nunca reatribuído a `chunkText`/`sentenceText`/`currentChunk` nem
propagado adiante. O texto original (com toda a pontuação) continua sendo o
que os testes/logs de "texto entregue a cada chunk" (mencionados na spec de
chunking) enxergam.

Comentário cruzado: o bloco que define `NATURAL_BREAK_RE` em
`pocket-tts.worker.js` ganha uma linha apontando pra
`tokenizer-sanitize.ts` (mesma fronteira textual, papéis opostos — uma
decide onde cortar, a outra o que o tokenizer recebe); `tokenizer-sanitize.ts`
aponta de volta. Evita que uma edição futura mude um dos dois sem notar o
outro.

`splitTokenIdsIntoChunks` (decodifica tokens de volta pra texto no fallback
de corte bruto) não muda — os tokens que ele recebe já vieram de texto
sanitizado, porque `encodeIds` que os gerou já passou pela função no
call-site.

### Call-sites atualizados (6, todos `tokenizerProcessor.encodeIds(...)`)

`pocket-tts.worker.js`, linhas atuais 526 (`splitSentenceAtNaturalBreaks`,
fallback pathológico), 546 e 577 (`splitIntoClauses`/medição de candidato),
608 e 631 (`splitIntoBestSentences`, medição de sentença e de combinação),
949 (encode final antes de gerar áudio). `decodeIds` não muda em nenhum
lugar. Números de linha são os do estado atual do arquivo — conferir de novo
no início da implementação, não são um contrato.

## Testes

`sanitizeForTokenizer` é lógica pura — Jest, não E2E (ver "Por que módulo
separado"). Isso também resolve uma lacuna que uma versão anterior desta
spec tinha: E2E black-box não conseguia verificar diretamente o texto
sanitizado (só inferir pelo áudio final), o que teria exigido expor estado
interno do Worker só pra teste.

- **`features/narration/tests/js/tokenizer-sanitize.test.ts`** (Jest, gate
  80% linhas via `jest.config.js`). Casos mínimos:
  - cada glyph do mapa família-OOV isolado e em frase (`“ ” ‘ ’ „ ‚ « » …`);
  - apóstrofo de contração curvo (`it’s` → `it's`) preservando a palavra;
  - parênteses/colchetes com e sem espaço ao redor (`"WordPress (WP)"` e
    `"WordPress(WP)"` ambos sem colar palavra);
  - colchete de nota/citação (`"fato[1]."`) — documenta o comportamento
    aceito (número fica solto), não é regressão, é caso conhecido;
  - travessão de aparte, com espaço e sem espaço ao redor;
  - travessão de range numérico (`"2020–2023"`) sobrevivendo intacto;
  - **hífen de ênclise/mesóclise** (`mantenha-se`, `trata-se`, `absteu-se`)
    sobrevivendo intacto — o caso que motivou esta seção;
  - string vazia, string só com os caracteres removidos (sem sobra de
    texto), texto sem nenhum caractere do escopo (idempotente);
  - aspa curva aninhada em parêntese, o padrão exato do artefato de
    `post=5` (`'(...as "impossible to sit through")'` com aspas curvas
    reais) — caso combinado, não só unidades isoladas.
- **E2E existente (`e2e/narration-audio-quality.spec.ts`)**: sem fixture
  nova dedicada a sanitização (a unidade já cobre isso). Reconferir que
  `LONG_PARAGRAPH`/`OVERSIZED_PUNCTUATED_SENTENCE` ainda passam pelo guard
  de duração mínima de 12s (`ffed8a4`) depois da mudança — contagem de token
  menor pode reduzir o número de chunks internos gerados; se algum fixture
  deixar de exercitar múltiplos chunks, ajustar o texto do fixture (mais
  pontuação OOV/mais texto), não o guard.
- **Verificação manual (qualitativa, documentada no PR)**: ouvir antes/depois
  o texto de `post=5` (ou equivalente), e especificamente o caso de travessão
  de aparte (aposta de prosódia sem evidência de tokenizer — só audição
  decide se vale manter). Se a audição não mostrar melhora clara na remoção
  de parênteses/travessão, decisão cai para reverter só essa metade
  (mapeamento de aspas fica, por ter evidência própria) — registrar o
  resultado como amendment aqui antes de fechar o PR.
- Gates normais de `TESTING.md` (lint, tsc, PHP, cobertura, build+E2E
  completo) continuam se aplicando, conforme `CLAUDE.md`.

## Fora de escopo

- Vírgula, ponto, dois-pontos, ponto-e-vírgula — sem evidência de problema,
  são o sinal de pausa que o split já usa.
- Normalizar `prepared.text` inteiro antes do split — rejeitado, quebraria
  o sinal de fecho de aspa/parêntese que `NATURAL_BREAK_RE` usa.
- Tratamento especial para nota/citação numerada entre colchetes
  (`[1]`, `[citação necessária]`) — comportamento (número solto) é aceito,
  documentado em teste, não corrigido nesta rodada.
- Qualquer caractere fora do conjunto testado nos 5 tokenizers (aspas,
  guillemets, aspas baixas, reticências, parênteses, colchetes, travessão).
- Métrica objetiva de prosódia — mesma decisão da spec de chunking, ainda
  sem métrica automatizada; validação continua sendo audição manual
  documentada.
