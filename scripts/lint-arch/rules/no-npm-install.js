'use strict';

// Só onde o comando de fato executa: `package.json`, os workflows sob
// `.github/workflows/` e os scripts sob `scripts/` — o escopo que a própria
// ADR-0015, em "## Como verificar", nomeia. Documentação (CLAUDE.md,
// TESTING.md, o texto das próprias ADRs) fica de fora de propósito: ela FALA
// sobre `npm install` para proibi-lo, e varrê-la acusaria o próprio arquivo
// que registra a proibição.
const ESCOPO_RE =
	/^(?:package\.json|\.github\/workflows\/.*\.ya?ml|scripts\/.*\.(?:sh|mjs|js)|\.husky\/.*)$/;

// Auto-referência: esta regra mora em scripts/lint-arch/, dentro do próprio
// escopo que ela varre, e a mensagem que ela produz contém a string literal
// "npm install" (com espaço de verdade) para explicar a violação a quem ler o
// relatório. Sem esta exclusão, `lint:arch` acusaria a si mesmo — e ao seu
// próprio arquivo de teste, que também contém a string para fixá-la em
// fixture — no exato commit que os introduz. A exclusão é por caminho, não
// por reescrever a agulha: ofuscar `NEEDLE_RE` para escapar de si mesma
// esconderia a intenção do próximo leitor.
const AUTO_REFERENCIA_RE = /^scripts\/lint-arch\//;

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
		( f ) => ESCOPO_RE.test( f ) && ! AUTO_REFERENCIA_RE.test( f )
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
