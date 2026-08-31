'use strict';
const { checkIndexTable } = require( '../health' );

const INDICE = 'docs/adr/README.md';

// Esta checagem já existia, mas rodava como caso especial dentro de `run`: ela
// REPROVAVA a CI sem ser módulo de regra, sem ADR nenhuma declará-la em
// `enforced_by`, sem `key` e portanto sem escape por `desvios:`. Ou seja, um
// gate bloqueante fora do espelho que este mecanismo inteiro existe para
// manter — o próprio defeito que a ADR-0001 descreve, dentro da ferramenta que
// a defende. Como regra de verdade ela herda tudo isso de graça: o espelho a
// enxerga, a órfã é detectável, e uma linha de índice divergente pode ser
// congelada como qualquer outra violação.
//
// Ausência de uma ADR no índice continua sendo assunto do `checkIndex`, no
// `doctor`: aqui só se confere a linha que EXISTE, para os dois não reportarem
// o mesmo defeito duas vezes.

/**
 * @param {Object} ctx
 * @return {Object[]} achados
 */
function check( ctx ) {
	// Índice ausente não é problema desta regra, e ler um arquivo fora da
	// árvore derrubaria o lint inteiro em vez de reportar.
	if ( ! ctx.files.includes( INDICE ) || ! ctx.adrs.length ) {
		return [];
	}
	return checkIndexTable( ctx.adrs, ctx.read( INDICE ) ).map( ( p ) => ( {
		// A chave carrega o id da ADR e a coluna divergente, e não a mensagem
		// inteira: a mensagem cita os dois valores observados e mudaria a cada
		// edição, o que invalidaria o `desvios:` sozinho.
		key: `${ INDICE } → ${ p.adr }-${ p.coluna }`,
		file: INDICE,
		line: p.line,
		// Sem o ponto final: o runner emenda a mensagem numa frase maior e
		// acrescenta o dele, como nas demais regras.
		message: p.message.replace( /\.$/, '' ),
	} ) );
}

module.exports = { id: 'adr-index-table', adr: '0001', check };
