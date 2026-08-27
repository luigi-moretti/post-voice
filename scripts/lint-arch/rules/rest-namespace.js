'use strict';
const { phpSources, stripPhpComments, stripPhpNoise } = require( '../context' );

const NAMESPACE = 'post-voice/v1';
const CONST_RE = /const\s+(\w+)\s*=\s*'([^']*)'/g;

// Guarda de fronteira em três partes, e não `\b`: `\b` não separa `->` nem `::`
// do nome que os segue (`>` e `:` não são caracteres de palavra, então há
// fronteira ali e `\b` deixaria passar `$obj->register_rest_route(` como se
// fosse a função global). É a mesma forma de dois lookbehinds que Task 10
// já usa em `no-server-side-tts.js`, com um terceiro (`(?<!\w)`) para cobrir
// um nome como `custom_register_rest_route(`.
// Flag `d`: dá `m.indices`, os offsets do grupo capturado — necessários para
// ler o mesmo trecho em `source` (ver `check`).
const CALL_RE = /(?<!\w)(?<!->)(?<!::)register_rest_route\s*\(\s*([^,]+),/dg;

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

/**
 * As constantes de classe declaradas no arquivo, nome → valor.
 *
 * `CONST_RE` roda sobre `source` (comentários fora, strings dentro) porque
 * precisa do corpo do literal. Mas um `const` dentro de uma string —
 * `'o valor é const X = \'y\''` — casaria do mesmo jeito ali; o filtro é
 * conferir, no mesmo offset, que `codigo` (strings apagadas) também começa
 * com "const" naquele ponto. Dentro de uma string de verdade, `codigo` teria
 * espaços em branco ali, não a palavra.
 *
 * @param {string} source o arquivo com stripPhpComments
 * @param {string} codigo o mesmo arquivo com stripPhpNoise
 * @return {Map<string, string>} nome da constante → valor
 */
function constantes( source, codigo ) {
	const consts = new Map();
	CONST_RE.lastIndex = 0;
	let c;
	while ( ( c = CONST_RE.exec( source ) ) !== null ) {
		if ( codigo.slice( c.index, c.index + 5 ) === 'const' ) {
			consts.set( c[ 1 ], c[ 2 ] );
		}
	}
	return consts;
}

function check( ctx ) {
	const achados = [];
	for ( const file of phpSources( ctx ) ) {
		const raw = ctx.read( file );
		// `codigo`: strings apagadas — é sobre isto que a chamada é reconhecida,
		// então um literal de string cujo *conteúdo* parece uma chamada
		// (`'lembre de chamar register_rest_route( ... )'`) não casa mais.
		// `source`: strings mantidas — dele é lido o valor real do argumento,
		// já que a chamada de verdade passa um literal ou `self::CONST`.
		// Os dois preservam o comprimento em bytes, então um offset em um vale
		// no outro.
		const codigo = stripPhpNoise( raw );
		const source = stripPhpComments( raw );
		if ( ! codigo.includes( 'register_rest_route' ) ) {
			continue;
		}
		const consts = constantes( source, codigo );

		CALL_RE.lastIndex = 0;
		let m;
		while ( ( m = CALL_RE.exec( codigo ) ) !== null ) {
			const line = codigo.slice( 0, m.index ).split( '\n' ).length;
			const [ inicio, fim ] = m.indices[ 1 ];
			const arg = source.slice( inicio, fim ).trim();
			const ns = resolver( arg, consts );
			if ( ns === null ) {
				achados.push( {
					key: `${ file } → namespace-dinamico`,
					file,
					line,
					message: `o namespace de register_rest_route não resolve estaticamente ("${ arg }"); use '${ NAMESPACE }' ou uma constante do mesmo arquivo (ADR-0007)`,
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
