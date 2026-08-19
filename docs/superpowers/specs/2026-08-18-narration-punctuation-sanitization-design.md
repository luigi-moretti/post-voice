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
| Onde a sanitização entra | Uma função, `sanitizeForTokenizer(text)`, chamada em **todo** call-site de `tokenizerProcessor.encodeIds(...)` em `pocket-tts.worker.js` (hoje 6: dentro de `splitSentenceAtNaturalBreaks`, `splitIntoClauses`'s medição de candidato, `splitIntoBestSentences`, e o encode final antes de gerar áudio). **Nunca** dentro de `splitTextIntoSentences`/`splitIntoClauses` — essas funções continuam lendo o texto original via regex, preservando o sinal de split que fecho de aspa/parêntese já fornece hoje (`NATURAL_BREAK_RE`, da spec de chunking). Alternativa considerada e rejeitada: normalizar `prepared.text` inteiro logo no início do pipeline — mais simples, mas apaga o glyph antes do split enxergar o fecho de aspa/parêntese como ponto de corte, regressão na feature que o PR#6 acabou de entregar. |
| Mapeamento — família OOV | `“ ” „` → `"` · `‘ ’ ‚` → `'` · `« »` → `"` · `…` → `...`. Substituição 1-para-1, sem alterar espaçamento — o glyph carrega papel sintático equivalente ao ASCII escolhido, informação não se perde. |
| Remoção — parênteses/colchetes | `( ) [ ]` viram espaço (não string vazia) — evita colar palavras quando o autor não deixou espaço ao redor (`"WordPress(WP)"` sem o espaço viraria `"WordPressWP"`, uma palavra inexistente, se a remoção fosse literal). Espaços múltiplos resultantes colapsam para um único, com trim nas pontas. |
| Remoção — travessão | `—`/`–` viram espaço, mesma regra de colapso — **exceto quando o caractere imediatamente antes e o imediatamente depois são dígitos** (range numérico, ex. `2020–2023`): nesse caso o travessão fica intacto, sem tocar. Verificação é posicional (olha o char anterior/seguinte na string), não regex de lookaround — mais simples de auditar. |
| Exceção — hífen ASCII (`-`) | **Nunca** entra nesta sanitização, em nenhuma circunstância. Hífen de ênclise/mesóclise em português (`mantenha-se`, `trata-se`, `absteu-se`) é caractere diferente de travessão (`— –`) — já confirmado token limpo, sem problema de OOV. A implementação usa os glyphs Unicode exatos `—`/`–` no conjunto de remoção; hífen-minus nunca aparece nesse conjunto. Caso de teste dedicado abaixo garante que a palavra sobrevive intacta. |
| Vírgula, ponto, dois-pontos, ponto-e-vírgula | Fora de escopo — token limpo, nenhuma evidência de problema, e são o próprio sinal de pausa que `NATURAL_BREAK_RE` usa pra decidir onde cortar. Não tocados por `sanitizeForTokenizer`. |
| Medição de token vs. síntese real | `sanitizeForTokenizer` entra em toda chamada de `encodeIds`, medição (decide se cabe no chunk) e síntese final (vira áudio) igualmente — não só na síntese. Efeito colateral positivo: contagem de token passa a refletir o custo real pro modelo (aspa curva custava 4 tokens medidos, 1 real pós-normalização), então menos texto cai desnecessariamente no fallback de corte bruto por estourar limite. Sem efeito colateral negativo identificado — a mesma função roda antes de qualquer `encodeIds`, então medição e síntese sempre veem o mesmo texto. |

## Mudanças

Único arquivo tocado: `features/narration/editor/engine/pocket-tts.worker.js`
— mesmo arquivo da spec de chunking, sem mudança de interface pública
(mensagens do worker, REST, meta de post), sem migração de dado.

### `sanitizeForTokenizer(text)`

Nova função, definida perto de `NATURAL_BREAK_RE` (as duas documentam a
mesma fronteira: uma decide onde CORTAR usando o texto original, a outra
decide o que o TOKENIZER recebe). Três passos, ordem não importa entre eles
(operam em conjuntos de caracteres disjuntos):

1. **Mapa de substituição direta** — tabela glyph → ASCII, um `replace` por
   entrada ou um único regex com callback de lookup:
   `“ ” „ → "`, `‘ ’ ‚ → '`, `« » → "`, `… → ...`.
2. **Parênteses/colchetes → espaço**: `text.replace(/[()[\]]/g, ' ')`.
3. **Travessão → espaço, com guarda de range numérico**: percorre ocorrências
   de `—`/`–`; se o char imediatamente antes E o imediatamente depois forem
   dígito (`/\d/`), mantém o travessão; caso contrário substitui por espaço.
4. **Colapso final**: `text.replace(/\s{2,}/g, ' ').trim()` — limpa os
   espaços introduzidos pelos passos 2 e 3.

`splitTokenIdsIntoChunks` (decodifica tokens de volta pra texto no fallback
de corte bruto) não muda — os tokens que ele recebe já vieram de texto
sanitizado, porque `encodeIds` que os gerou já passou por
`sanitizeForTokenizer` no call-site.

### Call-sites atualizados (6, todos `tokenizerProcessor.encodeIds(...)`)

Trocar `encodeIds(x)` por `encodeIds(sanitizeForTokenizer(x))` em:
`splitSentenceAtNaturalBreaks` (fallback pathológico), `splitIntoClauses`
(medição de candidato — 2 call-sites), `splitIntoBestSentences` (medição de
sentença e de combinação), e o encode final antes de `session.run` gerar
áudio. `decodeIds` não muda em nenhum lugar.

## Testes

Mesma convenção da spec de chunking: Worker/ONNX não leva mock/Jest, leva
E2E. Nenhum teste unitário novo.

- **E2E novo ou extensão de `e2e/narration-audio-quality.spec.ts`**: fixture
  cobrindo, no mínimo:
  - aspa curva aninhada em parêntese (o padrão exato do artefato de
    `post=5`) — variante do `OVERSIZED_PUNCTUATED_SENTENCE` já existente;
  - palavra com hífen de ênclise/mesóclise em português (`mantenha-se`),
    verificando que a palavra sobrevive intacta (assert no texto entregue
    ao tokenizer, não só "não trava" — o resto da suíte já cobre
    completude/timeout);
  - travessão de range numérico (`2020–2023`) sobrevivendo intacto;
  - travessão de aparte (`"O plano — uma boa ideia — funcionou."`) sendo
    removido sem colar palavras.
  - Asserções seguem o padrão black-box já estabelecido (geração completa,
    player recebe áudio, sem erro) — mas os casos de hífen/range acima
    precisam verificação adicional do texto pré-tokenizer, não só do áudio
    final; ver nota de implementação abaixo.
- **Verificação manual (qualitativa, documentada no PR)**: ouvir antes/depois
  o texto de `post=5` (ou equivalente), e especificamente o caso de travessão
  de aparte (aposta de prosódia sem evidência de tokenizer — só audição
  decide se vale manter). Se a audição não mostrar melhora clara na remoção
  de parênteses/travessão, decisão cai para reverter só essa metade
  (mapeamento de aspas fica, por ter evidência própria) — registrar o
  resultado como amendment aqui antes de fechar o PR.
- Gates normais de `TESTING.md` (lint, tsc, PHP, cobertura, build+E2E
  completo) continuam se aplicando, conforme `CLAUDE.md`.

**Nota de implementação para o plano**: como `sanitizeForTokenizer` roda
dentro do Worker, sem acesso direto de fora, a checagem de "hífen
sobrevive"/"range sobrevive" no E2E provavelmente precisa expor o texto
sanitizado de alguma forma testável (ex. exportar a função e cobri-la com um
teste dedicado dentro do próprio Worker context via Playwright
`page.evaluate`, ou log/assert indireto) — decisão de mecanismo fica pro
plano de implementação, não pra esta spec.

## Fora de escopo

- Vírgula, ponto, dois-pontos, ponto-e-vírgula — sem evidência de problema,
  são o sinal de pausa que o split já usa.
- Normalizar `prepared.text` inteiro antes do split — rejeitado, quebraria
  o sinal de fecho de aspa/parêntese que `NATURAL_BREAK_RE` usa.
- Qualquer caractere fora do conjunto testado nos 5 tokenizers (aspas,
  guillemets, aspas baixas, reticências, parênteses, colchetes, travessão).
- Métrica objetiva de prosódia — mesma decisão da spec de chunking, ainda
  sem métrica automatizada; validação continua sendo audição manual
  documentada.
