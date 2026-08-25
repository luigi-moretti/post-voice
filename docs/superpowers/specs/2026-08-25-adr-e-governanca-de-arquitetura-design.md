# ADRs e governança de arquitetura — design

**Data:** 2026-08-25
**Status:** Aprovado para planejamento de implementação
**Branch:** `docs/adr-architecture-governance`

## Contexto

O projeto decide bem e registra mal. Existem hoje ~50 decisões fechadas, espalhadas
em quatro formatos que não conversam:

| Onde | O que guarda | Problema |
|---|---|---|
| `CLAUDE.md` — Conventions / Never / Gotchas | regras vivas (prefixo `Post_Voice_`, layout feature-based, fronteira Jest/E2E, pins de contrato) | afirma a regra sem o porquê completo, e cresce sem limite |
| `docs/superpowers/specs/*.md` — tabelas "Decisões fechadas" | decisão + razão, por fase | 7 arquivos, ~2,4 mil linhas; uma decisão da Fase 1 pode ter sido substituída na Fase 3 sem que nada diga isso |
| `docs/FOLLOW-UPS.md` | achados de review deliberadamente **não** corrigidos, com a razão | é dívida, não decisão — mas ocupa o mesmo espaço mental |
| `docs/superpowers/plans/*.md` — seções de revisão numeradas | defeitos encontrados durante a execução | ~14 mil linhas; na prática ninguém relê |

Não existe índice de decisões, não existe status (aceita / superada / revogada) e não
existe nenhuma verificação automatizada de arquitetura. `lint:js`, `phpcs`, `phpstan`,
`tsc` e os gates de cobertura pegam estilo, tipo e teste — **nenhum** deles pega
"isto violou uma decisão de arquitetura".

A consequência já é mensurável, não hipotética. Ver "Estado atual medido" abaixo.

Quatro dores foram declaradas, todas com o mesmo peso: deriva silenciosa, decisão
perdida, onboarding e saúde do projeto. O design abaixo atende as quatro com um
único mecanismo, em vez de quatro artefatos separados.

## Decisões fechadas

| Decisão | Escolha | Por quê |
|---|---|---|
| Escopo do registro | Só decisões que orientam código futuro (~15 ADRs), não as ~50 decisões fechadas | Índice de 50 itens onde 35 são escolha de UI de uma fase deixa de ser lido — e nenhuma dessas 35 é verificável |
| Relação com os specs | ADR **destila**, spec permanece intacto | Spec responde "como a Fase 3 foi construída"; ADR responde "posso escrever isto hoje?". Reescrever spec histórico contradiz o princípio do próprio repo ("amende com seção datada") |
| Granularidade | A ADR captura a restrição, nunca o valor | "MP3 64 kbps" é valor; "o áudio é comprimido no cliente antes do upload" é a restrição. Trocar 64 por 80 kbps é spec, não ADR nova |
| Onde mora o critério de admissão | Na própria ADR-0001 | O critério é ele mesmo uma decisão: se mudar, muda com data e justificativa. Arquivo solto de "regras" muda no escuro |
| Fonte de configuração do linter | As próprias ADRs (front-matter YAML) | ADR e regra não podem divergir porque a ADR **é** a regra. Também dá de graça: ADR sem regra, regra órfã e dívida quitada |
| Enforcement | Dois níveis: determinístico bloqueia (`lint:arch` no CI), heurístico relata (`doctor`) | Heurística virando gate obriga a inventar limiar arbitrário, e limiar arbitrário é o que gera pressão para afrouxar a regra |
| Onde o gate roda | Job `lint` do CI + passo 1 do fluxo pré-PR. `doctor` no passo 3 (code review) | Hook local é pulável com `--no-verify`, que o `CLAUDE.md` já proíbe. No code review as alterações já estão prontas: o scan roda uma ou duas vezes por branch, não a cada edição |
| Hook de `PostToolUse`/`Stop` do Claude Code | Não entra | Vale só para quem usa Claude Code, vive fora do fluxo de review, e repetiria o scan a cada arquivo tocado |
| Divergência entre decisão e código | Status `aceita-com-desvio`, com os desvios listados no front-matter | Uma ADR que afirma "features são isoladas" quando não são é ficção documentada — exatamente o que aconteceu com o `CLAUDE.md` |
| Ciclos entre features (5 arestas) | Congelados como desvios listados, mais um spike medindo o custo da inversão | Guard rail ativo imediatamente, custo zero de refatoração, e a saída fica desenhada em vez de virar linha no `FOLLOW-UPS.md` |
| Layout `features/` | Mantido | O que falhou foi a regra de **dependência**, ortogonal ao layout. Reorganizar pastas deixaria os mesmos 5 ciclos no lugar |
| Linguagem das ADRs | Português | Segue os specs, que são os documentos irmãos. `CLAUDE.md`, código e commits continuam em inglês |
| Dependências novas | Zero | O lockfile é a superfície de auditoria (`CLAUDE.md`); `audit-check.mjs` e `bump-plugin-version.mjs` já são standalone assim |

## Estado atual medido

Levantado em `c74f944` durante o brainstorming, com `grep` sobre o repo. É o insumo
das ADRs 0005 e 0011 e a evidência de que a deriva já ocorreu.

### Dependências entre features

O `CLAUDE.md` diz *"shared code moves to `shared/` only when a second feature actually
needs it"*, mas nunca disse o que fazer quando a feature A precisa da **feature B
inteira**. Sem regra, cada caso resolveu com uma referência direta.

PHP, excluindo classes da própria feature:

| Feature | Referencia de outra feature |
|---|---|
| `features/narration/php` | `Post_Voice_Dictionary_Store` *(pronunciation)*, `Post_Voice_Style_Store` *(player-style)* |
| `features/pronunciation/php` | `Post_Voice_Post_Meta`, `Post_Voice_Rest_Api` *(narration)* |
| `features/player-style/php` | `Post_Voice_Frontend_Render` *(narration)* |

TypeScript:

- `features/narration/editor/index.tsx:50-53` → `pronunciation/editor/{dictionary-panel, dictionary-entry, apply-dictionary}`
- `features/pronunciation/editor/dictionary-entry.ts:1` → `narration/editor/model-source`
- `features/pronunciation/editor/dictionary-panel.tsx:9` → `narration/editor/model-source`

Resultado: ciclos `narration ↔ pronunciation` e `narration ↔ player-style`, nas duas
linguagens.

### Forma real do sistema

As três pastas de `features/` não são simétricas:

- `narration` tem 5 das 10 classes PHP e ~25 dos ~35 módulos TypeScript. É o produto.
- `pronunciation` e `player-style` **modificam** o comportamento de `narration`.
  Nenhuma das duas faz sentido sozinha.
- `shared/` tem um arquivo (`class-settings-page.php`), com dois consumidores reais —
  a regra dos dois consumidores está satisfeita.

A pasta `features/` sugere pares independentes; a realidade é um núcleo com duas
extensões. Isso não invalida o layout (ver "Não-metas"), mas é o contexto da ADR-0005.

### Outros desvios conhecidos

- `features/narration/editor/engine/pocket-tts.worker.js` e `sentencepiece.js` são
  JavaScript num editor decidido como TypeScript. Ambos já estão em `ignorePatterns`
  do `.eslintrc.js`, com justificativa (vendorizado / bundle Emscripten de 3,9 MB).
- Os mínimos de plataforma aparecem em cinco arquivos (`post-voice.php`,
  `composer.json`, `phpcs.xml.dist`, `.wp-env.json`, `readme.txt`) e nada garante que
  concordem.

## Escopo

Entra:

- `docs/adr/` — índice, template e 15 ADRs
- `scripts/lint-arch/` — gate determinístico, configurado pelas ADRs
- `scripts/doctor.mjs` — relatório de saúde, sem bloquear
- `.claude/skills/adr/SKILL.md` — skill de projeto
- Integração: `package.json`, `.github/workflows/ci.yml`, `jest.config.js`,
  `.eslintrc.js`, `CLAUDE.md`
- Um spike medindo o custo de inverter as 5 arestas cross-feature

Não entra:

- **Nenhuma mudança em código de produção.** Se uma regra exigir tocar `features/`,
  a execução para e apresenta o achado.
- Executar a inversão das arestas. O spike mede; não implementa.
- Migrar as ~35 decisões de produto/UI. Permanecem nos specs.
- Migrar o `FOLLOW-UPS.md`. É dívida, não decisão.

## Arquitetura

### Estrutura

```
docs/adr/
  README.md                              índice + como ler
  TEMPLATE.md
  0001-registrar-decisoes-em-adr.md      meta-ADR; contém o critério de admissão
  0002-....md … 0015-....md
```

### Critério de admissão

Vira ADR quando **as duas** afirmações são verdadeiras:

1. **Orienta código que ainda não foi escrito** — alguém vai encostar nisso amanhã e
   precisa saber a regra antes de decidir.
2. **Reverter custa mais que um PR** — a decisão está assentada embaixo de outras.

O critério aceita duas categorias, e ambas são legítimas:

| Categoria | Exemplo | Verificável por script? |
|---|---|---|
| **Guard rail** | "uma feature não referencia outra feature" | sim |
| **Fundação** | "o TTS nunca roda no servidor", "Pocket TTS, não Piper" | parcialmente, ou só em review |

Não vira ADR:

| O quê | Vai para |
|---|---|
| Escolha de produto ou UI de uma fase (raio com três presets, cor padrão, texto de botão) | spec |
| Bug e sua causa raiz | spec / plano |
| Achado de review deliberadamente não corrigido | `FOLLOW-UPS.md` |
| Detalhe substituível sem efeito colateral | nada |
| Um valor numérico isolado | ver a regra da restrição versus o valor |

### Formato

```markdown
---
id: 0005
titulo: Topologia de dependência entre features
status: aceita-com-desvio        # proposta | aceita | aceita-com-desvio
                                 # | superada-por-NNNN | revogada
data: 2026-08-25
origem: specs/2026-08-08-wp-narration-plugin-mvp-design.md#arquitetura
enforced_by: [ feature-deps ]    # lista. Cada item é um id de regra do lint:arch,
                                 # ou o literal `review-manual`, ou o literal `doctor`.
                                 # Sempre lista, mesmo com um item só — a ADR-0004 tem
                                 # duas regras e a 0007 combina regra com review.
revisar_quando: uma quarta feature entrar, ou uma extensão passar narration em nº de classes
desvios:
  - features/narration/php/class-rest-api.php → Post_Voice_Dictionary_Store
  - features/pronunciation/editor/dictionary-entry.ts:1 → narration/editor/model-source
---

## Contexto                  o que forçava a decisão
## Decisão                   a restrição, em uma frase imperativa
## Consequências             o que fica mais fácil, o que fica mais difícil
## Como verificar            a regra do lint:arch, ou o que olhar no review
## Alternativas rejeitadas   com o porquê
```

Tamanho: **alvo** de 40 a 80 linhas, **teto** de 120. Acima do teto o `doctor` avisa —
virou spec disfarçada. Entre 80 e 120 não gera aviso; é margem para as ADRs com lista
de desvios longa.

`revisar_quando` é uma **condição**, não uma data. Data vira TODO morto; condição o
`doctor` consegue checar.

### Como uma ADR muda

| Campo | Quem pode mudar |
|---|---|
| Contexto, Decisão, Consequências, Alternativas | Ninguém. Mudou de ideia → ADR nova, e a antiga recebe `status: superada-por-NNNN` |
| `status`, `desvios` | Qualquer PR. São campos vivos, e o `lint:arch` já exige que reflitam a realidade |

Sem essa regra, editar a ADR vira o caminho de menor resistência e o histórico do
porquê desaparece — o problema de origem.

### A ADR como configuração do linter

`scripts/lint-arch/index.js` lê `docs/adr/*.md`, extrai `enforced_by` e `desvios` de
cada front-matter e roda a regra correspondente. Cinco comportamentos caem de graça:

| Situação | Resultado |
|---|---|
| ADR declara `enforced_by: X` e a regra `X` não existe | **falha** — a ADR mente sobre estar protegida |
| Regra existe e nenhuma ADR a declara | **falha** — regra órfã, ninguém sabe o porquê |
| Código viola e o desvio **não** está listado | **falha**, citando a ADR e a seção |
| Código viola e o desvio **está** listado | passa |
| Desvio listado e o código **não** viola mais | **aviso** — dívida quitada, remova da lista |

A última linha é o que faz a lista de desvios encolher em vez de fossilizar, e o
conjunto é o que responde à pergunta que originou este trabalho: onde a teoria e a
implementação divergem, hoje, medido.

Esse acoplamento é a razão de **não** usar `import/no-restricted-paths` (do
`eslint-plugin-import`, já presente na árvore) nem sniffs customizados de PHPCS,
apesar de ambos serem o caminho idiomático:

- nenhum dos dois lê YAML de dentro de um Markdown, então a lista de desvios teria de
  ser duplicada num segundo arquivo — reintroduzindo a divergência que o design
  existe para eliminar;
- a mensagem deles diria "import proibido", onde o valor é "isto viola a ADR-0005;
  o porquê está em `docs/adr/0005-topologia-de-dependencia-entre-features.md`";
- espalhar as regras entre `phpcs.xml.dist`, `.eslintrc.js` e um script torna
  impossível responder "quais regras defendem a ADR-0005?";
- `.eslintrc.js` já ignora `pocket-tts.worker.js` e `sentencepiece.js`, então a regra
  `no-untyped-editor-code` (ADR-0011) nunca poderia viver no ESLint.

### Forma do código

```
scripts/lint-arch/
  index.js            lê as ADRs, resolve as regras, executa, relata
  adr.js              parser do front-matter
  rules/<id>.js       uma regra por arquivo: { id, adr, check( ctx ) }
  tests/              fixtures que devem passar e fixtures que devem falhar
scripts/doctor.mjs
```

CommonJS `.js`, não `.mjs`: o `testMatch` do preset do `wp-scripts` já custou uma
sessão (ver o comentário no `jest.config.js`), e CJS é o que o Jest executa sem tocar
em `testMatch` nem em `moduleFileExtensions`. O override do `.eslintrc.js` passa de
`scripts/**/*.mjs` para `scripts/**/*.{js,mjs}`.

Node puro, sem dependência nova.

## Inventário das ADRs

15 ADRs. Cada uma passa nos dois testes de admissão.

| # | Título | Origem | `enforced_by` |
|---|---|---|---|
| 0001 | Registrar decisões em ADR *(meta; contém o critério)* | — | `doctor` |
| 0002 | O TTS roda inteiro no navegador; o servidor só orquestra | spec do MVP, `CLAUDE.md` | `no-server-side-tts` |
| 0003 | Engine Pocket TTS, não Piper | `docs/research/2026-08-08-tts-engine-research.md` | `review-manual` |
| 0004 | Layout feature-based; `shared/` só a partir do segundo consumidor | `CLAUDE.md` | `feature-layout`, `shared-two-consumers` |
| 0005 | Topologia de dependência entre features *(nova; `aceita-com-desvio`)* | medição de 2026-08-25 | `feature-deps` |
| 0006 | PHP: prefixo `Post_Voice_`, uma classe por arquivo, `class-*.php` | `CLAUDE.md` | `php-class-naming` |
| 0007 | REST em `post-voice/v1`; todo valor validado no servidor mesmo com a UI restringindo | spec do MVP, `CLAUDE.md` | `rest-namespace`, `review-manual` |
| 0008 | O cliente calcula `source_hash`; o servidor nunca reimplementa "o que é narrado" | spec do MVP | `no-narration-logic-in-php` |
| 0009 | O áudio é comprimido no cliente antes do upload; o servidor nunca transcodifica | spec do MVP | `no-server-side-audio-processing` |
| 0010 | i18n desde o primeiro commit; exceção documentada para `SAMPLE_TEXTS` | `CLAUDE.md` | `i18n-text-domain` |
| 0011 | Editor em TypeScript *(`aceita-com-desvio`: dois `.js` vendorizados)* | spec do MVP | `no-untyped-editor-code` |
| 0012 | Fronteira Jest/E2E: extrair a função pura em vez de mockar o Worker | `CLAUDE.md` | `review-manual`, `doctor` |
| 0013 | `@covers` por classe de teste; gates de 80% (JS) e 85% (PHP) | `CLAUDE.md` | `covers-annotation` |
| 0014 | Pins de contrato mudam só por decisão própria | `CLAUDE.md` | `contract-pins` |
| 0015 | `npm ci`, nunca `npm install` | `CLAUDE.md` | `no-npm-install` |

Reprovados pelo critério, permanecem nos specs: raio com três presets, cores padrão,
layout do player, `CHUNK_GAP_SEC`, split em ponto de pausa natural, tamanho dos
bundles, regra de casamento de termo do dicionário.

## As regras determinísticas

Treze regras, todas em `scripts/lint-arch/rules/`.

| Regra | ADR | O que verifica |
|---|---|---|
| `no-server-side-tts` | 0002 | Nenhum PHP referencia modelo, ONNX ou síntese |
| `feature-layout` | 0004 | Nenhum `.php`/`.ts`/`.tsx` fora de `features/<f>/{php,editor,frontend,admin,tests}/`, `shared/`, `scripts/`, `e2e/`, `types/`, `test/` |
| `shared-two-consumers` | 0004 | Todo módulo de `shared/` tem dois consumidores reais |
| `feature-deps` | 0005 | Nenhuma aresta entre features fora da lista de desvios, em PHP e em TS |
| `php-class-naming` | 0006 | Todo `class-*.php` declara exatamente uma classe, com prefixo `Post_Voice_`, e o nome do arquivo corresponde |
| `rest-namespace` | 0007 | Todo `register_rest_route` usa `post-voice/v1` |
| `no-narration-logic-in-php` | 0008 | Nenhum PHP recomputa hash de fonte nem seleção de blocos |
| `no-server-side-audio-processing` | 0009 | Nenhum PHP invoca encoder ou transcodificação |
| `i18n-text-domain` | 0010 | Todo `__()`/`_x()`/`esc_html__()` usa o domínio `post-voice` |
| `no-untyped-editor-code` | 0011 | Nenhum `.js` em `features/*/{editor,admin,frontend}/` fora da lista de desvios |
| `covers-annotation` | 0013 | Toda classe de teste PHPUnit tem `@covers` |
| `contract-pins` | 0014 | `post-voice.php`, `composer.json`, `phpcs.xml.dist`, `.wp-env.json` e `readme.txt` concordam sobre WP 6.6 e PHP 8.2; `MODEL_BASE_URL` mantém o SHA fixado |
| `no-npm-install` | 0015 | Nenhum script ou workflow chama `npm install` |

Cada regra nasce com fixtures nos dois sentidos: código que deve passar e código que
deve falhar. **Sem fixture, sem regra.**

Risco assumido: expressão regular sobre PHP é frágil. A mitigação são as fixtures. Se
uma regra produzir falso positivo, aquela regra migra para `token_get_all()` — decisão
por regra, não pelo conjunto.

## O relatório `doctor`

`npm run doctor`. Nunca bloqueia, nunca é commitado.

- `lint:arch` em modo relatório: os desvios listados também aparecem, como dívida
- ADRs: contagem por status; `revisar_quando` cujo gatilho disparou; ADR acima de 120 linhas
- ADR cuja `origem` aponta para arquivo inexistente
- Toda linha de bullet sob as seções `## Conventions` e `## Never` do `CLAUDE.md` cita
  ao menos uma ADR existente, no formato `(ADR-NNNN)`. Só essas duas seções são
  verificadas: `## Before opening a pull request` e `## Gotchas…` são procedimento e
  armadilha operacional, não decisão de arquitetura, e não devem citar ADR
- Tamanho de arquivo acima do p95 do repo — sinal relativo de "faz coisa demais",
  sem limiar arbitrário
- `FOLLOW-UPS.md`: número de itens abertos
- Cobertura, quando houver relatório recente no disco

Regra nova nasce no `doctor` e só sobe para `lint:arch` depois de provar que não
produz falso positivo.

## Integração

| Onde | O quê |
|---|---|
| `.github/workflows/ci.yml`, job `lint` | `npm run lint:arch` — Node puro, sem Docker |
| `CLAUDE.md`, passo 1 do pré-PR | `lint:arch` na lista ordenada, logo após `lint:js` |
| `CLAUDE.md`, passo 3 (code review) | `npm run doctor` |
| pre-commit | nada |

### `CLAUDE.md`

Encolhe sem perder as regras: ele carrega em todo contexto, as ADRs não. Cada
convenção permanece como uma linha imperativa que **cita** a ADR:

```
- **Layout is feature-based** (ADR-0004); a feature never references another (ADR-0005).
```

O porquê fica a um `Read` de distância, a regra continua no contexto imediato, e o
`doctor` valida que toda linha de convenção cita uma ADR existente — se o `CLAUDE.md`
andar sozinho outra vez, o relatório acusa.

Além disso: `docs/adr/README.md` entra no topo dos "documents of record".

### Skill

`.claude/skills/adr/SKILL.md`, versionada no repo. Dispara ao fechar um brainstorming,
ao escrever um spec, durante o code review, ou sempre que "decidimos X" aparecer.
Conteúdo:

1. Os dois testes de admissão e a tabela do que não vira ADR
2. A regra da restrição versus o valor
3. Template e o alvo de 40 a 80 linhas
4. Checklist de review: rodar `lint:arch`, ler `docs/adr/README.md`, e perguntar "esta
   mudança contém uma decisão que ficou sem ADR?"
5. Como uma ADR muda

## Ordem de execução

| # | Entregável | Gate |
|---|---|---|
| 1 | `docs/adr/{README,TEMPLATE}.md` e ADR-0001 | — |
| 2 | ADRs 0002-0004 e 0006-0015 (13 documentos) | — |
| 3 | Spike: custo de inverter as cinco arestas via hook do WordPress | relatório; nada executado |
| 4 | ADR-0005, já com a seção "saída conhecida" vinda do spike | — |
| 5 | `scripts/lint-arch/` — parser de ADR e 13 regras, cada uma com fixtures | Jest |
| 6 | `scripts/doctor.mjs` | Jest no que for puro |
| 7 | `package.json`, `ci.yml`, `jest.config.js`, `.eslintrc.js` | CI |
| 8 | `.claude/skills/adr/SKILL.md` | — |
| 9 | `CLAUDE.md` reescrito | `doctor` |

As ADRs vêm antes do script porque **o script lê as ADRs**. Escrever a regra primeiro
seria derivar a decisão a partir do código — o inverso do que este trabalho existe
para fazer.

## Testes

- Regras e parser: Jest, em `scripts/lint-arch/tests/`. São funções puras sobre
  strings, o que cai exatamente no critério da ADR-0012.
- `collectCoverageFrom` do `jest.config.js` é uma allowlist explícita, então incluir
  `scripts/lint-arch/**/*.js` **não** arrasta `audit-check.mjs` nem
  `bump-plugin-version.mjs` para o gate de 80%.
- Nenhum cenário E2E novo: nada aqui toca Worker, ONNX ou navegador.
- `lint:arch` roda contra o próprio repo como parte do CI, o que é o seu teste de
  integração.

## Riscos

- **`lint:arch` vai reprovar o repo atual em mais pontos que as cinco arestas já
  medidas.** É o objetivo do trabalho, mas cada achado novo é uma decisão do usuário:
  vira desvio listado, ou vira correção. A execução não decide sozinha e **não afrouxa
  regra para passar** — o `CLAUDE.md` já proíbe isso.
- **Falso positivo em regra determinística** empurra para enfraquecer a regra. Mitigado
  por fixtures obrigatórias e pelo caminho de escape (aquela regra migra para
  `token_get_all()`).
- **A lista de desvios pode virar depósito.** Mitigado pelo aviso de dívida quitada e
  pelo `revisar_quando`.

## Critérios de aceite

1. `docs/adr/` contém 15 ADRs, um índice e um template; toda ADR tem front-matter
   completo e cabe entre 40 e 120 linhas.
2. `npm run lint:arch` termina com sucesso no repo, com os desvios de 0005 e 0011
   listados nas respectivas ADRs — e falha se qualquer um deles for removido da lista.
3. `npm run lint:arch` falha ao ser apresentada uma aresta cross-feature nova, com
   mensagem citando a ADR-0005 e o caminho do arquivo.
4. Toda regra tem fixtures nos dois sentidos, e `npm run test:unit` cobre as 13.
5. `npm run doctor` imprime o relatório completo e sai com código 0 mesmo com dívida.
6. Toda linha de convenção do `CLAUDE.md` cita uma ADR existente, e o `doctor` verifica.
7. O CI do `master` passa inteiro, sem nenhuma alteração em `features/`, `shared/`
   ou `post-voice.php`.

## Não-metas explícitas

- **Trocar o layout `features/`.** O que falhou foi a regra de dependência, ortogonal
  ao layout: reorganizar em `core/` mais `extensions/` deixaria os mesmos cinco ciclos
  no lugar. A decisão que de fato nunca foi tomada — "`narration` pode nomear suas
  extensões, ou elas se plugam nele?" — vale igual em qualquer layout, e é a ADR-0005.
- **Inverter as cinco arestas.** O spike mede o custo; executar é uma mudança própria,
  com seu próprio brainstorming.
- **Migrar as decisões de produto para ADR.** Continuam nos specs, que é onde servem.
- **Criar série temporal de dívida.** O `doctor` reporta o presente. Histórico é uma
  mudança própria, se algum dia doer.
