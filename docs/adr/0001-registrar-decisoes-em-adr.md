---
id: 0001
titulo: Registrar decisões de arquitetura como ADR
status: aceita
data: 2026-08-27
origem: superpowers/specs/2026-08-25-adr-e-governanca-de-arquitetura-design.md
enforced_by: [ doctor, adr-index-table ]
revisar_quando: o índice passar de 40 ADRs, ou uma ADR levar mais de meia hora para ser escrita
desvios: []
---

## Contexto

O projeto decidia bem e registrava mal. As decisões viviam em quatro formatos
que não conversavam: `CLAUDE.md` (a regra sem o porquê completo), tabelas
"Decisões fechadas" em sete specs (~2,4 mil linhas, sem status — uma decisão da
Fase 1 podia ter sido substituída na Fase 3 sem que nada dissesse isso),
`docs/FOLLOW-UPS.md` (dívida, não decisão) e seções de revisão nos planos
(~14 mil linhas que ninguém relê).

Não havia índice, não havia status e nenhum dos gates existentes — `lint:js`,
`phpcs`, `phpstan`, `tsc`, cobertura — pega "isto violou uma decisão de
arquitetura". A deriva já era mensurável: onze arestas entre features formando
ciclos nas duas linguagens, contra um `CLAUDE.md` que afirmava isolamento.

## Decisão

Toda decisão que restringe código futuro vira uma ADR em `docs/adr/`, numerada,
com front-matter YAML, e o front-matter **é** a configuração do `lint:arch`.

Vira ADR quando **as duas** afirmações são verdadeiras:

1. **Orienta código que ainda não foi escrito.** Alguém vai encostar nisso
   amanhã e precisa saber a regra antes de decidir.
2. **Reverter custa mais que um PR.** A decisão está assentada embaixo de outras.

Duas categorias passam, e ambas são legítimas:

| Categoria | Exemplo | Verificável por script? |
|---|---|---|
| Guard rail | "uma feature não referencia outra feature" | sim |
| Fundação | "o TTS nunca roda no servidor", "Pocket TTS, não Piper" | parcialmente, ou só em review |

Não vira ADR:

| O quê | Vai para |
|---|---|
| Escolha de produto ou UI de uma fase (raio com três presets, cor padrão, texto de botão) | spec |
| Bug e sua causa raiz | spec / plano |
| Achado de review deliberadamente não corrigido | `FOLLOW-UPS.md` |
| Detalhe substituível sem efeito colateral | nada |
| Um valor numérico isolado | ver abaixo |

**A restrição, nunca o valor.** "MP3 64 kbps" é valor; "o áudio é comprimido no
cliente antes do upload" é a restrição. Trocar 64 por 80 kbps é spec, não ADR
nova. Se a alteração proposta não muda o que é possível escrever, não é ADR.

**A ADR destila; o spec permanece intacto.** O spec responde "como a Fase 3 foi
construída"; a ADR responde "posso escrever isto hoje?". Reescrever spec
histórico contradiz o princípio do próprio repo, que manda amendar com seção
datada.

Tamanho: alvo de 40 a 80 linhas, teto de 120. Acima do teto virou spec
disfarçada e o `doctor` avisa.

Quem pode mudar o quê:

| Campo | Quem pode mudar |
|---|---|
| Contexto, Decisão, Consequências, Alternativas | Ninguém. Mudou de ideia → ADR nova, e a antiga recebe `status: superada-por-NNNN` |
| `status`, `desvios` | Qualquer PR. São campos vivos, e o `lint:arch` já exige que reflitam a realidade |

Sem essa separação, editar a ADR vira o caminho de menor resistência e o
histórico do porquê desaparece — que é o problema de origem.

## Consequências

Fica mais fácil: responder "posso escrever isto?" sem ler 2,4 mil linhas de
spec; ver onde teoria e implementação divergem, medido, em `desvios:`; e dar a
um dev ou LLM novo um ponto de entrada de tamanho finito.

Fica mais difícil: toda decisão de arquitetura passa a custar um arquivo. É
deliberado — o custo é o filtro. E o critério de admissão precisa ser aplicado
com rigor, senão o índice cresce até deixar de ser lido, que é o modo de falha
do `CLAUDE.md` que originou este trabalho.

## Como verificar

`npm run doctor` reporta: contagem por status, `revisar_quando` cujo gatilho
disparou, ADR acima de 120 linhas, ADR cuja `origem` aponta para arquivo
inexistente, e ADR ausente do índice de `README.md`.

`adr-index-table` reprova quando a tabela de `README.md` discorda do
front-matter em `status` ou em `enforced_by`. O índice duplica esses dois
campos, e duplicação sem checagem é a deriva que esta ADR existe para impedir —
sem a regra dava para mudar o front-matter e deixar a tabela mentindo com o
`lint:arch` em 0. Ausência de uma ADR no índice segue com o `doctor`, para os
dois não reportarem o mesmo defeito duas vezes.

O que continua sem gate determinístico é o critério de admissão: "isto merecia
ser uma ADR?" é julgamento, e é a razão de `doctor` estar no `enforced_by` ao
lado da regra.

## Alternativas rejeitadas

**Manter tudo no `CLAUDE.md`.** Ele carrega em todo contexto e a documentação do
Claude Code marca 200 linhas como ponto de queda de aderência. A 50 decisões o
arquivo deixa de ser obedecido, e o modo de falha é silencioso.

**ADR em ferramenta externa (Notion, wiki).** Sai do alcance de `grep`, do
histórico do git e de qualquer script de verificação. A ADR precisa estar no
repo justamente para poder ser a configuração do linter.

**Migrar as ~50 decisões fechadas dos specs.** Um índice de 50 itens onde 35 são
escolha de UI de uma fase deixa de ser lido — e nenhuma dessas 35 é verificável.
