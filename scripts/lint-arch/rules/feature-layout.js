'use strict';

const SUBDIRS_PERMITIDOS = [ 'php', 'editor', 'frontend', 'admin', 'tests' ];
const CODIGO_RE = /\.(?:php|ts|tsx|js|jsx)$/;

// Fora de features/, estes prefixos são o resto legítimo do repo. `build/`,
// `vendor/` e `node_modules/` não aparecem porque não são versionados.
//
// `shared/` entra inteiro, sem checagem de subestrutura, ao contrário de
// `features/<f>/`: a ADR-0004 prescreve layout só para as features. Se um dia
// se decidir que shared/ espelha a mesma convenção, é aqui que muda — e é
// decisão de ADR, não de regra.
const RAIZES_PERMITIDAS = [
	'shared/',
	'scripts/',
	'e2e/',
	'types/',
	'test/',
	'tests/',
];

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

module.exports = {
	id: 'feature-layout',
	adr: '0004',
	check,
	SUBDIRS_PERMITIDOS,
};
