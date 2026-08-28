'use strict';

// Confere concordância, nunca o valor. Fixar "6.6" aqui faria toda subida de
// mínimo exigir editar a regra; o que a ADR-0014 protege é que os arquivos não
// divirjam entre si, e que o modelo aponte para um commit, não para uma ref
// móvel. Um arquivo ausente de `ctx.files` é ignorado, não conta como
// divergência — só um arquivo PRESENTE e ILEGÍVEL é erro.
const FONTES_WP = [
	{ file: 'post-voice.php', re: /Requires at least:\s*([\d.]+)/ },
	{ file: 'readme.txt', re: /Requires at least:\s*([\d.]+)/ },
	{ file: '.wp-env.json', re: /WordPress\/WordPress#([\d.]+)/ },
];

const FONTES_PHP = [
	{ file: 'post-voice.php', re: /Requires PHP:\s*([\d.]+)/ },
	{ file: 'readme.txt', re: /Requires PHP:\s*([\d.]+)/ },
	{ file: 'composer.json', re: /"php"\s*:\s*">=\s*([\d.]+)"/ },
	{ file: 'phpcs.xml.dist', re: /name="testVersion"\s+value="([\d.]+)-?"/ },
];

// `composer.json` só declara PHP e `.wp-env.json` só declara WordPress — de
// propósito não aparecem nas duas listas. Um arquivo que não declara uma
// dimensão não é lido como se divergisse dela.
const MODEL_SOURCE = 'features/narration/editor/model-source.ts';

/**
 * @param {Object}   ctx
 * @param {Object[]} fontes arquivo + regex de captura do mínimo
 * @param {string}   rotulo "WordPress" ou "PHP", só para a mensagem
 * @return {Object[]} achados: zero, um "ilegível" ou um "divergente"
 */
function concordam( ctx, fontes, rotulo ) {
	const lidos = fontes
		.filter( ( { file } ) => ctx.files.includes( file ) )
		.map( ( { file, re } ) => ( {
			file,
			valor: ( ctx.read( file ).match( re ) || [] )[ 1 ],
		} ) );

	const ilegivel = lidos.find( ( l ) => ! l.valor );
	if ( ilegivel ) {
		return [
			{
				key: `${ ilegivel.file } → ${ rotulo }-ilegivel`,
				file: ilegivel.file,
				line: 1,
				message: `não foi possível ler o mínimo de ${ rotulo } neste arquivo (ADR-0014)`,
			},
		];
	}

	const distintos = [ ...new Set( lidos.map( ( l ) => l.valor ) ) ];
	if ( distintos.length <= 1 ) {
		return [];
	}
	const detalhe = lidos
		.map( ( l ) => `${ l.file }=${ l.valor }` )
		.join( ', ' );
	return [
		{
			key: `pins → ${ rotulo }-divergente`,
			file: lidos[ 0 ].file,
			line: 1,
			message: `o mínimo de ${ rotulo } diverge entre os arquivos: ${ detalhe } (ADR-0014)`,
		},
	];
}

function check( ctx ) {
	const achados = [
		...concordam( ctx, FONTES_WP, 'WordPress' ),
		...concordam( ctx, FONTES_PHP, 'PHP' ),
	];

	if ( ctx.files.includes( MODEL_SOURCE ) ) {
		const url = ( ctx
			.read( MODEL_SOURCE )
			.match( /MODEL_BASE_URL\s*=\s*[\s\S]*?'([^']+)'/ ) || [] )[ 1 ];
		if ( ! url || ! /\/resolve\/[0-9a-f]{40}\//.test( url ) ) {
			achados.push( {
				key: `${ MODEL_SOURCE } → model-base-url`,
				file: MODEL_SOURCE,
				line: 1,
				message:
					'MODEL_BASE_URL tem de apontar para um SHA de commit de 40 hexadígitos, nunca para uma ref móvel como resolve/main (ADR-0014)',
			} );
		}
	}

	return achados;
}

module.exports = { id: 'contract-pins', adr: '0014', check };
