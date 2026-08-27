# ADRs e governança de arquitetura — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar as 15 decisões que restringem código futuro como ADRs em `docs/adr/`, e transformar o front-matter dessas ADRs na configuração de um linter de arquitetura (`npm run lint:arch`) que bloqueia no CI, mais um relatório heurístico (`npm run doctor`) que nunca bloqueia.

**Architecture:** A ADR **é** a configuração do linter. `scripts/lint-arch/index.js` lê `docs/adr/*.md`, extrai `enforced_by` (quais regras defendem esta decisão) e `desvios` (quais violações já existem e estão congeladas), e executa as regras correspondentes de `scripts/lint-arch/rules/`. Decisão e regra não podem divergir porque são o mesmo arquivo. As convenções que hoje vivem no `CLAUDE.md` migram para `.claude/rules/*.md` com `paths` estreito, deixando no `CLAUDE.md` só o que não pode ser esquecido.

**Tech Stack:** Node 20+ puro (CommonJS), Jest (preset `@wordpress/scripts`), GitHub Actions. **Zero dependências novas.**

**Spec:** `docs/superpowers/specs/2026-08-25-adr-e-governanca-de-arquitetura-design.md`

---

## Global Constraints

Valem para toda tarefa deste plano. Copiados do spec e do `CLAUDE.md`.

- **Nenhuma alteração em código de produção.** Nada em `features/`, `shared/` ou `post-voice.php` pode ser tocado. Se uma regra reprovar algo que não vira desvio listado, a execução **para** e apresenta o achado ao usuário. Não afrouxe a regra para passar.
- **Zero dependências novas.** `package.json` não ganha entrada em `dependencies` nem `devDependencies`. O lockfile é a superfície de auditoria.
- **Nunca `npm install`.** Use `npm ci`.
- **Nunca `--no-verify`.** Nunca baixar um limiar de cobertura para passar.
- **Nunca commitar em `master`.** A branch é `docs/adr-architecture-governance`.
- **Não mexer nos pins de contrato** como efeito colateral: `MODEL_BASE_URL` (`b18a05128c4f727ead5b23a643b65b93eaf8ee5d`), WordPress `6.6`, PHP `8.2`.
- **Idioma:** ADRs, rules e o spike em **português**. Código, comentários de código, mensagens de commit e `CLAUDE.md` em **inglês**.
- **CommonJS `.js`**, nunca `.mjs`, em `scripts/lint-arch/`. O `testMatch` do preset do `wp-scripts` já custou uma sessão (ver o comentário no `jest.config.js`); CJS roda no Jest sem tocar em `testMatch` nem em `moduleFileExtensions`. `scripts/doctor.mjs` é ESM porque não é testado pelo Jest e acompanha `audit-check.mjs`.
- **Formatação:** o repo usa `wp-prettier` com tabs e espaços dentro de parênteses (`fn( arg )`). Todo código deste plano já vem nesse estilo. `npm run lint:js` é o árbitro.
- **Commits:** Conventional Commits, uma tarefa por commit (ou mais, se a tarefa tiver passos independentes). Toda mensagem de commit termina com a linha `Claude-Session: https://claude.ai/code/session_01U2Uski78ozNPf1uBQXU95q`.

### Duas refinações sobre o spec, decididas ao escrever este plano

Nenhuma muda uma decisão do spec; ambas são detalhes de execução que o spec não fixou.

1. **`desvios:` não carrega número de linha.** O exemplo do spec mostra `dictionary-entry.ts:1 → narration/editor/model-source`. Um desvio ancorado em linha apodrece na primeira edição acima dele, e o lint passaria a acusar violação nova onde não houve nenhuma. A chave de desvio é `arquivo → alvo`, sem linha; a linha aparece só na mensagem de erro.
2. **`npm run lint:arch` entra no `ci.yml` só na Tarefa 17**, depois que as 13 regras existirem. Entre as Tarefas 4 e 16 o comando roda localmente e sai não-zero de propósito — cada ADR escrita declara uma regra que ainda não foi implementada, que é exatamente o comportamento "ADR mente sobre estar protegida" que o spec pede. Ligá-lo no CI antes disso deixaria o CI vermelho por dezenas de commits sem que nada estivesse errado. Cada tarefa afetada diz qual saída esperar.

### Baseline medido em `5ee2f24` (2026-08-27)

Os números que as tarefas de regra usam como resultado esperado. Se a sua medição divergir, **pare e reporte** — significa que o repo mudou desde que o plano foi escrito.

| Regra | Violações hoje | Vira |
|---|---|---|
| `feature-deps` | 11 (6 PHP + 5 TS) | `desvios:` da ADR-0005 |
| `no-untyped-editor-code` | 2 | `desvios:` da ADR-0011 |
| `feature-layout` | 1 (`features/narration/format-time.ts`) | `desvios:` da ADR-0004 |
| `shared-two-consumers` | 0 (`Post_Voice_Settings_Page` tem 2 features consumidoras) | — |
| `php-class-naming` | 0 (10 classes, todas casam) | — |
| `rest-namespace` | 0 (1 `register_rest_route`, via `self::REST_NAMESPACE`) | — |
| `i18n-text-domain` | 0 (48 chamadas gettext) | — |
| `covers-annotation` | 0 (10 classes de teste PHPUnit) | — |
| `no-server-side-tts` | 0 | — |
| `no-narration-logic-in-php` | 0 | — |
| `no-server-side-audio-processing` | 0 | — |
| `contract-pins` | 0 | — |
| `no-npm-install` | 0 | — |

---

## Estrutura de arquivos

```
docs/adr/
  README.md                      índice: tabela id/título/status + como ler e como criar
  TEMPLATE.md                    esqueleto copiável
  0001-registrar-decisoes-em-adr.md   … 0015-npm-ci-nunca-npm-install.md

scripts/lint-arch/
  adr.js          parser do front-matter + loadAdrs(). Sem I/O de regra.
  context.js      corpus: lista de arquivos versionados, leitura cacheada,
                  e os strippers de comentário/string de PHP.
  index.js        runner: resolve enforced_by, executa, compara com desvios, relata. CLI.
  rules/index.js  registro { id: módulo }
  rules/<id>.js   uma regra por arquivo: { id, adr, check( ctx ) => Finding[] }
  tests/*.test.js Jest. Fixtures são objetos em memória, nunca arquivos no disco.

scripts/doctor.mjs             relatório heurístico, sempre exit 0

.claude/rules/{php,rest,editor,tests,adr}.md    convenções path-scoped
.claude/skills/adr/SKILL.md                     skill de projeto

docs/research/2026-08-27-custo-inversao-arestas-cross-feature.md   spike
```

### Contratos entre módulos

Todo o resto do plano depende destes três tipos. Estão aqui uma vez; as tarefas referenciam.

```js
/**
 * @typedef {Object} Adr
 * @property {string}   id             '0005'
 * @property {string}   titulo
 * @property {string}   status         'proposta' | 'aceita' | 'aceita-com-desvio'
 *                                     | 'superada-por-NNNN' | 'revogada'
 * @property {string}   data           'YYYY-MM-DD'
 * @property {string}   origem         caminho relativo a docs/, ex. superpowers/specs/x.md
 * @property {string[]} enforcedBy     ids de regra, ou 'review-manual', ou 'doctor'
 * @property {string}   revisarQuando  '' quando ausente
 * @property {string[]} desvios        chaves de Finding congeladas
 * @property {string}   file           'docs/adr/0005-....md'
 * @property {number}   linhas
 */

/**
 * @typedef {Object} Finding
 * @property {string} key      identidade estável da violação, sem número de linha.
 *                             É o que uma entrada de `desvios:` tem de casar, literal.
 * @property {string} file
 * @property {number} line     1-based; só para a mensagem
 * @property {string} message  o que está errado, em português
 */

/**
 * @typedef {Object} Rule
 * @property {string}                 id
 * @property {string}                 adr   id da ADR que a declara; o runner confere
 * @property {( ctx: Context ) => Finding[]} check
 */

/**
 * @typedef {Object} Context
 * @property {string}   root
 * @property {string[]} files            caminhos relativos, versionados no git
 * @property {( file: string ) => string} read   conteúdo, cacheado
 */
```

---

### Task 1: Esqueleto do `docs/adr/` e a meta-ADR

**Files:**
- Create: `docs/adr/README.md`
- Create: `docs/adr/TEMPLATE.md`
- Create: `docs/adr/0001-registrar-decisoes-em-adr.md`

**Interfaces:**
- Consumes: nada.
- Produces: o formato de front-matter que a Tarefa 2 vai parsear, e o critério de admissão que a Tarefa 19 (skill) cita.

- [ ] **Step 1: Escrever `docs/adr/TEMPLATE.md`**

```markdown
---
id: NNNN
titulo: Uma frase nominal, não uma frase completa
status: proposta
data: AAAA-MM-DD
origem: superpowers/specs/AAAA-MM-DD-nome-do-spec.md#secao
enforced_by: [ id-da-regra ]
revisar_quando: uma condição observável, nunca uma data
desvios: []
---

## Contexto

O que forçava a decisão. Estado do mundo antes, e a pressão concreta —
não "para ficar mais organizado", e sim o que doeu.

## Decisão

A restrição, em uma frase imperativa. Nunca um valor: "o áudio é comprimido
no cliente antes do upload", não "MP3 64 kbps".

## Consequências

O que fica mais fácil. O que fica mais difícil. As duas metades, sempre.

## Como verificar

A regra de `lint:arch` que defende isto e o que exatamente ela procura; ou,
quando não é verificável por script, o que olhar no code review.

## Alternativas rejeitadas

Cada uma com o porquê. Sem esta seção a ADR não impede que a alternativa
volte à mesa daqui a seis meses.
```

- [ ] **Step 2: Escrever `docs/adr/0001-registrar-decisoes-em-adr.md`**

Esta ADR contém o critério de admissão. O critério é ele mesmo uma decisão: se mudar, muda com data e justificativa.

```markdown
---
id: 0001
titulo: Registrar decisões de arquitetura como ADR
status: aceita
data: 2026-08-27
origem: superpowers/specs/2026-08-25-adr-e-governanca-de-arquitetura-design.md
enforced_by: [ doctor ]
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

O `lint:arch` não tem regra determinística para esta ADR: "isto merecia ser uma
ADR?" é julgamento. É a razão de `enforced_by: [ doctor ]`.

## Alternativas rejeitadas

**Manter tudo no `CLAUDE.md`.** Ele carrega em todo contexto e a documentação do
Claude Code marca 200 linhas como ponto de queda de aderência. A 50 decisões o
arquivo deixa de ser obedecido, e o modo de falha é silencioso.

**ADR em ferramenta externa (Notion, wiki).** Sai do alcance de `grep`, do
histórico do git e de qualquer script de verificação. A ADR precisa estar no
repo justamente para poder ser a configuração do linter.

**Migrar as ~50 decisões fechadas dos specs.** Um índice de 50 itens onde 35 são
escolha de UI de uma fase deixa de ser lido — e nenhuma dessas 35 é verificável.
```

- [ ] **Step 3: Escrever `docs/adr/README.md`**

```markdown
# Registros de decisão de arquitetura

O que está decidido, por quê, e o que impede de ser desfeito por acidente.

- **Não decide nada aqui.** Uma ADR registra uma decisão já tomada.
- **A ADR é a configuração do linter.** `npm run lint:arch` lê o `enforced_by` e
  o `desvios:` do front-matter destes arquivos. Editar `desvios:` muda o que o
  CI aceita — é a única parte do texto que qualquer PR pode mexer.
- **`status: aceita-com-desvio`** significa que a decisão vale e que as violações
  já existentes estão congeladas e listadas. Aresta nova reprova.
- **Quer criar uma?** Leia a ADR-0001: ela contém o critério de admissão e o
  que fazer quando a resposta é "não". Copie `TEMPLATE.md`.

| # | Título | Status | Defendida por |
|---|---|---|---|
| [0001](0001-registrar-decisoes-em-adr.md) | Registrar decisões de arquitetura como ADR | aceita | `doctor` |
```

O restante da tabela é preenchido pelas Tarefas 4, 5, 6 e 8, uma linha por ADR.

- [ ] **Step 4: Conferir o que foi escrito**

```bash
ls docs/adr/
wc -l docs/adr/*.md
```

Esperado: três arquivos; `0001-registrar-decisoes-em-adr.md` entre 80 e 120 linhas.

- [ ] **Step 5: Commit**

```bash
git add docs/adr/
git commit -m "docs(adr): add ADR directory, template and the meta-ADR

ADR-0001 carries the admission criteria, so the rule for what may become an
ADR is itself dated and revisable rather than living in a loose conventions
file that changes without a trace.

Claude-Session: https://claude.ai/code/session_01U2Uski78ozNPf1uBQXU95q"
```

---

### Task 2: Parser do front-matter (`adr.js`)

**Files:**
- Create: `scripts/lint-arch/adr.js`
- Test: `scripts/lint-arch/tests/adr.test.js`
- Modify: `.eslintrc.js` — os dois overrides que o teste desta tarefa exige para
  poder ser commitado (ver Step 5)

**Interfaces:**
- Consumes: o formato definido na Tarefa 1.
- Produces:
  - `parseAdr( source: string, file: string ): Adr` — lança `Error` com mensagem em português quando o front-matter é inválido.
  - `loadAdrs( dir: string ): Adr[]` — ordenado por `id`, lança em id duplicado ou em id que não bate com o prefixo do nome do arquivo.
  - `STATUSES: string[]`, `SUPERSEDED_RE: RegExp`.

Por que um parser próprio e não `js-yaml`: dependência nova está proibida, e o subconjunto usado é `chave: valor`, lista inline `[ a, b ]` e lista em bloco com `-`. Trinta linhas de parser custam menos que uma entrada no lockfile que passa a ser superfície de auditoria.

**Por que o `.eslintrc.js` entra aqui e não na Tarefa 3.** `.husky/pre-commit` roda
`npx lint-staged`, que mapeia `*.{js,cjs,mjs,ts,tsx}` para `wp-scripts lint-js`. Um
`.js` novo em `scripts/` com `require`/`module` dispara `no-undef`, e um arquivo de
teste com `describe`/`it`/`expect` dispara de novo. Sem os overrides, **esta tarefa
não consegue commitar** sem `--no-verify`, que é proibido. A config é pré-requisito
do primeiro `.js` do diretório, não da integração — por isso mora aqui.

- [ ] **Step 1: Escrever o teste que falha**

`scripts/lint-arch/tests/adr.test.js`:

```js
const { parseAdr, STATUSES } = require( '../adr' );

const VALIDO = `---
id: 0005
titulo: Topologia de dependência entre features
status: aceita-com-desvio
data: 2026-08-27
origem: superpowers/specs/2026-08-08-wp-narration-plugin-mvp-design.md#arquitetura
enforced_by: [ feature-deps ]    # lista, sempre
revisar_quando: uma quarta feature entrar
desvios:
  - features/narration/php/class-assets.php → Post_Voice_Dictionary_Store
  - features/narration/editor/index.tsx → pronunciation/editor/dictionary-entry
---

## Contexto

Texto.
`;

describe( 'parseAdr', () => {
	it( 'lê os campos escalares', () => {
		const adr = parseAdr( VALIDO, 'docs/adr/0005-x.md' );
		expect( adr.id ).toBe( '0005' );
		expect( adr.titulo ).toBe( 'Topologia de dependência entre features' );
		expect( adr.status ).toBe( 'aceita-com-desvio' );
		expect( adr.data ).toBe( '2026-08-27' );
		expect( adr.origem ).toBe(
			'superpowers/specs/2026-08-08-wp-narration-plugin-mvp-design.md#arquitetura'
		);
		expect( adr.revisarQuando ).toBe( 'uma quarta feature entrar' );
		expect( adr.file ).toBe( 'docs/adr/0005-x.md' );
	} );

	it( 'lê enforced_by como lista, descartando o comentário à direita', () => {
		expect( parseAdr( VALIDO, 'f.md' ).enforcedBy ).toEqual( [ 'feature-deps' ] );
	} );

	it( 'preserva o "#" de uma âncora em origem', () => {
		expect( parseAdr( VALIDO, 'f.md' ).origem ).toContain( '#arquitetura' );
	} );

	it( 'lê desvios como lista em bloco', () => {
		expect( parseAdr( VALIDO, 'f.md' ).desvios ).toEqual( [
			'features/narration/php/class-assets.php → Post_Voice_Dictionary_Store',
			'features/narration/editor/index.tsx → pronunciation/editor/dictionary-entry',
		] );
	} );

	it( 'conta as linhas do arquivo', () => {
		expect( parseAdr( VALIDO, 'f.md' ).linhas ).toBe( VALIDO.split( '\n' ).length );
	} );

	it( 'aceita desvios: [] e enforced_by com vários itens', () => {
		const adr = parseAdr(
			VALIDO.replace( '[ feature-deps ]', '[ feature-layout, shared-two-consumers ]' )
				.replace( 'aceita-com-desvio', 'aceita' )
				.replace(
					/desvios:\n( +- .*\n)+/,
					'desvios: []\n'
				),
			'f.md'
		);
		expect( adr.enforcedBy ).toEqual( [ 'feature-layout', 'shared-two-consumers' ] );
		expect( adr.desvios ).toEqual( [] );
	} );

	it( 'aceita superada-por-NNNN como status', () => {
		const adr = parseAdr(
			VALIDO.replace( 'aceita-com-desvio', 'superada-por-0042' ),
			'f.md'
		);
		expect( adr.status ).toBe( 'superada-por-0042' );
	} );

	it( 'recusa arquivo sem front-matter', () => {
		expect( () => parseAdr( '# Só um título\n', 'f.md' ) ).toThrow( /front-matter/ );
	} );

	it( 'recusa campo obrigatório ausente', () => {
		expect( () => parseAdr( VALIDO.replace( /^origem: .*$/m, '' ), 'f.md' ) ).toThrow(
			/origem/
		);
	} );

	it( 'recusa status desconhecido', () => {
		expect( () => parseAdr( VALIDO.replace( 'aceita-com-desvio', 'talvez' ), 'f.md' ) ).toThrow(
			/status/
		);
	} );

	it( 'recusa enforced_by escalar — tem de ser lista', () => {
		expect( () =>
			parseAdr( VALIDO.replace( '[ feature-deps ]', 'feature-deps' ), 'f.md' )
		).toThrow( /enforced_by/ );
	} );

	it( 'recusa aceita-com-desvio sem desvios listados', () => {
		expect( () =>
			parseAdr( VALIDO.replace( /desvios:\n( +- .*\n)+/, 'desvios: []\n' ), 'f.md' )
		).toThrow( /aceita-com-desvio/ );
	} );

	it( 'recusa status aceita com desvios listados', () => {
		expect( () =>
			parseAdr( VALIDO.replace( 'aceita-com-desvio', 'aceita' ), 'f.md' )
		).toThrow( /aceita/ );
	} );

	it( 'expõe o vocabulário de status', () => {
		expect( STATUSES ).toContain( 'aceita-com-desvio' );
	} );
} );
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:unit -- scripts/lint-arch/tests/adr.test.js`
Esperado: FAIL — `Cannot find module '../adr'`.

- [ ] **Step 3: Implementar `scripts/lint-arch/adr.js`**

```js
'use strict';
// Parser do front-matter das ADRs. Subconjunto deliberado de YAML: `chave: valor`,
// lista inline `[ a, b ]` e lista em bloco com `- `. Dependência nova está proibida
// (o lockfile é a superfície de auditoria), e o subconjunto cabe em trinta linhas.
const fs = require( 'node:fs' );
const path = require( 'node:path' );

const STATUSES = [ 'proposta', 'aceita', 'aceita-com-desvio', 'revogada' ];
const SUPERSEDED_RE = /^superada-por-\d{4}$/;
const OBRIGATORIOS = [ 'id', 'titulo', 'status', 'data', 'origem', 'enforced_by' ];

/**
 * Corta o comentário à direita.
 *
 * O gatilho é " #", com espaço antes, e não "#" sozinho: `origem` costuma
 * terminar numa âncora (`...design.md#arquitetura`) que não é comentário.
 *
 * @param {string} line
 * @return {string} a linha sem o comentário
 */
function stripComment( line ) {
	const i = line.indexOf( ' #' );
	return i === -1 ? line : line.slice( 0, i );
}

function parseInlineList( raw ) {
	return raw
		.replace( /^\[/, '' )
		.replace( /\]$/, '' )
		.split( ',' )
		.map( ( item ) => item.trim() )
		.filter( Boolean );
}

function parseFrontMatter( source, file ) {
	const match = source.match( /^---\r?\n([\s\S]*?)\r?\n---\r?\n/ );
	if ( ! match ) {
		throw new Error( `${ file }: sem front-matter YAML delimitado por ---` );
	}
	const fields = {};
	let chaveCorrente = null;
	for ( const rawLine of match[ 1 ].split( /\r?\n/ ) ) {
		const line = stripComment( rawLine );
		if ( ! line.trim() ) {
			continue;
		}
		const item = line.match( /^\s+-\s+(.*)$/ );
		if ( item ) {
			if ( ! chaveCorrente || ! Array.isArray( fields[ chaveCorrente ] ) ) {
				throw new Error( `${ file }: item de lista sem chave: ${ rawLine }` );
			}
			fields[ chaveCorrente ].push( item[ 1 ].trim() );
			continue;
		}
		const pair = line.match( /^([a-z_]+):\s*(.*)$/ );
		if ( ! pair ) {
			throw new Error( `${ file }: linha de front-matter ilegível: ${ rawLine }` );
		}
		const [ , key, value ] = pair;
		chaveCorrente = key;
		if ( value.startsWith( '[' ) ) {
			fields[ key ] = parseInlineList( value );
		} else if ( value === '' ) {
			// Chave sem valor na mesma linha abre uma lista em bloco. Se nenhum
			// item vier, fica [] — que é o que `desvios:` vazio significa.
			fields[ key ] = [];
		} else {
			fields[ key ] = value.trim();
		}
	}
	return fields;
}

/**
 * @param {string} source conteúdo do arquivo
 * @param {string} file   caminho relativo, usado nas mensagens de erro
 * @return {Object} a ADR normalizada
 */
function parseAdr( source, file ) {
	const fields = parseFrontMatter( source, file );

	for ( const key of OBRIGATORIOS ) {
		if ( fields[ key ] === undefined ) {
			throw new Error( `${ file }: campo obrigatório ausente: ${ key }` );
		}
	}
	if ( ! /^\d{4}$/.test( fields.id ) ) {
		throw new Error( `${ file }: id tem de ter quatro dígitos, recebeu "${ fields.id }"` );
	}
	if ( ! /^\d{4}-\d{2}-\d{2}$/.test( fields.data ) ) {
		throw new Error( `${ file }: data tem de ser AAAA-MM-DD, recebeu "${ fields.data }"` );
	}
	if ( ! STATUSES.includes( fields.status ) && ! SUPERSEDED_RE.test( fields.status ) ) {
		throw new Error(
			`${ file }: status "${ fields.status }" desconhecido; use ${ STATUSES.join(
				' | '
			) } | superada-por-NNNN`
		);
	}
	if ( ! Array.isArray( fields.enforced_by ) || fields.enforced_by.length === 0 ) {
		throw new Error(
			`${ file }: enforced_by tem de ser uma lista não vazia, mesmo com um item só`
		);
	}
	const desvios = fields.desvios === undefined ? [] : fields.desvios;
	if ( ! Array.isArray( desvios ) ) {
		throw new Error( `${ file }: desvios tem de ser uma lista` );
	}
	if ( fields.status === 'aceita-com-desvio' && desvios.length === 0 ) {
		throw new Error(
			`${ file }: status aceita-com-desvio exige pelo menos um desvio listado`
		);
	}
	if ( fields.status === 'aceita' && desvios.length > 0 ) {
		throw new Error(
			`${ file }: status aceita não admite desvios; use aceita-com-desvio`
		);
	}

	return {
		id: fields.id,
		titulo: fields.titulo,
		status: fields.status,
		data: fields.data,
		origem: fields.origem,
		enforcedBy: fields.enforced_by,
		revisarQuando: Array.isArray( fields.revisar_quando )
			? ''
			: fields.revisar_quando || '',
		desvios,
		file,
		linhas: source.split( '\n' ).length,
	};
}

/**
 * @param {string} dir diretório com as ADRs
 * @return {Object[]} ADRs ordenadas por id
 */
function loadAdrs( dir ) {
	const adrs = [];
	const vistos = new Set();
	for ( const name of fs.readdirSync( dir ).sort() ) {
		if ( ! /^\d{4}-.*\.md$/.test( name ) ) {
			continue;
		}
		const rel = path.posix.join( 'docs/adr', name );
		const adr = parseAdr( fs.readFileSync( path.join( dir, name ), 'utf8' ), rel );
		if ( adr.id !== name.slice( 0, 4 ) ) {
			throw new Error( `${ rel }: id "${ adr.id }" não bate com o nome do arquivo` );
		}
		if ( vistos.has( adr.id ) ) {
			throw new Error( `${ rel }: id ${ adr.id } duplicado` );
		}
		vistos.add( adr.id );
		adrs.push( adr );
	}
	return adrs;
}

module.exports = { parseAdr, loadAdrs, STATUSES, SUPERSEDED_RE };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:unit -- scripts/lint-arch/tests/adr.test.js`
Esperado: PASS, 14 testes.

- [ ] **Step 5: Ajustar o `.eslintrc.js`**

Dois overrides. O primeiro amplia o que já existe (linha 11); o segundo é novo:

```js
	overrides: [
		{
			// Tooling that runs in Node, not in a browser or a bundle. Without an
			// explicit env, the shared config leaves modern globals like
			// `globalThis` undeclared and `no-undef` fires on correct code.
			files: [ 'test/**/*.js', 'scripts/**/*.{js,mjs}', '*.config.js' ],
			env: { node: true, es2022: true },
		},
		{
			// Jest globals for the lint-arch suites. Scoped to that directory:
			// `test/jest.setup.js` is plain Node setup and declares none of them.
			files: [ 'scripts/**/tests/**/*.js' ],
			env: { jest: true },
		},
	],
```

Uma entrada com chaves (`*.{js,mjs}`), não duas separadas — é a forma que a Tarefa 3
espera encontrar. E o override de Jest cobre **só** `scripts/**/tests/**`:
`test/jest.setup.js` é setup de Node puro e passa no lint hoje sem env de Jest.

- [ ] **Step 6: Commit**

```bash
git add scripts/lint-arch/adr.js scripts/lint-arch/tests/adr.test.js .eslintrc.js
git commit -m "feat(lint-arch): parse ADR front matter

A deliberate YAML subset — scalars, inline lists, block lists — rather than a
new dependency: the lockfile is this project's audit surface, and the subset
fits in thirty lines. Comment stripping triggers on ' #' so that an anchor in
origem survives.

Claude-Session: https://claude.ai/code/session_01U2Uski78ozNPf1uBQXU95q"
```

---

### Task 3: Runner (`index.js`) e o comando `lint:arch`

**Files:**
- Create: `scripts/lint-arch/index.js`
- Create: `scripts/lint-arch/rules/index.js`
- Test: `scripts/lint-arch/tests/index.test.js`
- Modify: `package.json` (script `lint:arch`)
- Modify: `jest.config.js:28-50` (`collectCoverageFrom`)

**Interfaces:**
- Consumes: `loadAdrs`, `parseAdr` da Tarefa 2; o typedef `Rule` e `Finding`.
- Produces:
  - `run( { adrs, registry, ctx } ): { problems: Problem[], warnings: Problem[] }`
  - `Problem = { adr?: string, rule?: string, file?: string, line?: number, message: string }`
  - `format( { problems, warnings } ): string`
  - `rules/index.js` exporta `{}` por enquanto; cada tarefa de regra acrescenta uma entrada.

Os cinco comportamentos que o runner tem de produzir, do spec:

| Situação | Resultado |
|---|---|
| ADR declara `enforced_by: X` e a regra `X` não existe | **problema** — a ADR mente sobre estar protegida |
| Regra existe e nenhuma ADR a declara | **problema** — regra órfã, ninguém sabe o porquê |
| Código viola e o desvio **não** está listado | **problema**, citando ADR, título e arquivo da ADR |
| Código viola e o desvio **está** listado | passa |
| Desvio listado e o código **não** viola mais | **aviso** — dívida quitada, remova da lista |

Detalhe que importa: os achados são agrupados **por ADR**, não por regra. A ADR-0004 tem duas regras (`feature-layout` e `shared-two-consumers`) e uma única lista de `desvios:`; comparando por regra, um desvio de uma seria acusado de "dívida quitada" pela outra.

- [ ] **Step 1: Escrever o teste que falha**

`scripts/lint-arch/tests/index.test.js`:

```js
const { run, format } = require( '../index' );

const adr = ( over = {} ) => ( {
	id: '0005',
	titulo: 'Topologia de dependência entre features',
	status: 'aceita',
	data: '2026-08-27',
	origem: 'superpowers/specs/x.md',
	enforcedBy: [ 'feature-deps' ],
	revisarQuando: '',
	desvios: [],
	file: 'docs/adr/0005-topologia.md',
	linhas: 60,
	...over,
} );

const regra = ( id, adrId, findings = [] ) => ( {
	id,
	adr: adrId,
	check: () => findings,
} );

const acharam = ( key ) => ( {
	key,
	file: key.split( ' → ' )[ 0 ],
	line: 7,
	message: 'referencia outra feature',
} );

const ctx = { root: '/repo', files: [], read: () => '' };

describe( 'run', () => {
	it( 'não acusa nada quando as regras não acham nada', () => {
		const out = run( {
			adrs: [ adr() ],
			registry: { 'feature-deps': regra( 'feature-deps', '0005' ) },
			ctx,
		} );
		expect( out.problems ).toEqual( [] );
		expect( out.warnings ).toEqual( [] );
	} );

	it( 'acusa ADR que declara regra inexistente', () => {
		const out = run( { adrs: [ adr() ], registry: {}, ctx } );
		expect( out.problems ).toHaveLength( 1 );
		expect( out.problems[ 0 ].message ).toMatch( /não existe/ );
		expect( out.problems[ 0 ].message ).toMatch( /feature-deps/ );
	} );

	it( 'acusa regra órfã', () => {
		const out = run( {
			adrs: [ adr( { enforcedBy: [ 'review-manual' ] } ) ],
			registry: { 'feature-deps': regra( 'feature-deps', '0005' ) },
			ctx,
		} );
		expect( out.problems ).toHaveLength( 1 );
		expect( out.problems[ 0 ].message ).toMatch( /órfã/ );
	} );

	it( 'aceita os literais review-manual e doctor sem procurar regra', () => {
		const out = run( {
			adrs: [ adr( { enforcedBy: [ 'review-manual', 'doctor' ] } ) ],
			registry: {},
			ctx,
		} );
		expect( out.problems ).toEqual( [] );
	} );

	it( 'acusa violação não listada, citando a ADR', () => {
		const out = run( {
			adrs: [ adr() ],
			registry: {
				'feature-deps': regra( 'feature-deps', '0005', [ acharam( 'a.php → B' ) ] ),
			},
			ctx,
		} );
		expect( out.problems ).toHaveLength( 1 );
		expect( out.problems[ 0 ].message ).toMatch( /ADR-0005/ );
		expect( out.problems[ 0 ].message ).toMatch( /docs\/adr\/0005-topologia\.md/ );
		expect( out.problems[ 0 ].line ).toBe( 7 );
	} );

	it( 'deixa passar violação listada em desvios', () => {
		const out = run( {
			adrs: [ adr( { status: 'aceita-com-desvio', desvios: [ 'a.php → B' ] } ) ],
			registry: {
				'feature-deps': regra( 'feature-deps', '0005', [ acharam( 'a.php → B' ) ] ),
			},
			ctx,
		} );
		expect( out.problems ).toEqual( [] );
		expect( out.warnings ).toEqual( [] );
	} );

	it( 'avisa quando um desvio listado não viola mais', () => {
		const out = run( {
			adrs: [ adr( { status: 'aceita-com-desvio', desvios: [ 'a.php → B' ] } ) ],
			registry: { 'feature-deps': regra( 'feature-deps', '0005', [] ) },
			ctx,
		} );
		expect( out.problems ).toEqual( [] );
		expect( out.warnings ).toHaveLength( 1 );
		expect( out.warnings[ 0 ].message ).toMatch( /dívida quitada/ );
	} );

	it( 'compara desvios por ADR, não por regra', () => {
		// ADR-0004 tem duas regras e uma só lista de desvios. O desvio pertence à
		// primeira; a segunda não pode acusá-lo de dívida quitada.
		const out = run( {
			adrs: [
				adr( {
					id: '0004',
					enforcedBy: [ 'feature-layout', 'shared-two-consumers' ],
					status: 'aceita-com-desvio',
					desvios: [ 'x.ts → raiz' ],
				} ),
			],
			registry: {
				'feature-layout': regra( 'feature-layout', '0004', [ acharam( 'x.ts → raiz' ) ] ),
				'shared-two-consumers': regra( 'shared-two-consumers', '0004', [] ),
			},
			ctx,
		} );
		expect( out.problems ).toEqual( [] );
		expect( out.warnings ).toEqual( [] );
	} );

	it( 'acusa regra cujo campo adr não bate com a ADR que a declara', () => {
		const out = run( {
			adrs: [ adr() ],
			registry: { 'feature-deps': regra( 'feature-deps', '0099' ) },
			ctx,
		} );
		expect( out.problems ).toHaveLength( 1 );
		expect( out.problems[ 0 ].message ).toMatch( /declara adr: 0099/ );
	} );

	it( 'roda a mesma regra uma vez só, mesmo declarada por duas ADRs', () => {
		let chamadas = 0;
		const registry = {
			'feature-deps': { id: 'feature-deps', adr: '0005', check: () => { chamadas += 1; return []; } },
		};
		run( {
			adrs: [ adr(), adr( { id: '0006', file: 'docs/adr/0006-y.md' } ) ],
			registry,
			ctx,
		} );
		expect( chamadas ).toBe( 1 );
	} );
} );

describe( 'format', () => {
	it( 'lista problemas e avisos separadamente', () => {
		const texto = format( {
			problems: [ { message: 'quebrou' } ],
			warnings: [ { message: 'dívida quitada: x' } ],
		} );
		expect( texto ).toMatch( /quebrou/ );
		expect( texto ).toMatch( /dívida quitada: x/ );
	} );

	it( 'diz que está tudo certo quando não há nada', () => {
		expect( format( { problems: [], warnings: [] } ) ).toMatch( /nenhuma violação/ );
	} );
} );
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:unit -- scripts/lint-arch/tests/index.test.js`
Esperado: FAIL — `Cannot find module '../index'`.

- [ ] **Step 3: Criar o registro vazio de regras**

`scripts/lint-arch/rules/index.js`:

```js
'use strict';
// Registro das regras determinísticas. Cada tarefa de regra acrescenta uma linha.
// Uma regra aqui que nenhuma ADR declare em `enforced_by` reprova o lint como
// órfã — o registro e as ADRs são espelhos um do outro, de propósito.
module.exports = {};
```

- [ ] **Step 4: Implementar `scripts/lint-arch/index.js`**

```js
'use strict';
// Executa as regras de arquitetura usando as ADRs como configuração.
// Ver docs/adr/README.md e o spec 2026-08-25-adr-e-governanca-de-arquitetura-design.md.
const path = require( 'node:path' );
const { loadAdrs } = require( './adr' );
const { createContext } = require( './context' );

// Valores de `enforced_by` que não nomeiam uma regra: dizem que a decisão é
// defendida por leitura humana ou por relatório, não por gate determinístico.
const LITERAIS = new Set( [ 'review-manual', 'doctor' ] );

/**
 * @param {Object}   entrada
 * @param {Object[]} entrada.adrs
 * @param {Object}   entrada.registry mapa id → Rule
 * @param {Object}   entrada.ctx
 * @return {{ problems: Object[], warnings: Object[] }} achados
 */
function run( { adrs, registry, ctx } ) {
	const problems = [];
	const warnings = [];
	const declaradas = new Set();
	const cache = new Map();

	const executar = ( id ) => {
		if ( ! cache.has( id ) ) {
			cache.set( id, registry[ id ].check( ctx ) );
		}
		return cache.get( id );
	};

	for ( const adr of adrs ) {
		for ( const id of adr.enforcedBy ) {
			if ( LITERAIS.has( id ) ) {
				continue;
			}
			declaradas.add( id );
			if ( ! registry[ id ] ) {
				problems.push( {
					adr: adr.id,
					rule: id,
					message: `ADR-${ adr.id } declara enforced_by: ${ id }, mas essa regra não existe em scripts/lint-arch/rules/. Implemente a regra ou corrija o front-matter de ${ adr.file }.`,
				} );
			} else if ( registry[ id ].adr !== adr.id ) {
				problems.push( {
					adr: adr.id,
					rule: id,
					message: `ADR-${ adr.id } declara enforced_by: ${ id }, mas a regra declara adr: ${ registry[ id ].adr }. Uma das duas está errada.`,
				} );
			}
		}
	}

	for ( const id of Object.keys( registry ) ) {
		if ( ! declaradas.has( id ) ) {
			problems.push( {
				rule: id,
				message: `regra órfã: ${ id } existe em scripts/lint-arch/rules/ mas nenhuma ADR a declara em enforced_by. Sem ADR ninguém sabe por que a regra existe.`,
			} );
		}
	}

	for ( const adr of adrs ) {
		// Agrupado por ADR, e não por regra: uma ADR com duas regras tem uma única
		// lista de desvios, e comparar por regra faria uma acusar de "dívida
		// quitada" o desvio que pertence à outra.
		const achados = [];
		for ( const id of adr.enforcedBy ) {
			if ( LITERAIS.has( id ) || ! registry[ id ] ) {
				continue;
			}
			for ( const finding of executar( id ) ) {
				achados.push( { ...finding, rule: id } );
			}
		}

		const permitidos = new Set( adr.desvios );
		for ( const finding of achados ) {
			if ( permitidos.has( finding.key ) ) {
				continue;
			}
			problems.push( {
				adr: adr.id,
				rule: finding.rule,
				file: finding.file,
				line: finding.line,
				message: `${ finding.file }:${ finding.line } viola a ADR-${ adr.id } (${ adr.titulo }) — ${ finding.message }. Regra: ${ finding.rule }. Chave de desvio: "${ finding.key }". O porquê está em ${ adr.file }.`,
			} );
		}

		const vistos = new Set( achados.map( ( f ) => f.key ) );
		for ( const desvio of adr.desvios ) {
			if ( ! vistos.has( desvio ) ) {
				warnings.push( {
					adr: adr.id,
					message: `dívida quitada: "${ desvio }" não viola mais a ADR-${ adr.id }. Remova a entrada de desvios: em ${ adr.file }.`,
				} );
			}
		}
	}

	return { problems, warnings };
}

function format( { problems, warnings } ) {
	const linhas = [];
	if ( problems.length ) {
		linhas.push( `lint:arch — ${ problems.length } violação(ões):`, '' );
		for ( const p of problems ) {
			linhas.push( `  ✗ ${ p.message }` );
		}
		linhas.push( '' );
	}
	if ( warnings.length ) {
		linhas.push( `lint:arch — ${ warnings.length } aviso(s):`, '' );
		for ( const w of warnings ) {
			linhas.push( `  ! ${ w.message }` );
		}
		linhas.push( '' );
	}
	if ( ! problems.length && ! warnings.length ) {
		linhas.push( 'lint:arch — nenhuma violação e nenhuma dívida quitada pendente.' );
	}
	return linhas.join( '\n' );
}

module.exports = { run, format };

if ( require.main === module ) {
	const root = process.cwd();
	// --report: não sai não-zero. É como `npm run doctor` consome o linter.
	const reportOnly = process.argv.includes( '--report' );
	const adrs = loadAdrs( path.join( root, 'docs/adr' ) );
	const registry = require( './rules' );
	const resultado = run( { adrs, registry, ctx: createContext( { root } ) } );
	process.stdout.write( format( resultado ) + '\n' );
	process.exit( ! reportOnly && resultado.problems.length ? 1 : 0 );
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm run test:unit -- scripts/lint-arch/tests/index.test.js`
Esperado: PASS, 13 testes.

- [ ] **Step 6: Ligar o comando e as configs**

`package.json` — acrescente, na ordem alfabética das chaves já existentes, junto de `lint:js`:

```json
		"lint:arch": "node scripts/lint-arch/index.js",
```

`.eslintrc.js` — **nada a fazer**: os dois overrides que `scripts/lint-arch/` precisa
já entraram na Tarefa 2, que não conseguiria commitar o seu próprio teste sem eles.
Confira que estão lá e siga.

`jest.config.js` — acrescente ao fim do array `collectCoverageFrom` (linha 49, depois de `'features/player-style/admin/hex-field.ts'`):

```js
		'scripts/lint-arch/**/*.js',
		'!scripts/lint-arch/tests/**',
```

`collectCoverageFrom` é uma allowlist explícita, então isto **não** arrasta `audit-check.mjs` nem `bump-plugin-version.mjs` para o gate de 80%.

- [ ] **Step 7: Verificar que o comando roda**

Run: `npm run lint:js && npx tsc --noEmit`
Esperado: ambos passam.

Run: `npm run lint:arch`
Esperado: **falha** com `Cannot find module './context'`. `scripts/lint-arch/context.js`
só nasce na Tarefa 9, e `index.js` o exige no topo. Registre a saída no relatório como
estado pendente conhecido; **não** crie um stub — a Tarefa 9 traz o módulo de verdade, e
um stub teria de ser removido depois. A suíte Jest não é afetada: ela importa
`{ run, format }` e injeta um `ctx` falso, sem tocar no `createContext`.

A partir da Tarefa 9, o esperado passa a ser exit 0 com `lint:arch — nenhuma violação e
nenhuma dívida quitada pendente.` — a ADR-0001 declara `enforced_by: [ doctor ]`, que é
literal, e o registro de regras está vazio.

- [ ] **Step 8: Commit**

```bash
git add scripts/lint-arch/ package.json jest.config.js
git commit -m "feat(lint-arch): run rules with the ADRs as configuration

Findings are grouped per ADR rather than per rule: ADR-0004 has two rules and
one deviation list, so comparing per rule would make one rule report the
other's deviation as paid-off debt.

Not wired into ci.yml yet — that lands once all thirteen rules exist and the
repo is green under them.

Claude-Session: https://claude.ai/code/session_01U2Uski78ozNPf1uBQXU95q"
```

---

### Task 4: ADRs 0002, 0003 e 0004 — fundação e layout

**Files:**
- Create: `docs/adr/0002-tts-roda-no-navegador.md`
- Create: `docs/adr/0003-engine-pocket-tts.md`
- Create: `docs/adr/0004-layout-por-feature.md`
- Modify: `docs/adr/README.md` (três linhas na tabela)

**Interfaces:**
- Consumes: o formato da Tarefa 1, validado pelo parser da Tarefa 2.
- Produces: os ids de regra `no-server-side-tts` (0002), `feature-layout` e `shared-two-consumers` (0004), que as Tarefas 10 e 14 implementam sob exatamente esses nomes.

Conteúdo de cada uma: o `Contexto` vem do spec do MVP e da medição em "Estado atual medido"; a `Decisão` é a frase imperativa; `Como verificar` nomeia a regra. Use `TEMPLATE.md` e o critério da ADR-0001.

- [ ] **Step 1: Escrever `0002-tts-roda-no-navegador.md`**

```markdown
---
id: 0002
titulo: O TTS roda inteiro no navegador; o servidor só orquestra
status: aceita
data: 2026-08-27
origem: superpowers/specs/2026-08-08-wp-narration-plugin-mvp-design.md
enforced_by: [ no-server-side-tts ]
revisar_quando: um requisito exigir gerar narração sem um autor presente (agendamento, importação em lote)
desvios: []
---
```

Corpo, seguindo o template:

- **Contexto:** WordPress roda em hospedagem compartilhada. Um modelo ONNX de ~190 MB e a inferência que ele exige não cabem no orçamento de memória, de CPU nem de tempo de execução de um PHP típico, e uma API de TTS de terceiros transformaria o plugin numa dependência de rede paga, com o texto do post saindo do servidor do usuário.
- **Decisão:** a síntese acontece no navegador do autor, num Web Worker. O PHP recebe o áudio pronto, guarda como anexo e registra o post meta. Nenhum caminho de código PHP invoca processo externo, carrega modelo, nem chama serviço de síntese.
- **Consequências:** fica mais fácil — instalação sem requisito de servidor, custo zero por narração, texto nunca sai da máquina do autor. Fica mais difícil — só gera narração quem tem o editor aberto; agendamento e importação em lote ficam fora de alcance sem uma decisão nova; e a primeira geração paga o download do modelo.
- **Como verificar:** `no-server-side-tts` — nenhum PHP fora de `tests/` chama `exec`, `shell_exec`, `proc_open`, `passthru`, `system` ou `popen`, nem referencia `.onnx`/`onnxruntime`. Comentários são ignorados; strings não, porque um caminho de modelo moraria numa string.
- **Alternativas rejeitadas:** API de terceiros (custo recorrente, texto sai do servidor, quebra sem rede); binário no servidor (não instalável em hospedagem compartilhada, e vira suporte de plataforma); fila com worker externo (infra que o usuário-alvo não tem).

- [ ] **Step 2: Escrever `0003-engine-pocket-tts.md`**

```markdown
---
id: 0003
titulo: Pocket TTS como engine, não Piper
status: aceita
data: 2026-08-27
origem: research/2026-08-08-tts-engine-research.md
enforced_by: [ review-manual ]
revisar_quando: o bundle de um idioma passar de 60 MB, ou surgir engine com qualidade equivalente e bundle menor
desvios: []
---
```

Corpo: o `Contexto` e as `Alternativas rejeitadas` vêm de `docs/research/2026-08-08-tts-engine-research.md` — **leia o arquivo e cite os números que ele mediu**, não os invente. `Como verificar` diz que não há regra determinística: trocar de engine é uma reescrita do Worker, não um import que escapa num PR, e por isso é `review-manual`.

Esta é a única ADR do inventário sem regra. Passa nos dois testes de admissão — orienta código futuro (todo trabalho no Worker parte dela) e reverter custa muito mais que um PR — e o spec a classifica na categoria "fundação".

- [ ] **Step 3: Escrever `0004-layout-por-feature.md`**

```markdown
---
id: 0004
titulo: Layout por feature; shared/ só a partir do segundo consumidor
status: aceita-com-desvio
data: 2026-08-27
origem: superpowers/specs/2026-08-08-wp-narration-plugin-mvp-design.md#arquitetura
enforced_by: [ feature-layout, shared-two-consumers ]
revisar_quando: uma quarta feature entrar, ou shared/ passar de três módulos
desvios:
  - features/narration/format-time.ts → fora de features/<f>/{php,editor,frontend,admin,tests}/
---
```

Corpo:

- **Contexto:** um plugin WordPress cresce por camada técnica (`includes/`, `assets/`, `admin/`) e a camada não diz nada sobre o que o código faz. O layout por feature foi escolhido antes da primeira linha de código, e a medição de 2026-08-25 confirma que a divisão continua legível: `narration` tem 5 das 10 classes PHP e ~25 dos ~35 módulos TypeScript, `pronunciation` e `player-style` modificam o comportamento dela.
- **Decisão:** todo arquivo de produção mora em `features/<feature>/{php,editor,frontend,admin,tests}/`. Código só migra para `shared/` quando um **segundo** consumidor real aparece — abstrair antes é adivinhar a fronteira errada.
- **Consequências:** fica mais fácil ler uma feature inteira num diretório e apagá-la sem caçar restos. Fica mais difícil compartilhar: o segundo consumidor paga a migração, de propósito.
- **Como verificar:** `feature-layout` e `shared-two-consumers`. O desvio listado é `features/narration/format-time.ts`, que está na raiz da feature em vez de dentro de `editor/` — seu único consumidor de produção é `editor/mini-player.tsx`. Corrigir é mover o arquivo, o que é mudança em código de produção e está fora do escopo do trabalho que criou esta ADR.
- **Alternativas rejeitadas:** layout por camada técnica (a camada não informa a intenção); `shared/` desde o início (fronteira adivinhada antes de existir um segundo caso); monólito num diretório só (já eram 10 classes na Fase 1).

- [ ] **Step 4: Acrescentar as três linhas ao índice**

Em `docs/adr/README.md`, na tabela:

```markdown
| [0002](0002-tts-roda-no-navegador.md) | O TTS roda inteiro no navegador; o servidor só orquestra | aceita | `no-server-side-tts` |
| [0003](0003-engine-pocket-tts.md) | Pocket TTS como engine, não Piper | aceita | `review-manual` |
| [0004](0004-layout-por-feature.md) | Layout por feature; `shared/` só a partir do segundo consumidor | aceita-com-desvio | `feature-layout`, `shared-two-consumers` |
```

- [ ] **Step 5: Verificar que o parser aceita as três**

Run: `npm run lint:arch`
Esperado: **exit 1**, com exatamente três problemas, todos da forma `ADR-000X declara enforced_by: <regra>, mas essa regra não existe`, para `no-server-side-tts`, `feature-layout` e `shared-two-consumers`. Nenhum erro de parse.

Isto é o comportamento correto nesta fase do plano (ver "Duas refinações sobre o spec"). Se aparecer qualquer outra mensagem — erro de parse, status inválido, `aceita-com-desvio` sem desvio — **corrija antes de commitar**.

Run: `wc -l docs/adr/000{2,3,4}*.md`
Esperado: cada uma entre 40 e 120 linhas.

- [ ] **Step 6: Commit**

```bash
git add docs/adr/
git commit -m "docs(adr): record the browser-only TTS, the engine choice and the feature layout

ADR-0004 lands as aceita-com-desvio: features/narration/format-time.ts sits at
the feature root instead of under editor/. Moving it is a production change,
which this branch does not make, so it is frozen as a listed deviation.

Claude-Session: https://claude.ai/code/session_01U2Uski78ozNPf1uBQXU95q"
```

---

### Task 5: ADRs 0006 a 0010

**Files:**
- Create: `docs/adr/0006-nomenclatura-de-classe-php.md`
- Create: `docs/adr/0007-rest-namespace-e-validacao-no-servidor.md`
- Create: `docs/adr/0008-source-hash-e-calculado-no-cliente.md`
- Create: `docs/adr/0009-audio-comprimido-no-cliente.md`
- Create: `docs/adr/0010-i18n-desde-o-primeiro-commit.md`
- Modify: `docs/adr/README.md`

**Interfaces:**
- Produces: os ids `php-class-naming` (0006), `rest-namespace` (0007), `no-narration-logic-in-php` (0008), `no-server-side-audio-processing` (0009), `i18n-text-domain` (0010). As Tarefas 10, 11 e 12 implementam sob esses nomes exatos.

Todas as cinco entram com `status: aceita` e `desvios: []` — o baseline medido tem zero violações em cada uma.

- [ ] **Step 1: `0006-nomenclatura-de-classe-php.md`**

`enforced_by: [ php-class-naming ]`, `revisar_quando: o plugin adotar autoload PSR-4 via Composer`.

- **Contexto:** WordPress não tem namespaces por convenção e plugins colidem em nomes globais. As 10 classes do plugin são carregadas por `require_once` explícito em `post-voice.php`, sem autoloader.
- **Decisão:** toda classe se chama `Post_Voice_<Algo>`, mora sozinha num arquivo `class-<algo>.php` com o nome derivado da classe, e é carregada por `require_once` em `post-voice.php`.
- **Consequências:** fácil — do nome da classe cai-se no arquivo sem índice, e não há colisão global. Difícil — renomear classe é renomear arquivo e ajustar o `require_once`; adotar PSR-4 depois é migração, não ajuste.
- **Como verificar:** `php-class-naming`.
- **Alternativas rejeitadas:** namespaces PHP (WPCS e o ecossistema de plugins não seguem; ganho pequeno para 10 classes); autoloader Composer (uma dependência de runtime a mais para carregar 10 arquivos).

- [ ] **Step 2: `0007-rest-namespace-e-validacao-no-servidor.md`**

`enforced_by: [ rest-namespace, review-manual ]`, `revisar_quando: uma segunda versão da API for necessária (post-voice/v2)`.

- **Contexto:** o editor é a única UI, e é tentador confiar nela. Mas um endpoint REST é público: quem tem cookie de autor pode chamá-lo com qualquer corpo, ignorando todo `disabled` da interface.
- **Decisão:** toda rota vive em `post-voice/v1`, e **todo valor que o endpoint aceita é validado no servidor**, mesmo quando a UI já o restringe. Um controle desabilitado é UX, não garantia.
- **Consequências:** fácil — o endpoint é seguro sozinho, e a UI pode mudar sem virar buraco. Difícil — a lista de valores aceitos existe nos dois lados e precisa ser mantida nos dois.
- **Como verificar:** `rest-namespace` cobre metade — todo `register_rest_route` usa `post-voice/v1`, resolvendo constantes de classe. A outra metade é `review-manual`: "todo argumento tem `validate_callback` ou `sanitize_callback` que rejeita o que a UI impede" não é verificável por expressão regular sem falso positivo, e a mitigação é o passo 3 do fluxo pré-PR.
- **Alternativas rejeitadas:** confiar na UI (o endpoint é público); `admin-ajax.php` (sem esquema de argumentos, sem validação declarativa); namespace sem versão (a primeira quebra de contrato não teria saída).

- [ ] **Step 3: `0008-source-hash-e-calculado-no-cliente.md`**

`enforced_by: [ no-narration-logic-in-php ]`, `revisar_quando: o servidor precisar decidir sozinho se uma narração está obsoleta`.

- **Contexto:** "a narração está desatualizada?" é uma comparação entre o texto narrado e o texto atual. O cliente já monta o texto narrado — ele extrai os blocos, aplica o dicionário de pronúncia e sanitiza. Se o PHP recalculasse isso, existiriam duas implementações de "o que é narrado" que precisariam concordar para sempre.
- **Decisão:** o cliente calcula `source_hash` e o envia; o PHP guarda e compara. Nenhum PHP recomputa hash de conteúdo nem reimplementa a seleção de blocos.
- **Consequências:** fácil — uma definição só de "o que é narrado", e mudá-la é mudar um lugar. Difícil — o servidor não sabe julgar obsolescência sozinho; qualquer verificação fora do editor precisa de uma decisão nova.
- **Como verificar:** `no-narration-logic-in-php`.
- **Alternativas rejeitadas:** hash no servidor (duplica a definição, e a divergência aparece como bug de "sempre desatualizado"); hash dos dois lados com comparação cruzada (o dobro do custo pelo mesmo resultado).

- [ ] **Step 4: `0009-audio-comprimido-no-cliente.md`**

`enforced_by: [ no-server-side-audio-processing ]`, `revisar_quando: for preciso oferecer um segundo formato de áudio a partir de uma narração já salva`.

- **Contexto:** corolário direto da ADR-0002, mas independente dela: um servidor poderia orquestrar TTS no cliente e ainda assim transcodificar o resultado. PHP não tem encoder de áudio nativo, e `ffmpeg` não existe em hospedagem compartilhada.
- **Decisão:** o cliente comprime o áudio antes do upload. O servidor guarda o arquivo recebido como anexo e nunca transcodifica. O formato e a taxa são valores de spec, não desta ADR.
- **Consequências:** fácil — upload menor, servidor sem dependência binária. Difícil — oferecer um segundo formato exige regerar a partir do editor.
- **Como verificar:** `no-server-side-audio-processing`.
- **Alternativas rejeitadas:** WAV cru para o servidor comprimir (upload muitas vezes maior e dependência binária); deixar o servidor normalizar volume (mesma dependência, pelo mesmo motivo).

- [ ] **Step 5: `0010-i18n-desde-o-primeiro-commit.md`**

`enforced_by: [ i18n-text-domain ]`, `revisar_quando: o plugin passar a ter string de UI gerada dinamicamente no servidor`.

- **Contexto:** retrofit de i18n num plugin pronto é uma varredura sobre todo arquivo, e sempre escapa alguma coisa. Fazer desde o começo custa nada por string.
- **Decisão:** toda string visível ao usuário passa por `__()`/`_x()`/`esc_html__()` com o domínio `post-voice`. O `.pot` é regenerado quando as strings mudam, e `npm run i18n:check` reprova se estiver velho.
- **Consequências:** fácil — traduzível desde sempre, e o `.pot` no repo é revisável em diff. Difícil — o `.pot` tem de ser regenerado junto com a mudança, e esquecer reprova o CI.
- **Como verificar:** `i18n-text-domain` sobre o PHP. A exceção deliberada é `SAMPLE_TEXTS` em `voice-catalog.ts`: gettext segue o locale do admin, mas aquelas frases alimentam um modelo de fala cujo idioma é o do bundle escolhido. Não é desvio desta ADR porque a regra é sobre gettext em PHP, e `SAMPLE_TEXTS` deliberadamente não usa gettext. A razão está registrada aqui para que ninguém a "corrija".
- **Alternativas rejeitadas:** i18n só quando houver tradução pedida (é o retrofit); domínio por feature (WordPress carrega tradução por domínio, e três domínios significam três arquivos `.mo`).

- [ ] **Step 6: Acrescentar as cinco linhas ao índice de `README.md`**

- [ ] **Step 7: Verificar**

Run: `npm run lint:arch`
Esperado: exit 1, com **oito** problemas de "regra não existe" — os três da Tarefa 4 mais `php-class-naming`, `rest-namespace`, `no-narration-logic-in-php`, `no-server-side-audio-processing`, `i18n-text-domain`. Nenhum erro de parse.

Run: `wc -l docs/adr/00{06,07,08,09,10}*.md` — cada uma entre 40 e 120 linhas.

- [ ] **Step 8: Commit**

```bash
git add docs/adr/
git commit -m "docs(adr): record the PHP, REST, hashing, audio and i18n constraints

Claude-Session: https://claude.ai/code/session_01U2Uski78ozNPf1uBQXU95q"
```

---

### Task 6: ADRs 0011 a 0015

**Files:**
- Create: `docs/adr/0011-editor-em-typescript.md`
- Create: `docs/adr/0012-fronteira-jest-e2e.md`
- Create: `docs/adr/0013-covers-por-classe-e-gates-de-cobertura.md`
- Create: `docs/adr/0014-pins-de-contrato.md`
- Create: `docs/adr/0015-npm-ci-nunca-npm-install.md`
- Modify: `docs/adr/README.md`

**Interfaces:**
- Produces: os ids `no-untyped-editor-code` (0011), `covers-annotation` (0013), `contract-pins` (0014), `no-npm-install` (0015). A ADR-0012 é `review-manual` mais `doctor`, sem regra determinística.

- [ ] **Step 1: `0011-editor-em-typescript.md`**

```markdown
---
id: 0011
titulo: O editor é TypeScript
status: aceita-com-desvio
data: 2026-08-27
origem: superpowers/specs/2026-08-08-wp-narration-plugin-mvp-design.md
enforced_by: [ no-untyped-editor-code ]
revisar_quando: o worker vendorizado receber tipos upstream, ou for reescrito como código próprio
desvios:
  - features/narration/editor/engine/pocket-tts.worker.js
  - features/narration/editor/engine/sentencepiece.js
---
```

- **Contexto:** o editor conversa com APIs do Gutenberg cujo formato de dado não é óbvio, e o pipeline de narração passa estruturas (segmentos, entradas de dicionário) entre uma dúzia de módulos. Erro de forma nesse trajeto aparece em runtime, no navegador do autor.
- **Decisão:** todo código de `features/*/{editor,admin,frontend}/` é TypeScript. `npx tsc --noEmit` é gate de CI.
- **Consequências:** fácil — refatorar o pipeline sem caçar chamadores; tipos servem de documentação do formato. Difícil — código de terceiros precisa de declaração ou de exclusão explícita, e o build ganha um passo.
- **Como verificar:** `no-untyped-editor-code` — nenhum `.js` nesses diretórios fora da lista de desvios. Os dois desvios são vendorizados: `pocket-tts.worker.js` vem do repo de referência do pocket-tts (com modificações próprias em cima, ver `CREDITS.md`) e `sentencepiece.js` é um bundle Emscripten de 3,9 MB. Ambos já constam de `ignorePatterns` no `.eslintrc.js` — a regra não pode viver no ESLint justamente porque o ESLint não os enxerga.
- **Alternativas rejeitadas:** JSDoc com `checkJs` (a maior parte do ganho, mas a sintaxe de tipos complexos fica ilegível); JavaScript puro (o pipeline tem estruturas demais atravessando módulos demais).

- [ ] **Step 2: `0012-fronteira-jest-e2e.md`**

`status: aceita`, `enforced_by: [ review-manual, doctor ]`, `revisar_quando: a suíte E2E passar de 15 minutos, ou um mock de Worker aparecer num PR`.

- **Contexto:** mockar o Worker e o ONNX produz teste que passa enquanto o produto quebra: o mock afirma o comportamento que se quer, não o que a engine faz.
- **Decisão:** o que envolve Worker, ONNX ou navegador real ganha cenário E2E, **exceto** quando o comportamento sob teste é ele mesmo uma função pura, só alcançada através da UI. Nesse caso, extraia a função para um módulo próprio e dê a ela uma suíte Jest. `tokenizer-sanitize.ts` é o precedente: foi extraída de `pocket-tts.worker.js` porque seu único acoplamento ao Worker era morar no mesmo arquivo que um, não porque a lógica tocasse `self` ou ONNX.
- **Consequências:** fácil — os testes rápidos testam código de verdade, e a extração deixa o Worker menor. Difícil — a suíte E2E é lenta (~9 min, com download de modelo na primeira vez) e a decisão "isto é puro?" recai sobre o autor.
- **Como verificar:** `review-manual`, com uma pergunta: "este cenário E2E novo estaria só fixando a saída de uma função pura?". `e2e/segment-pipeline-perf.spec.ts` é o contraexemplo e tem de continuar E2E — o `DOMParser` do jsdom é ordens de grandeza mais lento que o de um navegador real e produzia números de tempo não confiáveis; o cabeçalho do próprio arquivo registra isso. O `doctor` reporta a contagem de cenários E2E e o tempo da última execução, para que o crescimento apareça antes de doer.
- **Alternativas rejeitadas:** mockar o Worker (testa o mock); só E2E (a suíte cresce até ninguém rodar antes do PR); só Jest (o caminho que de fato quebra fica sem teste).

- [ ] **Step 3: `0013-covers-por-classe-e-gates-de-cobertura.md`**

`status: aceita`, `enforced_by: [ covers-annotation ]`, `revisar_quando: um gate for reprovado três vezes seguidas por código que o time considera coberto`.

- **Contexto:** cobertura sem `@covers` credita à classe sob teste tudo o que a execução tocou, incluindo colaboradores. O número sobe sem que ninguém tenha testado nada a mais.
- **Decisão:** toda classe de teste PHPUnit declara `@covers`. Os gates são 80% de linhas em JS e 85% em PHP. Nenhum dos dois desce para fazer um PR passar; mudar um gate é decisão própria, com a razão no spec.
- **Consequências:** fácil — o número significa o que diz. Difícil — código alcançado através de outra classe lê como não coberto, **por desenho**, e isso já custou uma sessão de investigação; está registrado nos Gotchas do `CLAUDE.md`.
- **Como verificar:** `covers-annotation` sobre as classes de teste; os limiares são aplicados por `scripts/check-coverage-threshold.php` e por `coverageThreshold` no `jest.config.js`.
- **Alternativas rejeitadas:** cobertura sem `@covers` (número inflado); gate por arquivo (transforma cada PR em negociação de limiar).

- [ ] **Step 4: `0014-pins-de-contrato.md`**

`status: aceita`, `enforced_by: [ contract-pins ]`, `revisar_quando: o WordPress 6.6 sair do suporte, ou o mirror do modelo mudar de host`.

- **Contexto:** três valores se comportam como contrato: o SHA do commit em `MODEL_BASE_URL`, o mínimo de WordPress e o mínimo de PHP. Cada um aparece em vários arquivos, e nada garantia que concordassem. Mover qualquer um deles como efeito colateral de um trabalho não relacionado quebra usuários em silêncio.
- **Decisão:** os pins só mudam por decisão própria, com o seu próprio teste. `MODEL_BASE_URL` aponta para um commit fixado no mirror próprio, nunca para `resolve/main` nem para o repo upstream. Os mínimos de plataforma têm de concordar em `post-voice.php`, `readme.txt`, `composer.json`, `phpcs.xml.dist` e `.wp-env.json`.
- **Consequências:** fácil — o modelo baixado hoje é o mesmo de seis meses atrás, e o mínimo declarado é um só. Difícil — subir o mínimo vira PR próprio, com smoke test dos 5 idiomas e E2E.
- **Como verificar:** `contract-pins` confere a **concordância** entre os cinco arquivos e que o segmento `resolve/` de `MODEL_BASE_URL` é um SHA de 40 hexadígitos. A regra deliberadamente **não** fixa os valores: fixá-los faria toda subida de mínimo exigir editar a regra, e o que importa é que os arquivos não divirjam.
- **Alternativas rejeitadas:** apontar para `resolve/main` (o modelo muda debaixo dos usuários); um único arquivo como fonte da verdade (WordPress e Composer leem os seus próprios; centralizar exigiria geração de código).

- [ ] **Step 5: `0015-npm-ci-nunca-npm-install.md`**

`status: aceita`, `enforced_by: [ no-npm-install ]`, `revisar_quando: o projeto migrar de gerenciador de pacotes`.

- **Contexto:** `npm audit` é gate deste projeto, e o que ele audita é o `package-lock.json`. `npm install` reescreve o lockfile silenciosamente, então uma auditoria verde pode ter sido feita sobre uma árvore diferente da que roda em produção.
- **Decisão:** CI e scripts usam `npm ci`. `npm install` é para quando se está deliberadamente mudando uma dependência, na máquina do dev, com o lockfile no diff.
- **Consequências:** fácil — o lockfile é a superfície de auditoria e é imutável no CI. Difícil — lockfile fora de sincronia faz o CI falhar imediatamente, o que é o comportamento desejado.
- **Como verificar:** `no-npm-install`.
- **Alternativas rejeitadas:** `npm install` com lockfile commitado (ainda reescreve); `--frozen-lockfile` (é pnpm/yarn, não npm).

- [ ] **Step 6: Acrescentar as cinco linhas ao índice**

- [ ] **Step 7: Verificar**

Run: `npm run lint:arch`
Esperado: exit 1, com **doze** problemas de "regra não existe". Nenhum erro de parse. A ADR-0011 tem de parsear com dois desvios.

Run: `wc -l docs/adr/00{11,12,13,14,15}*.md` — cada uma entre 40 e 120 linhas.

- [ ] **Step 8: Commit**

```bash
git add docs/adr/
git commit -m "docs(adr): record the TypeScript, test-boundary, coverage, pin and npm-ci rules

ADR-0011 lands as aceita-com-desvio for the two vendored .js files under
editor/engine/ — the same two .eslintrc.js already ignores, which is why the
rule cannot live in ESLint.

Claude-Session: https://claude.ai/code/session_01U2Uski78ozNPf1uBQXU95q"
```

---

### Task 7: Spike — custo de inverter as arestas cross-feature

**Files:**
- Create: `docs/research/2026-08-27-custo-inversao-arestas-cross-feature.md`

**Interfaces:**
- Consumes: nada em código.
- Produces: a seção "Saída conhecida" que a Tarefa 8 cola dentro da ADR-0005.

**Isto é medição e escrita. Nenhum arquivo de `features/` é alterado, nem em rascunho, nem em branch de teste.** O spike mede; executar a inversão é uma mudança própria, com o seu próprio brainstorming.

As onze arestas medidas em `5ee2f24`:

| # | De | Para | Feature alvo |
|---|---|---|---|
| 1 | `features/narration/php/class-assets.php:64` | `Post_Voice_Dictionary_Store::get_global()` | pronunciation |
| 2 | `features/narration/php/class-assets.php:118` | `Post_Voice_Style_Store::inline_css()` | player-style |
| 3 | `features/player-style/php/class-style-section.php:142` | `Post_Voice_Frontend_Render::markup()` | narration |
| 4 | `features/pronunciation/php/class-dictionary-section.php:86` | `Post_Voice_Rest_Api::ALLOWED_LANGUAGES` | narration |
| 5 | `features/pronunciation/php/class-dictionary-store.php:57` | `Post_Voice_Rest_Api::ALLOWED_LANGUAGES` | narration |
| 6 | `features/pronunciation/php/class-dictionary-store.php:114` | `'Post_Voice_Post_Meta'::auth_callback` (callable em string) | narration |
| 7 | `features/narration/editor/index.tsx:50` | `pronunciation/editor/dictionary-panel` | pronunciation |
| 8 | `features/narration/editor/index.tsx:51,52` | `pronunciation/editor/dictionary-entry` | pronunciation |
| 9 | `features/narration/editor/index.tsx:53` | `pronunciation/editor/apply-dictionary` | pronunciation |
| 10 | `features/pronunciation/editor/dictionary-panel.tsx:9` | `narration/editor/model-source` | narration |
| 11 | `features/pronunciation/editor/dictionary-entry.ts:1` | `narration/editor/model-source` | narration |

- [ ] **Step 1: Confirmar que as onze arestas ainda são estas**

```bash
git rev-parse --short HEAD
grep -rnE "Post_Voice_(Dictionary_Store|Style_Store|Frontend_Render|Post_Meta|Rest_Api)" features/*/php/*.php
grep -rn "\.\./\.\./\(narration\|pronunciation\|player-style\)/" features/*/editor features/*/admin features/*/frontend
```

Se o conjunto divergir da tabela acima, **pare e reporte** antes de escrever o spike.

- [ ] **Step 2: Classificar cada aresta por mecanismo de inversão**

Para cada uma, responda três perguntas e registre a resposta:

1. **Qual é o dado que atravessa?** (`SUPPORTED_LANGUAGES`, o CSS inline, o markup do player, a lista do dicionário, o callback de autorização.)
2. **Quem é o dono natural desse dado?** Note quando a resposta contradiz a direção atual — a aresta 4 e a 5 leem `ALLOWED_LANGUAGES` de `Post_Voice_Rest_Api`, mas a lista de idiomas suportados é do modelo, não da API REST.
3. **Qual mecanismo inverteria?** Considere, para o PHP: filtro do WordPress (`apply_filters( 'post_voice_dictionary', [] )` em `narration`, com `pronunciation` registrando); ação com buffer; ou mover o dado compartilhado para `shared/`. Para o TypeScript: injeção por prop, registro de extensão em `narration/editor`, ou mover o tipo/constante para `shared/`.

- [ ] **Step 3: Medir o custo de cada mecanismo**

Para cada aresta, sem editar nada em `features/`, registre:

- número de arquivos que precisariam mudar (conte com `grep`, não por estimativa);
- se algum teste existente quebraria, e quais — liste os arquivos de teste que exercitam o caminho;
- se a inversão introduz ordem de carregamento nova em `post-voice.php` (hoje as classes são carregadas em ordem fixa nas linhas 31-40, e um filtro exige que o registrador carregue antes do disparo);
- o que fica **pior** com a inversão: um filtro do WordPress é um ponto de extensão público, e publicar um ponto de extensão é um compromisso de compatibilidade que ninguém pediu.

- [ ] **Step 4: Escrever o relatório**

`docs/research/2026-08-27-custo-inversao-arestas-cross-feature.md`, seguindo o formato de `docs/research/2026-08-08-tts-engine-research.md` (leia-o antes). Estrutura:

```markdown
# Custo de inverter as arestas cross-feature — medição

**Data:** 2026-08-27
**Commit medido:** <sha>
**Pergunta:** quanto custa fazer `pronunciation` e `player-style` se plugarem em
`narration` em vez de os três se referenciarem mutuamente?

## As onze arestas

<a tabela do Step 1, com a coluna "dado que atravessa" preenchida>

## Por mecanismo

<uma seção por mecanismo candidato, com as arestas que ele resolve e o custo medido>

## Recomendação

<qual subconjunto vale a pena, se algum, e em que ordem>

## O que fica pior

<o custo que a inversão cria: pontos de extensão públicos, indireção, ordem de carga>
```

A seção **Recomendação** é o que a Tarefa 8 cola na ADR-0005 como "Saída conhecida".

- [ ] **Step 5: Confirmar que nada de produção foi tocado**

```bash
git status --porcelain features/ shared/ post-voice.php
```
Esperado: **saída vazia.** Qualquer coisa aqui é violação do escopo — reverta.

- [ ] **Step 6: Commit**

```bash
git add docs/research/
git commit -m "docs(research): measure the cost of inverting the cross-feature edges

Measurement only. Nothing under features/ is touched: inverting the edges is
its own change with its own brainstorming.

Claude-Session: https://claude.ai/code/session_01U2Uski78ozNPf1uBQXU95q"
```

---

### Task 8: ADR-0005 — topologia de dependência entre features

**Files:**
- Create: `docs/adr/0005-topologia-de-dependencia-entre-features.md`
- Modify: `docs/adr/README.md`

**Interfaces:**
- Consumes: a seção "Recomendação" da Tarefa 7.
- Produces: o id de regra `feature-deps` e as **onze chaves de desvio** que a Tarefa 15 tem de reproduzir exatamente.

Esta é a ADR que responde à pergunta que originou o trabalho: onde a teoria e a implementação divergem, hoje, medido.

- [ ] **Step 1: Escrever o arquivo**

```markdown
---
id: 0005
titulo: Topologia de dependência entre features
status: aceita-com-desvio
data: 2026-08-27
origem: superpowers/specs/2026-08-25-adr-e-governanca-de-arquitetura-design.md#estado-atual-medido
enforced_by: [ feature-deps ]
revisar_quando: uma quarta feature entrar, ou uma extensão passar narration em número de classes, ou a lista de desvios abaixo chegar a zero
desvios:
  - features/narration/php/class-assets.php → Post_Voice_Dictionary_Store
  - features/narration/php/class-assets.php → Post_Voice_Style_Store
  - features/player-style/php/class-style-section.php → Post_Voice_Frontend_Render
  - features/pronunciation/php/class-dictionary-section.php → Post_Voice_Rest_Api
  - features/pronunciation/php/class-dictionary-store.php → Post_Voice_Rest_Api
  - features/pronunciation/php/class-dictionary-store.php → Post_Voice_Post_Meta
  - features/narration/editor/index.tsx → pronunciation/editor/dictionary-panel
  - features/narration/editor/index.tsx → pronunciation/editor/dictionary-entry
  - features/narration/editor/index.tsx → pronunciation/editor/apply-dictionary
  - features/pronunciation/editor/dictionary-panel.tsx → narration/editor/model-source
  - features/pronunciation/editor/dictionary-entry.ts → narration/editor/model-source
---
```

Corpo:

- **Contexto.** O `CLAUDE.md` dizia *"shared code moves to `shared/` only when a second feature actually needs it"*, mas nunca disse o que fazer quando a feature A precisa da **feature B inteira**. Sem regra, cada caso resolveu com uma referência direta, e a medição de 2026-08-25 encontrou onze arestas formando os ciclos `narration ↔ pronunciation` e `narration ↔ player-style`, nas duas linguagens. A causa raiz é a regra que faltava, não descuido: `shared/` responde "dois consumidores do mesmo utilitário", e nenhuma dessas onze arestas é isso.

  A forma real do sistema também importa. `features/` sugere pares independentes; a realidade é **um núcleo com duas extensões**. `narration` tem 5 das 10 classes PHP e ~25 dos ~35 módulos TypeScript; `pronunciation` e `player-style` modificam o comportamento dela e nenhuma faz sentido sozinha. A decisão que nunca foi tomada é: `narration` pode nomear suas extensões, ou elas se plugam nela?

- **Decisão.** Uma feature não referencia outra feature. O que atravessa a fronteira vai para `shared/` (quando é utilitário com dois consumidores, ADR-0004) ou passa por um ponto de extensão que o núcleo publica. **As onze arestas existentes ficam congeladas na lista de `desvios:` acima**: valem enquanto estiverem listadas, e aresta nova reprova o CI.

  Congelar em vez de corrigir é deliberado. O guard rail passa a valer imediatamente, a refatoração custa zero agora, e a saída fica desenhada em vez de virar uma linha no `FOLLOW-UPS.md`.

- **Consequências.** Fica mais fácil: a deriva para. Uma décima segunda aresta reprova o CI citando esta ADR, e a lista mede exatamente quanto de teoria e implementação divergem. O aviso de dívida quitada faz a lista encolher em vez de fossilizar.

  Fica mais difícil: as onze continuam lá, e o código não fica mais limpo hoje. Quem for inverter uma delas paga o custo medido no spike — e removê-la da lista é obrigatório, senão o lint avisa que a dívida foi quitada.

- **Saída conhecida.** *(cole aqui a seção "Recomendação" de `docs/research/2026-08-27-custo-inversao-arestas-cross-feature.md`, resumida em cinco a dez linhas, com o link para o relatório completo.)*

- **Como verificar.** `feature-deps`, em PHP e em TypeScript. Em PHP, um `Post_Voice_*` cuja classe é declarada em outra feature; comentários são ignorados, strings não — a aresta 6 é um callable em string (`array( 'Post_Voice_Post_Meta', 'auth_callback' )`) e sumiria se as strings fossem descartadas. Em TypeScript, um import relativo que sobe até `features/<outra>/`. Classes e módulos de `shared/` nunca contam como aresta.

- **Alternativas rejeitadas.**
  - **Corrigir as onze agora.** Mudança em código de produção com risco real, no meio de um trabalho de documentação. O spike mede primeiro.
  - **Trocar o layout para `core/` + `extensions/`.** O que falhou foi a regra de dependência, ortogonal ao layout: reorganizar as pastas deixaria os mesmos onze ciclos no lugar, e a decisão que falta ("o núcleo nomeia as extensões ou elas se plugam nele?") vale igual em qualquer layout.
  - **Permitir aresta em direção única, do núcleo para as extensões.** Não descreve o que existe: das onze, seis saem de uma extensão para o núcleo. Uma regra que já nasce com metade dos casos como exceção não é regra.
  - **Não ter regra.** É o estado que produziu os ciclos.

- [ ] **Step 2: Acrescentar a linha ao índice**

```markdown
| [0005](0005-topologia-de-dependencia-entre-features.md) | Topologia de dependência entre features | aceita-com-desvio | `feature-deps` |
```

Ordene a tabela por id.

- [ ] **Step 3: Verificar**

Run: `npm run lint:arch`
Esperado: exit 1, com **treze** problemas de "regra não existe" — as doze anteriores mais `feature-deps`. Nenhum erro de parse; as onze entradas de `desvios:` têm de sobreviver ao parser.

Run: `node -e "console.log(require('./scripts/lint-arch/adr').loadAdrs('docs/adr').find(a=>a.id==='0005').desvios.length)"`
Esperado: `11`.

- [ ] **Step 4: Commit**

```bash
git add docs/adr/
git commit -m "docs(adr): freeze the eleven cross-feature edges as listed deviations

The guard rail applies from now on; the eleven existing edges are named in
desvios: so they pass while a twelfth fails. The measured way out lives in
docs/research/2026-08-27-custo-inversao-arestas-cross-feature.md.

Claude-Session: https://claude.ai/code/session_01U2Uski78ozNPf1uBQXU95q"
```

---

### Task 9: O corpus (`context.js`)

**Files:**
- Create: `scripts/lint-arch/context.js`
- Test: `scripts/lint-arch/tests/context.test.js`

**Interfaces:**
- Produces:
  - `createContext( { root?, files?, read? } ): Context`
  - `stripPhpComments( source: string ): string` — comentários viram espaços, offsets de linha e coluna preservados.
  - `stripPhpNoise( source: string ): string` — comentários **e** corpo de string viram espaços.
  - `isTestPath( file: string ): boolean`
  - `phpSources( ctx ): string[]` — `.php` versionados fora de qualquer diretório de teste.

Por que `git ls-files` e não uma varredura do disco: pula `node_modules/`, `vendor/`, `build/`, `coverage/` e `artifacts/` sem manter lista de exclusão, e "arquivo versionado" é exatamente a palavra usada nos critérios de aceite.

Por que dois strippers: a regra de i18n precisa **ler** o literal `'post-voice'` dentro da chamada, então usa `stripPhpComments`. A regra que procura chamada de função precisa que um nome de função dentro de uma string não conte, então usa `stripPhpNoise`. Substituir por espaços em vez de remover mantém o número da linha e a coluna corretos na mensagem de erro.

- [ ] **Step 1: Escrever o teste que falha**

`scripts/lint-arch/tests/context.test.js`:

```js
const {
	createContext,
	stripPhpComments,
	stripPhpNoise,
	isTestPath,
	phpSources,
} = require( '../context' );

describe( 'stripPhpComments', () => {
	it( 'apaga // mantendo o número da linha', () => {
		const out = stripPhpComments( 'a();\n// exec( 1 );\nb();\n' );
		expect( out ).not.toMatch( /exec/ );
		expect( out.split( '\n' ) ).toHaveLength( 4 );
		expect( out.split( '\n' )[ 2 ] ).toBe( 'b();' );
	} );

	it( 'apaga bloco /* */ preservando as quebras de linha', () => {
		const out = stripPhpComments( 'a();\n/* exec\n   exec */\nb();\n' );
		expect( out ).not.toMatch( /exec/ );
		expect( out.split( '\n' ) ).toHaveLength( 5 );
	} );

	it( 'apaga # mas não confunde com atributo #[Foo]', () => {
		expect( stripPhpComments( '# exec();\n' ) ).not.toMatch( /exec/ );
		expect( stripPhpComments( '#[Attr]\nexec();\n' ) ).toMatch( /exec/ );
	} );

	it( 'não apaga o que está dentro de string', () => {
		expect( stripPhpComments( "$a = '// exec';\n" ) ).toMatch( /exec/ );
	} );

	it( 'preserva literais de string inteiros', () => {
		expect( stripPhpComments( "__( 'ola', 'post-voice' );\n" ) ).toMatch( /'post-voice'/ );
	} );
} );

describe( 'stripPhpNoise', () => {
	it( 'apaga também o corpo das strings', () => {
		expect( stripPhpNoise( "$a = 'exec';\n" ) ).not.toMatch( /exec/ );
	} );

	it( 'mantém as aspas, para o código continuar parseável', () => {
		expect( stripPhpNoise( "$a = 'exec';\n" ) ).toMatch( /'\s+'/ );
	} );

	it( 'respeita escape dentro de string', () => {
		expect( stripPhpNoise( "$a = 'x\\'exec';\nexec();\n" ) ).toMatch( /^exec\(\);$/m );
	} );

	it( 'não muda o comprimento total', () => {
		const src = "// c\n$a = 'x';\n";
		expect( stripPhpNoise( src ) ).toHaveLength( src.length );
	} );
} );

describe( 'isTestPath', () => {
	it.each( [
		[ 'features/narration/tests/php/test-assets.php', true ],
		[ 'tests/php/bootstrap.php', true ],
		[ 'test/jest.setup.js', true ],
		[ 'scripts/lint-arch/tests/adr.test.js', true ],
		[ 'features/narration/php/class-assets.php', false ],
		[ 'e2e/narration.spec.ts', false ],
	] )( '%s → %s', ( file, esperado ) => {
		expect( isTestPath( file ) ).toBe( esperado );
	} );
} );

describe( 'createContext', () => {
	it( 'aceita arquivos e leitor injetados', () => {
		const ctx = createContext( {
			root: '/repo',
			files: [ 'a.php' ],
			read: ( f ) => `conteúdo de ${ f }`,
		} );
		expect( ctx.files ).toEqual( [ 'a.php' ] );
		expect( ctx.read( 'a.php' ) ).toBe( 'conteúdo de a.php' );
	} );

	it( 'lê cada arquivo uma vez só', () => {
		let leituras = 0;
		const ctx = createContext( {
			files: [ 'a.php' ],
			read: () => {
				leituras += 1;
				return 'x';
			},
		} );
		ctx.read( 'a.php' );
		ctx.read( 'a.php' );
		expect( leituras ).toBe( 1 );
	} );
} );

describe( 'phpSources', () => {
	it( 'devolve só .php de produção', () => {
		const ctx = createContext( {
			files: [
				'features/narration/php/class-assets.php',
				'features/narration/tests/php/test-assets.php',
				'post-voice.php',
				'features/narration/editor/index.tsx',
			],
			read: () => '',
		} );
		expect( phpSources( ctx ) ).toEqual( [
			'features/narration/php/class-assets.php',
			'post-voice.php',
		] );
	} );
} );
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:unit -- scripts/lint-arch/tests/context.test.js`
Esperado: FAIL — `Cannot find module '../context'`.

- [ ] **Step 3: Implementar `scripts/lint-arch/context.js`**

```js
'use strict';
// O corpus sobre o qual as regras operam, e os strippers de PHP que elas
// compartilham. Nenhuma regra lê o disco por conta própria.
const { execFileSync } = require( 'node:child_process' );
const fs = require( 'node:fs' );
const path = require( 'node:path' );

const TEST_PATH_RE = /(^|\/)tests?\//;

/**
 * Arquivos versionados no git.
 *
 * `git ls-files` em vez de varrer o disco: pula node_modules/, vendor/, build/,
 * coverage/ e artifacts/ sem manter uma lista de exclusão que apodrece, e
 * "arquivo versionado" é a definição usada nos critérios de aceite.
 *
 * @param {string} root
 * @return {string[]} caminhos relativos, com barra normal
 */
function trackedFiles( root ) {
	const out = execFileSync( 'git', [ '-C', root, 'ls-files', '-z' ], {
		encoding: 'utf8',
		maxBuffer: 32 * 1024 * 1024,
	} );
	return out.split( '\0' ).filter( Boolean );
}

function blank( text ) {
	return text.replace( /[^\n]/g, ' ' );
}

/**
 * Substitui comentários PHP por espaços, e opcionalmente o corpo das strings.
 *
 * Substitui em vez de remover para que linha e coluna de um match continuem
 * apontando para o lugar certo no arquivo original.
 *
 * @param {string}  source
 * @param {boolean} strings também apaga o corpo dos literais de string
 * @return {string} o mesmo comprimento, com o ruído em branco
 */
function strip( source, strings ) {
	let out = '';
	let i = 0;
	while ( i < source.length ) {
		const dois = source.slice( i, i + 2 );
		// `#[` abre um atributo do PHP 8, não um comentário.
		const hashComment = source[ i ] === '#' && source[ i + 1 ] !== '[';
		if ( dois === '//' || hashComment ) {
			const fim = source.indexOf( '\n', i );
			const stop = fim === -1 ? source.length : fim;
			out += blank( source.slice( i, stop ) );
			i = stop;
			continue;
		}
		if ( dois === '/*' ) {
			const fim = source.indexOf( '*/', i + 2 );
			const stop = fim === -1 ? source.length : fim + 2;
			out += blank( source.slice( i, stop ) );
			i = stop;
			continue;
		}
		if ( source[ i ] === "'" || source[ i ] === '"' ) {
			const aspas = source[ i ];
			let j = i + 1;
			while ( j < source.length && source[ j ] !== aspas ) {
				j += source[ j ] === '\\' ? 2 : 1;
			}
			const corpo = source.slice( i + 1, Math.min( j, source.length ) );
			out += aspas + ( strings ? blank( corpo ) : corpo );
			if ( source[ j ] === aspas ) {
				out += aspas;
			}
			i = j + 1;
			continue;
		}
		out += source[ i ];
		i += 1;
	}
	return out;
}

const stripPhpComments = ( source ) => strip( source, false );
const stripPhpNoise = ( source ) => strip( source, true );

const isTestPath = ( file ) => TEST_PATH_RE.test( file );

/**
 * @param {Object} ctx
 * @return {string[]} .php versionados fora de qualquer diretório de teste
 */
function phpSources( ctx ) {
	return ctx.files.filter( ( f ) => f.endsWith( '.php' ) && ! isTestPath( f ) );
}

/**
 * @param {Object}   [entrada]
 * @param {string}   [entrada.root]  raiz do repo
 * @param {string[]} [entrada.files] injetado nos testes
 * @param {Function} [entrada.read]  injetado nos testes
 * @return {Object} o contexto
 */
function createContext( { root = process.cwd(), files, read } = {} ) {
	const lista = files || trackedFiles( root );
	const ler = read || ( ( f ) => fs.readFileSync( path.join( root, f ), 'utf8' ) );
	const cache = new Map();
	return {
		root,
		files: lista,
		read( file ) {
			if ( ! cache.has( file ) ) {
				cache.set( file, ler( file ) );
			}
			return cache.get( file );
		},
	};
}

module.exports = {
	createContext,
	trackedFiles,
	stripPhpComments,
	stripPhpNoise,
	isTestPath,
	phpSources,
};
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:unit -- scripts/lint-arch/tests/context.test.js`
Esperado: PASS, 17 testes.

- [ ] **Step 5: Verificar contra o repo de verdade**

```bash
node -e "
const { createContext, phpSources } = require('./scripts/lint-arch/context');
const ctx = createContext();
console.log('versionados:', ctx.files.length);
console.log('php de produção:', phpSources(ctx).length);
"
```
Esperado: `php de produção: 11` (10 classes mais `post-voice.php`). Se divergir, pare e reporte.

- [ ] **Step 6: Commit**

```bash
git add scripts/lint-arch/context.js scripts/lint-arch/tests/context.test.js
git commit -m "feat(lint-arch): share the file corpus and the PHP strippers

Two strippers, not one: the i18n rule has to read the 'post-voice' literal
inside the call, while the rules that look for function calls must not match a
function name that only appears inside a string. Both blank the noise instead
of removing it, so a match still reports the right line and column.

Claude-Session: https://claude.ai/code/session_01U2Uski78ozNPf1uBQXU95q"
```

---

### Task 10: Regras de conteúdo PHP (ADRs 0002, 0008, 0009)

**Files:**
- Create: `scripts/lint-arch/rules/forbidden-php.js` (helper compartilhado)
- Create: `scripts/lint-arch/rules/no-server-side-tts.js`
- Create: `scripts/lint-arch/rules/no-narration-logic-in-php.js`
- Create: `scripts/lint-arch/rules/no-server-side-audio-processing.js`
- Test: `scripts/lint-arch/tests/rules-php-content.test.js`
- Modify: `scripts/lint-arch/rules/index.js`

**Interfaces:**
- Consumes: `phpSources`, `stripPhpComments` da Tarefa 9; o typedef `Rule`/`Finding`.
- Produces: `scanForbidden( ctx, padroes ): Finding[]`, e as três regras registradas.

As três têm a mesma forma — varredura de padrões proibidos sobre PHP de produção — e por isso são uma tarefa só, com um helper. Usam `stripPhpComments` (comentários fora, strings dentro): um caminho de modelo ou um nome de binário moraria numa string, e `class-dictionary-store.php:74` tem a palavra "speech model" num comentário que não deve contar.

Baseline: **zero violações nas três**. Se alguma acusar algo, pare e reporte.

- [ ] **Step 1: Escrever o teste que falha**

`scripts/lint-arch/tests/rules-php-content.test.js`:

```js
const { createContext } = require( '../context' );
const tts = require( '../rules/no-server-side-tts' );
const narration = require( '../rules/no-narration-logic-in-php' );
const audio = require( '../rules/no-server-side-audio-processing' );

const ctxCom = ( file, src ) =>
	createContext( { files: [ file ], read: () => src } );

const PROD = 'features/narration/php/class-x.php';
const TESTE = 'features/narration/tests/php/test-x.php';

describe( 'no-server-side-tts', () => {
	it( 'declara a ADR-0002', () => {
		expect( tts.adr ).toBe( '0002' );
		expect( tts.id ).toBe( 'no-server-side-tts' );
	} );

	it.each( [
		[ 'shell_exec( $cmd );', /processo/ ],
		[ 'proc_open( $cmd, $d, $p );', /processo/ ],
		[ "$m = '/models/voice.onnx';", /ONNX/ ],
		[ "require 'onnxruntime.php';", /ONNX/ ],
	] )( 'acusa %s', ( linha, motivo ) => {
		const achados = tts.check( ctxCom( PROD, `<?php\n${ linha }\n` ) );
		expect( achados ).toHaveLength( 1 );
		expect( achados[ 0 ].line ).toBe( 2 );
		expect( achados[ 0 ].message ).toMatch( motivo );
		expect( achados[ 0 ].key ).toBe( `${ PROD } → ${ achados[ 0 ].key.split( ' → ' )[ 1 ] }` );
	} );

	it( 'ignora o que está em comentário', () => {
		expect( tts.check( ctxCom( PROD, '<?php\n// shell_exec( $x );\n' ) ) ).toEqual( [] );
		expect( tts.check( ctxCom( PROD, '<?php\n/* voice.onnx */\n' ) ) ).toEqual( [] );
	} );

	it( 'ignora arquivos de teste', () => {
		expect( tts.check( ctxCom( TESTE, "<?php\nshell_exec( 'x' );\n" ) ) ).toEqual( [] );
	} );

	it( 'não acusa PHP inocente', () => {
		expect(
			tts.check( ctxCom( PROD, '<?php\nadd_action( "init", "x" );\n' ) )
		).toEqual( [] );
	} );
} );

describe( 'no-narration-logic-in-php', () => {
	it( 'declara a ADR-0008', () => {
		expect( narration.adr ).toBe( '0008' );
	} );

	it.each( [ 'md5( $c );', 'sha1( $c );', 'hash( "sha256", $c );', 'parse_blocks( $c );' ] )(
		'acusa %s',
		( linha ) => {
			expect( narration.check( ctxCom( PROD, `<?php\n${ linha }\n` ) ) ).toHaveLength( 1 );
		}
	);

	it( 'não confunde uma variável chamada $hash com a função', () => {
		expect( narration.check( ctxCom( PROD, '<?php\n$hash = $meta;\n' ) ) ).toEqual( [] );
	} );
} );

describe( 'no-server-side-audio-processing', () => {
	it( 'declara a ADR-0009', () => {
		expect( audio.adr ).toBe( '0009' );
	} );

	it.each( [ "exec( 'ffmpeg -i' );", "$b = 'lame';", 'new getID3();' ] )(
		'acusa %s',
		( linha ) => {
			expect( audio.check( ctxCom( PROD, `<?php\n${ linha }\n` ) ) ).toHaveLength( 1 );
		}
	);

	it( 'não acusa a API de anexo do core', () => {
		expect(
			audio.check(
				ctxCom( PROD, '<?php\nwp_generate_attachment_metadata( $id, $file );\n' )
			)
		).toEqual( [] );
	} );
} );

describe( 'o repo de hoje', () => {
	it.each( [ tts, narration, audio ] )( '$id não acusa nada', ( regra ) => {
		expect( regra.check( createContext() ) ).toEqual( [] );
	} );
} );
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:unit -- scripts/lint-arch/tests/rules-php-content.test.js`
Esperado: FAIL — módulos não encontrados.

- [ ] **Step 3: Implementar o helper**

`scripts/lint-arch/rules/forbidden-php.js`:

```js
'use strict';
const { phpSources, stripPhpComments } = require( '../context' );

/**
 * Varre o PHP de produção procurando padrões proibidos.
 *
 * Comentários saem, strings ficam: um caminho de modelo ou um nome de binário
 * mora numa string, e é justamente ali que precisa ser pego. A contrapartida é
 * que uma palavra proibida citada num comentário não conta — o que é correto.
 *
 * @param {Object}   ctx
 * @param {Object[]} padroes { pattern: RegExp com /g, motivo: string, rotulo: string }
 * @return {Object[]} findings
 */
function scanForbidden( ctx, padroes ) {
	const achados = [];
	for ( const file of phpSources( ctx ) ) {
		const source = stripPhpComments( ctx.read( file ) );
		for ( const { pattern, motivo, rotulo } of padroes ) {
			pattern.lastIndex = 0;
			let m;
			while ( ( m = pattern.exec( source ) ) !== null ) {
				achados.push( {
					key: `${ file } → ${ rotulo }`,
					file,
					line: source.slice( 0, m.index ).split( '\n' ).length,
					message: motivo,
				} );
			}
		}
	}
	return achados;
}

module.exports = { scanForbidden };
```

- [ ] **Step 4: Implementar as três regras**

`scripts/lint-arch/rules/no-server-side-tts.js`:

```js
'use strict';
const { scanForbidden } = require( './forbidden-php' );

// Não procura a palavra "model" nem "voice": ambas aparecem legitimamente em
// strings traduzíveis e em nomes de opção. Procura o que só existe se o
// servidor estiver de fato sintetizando — spawn de processo e referência ao
// runtime ou ao arquivo do modelo.
const PADROES = [
	{
		pattern: /\b(?:exec|shell_exec|proc_open|passthru|system|popen)\s*\(/g,
		rotulo: 'spawn-de-processo',
		motivo: 'spawn de processo no servidor; o TTS roda no navegador (ADR-0002)',
	},
	{
		pattern: /\.onnx\b/g,
		rotulo: 'arquivo-onnx',
		motivo: 'referência a arquivo ONNX no servidor; o modelo vive no navegador (ADR-0002)',
	},
	{
		pattern: /\bonnxruntime\b/gi,
		rotulo: 'onnxruntime',
		motivo: 'referência ao runtime ONNX no servidor (ADR-0002)',
	},
];

module.exports = {
	id: 'no-server-side-tts',
	adr: '0002',
	check: ( ctx ) => scanForbidden( ctx, PADROES ),
};
```

`scripts/lint-arch/rules/no-narration-logic-in-php.js`:

```js
'use strict';
const { scanForbidden } = require( './forbidden-php' );

const PADROES = [
	{
		pattern: /\b(?:md5|sha1|hash|hash_hmac)\s*\(/g,
		rotulo: 'hash-no-servidor',
		motivo:
			'o cliente calcula source_hash; o servidor guarda e compara, nunca recomputa (ADR-0008)',
	},
	{
		pattern: /\bparse_blocks\s*\(/g,
		rotulo: 'parse-blocks',
		motivo:
			'a seleção do que é narrado é do cliente; o servidor não reimplementa (ADR-0008)',
	},
];

module.exports = {
	id: 'no-narration-logic-in-php',
	adr: '0008',
	check: ( ctx ) => scanForbidden( ctx, PADROES ),
};
```

`scripts/lint-arch/rules/no-server-side-audio-processing.js`:

```js
'use strict';
const { scanForbidden } = require( './forbidden-php' );

const PADROES = [
	{
		pattern: /\b(?:ffmpeg|avconv|lame|sox)\b/gi,
		rotulo: 'encoder-externo',
		motivo:
			'encoder de áudio no servidor; o cliente comprime antes do upload (ADR-0009)',
	},
	{
		pattern: /\bgetID3\b/g,
		rotulo: 'getid3',
		motivo: 'biblioteca de áudio no servidor (ADR-0009)',
	},
];

module.exports = {
	id: 'no-server-side-audio-processing',
	adr: '0009',
	check: ( ctx ) => scanForbidden( ctx, PADROES ),
};
```

- [ ] **Step 5: Registrar as três**

`scripts/lint-arch/rules/index.js`:

```js
'use strict';
// Registro das regras determinísticas. Uma regra aqui que nenhuma ADR declare
// em `enforced_by` reprova o lint como órfã — o registro e as ADRs são espelhos
// um do outro, de propósito.
module.exports = {
	'no-server-side-tts': require( './no-server-side-tts' ),
	'no-narration-logic-in-php': require( './no-narration-logic-in-php' ),
	'no-server-side-audio-processing': require( './no-server-side-audio-processing' ),
};
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npm run test:unit -- scripts/lint-arch/tests/rules-php-content.test.js`
Esperado: PASS.

Run: `npm run lint:arch`
Esperado: exit 1, com **dez** problemas de "regra não existe" (treze menos as três que acabaram de nascer) e **nenhuma** violação de conteúdo.

- [ ] **Step 7: Commit**

```bash
git add scripts/lint-arch/
git commit -m "feat(lint-arch): forbid server-side TTS, narration logic and audio processing

Comments are stripped, string bodies are not: a model path or a binary name
lives inside a string and is exactly what has to be caught, while 'speech
model' in a docblock must not count.

Claude-Session: https://claude.ai/code/session_01U2Uski78ozNPf1uBQXU95q"
```

---

### Task 11: `php-class-naming` e `rest-namespace` (ADRs 0006, 0007)

**Files:**
- Create: `scripts/lint-arch/rules/php-class-naming.js`
- Create: `scripts/lint-arch/rules/rest-namespace.js`
- Test: `scripts/lint-arch/tests/rules-php-shape.test.js`
- Modify: `scripts/lint-arch/rules/index.js`

**Interfaces:**
- Produces: `phpClassOwners( ctx ): Map<string, { feature, file }>` exportado por `php-class-naming.js` — a Tarefa 15 (`feature-deps`) consome esse mapa em vez de recalcular.

`rest-namespace` precisa resolver constante: o código real chama `register_rest_route( self::REST_NAMESPACE, ... )`, com `private const REST_NAMESPACE = 'post-voice/v1'` no mesmo arquivo. Uma regra que só aceitasse literal reprovaria o único uso correto que existe.

- [ ] **Step 1: Escrever o teste que falha**

`scripts/lint-arch/tests/rules-php-shape.test.js`:

```js
const { createContext } = require( '../context' );
const naming = require( '../rules/php-class-naming' );
const rest = require( '../rules/rest-namespace' );

const ctxCom = ( file, src ) => createContext( { files: [ file ], read: () => src } );

describe( 'php-class-naming', () => {
	it( 'declara a ADR-0006', () => {
		expect( naming.adr ).toBe( '0006' );
	} );

	it( 'aceita classe bem nomeada no arquivo certo', () => {
		expect(
			naming.check(
				ctxCom( 'features/x/php/class-rest-api.php', '<?php\nclass Post_Voice_Rest_Api {}\n' )
			)
		).toEqual( [] );
	} );

	it( 'acusa nome de arquivo que não deriva da classe', () => {
		const a = naming.check(
			ctxCom( 'features/x/php/class-api.php', '<?php\nclass Post_Voice_Rest_Api {}\n' )
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /class-rest-api\.php/ );
	} );

	it( 'acusa classe sem o prefixo', () => {
		const a = naming.check( ctxCom( 'features/x/php/class-api.php', '<?php\nclass Api {}\n' ) );
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /Post_Voice_/ );
	} );

	it( 'acusa duas classes no mesmo arquivo', () => {
		const a = naming.check(
			ctxCom(
				'features/x/php/class-a.php',
				'<?php\nclass Post_Voice_A {}\nclass Post_Voice_B {}\n'
			)
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /uma classe/ );
	} );

	it( 'ignora a palavra class dentro de comentário ou string', () => {
		expect(
			naming.check(
				ctxCom(
					'features/x/php/class-a.php',
					"<?php\n// class Post_Voice_Z {}\n$s = 'class Post_Voice_W';\nclass Post_Voice_A {}\n"
				)
			)
		).toEqual( [] );
	} );

	it( 'expõe o mapa classe → feature', () => {
		const mapa = naming.phpClassOwners(
			createContext( {
				files: [ 'features/narration/php/class-post-meta.php', 'shared/php/class-settings-page.php' ],
				read: ( f ) =>
					f.includes( 'post-meta' )
						? '<?php\nclass Post_Voice_Post_Meta {}\n'
						: '<?php\nclass Post_Voice_Settings_Page {}\n',
			} )
		);
		expect( mapa.get( 'Post_Voice_Post_Meta' ).feature ).toBe( 'narration' );
		expect( mapa.get( 'Post_Voice_Settings_Page' ).feature ).toBe( 'shared' );
	} );
} );

describe( 'rest-namespace', () => {
	it( 'declara a ADR-0007', () => {
		expect( rest.adr ).toBe( '0007' );
	} );

	it( 'aceita namespace literal correto', () => {
		expect(
			rest.check(
				ctxCom( 'features/x/php/class-rest-api.php', "<?php\nregister_rest_route( 'post-voice/v1', '/a', [] );\n" )
			)
		).toEqual( [] );
	} );

	it( 'resolve constante de classe do mesmo arquivo', () => {
		expect(
			rest.check(
				ctxCom(
					'features/x/php/class-rest-api.php',
					"<?php\nclass A {\nprivate const NS = 'post-voice/v1';\nfunction r() { register_rest_route( self::NS, '/a', [] ); }\n}\n"
				)
			)
		).toEqual( [] );
	} );

	it( 'acusa namespace errado', () => {
		const a = rest.check(
			ctxCom( 'features/x/php/class-rest-api.php', "<?php\nregister_rest_route( 'wp/v2', '/a', [] );\n" )
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /post-voice\/v1/ );
	} );

	it( 'acusa constante que resolve para o namespace errado', () => {
		const a = rest.check(
			ctxCom(
				'features/x/php/class-rest-api.php',
				"<?php\nprivate const NS = 'outro/v1';\nregister_rest_route( self::NS, '/a', [] );\n"
			)
		);
		expect( a ).toHaveLength( 1 );
	} );

	it( 'acusa primeiro argumento que não resolve estaticamente', () => {
		const a = rest.check(
			ctxCom( 'features/x/php/class-rest-api.php', '<?php\nregister_rest_route( $ns, "/a", [] );\n' )
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /não resolve/ );
	} );
} );

describe( 'o repo de hoje', () => {
	it( 'php-class-naming não acusa nada nas 10 classes', () => {
		expect( naming.check( createContext() ) ).toEqual( [] );
	} );

	it( 'rest-namespace não acusa nada', () => {
		expect( rest.check( createContext() ) ).toEqual( [] );
	} );

	it( 'mapeia as 10 classes do repo', () => {
		expect( naming.phpClassOwners( createContext() ).size ).toBe( 10 );
	} );
} );
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:unit -- scripts/lint-arch/tests/rules-php-shape.test.js`
Esperado: FAIL — módulos não encontrados.

- [ ] **Step 3: Implementar `php-class-naming.js`**

```js
'use strict';
const { stripPhpNoise, isTestPath } = require( '../context' );

const CLASS_RE = /^\s*(?:final\s+|abstract\s+)*class\s+(\w+)/gm;
const PREFIXO = 'Post_Voice_';

const classFiles = ( ctx ) =>
	ctx.files.filter(
		( f ) =>
			/^(?:features\/[^/]+|shared)\/php\/class-[a-z0-9-]+\.php$/.test( f ) &&
			! isTestPath( f )
	);

/**
 * `Post_Voice_Rest_Api` → `class-rest-api.php`
 *
 * @param {string} klass
 * @return {string} o nome de arquivo esperado
 */
function esperadoParaClasse( klass ) {
	return 'class-' + klass.slice( PREFIXO.length ).toLowerCase().replace( /_/g, '-' ) + '.php';
}

function declaradas( ctx, file ) {
	// stripPhpNoise, e não stripPhpComments: `'class Post_Voice_X'` dentro de uma
	// string não declara nada.
	const source = stripPhpNoise( ctx.read( file ) );
	CLASS_RE.lastIndex = 0;
	const out = [];
	let m;
	while ( ( m = CLASS_RE.exec( source ) ) !== null ) {
		out.push( { nome: m[ 1 ], line: source.slice( 0, m.index ).split( '\n' ).length } );
	}
	return out;
}

/**
 * @param {Object} ctx
 * @return {Map<string, { feature: string, file: string }>} classe → dono
 */
function phpClassOwners( ctx ) {
	const mapa = new Map();
	for ( const file of classFiles( ctx ) ) {
		const feature = file.startsWith( 'shared/' ) ? 'shared' : file.split( '/' )[ 1 ];
		for ( const { nome } of declaradas( ctx, file ) ) {
			mapa.set( nome, { feature, file } );
		}
	}
	return mapa;
}

function check( ctx ) {
	const achados = [];
	for ( const file of classFiles( ctx ) ) {
		const base = file.split( '/' ).pop();
		const classes = declaradas( ctx, file );

		if ( classes.length !== 1 ) {
			achados.push( {
				key: `${ file } → uma-classe-por-arquivo`,
				file,
				line: classes[ 1 ] ? classes[ 1 ].line : 1,
				message: `${ classes.length } classes declaradas; o padrão é uma classe por arquivo (ADR-0006)`,
			} );
			continue;
		}

		const { nome, line } = classes[ 0 ];
		if ( ! nome.startsWith( PREFIXO ) ) {
			achados.push( {
				key: `${ file } → prefixo`,
				file,
				line,
				message: `a classe "${ nome }" não usa o prefixo ${ PREFIXO } (ADR-0006)`,
			} );
			continue;
		}
		const esperado = esperadoParaClasse( nome );
		if ( base !== esperado ) {
			achados.push( {
				key: `${ file } → nome-do-arquivo`,
				file,
				line,
				message: `a classe "${ nome }" deveria morar em ${ esperado }, não em ${ base } (ADR-0006)`,
			} );
		}
	}
	return achados;
}

module.exports = { id: 'php-class-naming', adr: '0006', check, phpClassOwners, esperadoParaClasse };
```

- [ ] **Step 4: Implementar `rest-namespace.js`**

```js
'use strict';
const { phpSources, stripPhpComments } = require( '../context' );

const NAMESPACE = 'post-voice/v1';
const CONST_RE = /const\s+(\w+)\s*=\s*'([^']*)'/g;
const CALL_RE = /register_rest_route\s*\(\s*([^,]+),/g;

/**
 * Resolve o primeiro argumento de register_rest_route.
 *
 * O código real usa `self::REST_NAMESPACE`, com a constante no mesmo arquivo.
 * Uma regra que só aceitasse literal reprovaria o único uso correto que existe.
 *
 * @param {string} arg   o primeiro argumento, já trimado
 * @param {Map}    consts nome → valor, do mesmo arquivo
 * @return {string|null} o namespace, ou null quando não resolve estaticamente
 */
function resolver( arg, consts ) {
	const literal = arg.match( /^'([^']*)'$/ ) || arg.match( /^"([^"]*)"$/ );
	if ( literal ) {
		return literal[ 1 ];
	}
	const ref = arg.match( /^(?:self|static|\w+)::(\w+)$/ );
	if ( ref && consts.has( ref[ 1 ] ) ) {
		return consts.get( ref[ 1 ] );
	}
	return null;
}

function check( ctx ) {
	const achados = [];
	for ( const file of phpSources( ctx ) ) {
		const source = stripPhpComments( ctx.read( file ) );
		if ( ! source.includes( 'register_rest_route' ) ) {
			continue;
		}
		const consts = new Map();
		CONST_RE.lastIndex = 0;
		let c;
		while ( ( c = CONST_RE.exec( source ) ) !== null ) {
			consts.set( c[ 1 ], c[ 2 ] );
		}
		CALL_RE.lastIndex = 0;
		let m;
		while ( ( m = CALL_RE.exec( source ) ) !== null ) {
			const line = source.slice( 0, m.index ).split( '\n' ).length;
			const ns = resolver( m[ 1 ].trim(), consts );
			if ( ns === null ) {
				achados.push( {
					key: `${ file } → namespace-dinamico`,
					file,
					line,
					message: `o namespace de register_rest_route não resolve estaticamente ("${ m[ 1 ].trim() }"); use '${ NAMESPACE }' ou uma constante do mesmo arquivo (ADR-0007)`,
				} );
			} else if ( ns !== NAMESPACE ) {
				achados.push( {
					key: `${ file } → ${ ns }`,
					file,
					line,
					message: `register_rest_route usa o namespace "${ ns }"; o único aceito é "${ NAMESPACE }" (ADR-0007)`,
				} );
			}
		}
	}
	return achados;
}

module.exports = { id: 'rest-namespace', adr: '0007', check, resolver };
```

- [ ] **Step 5: Registrar as duas em `rules/index.js` e rodar**

Run: `npm run test:unit -- scripts/lint-arch/tests/rules-php-shape.test.js`
Esperado: PASS.

Run: `npm run lint:arch`
Esperado: exit 1, com **oito** problemas de "regra não existe", nenhuma violação.

- [ ] **Step 6: Commit**

```bash
git add scripts/lint-arch/
git commit -m "feat(lint-arch): check PHP class naming and the REST namespace

The namespace check resolves a class constant from the same file: the only
register_rest_route call in the codebase passes self::REST_NAMESPACE, so a
literal-only rule would reject the one correct usage that exists.

php-class-naming also exports the class → feature map that feature-deps needs.

Claude-Session: https://claude.ai/code/session_01U2Uski78ozNPf1uBQXU95q"
```

---

### Task 12: `i18n-text-domain` (ADR-0010)

**Files:**
- Create: `scripts/lint-arch/rules/i18n-text-domain.js`
- Test: `scripts/lint-arch/tests/rule-i18n.test.js`
- Modify: `scripts/lint-arch/rules/index.js`

**Interfaces:**
- Produces: `gettextCalls( source ): { fn, args, index }[]`, exportado para o `doctor` reusar.

Esta regra não pode usar `stripPhpNoise` — precisa **ler** o literal `'post-voice'` dentro da chamada. Usa `stripPhpComments` e um scanner de parênteses balanceados, porque uma expressão regular sobre `__( ... )` erra assim que um argumento contém parêntese.

Baseline: 48 chamadas, zero fora do domínio.

- [ ] **Step 1: Escrever o teste que falha**

`scripts/lint-arch/tests/rule-i18n.test.js`:

```js
const { createContext } = require( '../context' );
const regra = require( '../rules/i18n-text-domain' );

const ctxCom = ( src ) =>
	createContext( { files: [ 'features/x/php/class-a.php' ], read: () => src } );

describe( 'i18n-text-domain', () => {
	it( 'declara a ADR-0010', () => {
		expect( regra.adr ).toBe( '0010' );
	} );

	it.each( [
		"__( 'Olá', 'post-voice' )",
		"_x( 'Olá', 'saudação', 'post-voice' )",
		"esc_html__( 'Olá', 'post-voice' )",
		"_n( 'um', 'dois', $n, 'post-voice' )",
	] )( 'aceita %s', ( chamada ) => {
		expect( regra.check( ctxCom( `<?php\n${ chamada };\n` ) ) ).toEqual( [] );
	} );

	it( 'acusa domínio errado', () => {
		const a = regra.check( ctxCom( "<?php\n__( 'Olá', 'outro' );\n" ) );
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].line ).toBe( 2 );
		expect( a[ 0 ].message ).toMatch( /post-voice/ );
	} );

	it( 'acusa domínio ausente', () => {
		expect( regra.check( ctxCom( "<?php\n__( 'Olá' );\n" ) ) ).toHaveLength( 1 );
	} );

	it( 'lida com parêntese dentro do argumento', () => {
		expect(
			regra.check( ctxCom( "<?php\n__( sprintf( '%s (x)', $a ), 'post-voice' );\n" ) )
		).toEqual( [] );
	} );

	it( 'ignora chamada em comentário', () => {
		expect( regra.check( ctxCom( "<?php\n// __( 'Olá', 'outro' );\n" ) ) ).toEqual( [] );
	} );

	it( 'não confunde uma função cujo nome termina em __', () => {
		expect( regra.check( ctxCom( '<?php\nmy_helper__( $a );\n' ) ) ).toEqual( [] );
	} );

	it( 'o repo de hoje tem 48 chamadas e nenhuma fora do domínio', () => {
		const ctx = createContext();
		expect( regra.check( ctx ) ).toEqual( [] );
		expect( regra.contarChamadas( ctx ) ).toBe( 48 );
	} );
} );
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:unit -- scripts/lint-arch/tests/rule-i18n.test.js`
Esperado: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar**

`scripts/lint-arch/rules/i18n-text-domain.js`:

```js
'use strict';
const { phpSources, stripPhpComments } = require( '../context' );

const DOMINIO = "'post-voice'";
// `(?<![\w$])` impede casar o sufixo de `my_helper__(`.
const CALL_RE =
	/(?<![\w$])(esc_html__|esc_attr__|esc_html_e|esc_attr_e|_nx|_ex|__|_e|_x|_n)\s*\(/g;

/**
 * Todas as chamadas gettext do arquivo, com os argumentos crus.
 *
 * Percorre os parênteses contando profundidade em vez de casar com expressão
 * regular: `__( sprintf( '%s (x)', $a ), 'post-voice' )` derruba qualquer regex
 * de `\(([^)]*)\)`.
 *
 * @param {string} source já sem comentários
 * @return {Object[]} { fn, args, index }
 */
function gettextCalls( source ) {
	const out = [];
	CALL_RE.lastIndex = 0;
	let m;
	while ( ( m = CALL_RE.exec( source ) ) !== null ) {
		const abre = m.index + m[ 0 ].length - 1;
		let profundidade = 0;
		let fecha = abre;
		for ( let j = abre; j < source.length; j += 1 ) {
			if ( source[ j ] === '(' ) {
				profundidade += 1;
			} else if ( source[ j ] === ')' ) {
				profundidade -= 1;
				if ( profundidade === 0 ) {
					fecha = j;
					break;
				}
			}
		}
		out.push( { fn: m[ 1 ], args: source.slice( abre, fecha + 1 ), index: m.index } );
	}
	return out;
}

function check( ctx ) {
	const achados = [];
	for ( const file of phpSources( ctx ) ) {
		const source = stripPhpComments( ctx.read( file ) );
		for ( const { fn, args, index } of gettextCalls( source ) ) {
			if ( args.includes( DOMINIO ) ) {
				continue;
			}
			achados.push( {
				key: `${ file } → ${ fn }-sem-dominio`,
				file,
				line: source.slice( 0, index ).split( '\n' ).length,
				message: `${ fn }() sem o text domain ${ DOMINIO } (ADR-0010)`,
			} );
		}
	}
	return achados;
}

const contarChamadas = ( ctx ) =>
	phpSources( ctx ).reduce(
		( total, file ) => total + gettextCalls( stripPhpComments( ctx.read( file ) ) ).length,
		0
	);

module.exports = { id: 'i18n-text-domain', adr: '0010', check, gettextCalls, contarChamadas };
```

- [ ] **Step 4: Registrar, rodar e ver passar**

Run: `npm run test:unit -- scripts/lint-arch/tests/rule-i18n.test.js`
Esperado: PASS.

Se `contarChamadas` devolver algo diferente de 48, o repo mudou desde `5ee2f24`: **pare e reporte** em vez de ajustar o número.

Run: `npm run lint:arch` — exit 1, **sete** problemas de "regra não existe", nenhuma violação.

- [ ] **Step 5: Commit**

```bash
git add scripts/lint-arch/
git commit -m "feat(lint-arch): require the post-voice text domain on every gettext call

Balanced-paren scanning rather than a regex: a gettext call whose first
argument is itself a sprintf() containing parentheses breaks any naive
pattern, and this codebase has calls shaped exactly like that.

Claude-Session: https://claude.ai/code/session_01U2Uski78ozNPf1uBQXU95q"
```

---

### Task 13: `covers-annotation` (ADR-0013)

**Files:**
- Create: `scripts/lint-arch/rules/covers-annotation.js`
- Test: `scripts/lint-arch/tests/rule-covers.test.js`
- Modify: `scripts/lint-arch/rules/index.js`

Baseline: 10 classes de teste PHPUnit, todas com `@covers`.

- [ ] **Step 1: Escrever o teste que falha**

`scripts/lint-arch/tests/rule-covers.test.js`:

```js
const { createContext } = require( '../context' );
const regra = require( '../rules/covers-annotation' );

const ARQ = 'features/narration/tests/php/test-assets.php';
const ctxCom = ( src ) => createContext( { files: [ ARQ ], read: () => src } );

describe( 'covers-annotation', () => {
	it( 'declara a ADR-0013', () => {
		expect( regra.adr ).toBe( '0013' );
	} );

	it( 'aceita classe de teste com @covers', () => {
		expect(
			regra.check( ctxCom( '<?php\n/**\n * @covers Post_Voice_Assets\n */\nclass X extends A {}\n' ) )
		).toEqual( [] );
	} );

	it( 'aceita @coversDefaultClass', () => {
		expect(
			regra.check( ctxCom( '<?php\n/**\n * @coversDefaultClass Post_Voice_Assets\n */\nclass X {}\n' ) )
		).toEqual( [] );
	} );

	it( 'acusa classe de teste sem @covers', () => {
		const a = regra.check( ctxCom( '<?php\nclass X extends A {}\n' ) );
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].file ).toBe( ARQ );
		expect( a[ 0 ].message ).toMatch( /@covers/ );
	} );

	it( 'ignora arquivo que não é test-*.php', () => {
		expect(
			regra.check(
				createContext( {
					files: [ 'features/narration/tests/php/trait-with-asset-file.php' ],
					read: () => '<?php\ntrait T {}\n',
				} )
			)
		).toEqual( [] );
	} );

	it( 'ignora o bootstrap e a config do root', () => {
		expect(
			regra.check(
				createContext( {
					files: [ 'tests/php/bootstrap.php', 'tests/php/wp-tests-config.php' ],
					read: () => '<?php\n',
				} )
			)
		).toEqual( [] );
	} );

	it( 'o repo de hoje tem 10 classes de teste, todas cobertas', () => {
		const ctx = createContext();
		expect( regra.check( ctx ) ).toEqual( [] );
		expect( regra.classesDeTeste( ctx ) ).toHaveLength( 10 );
	} );
} );
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:unit -- scripts/lint-arch/tests/rule-covers.test.js` → FAIL.

- [ ] **Step 3: Implementar**

`scripts/lint-arch/rules/covers-annotation.js`:

```js
'use strict';

// Só classes de teste de feature ou de shared. `tests/php/bootstrap.php` e os
// traits auxiliares não declaram caso de teste e não têm o que cobrir.
const TEST_CLASS_RE = /^(?:features\/[^/]+|shared)\/tests\/php\/test-[a-z0-9-]+\.php$/;

const classesDeTeste = ( ctx ) => ctx.files.filter( ( f ) => TEST_CLASS_RE.test( f ) );

function check( ctx ) {
	return classesDeTeste( ctx )
		.filter( ( file ) => ! /@covers(?:DefaultClass|Nothing)?\b/.test( ctx.read( file ) ) )
		.map( ( file ) => ( {
			key: `${ file } → sem-covers`,
			file,
			line: 1,
			message:
				'classe de teste PHPUnit sem anotação @covers; sem ela a cobertura credita colaboradores à classe sob teste (ADR-0013)',
		} ) );
}

module.exports = { id: 'covers-annotation', adr: '0013', check, classesDeTeste };
```

- [ ] **Step 4: Registrar, rodar e ver passar**

Run: `npm run test:unit -- scripts/lint-arch/tests/rule-covers.test.js` → PASS.
Run: `npm run lint:arch` → exit 1, **seis** problemas de "regra não existe", nenhuma violação.

- [ ] **Step 5: Commit**

```bash
git add scripts/lint-arch/
git commit -m "feat(lint-arch): require @covers on every PHPUnit test class

Claude-Session: https://claude.ai/code/session_01U2Uski78ozNPf1uBQXU95q"
```

---

### Task 14: `feature-layout` e `shared-two-consumers` (ADR-0004)

**Files:**
- Create: `scripts/lint-arch/rules/feature-layout.js`
- Create: `scripts/lint-arch/rules/shared-two-consumers.js`
- Test: `scripts/lint-arch/tests/rules-layout.test.js`
- Modify: `scripts/lint-arch/rules/index.js`

**Interfaces:**
- Consumes: `phpClassOwners` da Tarefa 11.
- Produces: `SUBDIRS_PERMITIDOS`, exportado por `feature-layout.js` e citado por `.claude/rules/php.md` na Tarefa 20.

Baseline: `feature-layout` acusa **1** — `features/narration/format-time.ts`, já congelado nos `desvios:` da ADR-0004 (Tarefa 4). `shared-two-consumers` acusa **0**: `Post_Voice_Settings_Page` é usada por `player-style` e por `pronunciation`.

- [ ] **Step 1: Escrever o teste que falha**

`scripts/lint-arch/tests/rules-layout.test.js`:

```js
const { createContext } = require( '../context' );
const layout = require( '../rules/feature-layout' );
const shared = require( '../rules/shared-two-consumers' );

const comArquivos = ( files, read = () => '' ) => createContext( { files, read } );

describe( 'feature-layout', () => {
	it( 'declara a ADR-0004', () => {
		expect( layout.adr ).toBe( '0004' );
	} );

	it.each( [
		'features/narration/php/class-assets.php',
		'features/narration/editor/index.tsx',
		'features/narration/editor/engine/tts-engine.ts',
		'features/player-style/admin/contrast.ts',
		'features/narration/tests/js/segment.test.ts',
		'shared/php/class-settings-page.php',
		'scripts/lint-arch/index.js',
		'e2e/narration.spec.ts',
		'types/post-voice-data.d.ts',
		'test/jest.setup.js',
		'tests/phpstan-bootstrap.php',
		'post-voice.php',
		'jest.config.js',
	] )( 'aceita %s', ( file ) => {
		expect( layout.check( comArquivos( [ file ] ) ) ).toEqual( [] );
	} );

	it( 'acusa arquivo na raiz da feature', () => {
		const a = layout.check( comArquivos( [ 'features/narration/format-time.ts' ] ) );
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].key ).toBe(
			'features/narration/format-time.ts → fora de features/<f>/{php,editor,frontend,admin,tests}/'
		);
	} );

	it( 'acusa subdiretório de feature não previsto', () => {
		expect( layout.check( comArquivos( [ 'features/narration/utils/x.ts' ] ) ) ).toHaveLength( 1 );
	} );

	it( 'ignora arquivo que não é código', () => {
		expect( layout.check( comArquivos( [ 'features/narration/README.md' ] ) ) ).toEqual( [] );
	} );

	it( 'o repo de hoje acusa só o format-time.ts', () => {
		const a = layout.check( createContext() );
		expect( a.map( ( f ) => f.file ) ).toEqual( [ 'features/narration/format-time.ts' ] );
	} );
} );

describe( 'shared-two-consumers', () => {
	it( 'declara a ADR-0004', () => {
		expect( shared.adr ).toBe( '0004' );
	} );

	it( 'aceita módulo com duas features consumidoras', () => {
		const ctx = comArquivos(
			[
				'shared/php/class-settings-page.php',
				'features/a/php/class-a.php',
				'features/b/php/class-b.php',
			],
			( f ) =>
				f.startsWith( 'shared/' )
					? '<?php\nclass Post_Voice_Settings_Page {}\n'
					: '<?php\nPost_Voice_Settings_Page::MENU_SLUG;\n'
		);
		expect( shared.check( ctx ) ).toEqual( [] );
	} );

	it( 'acusa módulo com um consumidor só', () => {
		const ctx = comArquivos(
			[ 'shared/php/class-settings-page.php', 'features/a/php/class-a.php' ],
			( f ) =>
				f.startsWith( 'shared/' )
					? '<?php\nclass Post_Voice_Settings_Page {}\n'
					: '<?php\nPost_Voice_Settings_Page::MENU_SLUG;\n'
		);
		const a = shared.check( ctx );
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /1 feature/ );
	} );

	it( 'não conta post-voice.php como feature consumidora', () => {
		// A raiz carrega e registra tudo; contá-la faria qualquer módulo de
		// shared/ parecer ter um consumidor a mais do que tem.
		const ctx = comArquivos(
			[ 'shared/php/class-settings-page.php', 'post-voice.php', 'features/a/php/class-a.php' ],
			( f ) =>
				f.startsWith( 'shared/' )
					? '<?php\nclass Post_Voice_Settings_Page {}\n'
					: '<?php\nPost_Voice_Settings_Page::register();\n'
		);
		expect( shared.check( ctx ) ).toHaveLength( 1 );
	} );

	it( 'o repo de hoje não acusa nada', () => {
		expect( shared.check( createContext() ) ).toEqual( [] );
	} );
} );
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:unit -- scripts/lint-arch/tests/rules-layout.test.js` → FAIL.

- [ ] **Step 3: Implementar `feature-layout.js`**

```js
'use strict';

const SUBDIRS_PERMITIDOS = [ 'php', 'editor', 'frontend', 'admin', 'tests' ];
const CODIGO_RE = /\.(?:php|ts|tsx|js|jsx)$/;

// Fora de features/, estes prefixos são o resto legítimo do repo. `build/`,
// `vendor/` e `node_modules/` não aparecem porque não são versionados.
const RAIZES_PERMITIDAS = [ 'shared/', 'scripts/', 'e2e/', 'types/', 'test/', 'tests/' ];

const FEATURE_RE = new RegExp(
	`^features/[^/]+/(?:${ SUBDIRS_PERMITIDOS.join( '|' ) })/`
);

const ESPERADO = `features/<f>/{${ SUBDIRS_PERMITIDOS.join( ',' ) }}/`;

function permitido( file ) {
	if ( file.startsWith( 'features/' ) ) {
		return FEATURE_RE.test( file );
	}
	if ( ! file.includes( '/' ) ) {
		// Arquivo na raiz do repo: post-voice.php, jest.config.js, .eslintrc.js.
		return true;
	}
	return RAIZES_PERMITIDAS.some( ( raiz ) => file.startsWith( raiz ) );
}

function check( ctx ) {
	return ctx.files
		.filter( ( f ) => CODIGO_RE.test( f ) && ! permitido( f ) )
		.map( ( file ) => ( {
			key: `${ file } → fora de ${ ESPERADO }`,
			file,
			line: 1,
			message: `arquivo de código fora do layout; o esperado é ${ ESPERADO } (ADR-0004)`,
		} ) );
}

module.exports = { id: 'feature-layout', adr: '0004', check, SUBDIRS_PERMITIDOS };
```

- [ ] **Step 4: Implementar `shared-two-consumers.js`**

```js
'use strict';
const { isTestPath } = require( '../context' );
const { phpClassOwners } = require( './php-class-naming' );

/**
 * Todo módulo de shared/ precisa de dois consumidores reais.
 *
 * `post-voice.php` não conta: a raiz carrega e registra tudo, e contá-la faria
 * qualquer módulo de shared/ parecer ter um consumidor a mais do que tem.
 * Testes também não contam — um teste consome por definição.
 */
function check( ctx ) {
	const donos = phpClassOwners( ctx );
	const compartilhadas = [ ...donos.entries() ].filter( ( [ , v ] ) => v.feature === 'shared' );

	const consumidores = ( klass ) => {
		const features = new Set();
		for ( const file of ctx.files ) {
			if (
				! file.startsWith( 'features/' ) ||
				! file.endsWith( '.php' ) ||
				isTestPath( file )
			) {
				continue;
			}
			if ( new RegExp( `\\b${ klass }\\b` ).test( ctx.read( file ) ) ) {
				features.add( file.split( '/' )[ 1 ] );
			}
		}
		return features;
	};

	return compartilhadas
		.map( ( [ klass, { file } ] ) => ( { klass, file, features: consumidores( klass ) } ) )
		.filter( ( { features } ) => features.size < 2 )
		.map( ( { klass, file, features } ) => ( {
			key: `${ file } → ${ features.size }-consumidor(es)`,
			file,
			line: 1,
			message: `${ klass } está em shared/ com ${ features.size } feature(s) consumidora(s); shared/ é para o segundo consumidor real, não para o primeiro (ADR-0004)`,
		} ) );
}

module.exports = { id: 'shared-two-consumers', adr: '0004', check };
```

- [ ] **Step 5: Registrar, rodar e verificar**

Run: `npm run test:unit -- scripts/lint-arch/tests/rules-layout.test.js` → PASS.

Run: `npm run lint:arch`
Esperado: exit 1, com **quatro** problemas de "regra não existe" e **nenhuma** violação — o desvio de `format-time.ts` já está listado na ADR-0004, então passa. Se ele aparecer como violação, a chave da ADR e a chave do `Finding` divergem: acerte a ADR, nunca a chave da regra.

- [ ] **Step 6: Commit**

```bash
git add scripts/lint-arch/
git commit -m "feat(lint-arch): enforce the feature layout and the two-consumer rule for shared/

post-voice.php is not counted as a consumer: the root file loads and registers
everything, so counting it would make any shared/ module look like it has one
more consumer than it does.

Claude-Session: https://claude.ai/code/session_01U2Uski78ozNPf1uBQXU95q"
```

---

### Task 15: `feature-deps` (ADR-0005)

**Files:**
- Create: `scripts/lint-arch/rules/feature-deps.js`
- Test: `scripts/lint-arch/tests/rule-feature-deps.test.js`
- Modify: `scripts/lint-arch/rules/index.js`

**Interfaces:**
- Consumes: `phpClassOwners` (Tarefa 11), `stripPhpComments`, `isTestPath` (Tarefa 9).
- Produces: as **onze chaves** que a ADR-0005 lista em `desvios:`. As duas listas têm de bater exatamente.

A regra mais importante do conjunto, e a que responde à pergunta que originou o trabalho.

Dois detalhes que decidem se ela funciona:

1. **PHP: comentários fora, strings dentro.** A aresta 6 é `array( 'Post_Voice_Post_Meta', 'auth_callback' )` — um callable em string. Descartar strings a faria sumir, e a lista de desvios teria dez entradas com uma aresta invisível.
2. **`shared/` nunca é aresta.** Uma classe cujo dono é `shared` atravessa fronteira por desenho (ADR-0004).

- [ ] **Step 1: Escrever o teste que falha**

`scripts/lint-arch/tests/rule-feature-deps.test.js`:

```js
const { createContext } = require( '../context' );
const regra = require( '../rules/feature-deps' );
const { loadAdrs } = require( '../adr' );

const PHP_BASE = {
	'features/narration/php/class-post-meta.php': '<?php\nclass Post_Voice_Post_Meta {}\n',
	'features/pronunciation/php/class-dictionary-store.php':
		'<?php\nclass Post_Voice_Dictionary_Store {}\n',
	'shared/php/class-settings-page.php': '<?php\nclass Post_Voice_Settings_Page {}\n',
};

const ctxPhp = ( extra ) => {
	const files = { ...PHP_BASE, ...extra };
	return createContext( { files: Object.keys( files ), read: ( f ) => files[ f ] } );
};

describe( 'feature-deps — PHP', () => {
	it( 'declara a ADR-0005', () => {
		expect( regra.adr ).toBe( '0005' );
		expect( regra.id ).toBe( 'feature-deps' );
	} );

	it( 'aceita referência à própria feature', () => {
		expect(
			regra.check(
				ctxPhp( {
					'features/narration/php/class-assets.php':
						'<?php\nPost_Voice_Post_Meta::get( 1 );\n',
				} )
			)
		).toEqual( [] );
	} );

	it( 'aceita referência a shared/', () => {
		expect(
			regra.check(
				ctxPhp( {
					'features/narration/php/class-assets.php':
						'<?php\nPost_Voice_Settings_Page::MENU_SLUG;\n',
				} )
			)
		).toEqual( [] );
	} );

	it( 'acusa referência a outra feature, com a chave sem número de linha', () => {
		const a = regra.check(
			ctxPhp( {
				'features/narration/php/class-assets.php':
					'<?php\n\nPost_Voice_Dictionary_Store::get_global();\n',
			} )
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].key ).toBe(
			'features/narration/php/class-assets.php → Post_Voice_Dictionary_Store'
		);
		expect( a[ 0 ].line ).toBe( 3 );
	} );

	it( 'pega callable em string — a aresta 6 do inventário', () => {
		const a = regra.check(
			ctxPhp( {
				'features/narration/php/class-assets.php':
					"<?php\narray( 'Post_Voice_Dictionary_Store', 'x' );\n",
			} )
		);
		expect( a ).toHaveLength( 1 );
	} );

	it( 'ignora menção em comentário', () => {
		expect(
			regra.check(
				ctxPhp( {
					'features/narration/php/class-assets.php':
						'<?php\n// ver Post_Voice_Dictionary_Store\n',
				} )
			)
		).toEqual( [] );
	} );

	it( 'ignora arquivos de teste', () => {
		expect(
			regra.check(
				ctxPhp( {
					'features/narration/tests/php/test-assets.php':
						'<?php\nPost_Voice_Dictionary_Store::get_global();\n',
				} )
			)
		).toEqual( [] );
	} );

	it( 'colapsa duas ocorrências da mesma classe no mesmo arquivo em uma chave', () => {
		const a = regra.check(
			ctxPhp( {
				'features/narration/php/class-assets.php':
					'<?php\nPost_Voice_Dictionary_Store::a();\nPost_Voice_Dictionary_Store::b();\n',
			} )
		);
		expect( a ).toHaveLength( 1 );
	} );
} );

describe( 'feature-deps — TypeScript', () => {
	const ctxTs = ( file, src ) => createContext( { files: [ file ], read: () => src } );

	it( 'aceita import dentro da própria feature', () => {
		expect(
			regra.check( ctxTs( 'features/narration/editor/a.ts', "import { x } from './b';\n" ) )
		).toEqual( [] );
	} );

	it( 'acusa import de outra feature', () => {
		const a = regra.check(
			ctxTs(
				'features/narration/editor/index.tsx',
				"import { DictionaryPanel } from '../../pronunciation/editor/dictionary-panel';\n"
			)
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].key ).toBe(
			'features/narration/editor/index.tsx → pronunciation/editor/dictionary-panel'
		);
	} );

	it( 'acusa import type também — o tipo acopla igual', () => {
		expect(
			regra.check(
				ctxTs(
					'features/narration/editor/index.tsx',
					"import type { DictionaryEntry } from '../../pronunciation/editor/dictionary-entry';\n"
				)
			)
		).toHaveLength( 1 );
	} );

	it( 'colapsa duas linhas que importam do mesmo módulo em uma chave', () => {
		const a = regra.check(
			ctxTs(
				'features/narration/editor/index.tsx',
				"import type { A } from '../../pronunciation/editor/dictionary-entry';\n" +
					"import { b } from '../../pronunciation/editor/dictionary-entry';\n"
			)
		);
		expect( a ).toHaveLength( 1 );
	} );
} );

describe( 'o repo de hoje', () => {
	it( 'acha exatamente as onze arestas', () => {
		expect( regra.check( createContext() ) ).toHaveLength( 11 );
	} );

	it( 'as onze chaves batem, uma a uma, com desvios: da ADR-0005', () => {
		const achadas = regra.check( createContext() ).map( ( f ) => f.key ).sort();
		const listadas = loadAdrs( 'docs/adr' ).find( ( a ) => a.id === '0005' ).desvios.sort();
		expect( achadas ).toEqual( listadas );
	} );
} );
```

O último teste é o que impede a ADR e a regra de divergirem. É deliberadamente redundante com o `lint:arch`: aqui a falha diz *qual* chave divergiu.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:unit -- scripts/lint-arch/tests/rule-feature-deps.test.js` → FAIL.

- [ ] **Step 3: Implementar**

`scripts/lint-arch/rules/feature-deps.js`:

```js
'use strict';
const path = require( 'node:path' );
const { stripPhpComments, isTestPath } = require( '../context' );
const { phpClassOwners } = require( './php-class-naming' );

const CLASSE_RE = /\bPost_Voice_\w+\b/g;
const IMPORT_RE = /(?:from\s+|import\s+|require\s*\(\s*)['"](\.[^'"]+)['"]/g;
const TS_RE = /\.tsx?$/;

const featureDe = ( file ) => file.split( '/' )[ 1 ];

function arestasPhp( ctx ) {
	const donos = phpClassOwners( ctx );
	const achados = new Map();
	for ( const file of ctx.files ) {
		if ( ! file.startsWith( 'features/' ) || ! file.endsWith( '.php' ) || isTestPath( file ) ) {
			continue;
		}
		const propria = featureDe( file );
		// Comentários fora, strings dentro: `array( 'Post_Voice_Post_Meta', 'x' )`
		// é uma aresta de verdade e sumiria se as strings fossem descartadas.
		const source = stripPhpComments( ctx.read( file ) );
		CLASSE_RE.lastIndex = 0;
		let m;
		while ( ( m = CLASSE_RE.exec( source ) ) !== null ) {
			const dono = donos.get( m[ 0 ] );
			if ( ! dono || dono.feature === propria || dono.feature === 'shared' ) {
				continue;
			}
			const key = `${ file } → ${ m[ 0 ] }`;
			if ( achados.has( key ) ) {
				continue;
			}
			achados.set( key, {
				key,
				file,
				line: source.slice( 0, m.index ).split( '\n' ).length,
				message: `referencia ${ m[ 0 ] }, que pertence à feature "${ dono.feature }" (ADR-0005)`,
			} );
		}
	}
	return [ ...achados.values() ];
}

function arestasTs( ctx ) {
	const achados = new Map();
	for ( const file of ctx.files ) {
		if ( ! file.startsWith( 'features/' ) || ! TS_RE.test( file ) || isTestPath( file ) ) {
			continue;
		}
		const propria = featureDe( file );
		const source = ctx.read( file );
		IMPORT_RE.lastIndex = 0;
		let m;
		while ( ( m = IMPORT_RE.exec( source ) ) !== null ) {
			const alvo = path.posix.normalize( path.posix.join( path.posix.dirname( file ), m[ 1 ] ) );
			if ( ! alvo.startsWith( 'features/' ) || featureDe( alvo ) === propria ) {
				continue;
			}
			// A chave omite o prefixo `features/` do alvo: é a forma que a ADR-0005
			// registra, e a que se lê como "feature → módulo".
			const key = `${ file } → ${ alvo.slice( 'features/'.length ) }`;
			if ( achados.has( key ) ) {
				continue;
			}
			achados.set( key, {
				key,
				file,
				line: source.slice( 0, m.index ).split( '\n' ).length,
				message: `importa de "${ featureDe( alvo ) }", outra feature (ADR-0005)`,
			} );
		}
	}
	return [ ...achados.values() ];
}

module.exports = {
	id: 'feature-deps',
	adr: '0005',
	check: ( ctx ) => [ ...arestasPhp( ctx ), ...arestasTs( ctx ) ],
	arestasPhp,
	arestasTs,
};
```

- [ ] **Step 4: Registrar, rodar e verificar**

Run: `npm run test:unit -- scripts/lint-arch/tests/rule-feature-deps.test.js`
Esperado: PASS, inclusive o teste que compara as onze chaves com `desvios:` da ADR-0005.

Se as chaves divergirem: **a fonte da verdade é o que a regra mede.** Corrija as entradas de `desvios:` na ADR-0005 para casarem, e nunca o contrário — inventar uma chave na regra para casar com o texto é escrever a medição de trás para frente.

Run: `npm run lint:arch`
Esperado: exit 1, com **três** problemas de "regra não existe" (`no-untyped-editor-code`, `contract-pins`, `no-npm-install`) e **nenhuma** violação nem aviso.

- [ ] **Step 5: Commit**

```bash
git add scripts/lint-arch/
git commit -m "feat(lint-arch): detect cross-feature edges in PHP and TypeScript

PHP comments are stripped but string bodies are kept: one of the eleven edges
is array( 'Post_Voice_Post_Meta', 'auth_callback' ), a callable written as a
string, which would vanish otherwise. shared/ is never an edge — crossing the
boundary is what it is for.

A test asserts the eleven measured keys equal ADR-0005's desvios: list one by
one, so a divergence names the key instead of just failing the lint.

Claude-Session: https://claude.ai/code/session_01U2Uski78ozNPf1uBQXU95q"
```

---

### Task 16: `no-untyped-editor-code` (ADR-0011)

**Files:**
- Create: `scripts/lint-arch/rules/no-untyped-editor-code.js`
- Test: `scripts/lint-arch/tests/rule-untyped-editor.test.js`
- Modify: `scripts/lint-arch/rules/index.js`

Baseline: **2** violações, ambas já listadas nos `desvios:` da ADR-0011. A chave é o caminho puro do arquivo, sem seta — é violação de existência, não de relação.

- [ ] **Step 1: Escrever o teste que falha**

```js
const { createContext } = require( '../context' );
const regra = require( '../rules/no-untyped-editor-code' );
const { loadAdrs } = require( '../adr' );

const com = ( files ) => createContext( { files, read: () => '' } );

describe( 'no-untyped-editor-code', () => {
	it( 'declara a ADR-0011', () => {
		expect( regra.adr ).toBe( '0011' );
	} );

	it.each( [
		'features/narration/editor/engine/pocket-tts.worker.js',
		'features/player-style/admin/index.js',
		'features/narration/frontend/player.js',
	] )( 'acusa %s', ( file ) => {
		const a = regra.check( com( [ file ] ) );
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].key ).toBe( file );
	} );

	it.each( [
		'features/narration/editor/index.tsx',
		'features/narration/php/class-assets.php',
		'features/narration/tests/js/segment.test.ts',
		'scripts/lint-arch/index.js',
		'jest.config.js',
	] )( 'aceita %s', ( file ) => {
		expect( regra.check( com( [ file ] ) ) ).toEqual( [] );
	} );

	it( 'o repo de hoje acusa os dois vendorizados, e eles batem com a ADR-0011', () => {
		const achadas = regra.check( createContext() ).map( ( f ) => f.key ).sort();
		expect( achadas ).toHaveLength( 2 );
		expect( achadas ).toEqual(
			loadAdrs( 'docs/adr' ).find( ( a ) => a.id === '0011' ).desvios.sort()
		);
	} );
} );
```

- [ ] **Step 2: Rodar e ver falhar** → FAIL.

- [ ] **Step 3: Implementar**

```js
'use strict';
const { isTestPath } = require( '../context' );

// Só editor/, admin/ e frontend/: php/ é PHP e tests/ tem a sua própria regra.
const ALVO_RE = /^features\/[^/]+\/(?:editor|admin|frontend)\/.*\.jsx?$/;

function check( ctx ) {
	return ctx.files
		.filter( ( f ) => ALVO_RE.test( f ) && ! isTestPath( f ) )
		.map( ( file ) => ( {
			// Chave sem seta: aqui a violação é a existência do arquivo, não uma
			// relação entre dois lugares.
			key: file,
			file,
			line: 1,
			message:
				'JavaScript em diretório de editor/admin/frontend; esse código é TypeScript (ADR-0011)',
		} ) );
}

module.exports = { id: 'no-untyped-editor-code', adr: '0011', check };
```

- [ ] **Step 4: Registrar, rodar e verificar**

Run: `npm run test:unit -- scripts/lint-arch/tests/rule-untyped-editor.test.js` → PASS.
Run: `npm run lint:arch` → exit 1, **dois** problemas de "regra não existe", nenhuma violação.

- [ ] **Step 5: Commit**

```bash
git add scripts/lint-arch/
git commit -m "feat(lint-arch): keep editor, admin and frontend code TypeScript

The two vendored .js files are listed deviations on ADR-0011. This rule cannot
live in ESLint precisely because .eslintrc.js already ignores both of them.

Claude-Session: https://claude.ai/code/session_01U2Uski78ozNPf1uBQXU95q"
```

---

### Task 17: `contract-pins`, `no-npm-install`, e ligar o gate no CI (ADRs 0014, 0015)

**Files:**
- Create: `scripts/lint-arch/rules/contract-pins.js`
- Create: `scripts/lint-arch/rules/no-npm-install.js`
- Test: `scripts/lint-arch/tests/rules-pins.test.js`
- Modify: `scripts/lint-arch/rules/index.js`
- Modify: `.github/workflows/ci.yml` (job `lint`)

`contract-pins` confere **concordância**, nunca o valor. Fixar `6.6` na regra faria toda subida de mínimo exigir editar a regra; o que importa é que os cinco arquivos não divirjam. Idem para o SHA: a regra exige 40 hexadígitos, não aquele SHA.

- [ ] **Step 1: Escrever o teste que falha**

`scripts/lint-arch/tests/rules-pins.test.js`:

```js
const { createContext } = require( '../context' );
const pins = require( '../rules/contract-pins' );
const npmci = require( '../rules/no-npm-install' );

const REPO = {
	'post-voice.php': ' * Requires at least: 6.6\n * Requires PHP: 8.2\n',
	'readme.txt': 'Requires at least: 6.6\nRequires PHP: 8.2\n',
	'composer.json': '{ "require": { "php": ">=8.2" } }',
	'phpcs.xml.dist': '<config name="testVersion" value="8.2-"/>',
	'.wp-env.json': '{ "core": "WordPress/WordPress#6.6" }',
	'features/narration/editor/model-source.ts':
		"export const MODEL_BASE_URL =\n\t'https://huggingface.co/x/y/resolve/b18a05128c4f727ead5b23a643b65b93eaf8ee5d/';\n",
};

const com = ( over = {} ) => {
	const files = { ...REPO, ...over };
	return createContext( { files: Object.keys( files ), read: ( f ) => files[ f ] } );
};

describe( 'contract-pins', () => {
	it( 'declara a ADR-0014', () => {
		expect( pins.adr ).toBe( '0014' );
	} );

	it( 'aceita os cinco arquivos concordando', () => {
		expect( pins.check( com() ) ).toEqual( [] );
	} );

	it( 'acusa mínimo de WordPress divergente', () => {
		const a = pins.check( com( { 'readme.txt': 'Requires at least: 6.7\nRequires PHP: 8.2\n' } ) );
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /WordPress/ );
		expect( a[ 0 ].message ).toMatch( /6\.7/ );
	} );

	it( 'acusa mínimo de PHP divergente', () => {
		const a = pins.check( com( { 'composer.json': '{ "require": { "php": ">=8.3" } }' } ) );
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /PHP/ );
	} );

	it( 'acusa MODEL_BASE_URL apontando para uma ref móvel', () => {
		const a = pins.check( {
			...com( {
				'features/narration/editor/model-source.ts':
					"export const MODEL_BASE_URL =\n\t'https://huggingface.co/x/y/resolve/main/';\n",
			} ),
		} );
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /SHA/ );
	} );

	it( 'não fixa o valor: 6.7 em todos os cinco passa', () => {
		expect(
			pins.check(
				com( {
					'post-voice.php': ' * Requires at least: 6.7\n * Requires PHP: 8.2\n',
					'readme.txt': 'Requires at least: 6.7\nRequires PHP: 8.2\n',
					'.wp-env.json': '{ "core": "WordPress/WordPress#6.7" }',
				} )
			)
		).toEqual( [] );
	} );

	it( 'o repo de hoje concorda', () => {
		expect( pins.check( createContext() ) ).toEqual( [] );
	} );
} );

describe( 'no-npm-install', () => {
	it( 'declara a ADR-0015', () => {
		expect( npmci.adr ).toBe( '0015' );
	} );

	it( 'acusa npm install em workflow', () => {
		const a = npmci.check(
			createContext( { files: [ '.github/workflows/ci.yml' ], read: () => '      - run: npm install\n' } )
		);
		expect( a ).toHaveLength( 1 );
	} );

	it( 'acusa npm i abreviado', () => {
		expect(
			npmci.check(
				createContext( { files: [ 'scripts/x.sh' ], read: () => 'npm i --save-dev x\n' } )
			)
		).toHaveLength( 1 );
	} );

	it( 'aceita npm ci', () => {
		expect(
			npmci.check(
				createContext( { files: [ '.github/workflows/ci.yml' ], read: () => '      - run: npm ci\n' } )
			)
		).toEqual( [] );
	} );

	it( 'não varre a documentação, que fala sobre o comando', () => {
		expect(
			npmci.check( createContext( { files: [ 'CLAUDE.md' ], read: () => 'never `npm install`\n' } ) )
		).toEqual( [] );
	} );

	it( 'o repo de hoje não acusa nada', () => {
		expect( npmci.check( createContext() ) ).toEqual( [] );
	} );
} );
```

- [ ] **Step 2: Rodar e ver falhar** → FAIL.

- [ ] **Step 3: Implementar `contract-pins.js`**

```js
'use strict';

// Confere concordância, nunca o valor. Fixar "6.6" aqui faria toda subida de
// mínimo exigir editar a regra; o que a ADR-0014 protege é que os arquivos não
// divirjam, e que o modelo aponte para um commit e não para uma ref móvel.
const FONTES_WP = [
	{ file: 'post-voice.php', re: /Requires at least:\s*([\d.]+)/ },
	{ file: 'readme.txt', re: /Requires at least:\s*([\d.]+)/ },
	{ file: '.wp-env.json', re: /WordPress\/WordPress#([\d.]+)/ },
];

const FONTES_PHP = [
	{ file: 'post-voice.php', re: /Requires PHP:\s*([\d.]+)/ },
	{ file: 'readme.txt', re: /Requires PHP:\s*([\d.]+)/ },
	{ file: 'composer.json', re: /"php"\s*:\s*">=\s*([\d.]+)"/ },
	{ file: 'phpcs.xml.dist', re: /name="testVersion"\s+value="([\d.]+)-?"/ },
];

const MODEL_SOURCE = 'features/narration/editor/model-source.ts';

function concordam( ctx, fontes, rotulo ) {
	const lidos = fontes
		.filter( ( { file } ) => ctx.files.includes( file ) )
		.map( ( { file, re } ) => ( { file, valor: ( ctx.read( file ).match( re ) || [] )[ 1 ] } ) );

	const faltando = lidos.filter( ( l ) => ! l.valor );
	if ( faltando.length ) {
		return [
			{
				key: `${ faltando[ 0 ].file } → ${ rotulo }-ilegivel`,
				file: faltando[ 0 ].file,
				line: 1,
				message: `não foi possível ler o mínimo de ${ rotulo } neste arquivo (ADR-0014)`,
			},
		];
	}

	const distintos = [ ...new Set( lidos.map( ( l ) => l.valor ) ) ];
	if ( distintos.length <= 1 ) {
		return [];
	}
	const detalhe = lidos.map( ( l ) => `${ l.file }=${ l.valor }` ).join( ', ' );
	return [
		{
			key: `pins → ${ rotulo }-divergente`,
			file: lidos[ 0 ].file,
			line: 1,
			message: `o mínimo de ${ rotulo } diverge entre os arquivos: ${ detalhe } (ADR-0014)`,
		},
	];
}

function check( ctx ) {
	const achados = [
		...concordam( ctx, FONTES_WP, 'WordPress' ),
		...concordam( ctx, FONTES_PHP, 'PHP' ),
	];

	if ( ctx.files.includes( MODEL_SOURCE ) ) {
		const url = ( ctx.read( MODEL_SOURCE ).match( /MODEL_BASE_URL\s*=\s*[\s\S]*?'([^']+)'/ ) ||
			[] )[ 1 ];
		if ( ! url || ! /\/resolve\/[0-9a-f]{40}\//.test( url ) ) {
			achados.push( {
				key: `${ MODEL_SOURCE } → model-base-url`,
				file: MODEL_SOURCE,
				line: 1,
				message:
					'MODEL_BASE_URL tem de apontar para um SHA de commit de 40 hexadígitos, nunca para uma ref móvel como resolve/main (ADR-0014)',
			} );
		}
	}

	return achados;
}

module.exports = { id: 'contract-pins', adr: '0014', check };
```

- [ ] **Step 4: Implementar `no-npm-install.js`**

```js
'use strict';

// Só onde o comando de fato executa. Documentação fala sobre `npm install` para
// dizer para não usá-lo, e varrê-la acusaria o próprio CLAUDE.md.
const EXECUTAVEIS_RE = /^(?:package\.json|\.github\/workflows\/.*\.ya?ml|scripts\/.*\.(?:sh|mjs|js)|\.husky\/.*)$/;
const NPM_INSTALL_RE = /\bnpm\s+(?:install|i)\b(?!\s*-{0,2}(?:help|-version))/g;

function check( ctx ) {
	const achados = [];
	for ( const file of ctx.files.filter( ( f ) => EXECUTAVEIS_RE.test( f ) ) ) {
		const source = ctx.read( file );
		NPM_INSTALL_RE.lastIndex = 0;
		let m;
		while ( ( m = NPM_INSTALL_RE.exec( source ) ) !== null ) {
			achados.push( {
				key: `${ file } → npm-install`,
				file,
				line: source.slice( 0, m.index ).split( '\n' ).length,
				message:
					'use `npm ci`: `npm install` reescreve o lockfile, e o lockfile é a superfície que `npm audit` audita (ADR-0015)',
			} );
		}
	}
	return achados;
}

module.exports = { id: 'no-npm-install', adr: '0015', check };
```

- [ ] **Step 5: Registrar as duas e rodar o lint inteiro**

Run: `npm run test:unit -- scripts/lint-arch/tests/rules-pins.test.js` → PASS.

Run: `npm run lint:arch`
Esperado: **exit 0** e `lint:arch — nenhuma violação e nenhuma dívida quitada pendente.`

Este é o momento em que as 13 regras existem, nenhuma é órfã, nenhuma ADR declara regra inexistente e as treze violações reais estão listadas como desvios. **Se não estiver verde aqui, pare e apresente o achado** — não remova regra, não afrouxe padrão e não acrescente desvio que não tenha sido medido.

- [ ] **Step 6: Ligar no CI**

`.github/workflows/ci.yml`, job `lint`, logo depois de `- run: npm run lint:js`:

```yaml
      # Node puro, sem Docker e sem WordPress: as regras leem o repo versionado.
      # As ADRs em docs/adr/ são a configuração — ver docs/adr/README.md.
      - run: npm run lint:arch
```

- [ ] **Step 7: Rodar a bateria de gates que este passo pode quebrar**

```bash
npm run lint:js
npx tsc --noEmit
npm run test:unit -- --coverage
```
Esperado: os três passam, e a cobertura global continua acima de 80%.

- [ ] **Step 8: Commit**

```bash
git add scripts/lint-arch/ .github/workflows/ci.yml
git commit -m "feat(lint-arch): check contract pins and npm ci, then gate CI on lint:arch

contract-pins asserts agreement, never a value: pinning 6.6 into the rule would
make every minimum bump require editing the rule, while what ADR-0014 protects
is that the five files never disagree and that the model URL names a commit
rather than a moving ref.

lint:arch joins the lint job now that all thirteen rules exist and the repo is
green under them.

Claude-Session: https://claude.ai/code/session_01U2Uski78ozNPf1uBQXU95q"
```

---

### Task 18: `scripts/doctor.mjs`

**Files:**
- Create: `scripts/doctor.mjs`
- Create: `scripts/lint-arch/health.js` (as verificações puras)
- Test: `scripts/lint-arch/tests/health.test.js`
- Modify: `package.json` (script `doctor`)

**Interfaces:**
- Produces, de `health.js`:
  - `checkClaudeMdSize( source, teto = 80 ): Problem[]`
  - `checkAdrCitations( source, secoes, adrIds ): Problem[]` — bullets que não citam `(ADR-NNNN)`, ou citam uma ADR inexistente
  - `checkRulePaths( rules, files ): Problem[]` — glob morto e glob largo demais
  - `checkIndex( adrs, readme ): Problem[]`
  - `checkAdrHygiene( adrs, files ): Problem[]` — acima de 120 linhas, `origem` inexistente
  - `parseRulePaths( source ): string[]` e `globToRegExp( glob ): RegExp`

`health.js` é CommonJS e testável; `doctor.mjs` é a casca ESM que lê o disco, imprime e **sempre sai com código 0**. Nunca bloqueia, nunca é commitado como gate.

O `doctor` não avalia `revisar_quando`: é uma condição em prosa. Ele **imprime** todas elas junto do número que a condição menciona quando esse número é estrutural (quantidade de features, de módulos em `shared/`, de desvios), para que o humano julgue.

- [ ] **Step 1: Escrever o teste que falha**

`scripts/lint-arch/tests/health.test.js`:

```js
const {
	checkClaudeMdSize,
	checkAdrCitations,
	checkRulePaths,
	checkIndex,
	checkAdrHygiene,
	globToRegExp,
	parseRulePaths,
} = require( '../health' );

describe( 'checkClaudeMdSize', () => {
	it( 'aceita arquivo dentro do teto', () => {
		expect( checkClaudeMdSize( 'a\n'.repeat( 60 ), 80 ) ).toEqual( [] );
	} );

	it( 'acusa acima do teto e nomeia a maior seção', () => {
		const src = '## Conventions\n' + 'x\n'.repeat( 90 ) + '## Never\n- a\n';
		const a = checkClaudeMdSize( src, 80 );
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /## Conventions/ );
		expect( a[ 0 ].message ).toMatch( /80/ );
	} );
} );

describe( 'checkAdrCitations', () => {
	const ids = new Set( [ '0004', '0005' ] );

	it( 'aceita bullet que cita ADR existente', () => {
		expect(
			checkAdrCitations( '## Conventions\n- Layout is feature-based (ADR-0004).\n', [ 'Conventions' ], ids )
		).toEqual( [] );
	} );

	it( 'acusa bullet sem citação', () => {
		expect(
			checkAdrCitations( '## Conventions\n- Layout is feature-based.\n', [ 'Conventions' ], ids )
		).toHaveLength( 1 );
	} );

	it( 'acusa citação de ADR inexistente', () => {
		const a = checkAdrCitations( '## Conventions\n- x (ADR-0099).\n', [ 'Conventions' ], ids );
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /0099/ );
	} );

	it( 'ignora seções que não são de decisão', () => {
		expect(
			checkAdrCitations(
				'## Gotchas\n- opcache serves a stale copy.\n',
				[ 'Conventions', 'Never' ],
				ids
			)
		).toEqual( [] );
	} );

	it( 'com lista de seções vazia, verifica o arquivo inteiro — é o caso das rules', () => {
		expect( checkAdrCitations( '- Prefixo Post_Voice_.\n', [], ids ) ).toHaveLength( 1 );
	} );

	it( 'não lê os itens de paths: do front-matter como bullets de convenção', () => {
		const rule = '---\npaths:\n  - "features/**/php/**/*.php"\n---\n\n- Prefixo (ADR-0004).\n';
		expect( checkAdrCitations( rule, [], ids ) ).toEqual( [] );
	} );
} );

describe( 'globToRegExp', () => {
	it.each( [
		[ 'features/**/php/**/*.php', 'features/narration/php/class-a.php', true ],
		[ 'features/**/php/**/*.php', 'features/narration/editor/a.ts', false ],
		[ '**/class-rest-api.php', 'features/narration/php/class-rest-api.php', true ],
		[ 'features/**/editor/**/*.{ts,tsx}', 'features/narration/editor/index.tsx', true ],
		[ 'features/**/editor/**/*.{ts,tsx}', 'features/narration/editor/a.js', false ],
		[ 'docs/adr/**/*.md', 'docs/adr/0001-x.md', true ],
	] )( '%s ~ %s → %s', ( glob, file, esperado ) => {
		expect( globToRegExp( glob ).test( file ) ).toBe( esperado );
	} );
} );

describe( 'checkRulePaths', () => {
	const files = [ 'features/a/php/x.php', 'docs/adr/0001-x.md', 'README.md' ];

	it( 'aceita glob que casa com parte do repo', () => {
		expect(
			checkRulePaths( [ { file: '.claude/rules/php.md', paths: [ 'features/**/php/**/*.php' ] } ], files )
		).toEqual( [] );
	} );

	it( 'acusa glob morto', () => {
		const a = checkRulePaths( [ { file: '.claude/rules/x.md', paths: [ 'src/**/*.rb' ] } ], files );
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /nenhum arquivo/ );
	} );

	it( 'acusa glob que casa com mais de 60% do repo', () => {
		const a = checkRulePaths( [ { file: '.claude/rules/x.md', paths: [ '**/*' ] } ], files );
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /60%/ );
	} );

	it( 'acusa rule sem paths', () => {
		const a = checkRulePaths( [ { file: '.claude/rules/x.md', paths: [] } ], files );
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /sem paths/ );
	} );
} );

describe( 'parseRulePaths', () => {
	it( 'lê o front-matter de uma rule', () => {
		expect(
			parseRulePaths( '---\npaths:\n  - "features/**/*.php"\n  - "shared/**/*.php"\n---\n\n- x\n' )
		).toEqual( [ 'features/**/*.php', 'shared/**/*.php' ] );
	} );

	it( 'devolve [] quando não há front-matter', () => {
		expect( parseRulePaths( '- x\n' ) ).toEqual( [] );
	} );
} );

describe( 'checkIndex', () => {
	it( 'acusa ADR ausente do índice', () => {
		const a = checkIndex(
			[ { id: '0001', file: 'docs/adr/0001-a.md' }, { id: '0002', file: 'docs/adr/0002-b.md' } ],
			'| [0001](0001-a.md) | ... |\n'
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /0002/ );
	} );
} );

describe( 'checkAdrHygiene', () => {
	it( 'acusa ADR acima de 120 linhas', () => {
		const a = checkAdrHygiene(
			[ { id: '0001', file: 'docs/adr/0001-a.md', linhas: 140, origem: 'superpowers/specs/x.md' } ],
			[ 'docs/superpowers/specs/x.md' ]
		);
		expect( a.some( ( p ) => /120/.test( p.message ) ) ).toBe( true );
	} );

	it( 'acusa origem que não existe', () => {
		const a = checkAdrHygiene(
			[ { id: '0001', file: 'docs/adr/0001-a.md', linhas: 50, origem: 'superpowers/specs/sumiu.md#x' } ],
			[ 'docs/superpowers/specs/outro.md' ]
		);
		expect( a.some( ( p ) => /origem/.test( p.message ) ) ).toBe( true );
	} );
} );
```

- [ ] **Step 2: Rodar e ver falhar** → FAIL.

- [ ] **Step 3: Implementar `scripts/lint-arch/health.js`**

```js
'use strict';
// Verificações heurísticas do `doctor`. Puras, para serem testáveis; o
// doctor.mjs é só a casca que lê o disco e imprime. Nada aqui bloqueia.

const CITACAO_RE = /\(ADR-(\d{4})\)/g;
const LIMITE_ABRANGENCIA = 0.6;

function secoes( source ) {
	const out = new Map();
	let atual = null;
	for ( const line of source.split( '\n' ) ) {
		const h = line.match( /^##\s+(.*)$/ );
		if ( h ) {
			atual = h[ 1 ].trim();
			out.set( atual, [] );
		} else if ( atual ) {
			out.get( atual ).push( line );
		}
	}
	return out;
}

function checkClaudeMdSize( source, teto = 80 ) {
	const linhas = source.split( '\n' ).length;
	if ( linhas <= teto ) {
		return [];
	}
	const maior = [ ...secoes( source ).entries() ].sort(
		( a, b ) => b[ 1 ].length - a[ 1 ].length
	)[ 0 ];
	const alvo = maior ? `A maior seção é "## ${ maior[ 0 ] }", com ${ maior[ 1 ].length } linhas.` : '';
	return [
		{
			message: `CLAUDE.md tem ${ linhas } linhas, acima do teto de ${ teto }. ${ alvo } Convenção com escopo de caminho vai para .claude/rules/ (ADR-0001).`,
		},
	];
}

/**
 * @param {string}   source
 * @param {string[]} nomes  seções a verificar; lista vazia = arquivo inteiro
 * @param {Set}      adrIds ids existentes
 * @return {Object[]} problemas
 */
function checkAdrCitations( source, nomes, adrIds ) {
	// Sem lista de seções, o alvo é o arquivo inteiro — mas sem o front-matter:
	// cada item de `paths:` começa com "- " e seria lido como bullet de convenção.
	const corpo = source.replace( /^---\r?\n[\s\S]*?\r?\n---\r?\n/, '' );
	const blocos = nomes.length
		? nomes.map( ( n ) => ( secoes( source ).get( n ) || [] ).join( '\n' ) )
		: [ corpo ];
	const problemas = [];
	for ( const bloco of blocos ) {
		for ( const line of bloco.split( '\n' ) ) {
			if ( ! /^\s*-\s+\S/.test( line ) ) {
				continue;
			}
			CITACAO_RE.lastIndex = 0;
			const citadas = [ ...line.matchAll( CITACAO_RE ) ].map( ( m ) => m[ 1 ] );
			if ( ! citadas.length ) {
				problemas.push( {
					message: `linha de convenção sem citação de ADR: "${ line.trim() }". O formato é (ADR-NNNN).`,
				} );
				continue;
			}
			for ( const id of citadas ) {
				if ( ! adrIds.has( id ) ) {
					problemas.push( {
						message: `cita ADR-${ id }, que não existe em docs/adr/: "${ line.trim() }"`,
					} );
				}
			}
		}
	}
	return problemas;
}

/**
 * Glob → RegExp. Subconjunto: `**`, `*`, `?` e `{a,b}`.
 *
 * @param {string} glob
 * @return {RegExp} âncorada
 */
function globToRegExp( glob ) {
	let out = '';
	for ( let i = 0; i < glob.length; i += 1 ) {
		const c = glob[ i ];
		if ( c === '*' ) {
			if ( glob[ i + 1 ] === '*' ) {
				// `**/` casa com zero ou mais segmentos; `**` sozinho casa com tudo.
				if ( glob[ i + 2 ] === '/' ) {
					out += '(?:[^/]+/)*';
					i += 2;
				} else {
					out += '.*';
					i += 1;
				}
			} else {
				out += '[^/]*';
			}
		} else if ( c === '?' ) {
			out += '[^/]';
		} else if ( c === '{' ) {
			const fim = glob.indexOf( '}', i );
			out += '(?:' + glob.slice( i + 1, fim ).split( ',' ).map( ( s ) => s.replace( /[.+^${}()|[\]\\]/g, '\\$&' ) ).join( '|' ) + ')';
			i = fim;
		} else {
			out += c.replace( /[.+^${}()|[\]\\]/g, '\\$&' );
		}
	}
	return new RegExp( `^${ out }$` );
}

function parseRulePaths( source ) {
	const fm = source.match( /^---\r?\n([\s\S]*?)\r?\n---/ );
	if ( ! fm ) {
		return [];
	}
	const bloco = fm[ 1 ].match( /paths:\s*\n((?:\s+-\s+.*\n?)+)/ );
	if ( ! bloco ) {
		return [];
	}
	return bloco[ 1 ]
		.split( '\n' )
		.map( ( l ) => ( l.match( /^\s+-\s+["']?(.+?)["']?\s*$/ ) || [] )[ 1 ] )
		.filter( Boolean );
}

/**
 * Glob morto nunca carrega; glob largo demais é CLAUDE.md com passos extras.
 *
 * @param {Object[]} rules { file, paths }
 * @param {string[]} files arquivos versionados
 * @return {Object[]} problemas
 */
function checkRulePaths( rules, files ) {
	const problemas = [];
	for ( const { file, paths } of rules ) {
		if ( ! paths.length ) {
			problemas.push( {
				message: `${ file } não declara paths:. Rule sem paths carrega em toda sessão, com o mesmo custo do CLAUDE.md.`,
			} );
			continue;
		}
		const res = paths.map( globToRegExp );
		const casados = files.filter( ( f ) => res.some( ( re ) => re.test( f ) ) ).length;
		if ( casados === 0 ) {
			problemas.push( {
				message: `${ file }: paths: não casa com nenhum arquivo versionado. Glob morto — a rule nunca carrega.`,
			} );
		} else if ( casados / files.length > LIMITE_ABRANGENCIA ) {
			const pct = Math.round( ( casados / files.length ) * 100 );
			problemas.push( {
				message: `${ file }: paths: casa com ${ pct }% dos arquivos, acima de 60%. Uma rule que sempre carrega é CLAUDE.md com passos extras.`,
			} );
		}
	}
	return problemas;
}

function checkIndex( adrs, readme ) {
	return adrs
		.filter( ( a ) => ! readme.includes( a.file.split( '/' ).pop() ) )
		.map( ( a ) => ( {
			message: `ADR-${ a.id } não aparece no índice docs/adr/README.md.`,
		} ) );
}

function checkAdrHygiene( adrs, files ) {
	const problemas = [];
	for ( const adr of adrs ) {
		if ( adr.linhas > 120 ) {
			problemas.push( {
				message: `ADR-${ adr.id } tem ${ adr.linhas } linhas, acima do teto de 120. Virou spec disfarçada?`,
			} );
		}
		// `origem` é um caminho relativo a docs/, então a checagem é de existência
		// exata. Casar por sufixo aceitaria qualquer `.../specs/x.md` — frouxo
		// demais para a única verificação que a ADR-0001 declara sobre si mesma.
		const alvo = 'docs/' + adr.origem.split( '#' )[ 0 ];
		if ( ! files.includes( alvo ) ) {
			problemas.push( {
				message: `ADR-${ adr.id }: origem "${ adr.origem }" não aponta para nenhum arquivo existente.`,
			} );
		}
	}
	return problemas;
}

module.exports = {
	checkClaudeMdSize,
	checkAdrCitations,
	checkRulePaths,
	checkIndex,
	checkAdrHygiene,
	globToRegExp,
	parseRulePaths,
	secoes,
};
```

- [ ] **Step 4: Implementar `scripts/doctor.mjs`**

```js
#!/usr/bin/env node
// Relatório de saúde do projeto. Heurístico: reporta, nunca bloqueia, e sempre
// sai com código 0. Regra nova nasce aqui e só sobe para lint:arch depois de
// provar que não produz falso positivo. Ver ADR-0001.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire( import.meta.url );
const { loadAdrs } = require( './lint-arch/adr.js' );
const { createContext } = require( './lint-arch/context.js' );
const { run, format } = require( './lint-arch/index.js' );
const regras = require( './lint-arch/rules/index.js' );
const health = require( './lint-arch/health.js' );

const root = process.cwd();
const ler = ( rel ) => {
	try {
		return fs.readFileSync( path.join( root, rel ), 'utf8' );
	} catch {
		return '';
	}
};

const secao = ( titulo, linhas ) => {
	process.stdout.write( `\n── ${ titulo } ${ '─'.repeat( Math.max( 0, 58 - titulo.length ) ) }\n` );
	if ( ! linhas.length ) {
		process.stdout.write( '   nada a relatar\n' );
		return;
	}
	for ( const l of linhas ) {
		process.stdout.write( `   ${ l }\n` );
	}
};

const adrs = loadAdrs( path.join( root, 'docs/adr' ) );
const ctx = createContext( { root } );
const adrIds = new Set( adrs.map( ( a ) => a.id ) );

// 1. lint:arch em modo relatório: os desvios listados aparecem como dívida.
const lint = run( { adrs, registry: regras, ctx } );
secao( 'lint:arch', format( lint ).split( '\n' ) );

const dividas = adrs.flatMap( ( a ) =>
	a.desvios.map( ( d ) => `ADR-${ a.id }: ${ d }` )
);
secao( `dívida congelada (${ dividas.length })`, dividas );

// 2. ADRs: status, higiene, índice.
const porStatus = adrs.reduce( ( acc, a ) => {
	acc[ a.status ] = ( acc[ a.status ] || 0 ) + 1;
	return acc;
}, {} );
secao(
	`ADRs (${ adrs.length })`,
	Object.entries( porStatus ).map( ( [ s, n ] ) => `${ n } ${ s }` )
);
secao( 'higiene das ADRs', [
	...health.checkAdrHygiene( adrs, ctx.files ),
	...health.checkIndex( adrs, ler( 'docs/adr/README.md' ) ),
].map( ( p ) => p.message ) );

// 3. revisar_quando: condição em prosa, impressa junto dos números estruturais
//    que ela costuma mencionar. Quem julga é o humano.
const features = new Set(
	ctx.files.filter( ( f ) => f.startsWith( 'features/' ) ).map( ( f ) => f.split( '/' )[ 1 ] )
);
const sharedModulos = ctx.files.filter( ( f ) => /^shared\/php\/class-.*\.php$/.test( f ) ).length;
secao( 'gatilhos de revisão', [
	`features hoje: ${ features.size } (${ [ ...features ].sort().join( ', ' ) })`,
	`módulos em shared/: ${ sharedModulos }`,
	'',
	...adrs.filter( ( a ) => a.revisarQuando ).map( ( a ) => `ADR-${ a.id }: ${ a.revisarQuando }` ),
] );

// 4. CLAUDE.md e as rules.
const claudeMd = ler( 'CLAUDE.md' );
const rulesDir = path.join( root, '.claude/rules' );
const rules = fs.existsSync( rulesDir )
	? fs
			.readdirSync( rulesDir )
			.filter( ( f ) => f.endsWith( '.md' ) )
			.map( ( f ) => ( {
				file: `.claude/rules/${ f }`,
				source: ler( `.claude/rules/${ f }` ),
			} ) )
			.map( ( r ) => ( { ...r, paths: health.parseRulePaths( r.source ) } ) )
	: [];

secao( 'CLAUDE.md e rules', [
	...health.checkClaudeMdSize( claudeMd, 80 ),
	...health.checkAdrCitations( claudeMd, [ 'Conventions', 'Never' ], adrIds ),
	...rules.flatMap( ( r ) => health.checkAdrCitations( r.source, [], adrIds ) ),
	...health.checkRulePaths( rules, ctx.files ),
].map( ( p ) => p.message ) );

// 5. Tamanho de arquivo acima do p95: sinal relativo de "faz coisa demais",
//    sem limiar arbitrário.
const tamanhos = ctx.files
	.filter( ( f ) => /\.(?:php|ts|tsx|js)$/.test( f ) && ! f.startsWith( 'features/narration/editor/engine/' ) )
	.map( ( f ) => ( { f, n: ler( f ).split( '\n' ).length } ) )
	.sort( ( a, b ) => a.n - b.n );
const p95 = tamanhos.length ? tamanhos[ Math.floor( tamanhos.length * 0.95 ) ].n : 0;
secao(
	`arquivos acima do p95 (${ p95 } linhas)`,
	tamanhos.filter( ( t ) => t.n > p95 ).map( ( t ) => `${ t.n }\t${ t.f }` )
);

// 6. Dívida declarada e cobertura, quando houver relatório no disco.
const followUps = ( ler( 'docs/FOLLOW-UPS.md' ).match( /^##\s+/gm ) || [] ).length;
const cobertura = fs.existsSync( path.join( root, 'coverage/coverage-summary.json' ) )
	? `linhas (JS): ${
			JSON.parse( ler( 'coverage/coverage-summary.json' ) ).total.lines.pct
	  }%`
	: 'sem relatório recente no disco — rode `npm run test:unit -- --coverage`';
secao( 'outros', [ `FOLLOW-UPS.md: ${ followUps } item(ns)`, cobertura ] );

process.stdout.write( '\ndoctor: relatório, não gate. Nada aqui reprova um PR.\n' );
process.exit( 0 );
```

- [ ] **Step 5: Ligar o comando**

`package.json`, junto dos demais scripts:

```json
		"doctor": "node scripts/doctor.mjs",
```

- [ ] **Step 6: Rodar**

Run: `npm run test:unit -- scripts/lint-arch/tests/health.test.js` → PASS.

Run: `npm run doctor`
Esperado: exit **0**, com todas as seções impressas. Nesta altura ele acusa o `CLAUDE.md` — 113 linhas e bullets sem `(ADR-NNNN)` — e nenhuma rule, porque `.claude/rules/` ainda não existe. Correto: as Tarefas 20 e 21 zeram esses achados.

Run: `npm run lint:js` → passa (`.eslintrc.js` já cobre `scripts/**/*.{js,mjs}`).

- [ ] **Step 7: Commit**

```bash
git add scripts/doctor.mjs scripts/lint-arch/health.js scripts/lint-arch/tests/health.test.js package.json
git commit -m "feat(doctor): report project health without blocking

The checks live in health.js as pure functions so they can be tested; doctor.mjs
is the shell that reads disk, prints and always exits 0. It does not evaluate
revisar_quando — that is prose — but prints each condition next to the
structural number it tends to name, so a human can judge.

Claude-Session: https://claude.ai/code/session_01U2Uski78ozNPf1uBQXU95q"
```

---

### Task 19: A skill de projeto

**Files:**
- Create: `.claude/skills/adr/SKILL.md`

**Interfaces:**
- Consumes: o critério de admissão da ADR-0001.
- Produces: nada em código.

Versionada no repo, para valer para qualquer sessão. Dispara ao fechar um brainstorming, ao escrever um spec, durante o code review, ou sempre que "decidimos X" aparecer.

- [ ] **Step 1: Escrever o arquivo**

Front-matter obrigatório: `name: adr` e uma `description` que diga **quando** disparar (é o que o modelo lê para decidir invocar), não o que a skill faz.

Conteúdo, nesta ordem:

1. **Os dois testes de admissão**, literais da ADR-0001, e a tabela do que **não** vira ADR.
2. **A regra da restrição versus o valor**, com o exemplo do MP3.
3. **Onde a decisão mora**, com a tabela por custo de esquecer: `CLAUDE.md` (catastrófico e irreversível) / `.claude/rules/*.md` com `paths` (um ciclo de review) / só ADR mais regra (o `lint:arch` pega).
4. **Como escrever**: copiar `TEMPLATE.md`, alvo de 40 a 80 linhas, `revisar_quando` é condição e nunca data, `desvios:` sem número de linha.
5. **Se a ADR é enforcável**, escrever a regra em `scripts/lint-arch/rules/` no mesmo PR, com fixtures nos dois sentidos. Sem fixture, sem regra.
6. **Checklist de code review**: rodar `npm run lint:arch` e `npm run doctor`; ler `docs/adr/README.md`; perguntar *"esta mudança contém uma decisão que ficou sem ADR?"*; e, quando o diff toca `features/`, *"isto cria aresta cross-feature nova?"*.
7. **Como uma ADR muda**: a tabela de quem pode mudar o quê. Mudou de ideia → ADR nova, e a antiga vira `superada-por-NNNN`. Nunca reescrever Contexto, Decisão, Consequências ou Alternativas.
8. **A regra de crescimento**: ADR nova não toca o `CLAUDE.md`.

- [ ] **Step 2: Verificar que a skill é descoberta**

```bash
ls .claude/skills/adr/SKILL.md
head -5 .claude/skills/adr/SKILL.md
```
Esperado: front-matter com `name:` e `description:` nas primeiras linhas.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/adr/
git commit -m "feat(skills): add the project ADR skill

Claude-Session: https://claude.ai/code/session_01U2Uski78ozNPf1uBQXU95q"
```

---

### Task 20: `.claude/rules/*.md` — as convenções path-scoped

**Files:**
- Create: `.claude/rules/php.md`, `rest.md`, `editor.md`, `tests.md`, `adr.md`

**Interfaces:**
- Consumes: os ids de ADR das Tarefas 4, 5, 6 e 8.
- Produces: as linhas que a Tarefa 21 **remove** do `CLAUDE.md`.

Regras do formato, todas verificadas pelo `doctor` da Tarefa 18:

- Todo bullet cita ao menos uma ADR existente, em `(ADR-NNNN)`.
- `paths` tem de casar com pelo menos um arquivo versionado, e com **menos de 60%** deles.
- Uma imperativa por bullet. **Nunca duplicar o corpo da ADR** — duplicação é a divergência que este trabalho existe para eliminar.

- [ ] **Step 1: `.claude/rules/php.md`**

```markdown
---
paths:
  - "features/**/php/**/*.php"
  - "shared/php/**/*.php"
  - "post-voice.php"
---

# PHP

- Prefixo `Post_Voice_`, uma classe por arquivo, `class-<algo>.php` derivado do nome da classe, carregada por `require_once` em `post-voice.php` (ADR-0006).
- Uma feature nunca referencia classe de outra feature; `shared/` é a fronteira, e só a partir do segundo consumidor real (ADR-0004, ADR-0005).
- O servidor não sintetiza fala, não transcodifica áudio e não recomputa hash de conteúdo nem seleção de blocos — tudo isso é do cliente (ADR-0002, ADR-0008, ADR-0009).
- Toda string visível ao usuário passa por gettext com o domínio `post-voice`; regenere o `.pot` com `npm run i18n:pot` quando strings mudarem (ADR-0010).
- Classe de teste PHPUnit declara `@covers` (ADR-0013).
```

- [ ] **Step 2: `.claude/rules/rest.md`**

```markdown
---
paths:
  - "**/class-rest-api.php"
---

# REST

- Namespace `post-voice/v1`, sempre (ADR-0007).
- Todo valor que o endpoint aceita é validado no servidor **mesmo quando a UI já o restringe**: um controle desabilitado é UX, não garantia (ADR-0007).
- O `source_hash` chega pronto do cliente; o servidor guarda e compara, nunca recalcula (ADR-0008).
```

- [ ] **Step 3: `.claude/rules/editor.md`**

```markdown
---
paths:
  - "features/**/editor/**/*.{ts,tsx}"
  - "features/**/admin/**/*.{ts,tsx}"
  - "features/**/frontend/**/*.{ts,tsx}"
---

# Editor, admin e frontend

- TypeScript, não JavaScript. Os dois `.js` em `editor/engine/` são vendorizados e estão listados como desvio (ADR-0011).
- Nenhum import atravessa para outra feature; o que precisa ser compartilhado vai para `shared/`, a partir do segundo consumidor (ADR-0004, ADR-0005).
- Toda a síntese acontece aqui, num Web Worker: o PHP só recebe o áudio pronto (ADR-0002).
- O áudio é comprimido antes do upload (ADR-0009).
- Strings de UI passam por gettext com o domínio `post-voice`. A exceção deliberada é `SAMPLE_TEXTS` em `voice-catalog.ts`, que alimenta o modelo de fala e segue o idioma do bundle, não o locale do admin (ADR-0010).
```

- [ ] **Step 4: `.claude/rules/tests.md`**

```markdown
---
paths:
  - "features/**/tests/**"
  - "e2e/**"
  - "**/*.test.ts"
---

# Testes

- TypeScript puro vai para Jest; o que envolve Worker, ONNX ou navegador real vai para E2E (ADR-0012).
- Antes de criar cenário E2E, pergunte se ele estaria só fixando a saída de uma função pura. Se estiver, extraia a função para um módulo próprio e escreva Jest — `tokenizer-sanitize.ts` é o precedente (ADR-0012).
- `e2e/segment-pipeline-perf.spec.ts` continua E2E de propósito: o `DOMParser` do jsdom é ordens de grandeza mais lento e dava números não confiáveis. Está no cabeçalho do arquivo (ADR-0012).
- Classe de teste PHPUnit declara `@covers`; sem ela a cobertura credita colaboradores à classe sob teste (ADR-0013).
- Gates: 80% de linhas em JS, 85% em PHP. Nenhum dos dois desce para um PR passar (ADR-0013).
```

- [ ] **Step 5: `.claude/rules/adr.md`**

```markdown
---
paths:
  - "docs/adr/**/*.md"
---

# Escrevendo uma ADR

- Vira ADR só se **as duas** forem verdadeiras: orienta código ainda não escrito, e reverter custa mais que um PR (ADR-0001).
- Registre a restrição, nunca o valor: "o áudio é comprimido no cliente" é ADR; "MP3 64 kbps" é spec (ADR-0001).
- O front-matter é a configuração do `lint:arch`. `enforced_by` é sempre lista; `desvios:` usa `arquivo → alvo`, sem número de linha, que apodrece (ADR-0001).
- `revisar_quando` é uma condição observável, nunca uma data: data vira TODO morto (ADR-0001).
- Contexto, Decisão, Consequências e Alternativas não se editam. Mudou de ideia → ADR nova, e a antiga recebe `status: superada-por-NNNN` (ADR-0001).
- Alvo de 40 a 80 linhas, teto de 120. Acrescente a linha em `README.md` no mesmo commit (ADR-0001).
```

- [ ] **Step 6: Verificar**

Run: `npm run doctor`
Esperado: a seção "CLAUDE.md e rules" **não** acusa nenhuma rule — todo bullet cita ADR existente, todo `paths` casa com ≥1 arquivo e nenhum passa de 60%. O `CLAUDE.md` continua acusado (Tarefa 21).

Se um `paths` for acusado de glob morto, confira com:
```bash
node -e "
const { globToRegExp } = require('./scripts/lint-arch/health');
const { createContext } = require('./scripts/lint-arch/context');
const re = globToRegExp( process.argv[1] );
console.log( createContext().files.filter( f => re.test( f ) ).length );
" 'features/**/php/**/*.php'
```

- [ ] **Step 7: Commit**

```bash
git add .claude/rules/
git commit -m "docs(rules): scope the conventions to the paths they apply to

Each bullet is one imperative plus the ADR that carries the reasoning — never a
copy of the ADR body, since duplication is the divergence this work exists to
remove. Path-scoped so they load only when a matching file is read, instead of
in every session like CLAUDE.md.

Claude-Session: https://claude.ai/code/session_01U2Uski78ozNPf1uBQXU95q"
```

---

### Task 21: Reescrever o `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` (113 linhas hoje)
- Modify: `scripts/lint-arch/health.js` — escopo do check de citação

**Interfaces:**
- Consumes: as rules da Tarefa 20, os ids de ADR, o `doctor` da Tarefa 18.

**Refinação nº 3 sobre o spec, encontrada ao redigir o arquivo.** O spec manda o `doctor` exigir `(ADR-NNNN)` em todo bullet sob `## Conventions` **e** `## Never`. Duas das três linhas de `## Never` não são decisão de arquitetura — "não commite em `master`" e "não empurre o que o usuário não pediu" são regras de processo, e não existe ADR para elas nem deveria existir. Exigir citação ali produziria ou ruído permanente no relatório ou uma ADR inventada para calar o check.

Corrija o escopo: o check cobre **`## Conventions` do `CLAUDE.md` e os bullets de `.claude/rules/*.md`**. `## Never`, `## Before opening a pull request` e `## Gotchas…` ficam de fora, por serem processo e armadilha operacional. Ajuste também o critério de aceite 6 na sua leitura da tarefa.

- [ ] **Step 1: Corrigir o escopo do check em `health.js`**

Em `scripts/doctor.mjs`, a chamada passa a ser:

```js
	...health.checkAdrCitations( claudeMd, [ 'Conventions' ], adrIds ),
```

E em `scripts/lint-arch/tests/health.test.js`, acrescente:

```js
	it( 'não exige citação em ## Never — processo, não arquitetura', () => {
		expect(
			checkAdrCitations(
				'## Conventions\n- x (ADR-0004).\n## Never\n- Commit to master.\n',
				[ 'Conventions' ],
				ids
			)
		).toEqual( [] );
	} );
```

- [ ] **Step 2: Reescrever o `CLAUDE.md`**

O conteúdo completo está em `/tmp/claude-1000/…/scratchpad/claude-md-draft.md` se ainda existir; se não, reconstrua a partir do arquivo atual aplicando estas quatro transformações e **nada mais**:

1. **`docs/adr/README.md` entra no topo** dos "documents of record", com uma linha dizendo que é o que restringe código novo.
2. **Um parágrafo novo** logo abaixo da lista: *"Path-scoped conventions live in `.claude/rules/` and load when you open a file they cover. This file carries only what must never be forgotten."*
3. **`## Conventions` encolhe de 32 para 8 bullets**, cada um uma imperativa curta terminando em `(ADR-NNNN)`. Todo o detalhe — a árvore Jest-vs-E2E, a exceção do `SAMPLE_TEXTS`, a regra dos dois consumidores, o precedente do `tokenizer-sanitize.ts` — já vive nas rules da Tarefa 20 e nas ADRs. **Não copie o detalhe de volta.** O oitavo bullet é a regra de crescimento: *"A new ADR never touches this file."*
4. **`## Before opening a pull request` ganha duas linhas**: `npm run lint:arch` logo depois de `npm run lint:js` no bloco de comandos, e `npm run doctor` no passo 3, antes da skill de code review. A prosa dos passos 1 a 4 é condensada sem perder nenhuma das quatro proibições (não abrir PR, não desabilitar check, não baixar limiar, não abrir PR sem pedido).

`## Gotchas` e `## Never` ficam como estão. São armadilhas operacionais e proibições de processo, e nenhuma é derivável do código.

- [ ] **Step 3: Medir**

```bash
wc -l CLAUDE.md
npm run doctor
```

**Ponto de decisão do usuário.** O spec fixou o teto em 80 linhas estimando ~65 depois da migração. A estimativa foi feita antes do arquivo existir; a redação real com as quatro transformações acima cai em **~94 linhas**, e trimar até 80 exigiria remover conteúdo que ganha o seu lugar — os Gotchas, que não são path-scopáveis e não têm ADR por trás.

Se `wc -l` passar de 80, **pare e apresente ao usuário**, com estas três opções e a recomendação:

| Opção | Custo |
|---|---|
| **Subir o teto para 95** *(recomendada)* | O teto passa a refletir a medição em vez da estimativa. Ainda 105 linhas abaixo das 200 que a documentação do Claude Code marca como ponto de queda de aderência, e o que segura o crescimento é a regra "ADR nova não toca este arquivo", não o número |
| Mover os Gotchas para `.claude/rules/` | Ganha ~11 linhas, mas eles não citam ADR e passariam a violar o check de citação nas rules — trocaria um achado do relatório por outro |
| Cortar Gotchas ou proibições | Perde conteúdo que já custou uma sessão cada. Não recomendado |

**Decisão tomada na execução (2026-08-27):** teto de **95 linhas**. A estimativa de
80 foi feita antes de o arquivo existir; a redação real cai em ~94, e trimar até 80
exigiria remover os Gotchas, que custaram uma sessão cada e não são path-scopáveis.
95 continua 105 linhas abaixo das 200 onde a aderência cai, e o que segura o
crescimento é a regra "ADR nova não toca este arquivo", não o número. Use 95 em
`scripts/doctor.mjs` e registre a razão na emenda do spec (Tarefa 21, Step 5).

- [ ] **Step 4: Verificar**

Run: `npm run doctor`
Esperado: a seção "CLAUDE.md e rules" fica limpa — nenhum bullet de `## Conventions` sem `(ADR-NNNN)`, nenhuma citação de ADR inexistente, nenhuma rule com glob morto ou largo demais, e o tamanho dentro do teto acordado.

Run: `npm run lint:arch` → exit 0.
Run: `npm run test:unit -- scripts/lint-arch/` → PASS.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md scripts/doctor.mjs scripts/lint-arch/tests/health.test.js
git commit -m "docs: shrink CLAUDE.md to what must never be forgotten

The conventions moved to .claude/rules/*.md, which load only when a matching
file is read; what stays here is what a /compact must never drop. Each
remaining convention is one imperative citing the ADR that carries the
reasoning, and doctor verifies the citation.

The citation check covers ## Conventions and the rules files, not ## Never:
'do not commit to master' is process, not an architecture decision, and there
is no ADR behind it.

Claude-Session: https://claude.ai/code/session_01U2Uski78ozNPf1uBQXU95q"
```

---

### Task 22: Fechamento — CI local completo e code review

**Files:** nenhum, exceto o que os achados exigirem.

Esta é a tarefa que o `CLAUDE.md` obriga antes de qualquer PR. Nada aqui é opcional.

- [ ] **Step 1: Confirmar que nenhum código de produção foi tocado**

```bash
git diff --stat master...HEAD -- features/ shared/ post-voice.php
```
Esperado: **saída vazia.** É o critério de aceite 8. Se houver qualquer coisa, pare e reporte antes de seguir.

- [ ] **Step 2: Rodar a CI local inteira, na ordem do `CLAUDE.md`**

```bash
npx wp-env start
npm run lint:js
npm run lint:arch
npx tsc --noEmit
composer run lint
composer run stan
npm run test:unit -- --coverage
npm run test:php
npm run test:php:coverage
npm run i18n:check
npm run audit:npm:production && npm run audit:npm && npm run audit:composer
npm run build && npm run test:e2e
```

Esperado: todos verdes. Cobertura JS acima de 80%, PHP acima de 85%.

**Se algo falhar: pare e apresente planos de correção** — o que falhou com a saída real, a causa raiz estabelecida e não adivinhada, duas ou três formas de corrigir com custo e risco, e uma recomendação. Não desabilite check, não baixe limiar, não abra PR.

Dois pontos merecem atenção especial nesta rodada:

- `npm run i18n:check` — nenhuma string nova foi criada por este trabalho (o código de `scripts/` não usa gettext), então o `.pot` não deve ter mudado. Se acusar, investigue antes de regenerar.
- `npm run test:unit -- --coverage` — `scripts/lint-arch/**/*.js` entrou no `collectCoverageFrom` na Tarefa 3. O código é fortemente testado e deve **subir** a média; se derrubar abaixo de 80, o gate está certo e falta teste.

- [ ] **Step 3: Rodar o `doctor` e ler o relatório inteiro**

```bash
npm run doctor
```

Não é gate, mas é insumo do review. Confira em particular:

- a dívida congelada lista exatamente 14 desvios (11 da ADR-0005, 2 da ADR-0011, 1 da ADR-0004) e nenhum a mais;
- nenhum aviso de "dívida quitada" — se houver, um desvio listado deixou de valer e a entrada tem de sair da ADR;
- 15 ADRs, todas no índice, nenhuma acima de 120 linhas, nenhuma `origem` quebrada.

- [ ] **Step 4: Code review**

Invoque `superpowers:requesting-code-review`, que despacha um subagente revisor contra o diff da branch. Endereçe o que ele achar — ou explique por que um achado não se aplica — antes que o PR exista.

- [ ] **Step 5: Commit final, se houve correção**

```bash
git add -A
git commit -m "fix: address code review findings on the ADR governance branch

Claude-Session: https://claude.ai/code/session_01U2Uski78ozNPf1uBQXU95q"
```

- [ ] **Step 6: Parar**

Abrir o PR é ação externa e **não é feita sem pedido**. Reporte ao usuário que a branch está verde e pronta, e espere.

---

## Autorrevisão do plano

Feita depois de escrever tudo, contra o spec.

### Cobertura do spec

| Seção do spec | Onde |
|---|---|
| `docs/adr/` — índice, template, 15 ADRs | Tarefas 1, 4, 5, 6, 8 |
| Critério de admissão dentro da ADR-0001 | Tarefa 1, Step 2 |
| Formato do front-matter | Tarefa 1 (template), Tarefa 2 (parser que o valida) |
| ADR como configuração do linter, cinco comportamentos | Tarefa 3 |
| `scripts/lint-arch/` com 13 regras e fixtures | Tarefas 9 a 17 |
| `scripts/doctor.mjs` | Tarefa 18 |
| Spike de inversão das arestas | Tarefa 7 |
| Skill de projeto | Tarefa 19 |
| `.claude/rules/*.md` path-scoped | Tarefa 20 |
| `CLAUDE.md` encolhido, com teto verificado | Tarefa 21 |
| Integração: `.eslintrc.js` | Tarefa 2 |
| Integração: `package.json`, `jest.config.js`, `ci.yml` | Tarefa 3 (as duas primeiras), Tarefa 17 (`ci.yml`) |
| Testes: Jest sobre funções puras, nenhum E2E novo | toda tarefa de regra |

Nenhuma lacuna. A ordem difere do spec em dois pontos, ambos declarados em "Duas refinações sobre o spec": o parser e o runner vêm antes das ADRs de decisão (o spec proíbe derivar a **decisão** do código, e um parser não é uma decisão), e o `ci.yml` só é ligado quando o repo está verde.

### Consistência de tipos

- `Finding.key` é produzido por toda regra e consumido só pelo runner (Tarefa 3) e pelos testes que comparam com `desvios:` (Tarefas 15 e 16). Formato: `arquivo → alvo`, exceto `no-untyped-editor-code`, onde é o caminho puro — documentado nas duas pontas.
- `phpClassOwners` é definido em `rules/php-class-naming.js` (Tarefa 11) e consumido em `rules/shared-two-consumers.js` (Tarefa 14) e `rules/feature-deps.js` (Tarefa 15), com a mesma assinatura.
- `createContext` aceita `{ root, files, read }` em toda tarefa que o usa.
- `stripPhpComments` versus `stripPhpNoise`: a escolha está justificada em cada regra que usa uma das duas, e o teste de `feature-deps` prova que a escolha errada perderia a aresta 6.

### Três números que o executor tem de confirmar, não assumir

Se qualquer um divergir, o repo mudou desde `5ee2f24` e a tarefa **para e reporta**:

- `feature-deps` acha **11** arestas, e as 11 chaves batem com `desvios:` da ADR-0005 (Tarefa 15).
- `i18n-text-domain` conta **48** chamadas gettext (Tarefa 12).
- `covers-annotation` vê **10** classes de teste PHPUnit (Tarefa 13).

### Um ponto de decisão explícito

O teto do `CLAUDE.md` (Tarefa 21, Step 3). A redação real cai em ~94 linhas contra as 80 do spec, e o plano manda parar e perguntar em vez de trimar conteúdo ou mexer no número sozinho.
