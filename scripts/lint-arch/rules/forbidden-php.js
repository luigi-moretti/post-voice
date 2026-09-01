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
 * @param {Object[]} padroes { pattern: RegExp com /g, motivo: string }
 * @return {Object[]} findings
 */
function scanForbidden( ctx, padroes ) {
	const achados = [];
	for ( const file of phpSources( ctx ) ) {
		const source = stripPhpComments( ctx.read( file ) );
		for ( const { pattern, motivo } of padroes ) {
			pattern.lastIndex = 0;
			let m;
			while ( ( m = pattern.exec( source ) ) !== null ) {
				// A chave carrega o termo casado, não a categoria. Um padrão cobre
				// vários nomes (`exec`, `shell_exec`, `proc_open`…), e com a
				// categoria na chave um arquivo com dois deles produziria a mesma
				// chave duas vezes — uma entrada de `desvios:` absolveria as duas,
				// e a segunda violação passaria despercebida.
				const termo = m[ 0 ].replace( /\s*\($/, '' );
				achados.push( {
					key: `${ file } → ${ termo }`,
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
