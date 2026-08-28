'use strict';

// Só onde o comando de fato executa: `package.json`, os workflows sob
// `.github/workflows/` e os scripts sob `scripts/` — os três lugares que a
// própria ADR-0015 nomeia em "## Como verificar". Documentação (CLAUDE.md,
// TESTING.md, o texto das próprias ADRs) fica de fora de propósito: ela FALA
// sobre `npm install` para proibi-lo, e varrê-la acusaria o próprio arquivo
// que registra a proibição.
//
// `.husky/` NÃO está aqui. Nem "## Decisão" nem "## Como verificar" da
// ADR-0015 mencionam git hooks em nenhuma direção — ao contrário do que
// `no-untyped-editor-code.js` faz para as extensões (onde a "## Decisão" da
// ADR-0011 genuinamente licencia um escopo mais largo que "## Como
// verificar", e o comentário lá diz isso). Incluir `.husky/` aqui sem uma
// ADR que o nomeie seria o mesmo defeito que este comentário está evitando:
// afirmar que o escopo é "o que a ADR nomeia" e incluir um quarto padrão que
// ela não nomeia.
const ESCOPO_RE =
	/^(?:package\.json|\.github\/workflows\/.*\.ya?ml|scripts\/.*\.(?:sh|mjs|js))$/;

// Auto-referência: só estes dois arquivos citam a string literal "npm
// install" (com espaço de verdade) de propósito — a mensagem de violação
// desta regra, e o fixture que a fixa no teste. Sem excluí-los, `lint:arch`
// acusaria os dois no exato commit que os introduz. A exclusão é por
// caminho EXATO, não pelo diretório inteiro: `context.js`, `adr.js` e as
// outras regras sob `scripts/lint-arch/` não têm motivo nenhum para ficar
// fora da varredura, e um `npm install` de verdade ali continua sendo
// achado. Também não é por ofuscar a agulha — reescrever `NPM_INSTALL_RE`
// para escapar de si mesma esconderia a intenção do próximo leitor.
const AUTO_REFERENCIA = new Set( [
	'scripts/lint-arch/rules/no-npm-install.js',
	'scripts/lint-arch/tests/rules-pins.test.js',
] );

// A agulha é `npm install` de verdade, não qualquer "install": o job `lint`
// do CI roda `npx playwright install --with-deps` e `composer install`, e uma
// regex em cima só de "install" acusaria os dois por engano (ver ADR-0015,
// hazard B). `npm i` (abreviação) e `npm add` são a mesma decisão por outra
// porta — cobertos aqui para não virarem uma forma de escapar do lint sem
// escapar da decisão.
const NPM_INSTALL_RE = /\bnpm\s+(?:install|i|add)\b/g;

function check( ctx ) {
	const achados = [];
	for ( const file of ctx.files.filter(
		( f ) => ESCOPO_RE.test( f ) && ! AUTO_REFERENCIA.has( f )
	) ) {
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
