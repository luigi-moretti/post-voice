'use strict';
const { stripPhpNoise, isTestPath } = require( '../context' );

const CLASS_RE = /^\s*(?:final\s+|abstract\s+)*class\s+(\w+)/gm;
const PREFIXO = 'Post_Voice_';

const classFiles = ( ctx ) =>
	ctx.files.filter(
		( f ) =>
			/^(?:features\/[^/]+|shared)\/php\/class-[a-z0-9-]+\.php$/.test(
				f
			) && ! isTestPath( f )
	);

/**
 * `Post_Voice_Rest_Api` → `class-rest-api.php`
 *
 * @param {string} klass
 * @return {string} o nome de arquivo esperado
 */
function esperadoParaClasse( klass ) {
	return (
		'class-' +
		klass.slice( PREFIXO.length ).toLowerCase().replace( /_/g, '-' ) +
		'.php'
	);
}

function declaradas( ctx, file ) {
	// stripPhpNoise, e não stripPhpComments: `'class Post_Voice_X'` dentro de uma
	// string não declara nada.
	const source = stripPhpNoise( ctx.read( file ) );
	CLASS_RE.lastIndex = 0;
	const out = [];
	let m;
	while ( ( m = CLASS_RE.exec( source ) ) !== null ) {
		out.push( {
			nome: m[ 1 ],
			line: source.slice( 0, m.index ).split( '\n' ).length,
		} );
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
		const feature = file.startsWith( 'shared/' )
			? 'shared'
			: file.split( '/' )[ 1 ];
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

module.exports = {
	id: 'php-class-naming',
	adr: '0006',
	check,
	phpClassOwners,
	esperadoParaClasse,
};
