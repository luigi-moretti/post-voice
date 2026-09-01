'use strict';
const { isTestPath } = require( '../context' );

// Só editor/, admin/ e frontend/: php/ é PHP e tests/ tem a sua própria
// convenção (Jest sobre .test.ts) — nenhum dos dois é o alvo da ADR-0011.
//
// Extensões: a `## Decisão` da ADR-0011 fala em "todo código de produção" ser
// TypeScript, sem restringir a extensão do que ela proíbe — é a seção
// `## Como verificar` que estreita para "nenhum arquivo `.js`". As duas leituras
// concordam no repo de hoje (não há `.jsx`, `.mjs` nem `.cjs` sob estes
// diretórios), mas divergem amanhã. Aqui a decisão é pela `## Decisão`: ela é a
// parte vinculante, `## Como verificar` é a sua ilustração no repo atual, e
// JavaScript sem tipos é JavaScript sem tipos em qualquer uma dessas quatro
// extensões. Isso torna esta regra mais estrita do que o texto literal de
// "Como verificar" — o comentário fica aqui para quem for comparar os dois e
// achar que divergiram por descuido.
const ALVO_RE =
	/^features\/[^/]+\/(?:editor|admin|frontend)\/.*\.(?:js|jsx|mjs|cjs)$/;

function check( ctx ) {
	return ctx.files
		.filter( ( f ) => ALVO_RE.test( f ) && ! isTestPath( f ) )
		.map( ( file ) => ( {
			// Chave sem seta: a violação é a existência do arquivo, não uma
			// relação entre dois lugares — como em feature-layout ou
			// feature-deps, cujas chaves têm " → ".
			key: file,
			file,
			line: 1,
			message:
				'JavaScript sem tipos em diretório de editor/admin/frontend; esse código é ' +
				'TypeScript (ADR-0011). Converta o arquivo para .ts/.tsx, ou — se for código ' +
				'de terceiros vendorizado — acrescente o caminho a desvios: em ' +
				'docs/adr/0011-editor-em-typescript.md com a razão',
		} ) );
}

module.exports = { id: 'no-untyped-editor-code', adr: '0011', check };
