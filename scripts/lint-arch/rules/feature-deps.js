'use strict';
// ADR-0005: uma feature não referencia outra feature. `shared/` nunca é
// aresta — atravessar a fronteira é para isso que existe (ADR-0004).
const path = require( 'node:path' );
const { stripPhpComments, isTestPath } = require( '../context' );
const { phpClassOwners } = require( './php-class-naming' );

const CLASSE_RE = /\bPost_Voice_\w+\b/g;
// `import(` precisa de ramo próprio: `import\s+` exige espaço em branco, e
// `(` não é espaço — sem ele o import dinâmico passava batido. Hoje não há
// nenhum sob `features/`, então o buraco era silencioso: nada acusava, e nada
// deixava de acusar. É o pior tipo de buraco de detecção.
const IMPORT_RE =
	/(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)['"](\.[^'"]+)['"]/g;
const TS_RE = /\.tsx?$/;

const featureDe = ( file ) => file.split( '/' )[ 1 ];

/**
 * Arestas cross-feature em PHP: um `Post_Voice_*` cuja classe é declarada em
 * outra feature.
 *
 * Comentários fora, strings dentro: a aresta 6 do inventário é
 * `array( 'Post_Voice_Post_Meta', 'auth_callback' )`, um callable escrito
 * como string. `stripPhpComments` (não `stripPhpNoise`) apaga só o
 * comentário e preserva o corpo das strings — descartá-las junto faria essa
 * aresta sumir da contagem.
 *
 * @param {Object} ctx
 * @return {Object[]} achados
 */
function arestasPhp( ctx ) {
	const donos = phpClassOwners( ctx );
	const achados = new Map();
	for ( const file of ctx.files ) {
		if (
			! file.startsWith( 'features/' ) ||
			! file.endsWith( '.php' ) ||
			isTestPath( file )
		) {
			continue;
		}
		const propria = featureDe( file );
		const source = stripPhpComments( ctx.read( file ) );
		CLASSE_RE.lastIndex = 0;
		let m;
		while ( ( m = CLASSE_RE.exec( source ) ) !== null ) {
			const dono = donos.get( m[ 0 ] );
			if (
				! dono ||
				dono.feature === propria ||
				dono.feature === 'shared'
			) {
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

/**
 * Arestas cross-feature em TypeScript: um import relativo cujo alvo,
 * resolvido contra o diretório do arquivo que importa, cai dentro de
 * `features/<outra>/`.
 *
 * A resolução é o que separa uma aresta de verdade de um `../../` que sobe
 * até a raiz da PRÓPRIA feature e desce de novo — textualmente indistintos,
 * semanticamente opostos. Por isso o specifier é normalizado com
 * `path.posix.join`/`normalize` contra o diretório do arquivo antes de
 * comparar features, em vez de checar o texto do import.
 *
 * @param {Object} ctx
 * @return {Object[]} achados
 */
function arestasTs( ctx ) {
	const achados = new Map();
	for ( const file of ctx.files ) {
		if (
			! file.startsWith( 'features/' ) ||
			! TS_RE.test( file ) ||
			isTestPath( file )
		) {
			continue;
		}
		const propria = featureDe( file );
		const source = ctx.read( file );
		IMPORT_RE.lastIndex = 0;
		let m;
		while ( ( m = IMPORT_RE.exec( source ) ) !== null ) {
			const alvo = path.posix.normalize(
				path.posix.join( path.posix.dirname( file ), m[ 1 ] )
			);
			if (
				! alvo.startsWith( 'features/' ) ||
				featureDe( alvo ) === propria
			) {
				continue;
			}
			// A chave omite o prefixo `features/` do alvo: é a forma que a
			// ADR-0005 registra em `desvios:`, e se lê como "feature → módulo".
			const key = `${ file } → ${ alvo.slice( 'features/'.length ) }`;
			if ( achados.has( key ) ) {
				continue;
			}
			achados.set( key, {
				key,
				file,
				line: source.slice( 0, m.index ).split( '\n' ).length,
				message: `importa de "${ featureDe(
					alvo
				) }", outra feature (ADR-0005)`,
			} );
		}
	}
	return [ ...achados.values() ];
}

module.exports = {
	id: 'feature-deps',
	adr: '0005',
	check: ( ctx ) => [ ...arestasPhp( ctx ), ...arestasTs( ctx ) ],
};
