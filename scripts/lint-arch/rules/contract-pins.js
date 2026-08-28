'use strict';

// Confere concordância, nunca o valor do mínimo. Fixar "6.6" aqui faria toda
// subida de mínimo exigir editar a regra; o que a ADR-0014 protege é que os
// arquivos não divirjam entre si, e que o modelo aponte para um commit no
// mirror próprio, não para uma ref móvel nem para o upstream. Um arquivo
// ausente de `ctx.files` é ignorado, não conta como divergência — só um
// arquivo PRESENTE e num formato que a regra não reconhece é erro.
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

// O mirror É fixado, ao contrário dos mínimos e do SHA. A ADR-0014 diz que a
// regra "não fixa os valores em si — nem os mínimos atuais, nem o SHA atual",
// mas a frase é sobre ESSES dois; o alvo do pin é outra coisa — a `##
// Decisão` exige literalmente "no mirror próprio do plugin, nunca ... para o
// repositório upstream", e o `revisar_quando` da própria ADR já lista "o
// mirror do modelo mudar de host" como evento que reabre a decisão. Mudar o
// mirror já é, portanto, evento de ADR de qualquer jeito — fixá-lo aqui não
// cria uma segunda linha de manutenção que "toda subida de mínimo" evitava.
const MIRROR_PREFIX =
	'https://huggingface.co/luigi-moretti/pocket-tts-onnx-mirror/resolve/';

/**
 * @param {string} url valor de MODEL_BASE_URL, ou undefined se não achado
 * @return {boolean} true quando aponta para o mirror próprio, fixado num SHA
 *   de commit de 40 hexadígitos — nunca para o upstream, nem para outro host,
 *   nem para uma ref móvel como `resolve/main`
 */
function apontaParaOMirrorFixado( url ) {
	if ( ! url || ! url.startsWith( MIRROR_PREFIX ) ) {
		return false;
	}
	return /^[0-9a-f]{40}\//.test( url.slice( MIRROR_PREFIX.length ) );
}

/**
 * @param {Object}   ctx
 * @param {Object[]} fontes arquivo + regex de captura do mínimo
 * @param {string}   rotulo "WordPress" ou "PHP", só para a mensagem
 * @return {Object[]} achados: zero, um "formato desconhecido" ou um
 *   "divergente" — nunca os dois na mesma chamada
 */
function concordam( ctx, fontes, rotulo ) {
	const lidos = fontes
		.filter( ( { file } ) => ctx.files.includes( file ) )
		.map( ( { file, re } ) => ( {
			file,
			valor: ( ctx.read( file ).match( re ) || [] )[ 1 ],
		} ) );

	const semValor = lidos.find( ( l ) => ! l.valor );
	if ( semValor ) {
		return [
			{
				key: `${ semValor.file } → ${ rotulo }-formato-desconhecido`,
				file: semValor.file,
				line: 1,
				message: `não reconheço o formato usado neste arquivo para declarar o mínimo de ${ rotulo } (ADR-0014)`,
			},
		];
	}

	const distintos = [ ...new Set( lidos.map( ( l ) => l.valor ) ) ];
	if ( distintos.length <= 1 ) {
		return [];
	}

	// `file` aponta para um arquivo que DE FATO diverge: o primeiro cujo
	// valor difere do primeiro arquivo lido. Isso vale mesmo sem uma maioria
	// clara — com três fontes e três valores diferentes não há "o dissidente",
	// só pares que discordam, e o primeiro par já é um lugar real para olhar.
	const divergente = lidos.find( ( l ) => l.valor !== lidos[ 0 ].valor );
	const detalhe = lidos
		.map( ( l ) => `${ l.file }=${ l.valor }` )
		.join( ', ' );

	// A chave carrega o conjunto observado inteiro (arquivo=valor, na ordem
	// fixa de `fontes`) — não só o rótulo da dimensão. Duas divergências
	// diferentes (arquivos diferentes discordando, ou valores diferentes)
	// nunca colidem, e a mesma divergência sempre reproduz a mesma chave, o
	// que é o que uma linha futura de `desvios:` precisa para identificar UMA
	// causa, não a dimensão inteira.
	return [
		{
			key: `pins → ${ rotulo }-divergente:${ detalhe }`,
			file: divergente.file,
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
		if ( ! apontaParaOMirrorFixado( url ) ) {
			achados.push( {
				key: `${ MODEL_SOURCE } → model-base-url`,
				file: MODEL_SOURCE,
				line: 1,
				message: `MODEL_BASE_URL tem de apontar para o mirror próprio do plugin (${ MIRROR_PREFIX }) fixado num SHA de commit de 40 hexadígitos — nunca para o repositório upstream, nem para outro host, nem para uma ref móvel como resolve/main (ADR-0014)`,
			} );
		}
	}

	return achados;
}

module.exports = { id: 'contract-pins', adr: '0014', check };
