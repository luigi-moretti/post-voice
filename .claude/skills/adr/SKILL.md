---
name: adr
description: Dispara sempre que uma decisão de arquitetura pode estar nascendo ou mudando — ao fechar um brainstorming, ao escrever ou revisar um spec, durante code review, ou sempre que a conversa disser "decidimos X" ou "a partir de agora Y". Também dispara quando `npm run lint:arch` reprova um PR (para saber congelar um desvio versus corrigir o código) e quando alguém quer mudar `status`, `desvios`, ou substituir uma ADR existente.
---

# ADR — registrar e manter decisões de arquitetura

Este projeto guarda decisões de arquitetura em `docs/adr/*.md`, numeradas, com
front-matter YAML que **é** a configuração do linter `npm run lint:arch`. As
ADRs já estão no repo e são legíveis por conta própria — esta skill não as
resume. Ela é o procedimento: quando abrir uma ADR nova, como escrevê-la sem
quebrar o linter, o que fazer quando ele acusa, e como uma ADR muda depois de
existir.

Leia `docs/adr/README.md` uma vez por sessão em que esta skill dispara — ele
tem o índice atual e as duas frases que resumem o sistema. A ADR-0001
(`docs/adr/0001-registrar-decisoes-em-adr.md`) é a fonte de verdade do
critério de admissão; o que segue aqui é como aplicá-lo, não uma segunda
cópia dele.

## 1. Isto vira ADR?

Abra a ADR-0001, seção "Decisão", e aplique os dois testes literais que estão
lá: a decisão orienta código que ainda não foi escrito, **e** reverter custa
mais que um PR. As duas têm de ser verdadeiras. Se uma falhar, não é ADR —
veja a tabela "Não vira ADR" na própria ADR-0001 para onde a coisa vai em vez
disso (spec, plano, `FOLLOW-UPS.md`, ou nada).

Não repita o teste de memória: releia a ADR-0001 a cada vez, porque é o
único lugar onde o critério pode mudar.

## 2. A restrição, nunca o valor

Antes de escrever, pergunte: "se eu trocar só o literal, o que é possível
escrever muda?" — o número, mas também a string, o booleano, o valor de enum.
Se a resposta é não, o que você tem é um valor, não uma restrição, e é edição
de spec, não ADR nova. E se não houver literal nenhum para trocar, o teste
não se aplica: volte à formulação da ADR-0001, "se a alteração proposta não
muda o que é possível escrever, não é ADR". O exemplo canônico está na
ADR-0001: "MP3 64 kbps" é valor (mudar para 80 kbps é spec); "o áudio é
comprimido no cliente antes do upload" é a restrição (é isso que uma ADR
registra).

## 3. Onde a decisão mora

Nem toda decisão vai para uma ADR mesmo quando passa nos dois testes —
depende do custo de alguém esquecê-la:

| Custo de esquecer | Onde mora |
|---|---|
| Catastrófico e irreversível (ex.: TTS nunca roda no servidor) | `CLAUDE.md`, e ainda assim só se caber no teto do arquivo — o `doctor` reporta o teto |
| Um ciclo de review (alguém erra, o reviewer humano pega) | `.claude/rules/<nome>.md` com `paths:` apontando para onde a regra se aplica |
| O `lint:arch` pega sozinho | só a ADR + a regra em `scripts/lint-arch/rules/` — não precisa duplicar em `CLAUDE.md` |

Uma decisão pode estar em mais de uma linha desta tabela ao mesmo tempo (uma
frase curta em `CLAUDE.md` **e** a ADR que a sustenta — ver seção 9).

## 4. Como escrever a ADR

1. Copie `docs/adr/TEMPLATE.md` para `docs/adr/NNNN-titulo-curto.md`, `NNNN`
   sendo o próximo id de quatro dígitos livre (confira o índice de
   `docs/adr/README.md`).
2. Alvo de 40 a 80 linhas, teto de 120 — acima disso é spec disfarçada e o
   `doctor` avisa.
3. `origem` tem de apontar para um arquivo que **já existe**: se a decisão
   ainda não tem spec ou documento sob `docs/`, escreva-o primeiro — é o
   único passo deste procedimento que trava quem chega nele sem saber.
   O caminho é **relativo a `docs/`**, não um atalho:
   `superpowers/specs/2026-08-25-nome.md`, não `specs/2026-08-25-nome.md`.
   O teste é `cat docs/<origem sem a âncora #...>` funcionar — e
   `lint:arch` reprova a ADR se o arquivo não existir exatamente nesse
   caminho.
4. `status` é um dos cinco valores fechados:
   `proposta | aceita | aceita-com-desvio | superada-por-NNNN | revogada`.
   Qualquer outro texto reprova o parser (`scripts/lint-arch/adr.js`).
5. `revisar_quando` é uma **condição observável**, nunca uma data —
   "uma quarta feature entrar", não "em março". Uma data vira dívida
   invisível: ninguém revê o arquivo no dia certo, e a ADR nunca é
   reaberta. Isto é código convencional do parser, não estilo: o `doctor`
   imprime `revisar_quando` ao lado dos números que ela costuma citar
   (contagem de features, de módulos em `shared/`) justamente para um
   humano julgar se a condição já disparou.
6. `desvios:` não leva número de linha — veja a seção 6 antes de escrever
   qualquer entrada aqui.
7. `enforced_by` é uma lista não vazia. Cada item ou é o id de uma regra em
   `scripts/lint-arch/rules/`, ou um dos dois literais que dizem "isto só é
   verificável por leitura humana": `review-manual` (o code review confere)
   ou `doctor` (o relatório de saúde reporta, sem bloquear — é o caso da
   própria ADR-0001, cujo critério de admissão é julgamento).
8. Preencha "Como verificar" e "Alternativas rejeitadas" de verdade — sem
   "Alternativas rejeitadas" a decisão não impede que a opção descartada
   volte à mesa em seis meses.

## 5. Se a ADR é enforçável por script, a regra vem no mesmo PR

Um `enforced_by` que nomeia uma regra que não existe em
`scripts/lint-arch/rules/` reprova o `lint:arch` imediatamente — e o inverso
também: uma regra em `rules/` que nenhuma ADR declara em `enforced_by` é
"regra órfã" e também reprova. O registro (`scripts/lint-arch/rules/index.js`)
e as ADRs são espelhos deliberados um do outro; não existe meio-termo onde a
regra existe mas ainda não está "ligada".

Ao escrever a regra:

- Arquivo novo em `scripts/lint-arch/rules/<id>.js`, exportando
  `{ id, adr, check(ctx) }` — `adr` é o id de quatro dígitos da ADR que a
  regra defende, e o `lint:arch` confere que os dois lados concordam.
- Registre em `scripts/lint-arch/rules/index.js`.
- Cada achado (`finding`) que `check()` devolve carrega uma `key` **estável**
  — sem número de linha, porque a linha muda a cada edição e uma `key` que
  muda sozinha invalida qualquer `desvios:` escrito contra ela. Veja o padrão
  em regras existentes (`grep -n "key:" scripts/lint-arch/rules/*.js`):
  sempre algo como `` `${file} → ${o-que-foi-violado}` ``, nunca um número de
  linha na chave.
- **Fixture nos dois sentidos, sem exceção**: um teste Jest que prova que a
  regra deixa passar o caso correto, e um que prova que ela acusa o caso
  violador — ambos com uma amostra mínima de código, não o arquivo real do
  projeto. Sem as duas fixtures, a regra não vai para o PR. Exemplo completo:
  `scripts/lint-arch/tests/rule-feature-deps.test.js`.

## 6. Quando `lint:arch` te acusa: congelar ou corrigir

`desvios:` não é prosa. Cada linha é comparada **caractere a caractere**
contra a `key` que a regra emitiu para aquele achado — é a única parte do
texto de uma ADR que qualquer PR pode editar (ver ADR-0001, tabela "Quem pode
mudar o quê"), e por isso é também o jeito mais fácil de errar o sistema
inteiro sem perceber. Uma `key` com um caractere trocado não absolve nada; o
achado continua reprovando, sem avisar por quê a entrada não bateu.

Passo a passo ao ver uma reprovação:

1. Rode `npm run lint:arch` (ou leia a saída do CI). Cada linha de violação
   já nomeia o arquivo a editar — `viola a ADR-NNNN (título)` — e termina em
   `Chave de desvio: "..."`. **Copie esse texto entre aspas**, não
   reconstrua a `key` de memória olhando o código-fonte da regra.
2. Decida: isto é uma violação nova de uma decisão real, ou uma violação já
   conhecida e aceita por enquanto?
   - **Violação nova de código que você está escrevendo agora**: corrija o
     código. Não existe atalho de congelar uma violação que você mesmo está
     introduzindo.
   - **Violação preexistente, cuja correção é fora do escopo do PR atual**:
     cole a `key` copiada dentro de `desvios:` na ADR correspondente, e mude
     `status` para `aceita-com-desvio` se ainda não estava. O texto da ADR
     (Contexto/Decisão/Consequências/Alternativas) não muda — só o
     front-matter.
3. Se a lista de `desvios:` de uma ADR chega a zero porque tudo foi
   corrigido, volte `status` para `aceita`. O `lint:arch` recusa
   `aceita-com-desvio` sem nenhum desvio listado, e é o próprio `lint:arch`
   que avisa quando uma entrada de `desvios:` parou de ser violada ("dívida
   quitada") — o `doctor` só reimprime essa saída na primeira seção. Remova
   a entrada em vez de deixá-la fossilizada.

## 7. Checklist de code review

Antes de aprovar ou abrir um PR que mexe em código sob governança de ADR:

- [ ] `npm run lint:arch` passa (sai 0).
- [ ] `npm run doctor` rodou e nada na seção "higiene das ADRs" nem
      "gatilhos de revisão" pede atenção que este PR deveria resolver.
      (`doctor` nunca reprova o PR sozinho — é relatório, não gate — mas
      ignorar o que ele mostra é decisão do revisor, não do script.)
- [ ] Leu `docs/adr/README.md` e confirmou que a ADR certa (nova ou
      existente) cobre o que este diff está fazendo.
- [ ] Perguntou: **"esta mudança contém uma decisão que ficou sem ADR?"** —
      aplique os dois testes da seção 1.
- [ ] Se o diff toca `features/`: **"isto cria uma aresta cross-feature
      nova?"** (ADR-0005/`feature-deps` já bloqueia isso automaticamente,
      mas a pergunta pega o caso em que a aresta nasce disfarçada — por
      exemplo, através de um hook do WordPress em vez de um `import`/
      referência de classe direta, que a regra não enxerga).

## 8. Como uma ADR muda depois de existir

Repetido aqui de propósito, porque é o que se consulta no meio de um review;
a fonte é a ADR-0001, e se as duas divergirem, ela vence.

| Campo | Quem pode mudar, e como |
|---|---|
| `Contexto`, `Decisão`, `Consequências`, `Alternativas rejeitadas` | Ninguém, nunca. Mudou de ideia → escreva uma ADR **nova**, e mude o `status` da antiga para `superada-por-NNNN` (o `NNNN` da nova). |
| `status`, `desvios` | Qualquer PR — são campos vivos, e existem justamente para refletir a realidade sem reescrever a decisão (ver seção 6). |

Ao mudar o status para `revogada` ou `superada-por-NNNN`, a ADR para de
enforçar: as violações dela deixam de reprovar, e o `desvios:` dela vira
inerte (o `lint:arch` avisa se sobrou algum listado). A regra que ela nomeava
passa a aparecer como **órfã** — esse é o sinal de que o passo seguinte é
apagar a regra, ou apontá-la para a ADR nova mudando o `adr:` dela. O porquê
histórico não se perde: fica no texto da ADR antiga, que continua versionado e
não se reescreve.

Reescrever o corpo de uma ADR existente para "atualizar" uma decisão é o
próprio problema que este sistema existe para evitar — apaga o porquê
histórico. Se a dúvida é "isto é uma correção de erro de digitação ou uma
mudança de decisão?": erro de digitação (data errada, link quebrado) pode
corrigir; qualquer coisa que mude o que a decisão permite ou proíbe é ADR
nova.

## 9. A regra de crescimento: ADR nova não toca `CLAUDE.md`

Adicionar uma ADR não é motivo para editar `CLAUDE.md`. A citação
`(ADR-NNNN)` só é obrigatória em dois lugares, e só quando a linha já existe
como bullet de convenção ali: a seção `## Conventions` de `CLAUDE.md`, e
qualquer bullet dentro de `.claude/rules/*.md`. `## Never` fica de fora de
propósito — é processo ("não commite em master"), não decisão de arquitetura,
e não há ADR para citar (`scripts/lint-arch/health.js`,
`checkAdrCitations`/`CITED_SECTIONS`). Se a convenção nova não tem uma linha
correspondente em `## Conventions`, a ADR pode existir sozinha — o ponto de
entrada é `docs/adr/README.md`, não `CLAUDE.md` crescendo a cada decisão.

## O que é mecânico e o que só um humano pega

Seja honesto sobre isto ao usar a skill — não deixe ninguém tratar `doctor`
como gate:

- **`npm run lint:arch` (bloqueia o CI, sai 1 em violação)**: front-matter
  bem formado; `enforced_by` aponta para regra existente e regra existente
  está declarada por alguma ADR; toda regra concreta listada em
  `enforced_by` (as que não são `review-manual`/`doctor`) roda de fato contra
  o repo. Sobre `desvios:`, os dois sentidos NÃO pesam igual, e vale saber
  qual é qual: um achado real que falta na lista vira `problems` e **sai 1**;
  uma entrada que parou de ser violada vira só `warnings` e **sai 0**. Ou
  seja, o gate impede que uma violação nova passe despercebida, mas não
  impede dívida fossilizada — essa depende de alguém ler o aviso.
- **`npm run doctor` (relatório, nunca sai 1)**: teto de 120 linhas por ADR;
  `origem` aponta para arquivo existente; ADR ausente do índice do `README`;
  `revisar_quando` impresso ao lado dos números que costuma citar, para
  julgamento humano; tamanho de `CLAUDE.md`; citação `(ADR-NNNN)` presente e
  válida nas convenções e nas rules.
- **Só review humano, nada de script**: se a decisão passou nos dois testes
  da seção 1 (é julgamento, por isso a própria ADR-0001 tem
  `enforced_by: [ doctor ]` e não uma regra); se uma "categoria fundação"
  (ADR-0001, tabela) como "Pocket TTS, não Piper" continua sendo respeitada
  em espírito, não só em regex; se um `validate_callback`/`sanitize_callback`
  cobre exatamente os valores que a UI permite (ADR-0007 — `rest-namespace`
  só confere o namespace, a validação de argumento é `review-manual`).
