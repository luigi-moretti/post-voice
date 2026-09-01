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
	// Índice ausente não é problema desta regra — quem cobra ausência é o
	// `checkIndex`, no doctor —, e ler um arquivo fora da árvore derrubaria o
	// lint inteiro em vez de reportar.
	// Arquivo ausente do disco: `ctx.read` estoura. Rastreado no git e sumido
	// da árvore de trabalho é estado real (checkout parcial, `rm` sem `git
	// rm`), e derrubar o lint inteiro com um stack trace de ENOENT é a pior
	// forma de reportar isso.
	let indice = null;
	if ( ctx.files.includes( INDICE ) ) {
		try {
			indice = ctx.read( INDICE );
		} catch {
			indice = null;
		}
	}
	if ( indice === null ) {
		// Ausência é assunto do `checkIndex`, no doctor — MAS o doctor não
		// bloqueia, e o índice sumido apaga a tabela inteira em vez de uma
		// linha. É a mesma lacuna que o `doctor.mjs` ausente tem no espelho do
		// `enforced_by: doctor`, e recebe o mesmo tratamento: quem não
		// consegue conferir diz isso.
		return [
			{
				key: `${ INDICE } → indice-ausente`,
				file: INDICE,
				line: 1,
				message: `${ INDICE } não está legível na árvore, então a tabela do índice não foi conferida contra o front-matter das ADRs (ADR-0001)`,
			},
		];
	}
	// Índice presente e `ctx.adrs` vazio é FIAÇÃO QUEBRADA, não estado limpo:
	// significa que quem montou o contexto não passou as ADRs, e a regra não
	// consegue conferir nada. Calar aqui foi medido: tirar `adrs` da chamada de
	// `createContext` no CLI desligava este gate inteiro em silêncio — exit 0,
	// zero saída, regra não órfã, e os 531 testes verdes. É exatamente o
	// defeito que a correção do `status` inerte fechou, reintroduzido pela
	// correção que trouxe esta regra para dentro do espelho. Um gate que não
	// consegue conferir tem de dizer isso, não sair 0.
	if ( ! ctx.adrs.length ) {
		return [
			{
				key: `${ INDICE } → sem-adrs-no-contexto`,
				file: INDICE,
				line: 1,
				message:
					'o índice existe mas o contexto não trouxe ADR nenhuma, então a tabela não foi conferida; quem monta o ctx tem de passar `adrs` a `createContext` (ADR-0001)',
			},
		];
	}
	return checkIndexTable( ctx.adrs, indice ).map( ( p ) => ( {
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
