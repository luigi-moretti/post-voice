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
 * @param {string} arg    o primeiro argumento, já trimado
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
