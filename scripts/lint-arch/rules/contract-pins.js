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
//
// Mover o mirror mexe em TRÊS lugares, e este comentário existe para quem
// estiver executando o `revisar_quando` da ADR-0014 achar os três:
// `features/narration/editor/model-source.ts` (o valor de produção), a
// constante aqui, e as URLs nos fixtures de `tests/rules-pins.test.js`. O gate
// falha alto se um deles ficar para trás — é justamente o que esta regra faz —,
// mas falhar alto não é o mesmo que dizer onde mexer.
const MIRROR_PREFIX =
	'https://huggingface.co/luigi-moretti/pocket-tts-onnx-mirror/resolve/';

/**
 * @param {string} url valor de MODEL_BASE_URL, ou undefined se não achado
 * @return {boolean} true quando aponta para o mirror próprio, fixado num SHA
 *   de commit de 40 hexadígitos — nunca para o upstream, nem para outro host,
 *   nem para uma ref móvel como `resolve/main`
 */
const MENSAGEM_PIN = `MODEL_BASE_URL tem de apontar para o mirror próprio do plugin (${ MIRROR_PREFIX }) fixado num SHA de commit de 40 hexadígitos — nunca para o repositório upstream, nem para outro host, nem para uma ref móvel como resolve/main (ADR-0014)`;

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

/**
 * Lê a declaração inteira de `MODEL_BASE_URL` — do nome até o `;` que a fecha
 * FORA de string — e devolve todos os literais de texto que ela contém.
 *
 * Existe porque a versão anterior usava
 * `MODEL_BASE_URL\s*=\s*[\s\S]*?'([^']+)'`, e o `*?` preguiçoso casa a
 * PRIMEIRA string depois do `=`. Num ternário cujo primeiro ramo é o mirror
 * fixado, o segundo ramo nunca era olhado: dava para apontar o fallback para
 * qualquer host com o gate verde. Um pin de contrato que passa violado é pior
 * que não ter pin, porque a ADR-0014 promete uma proteção que não existe.
 *
 * Varre caractere a caractere em vez de usar regex porque é preciso saber se
 * um `;` está dentro ou fora de string: `'https://x/;y/'` não fecha nada.
 *
 * @param {string} source conteúdo do arquivo
 * @return {?Object[]} literais `{ valor, interpolado, index }`, ou `null` se
 *   a declaração não existe no arquivo
 */
function literaisDaDeclaracao( source ) {
	const inicio = source.indexOf( 'MODEL_BASE_URL' );
	if ( inicio === -1 ) {
		return null;
	}

	const literais = [];
	let i = inicio + 'MODEL_BASE_URL'.length;
	while ( i < source.length ) {
		const c = source[ i ];
		if ( c === ';' ) {
			break;
		}
		if ( c === "'" || c === '"' || c === '`' ) {
			const abre = c;
			const comeco = i;
			let valor = '';
			let interpolado = false;
			i += 1;
			while ( i < source.length && source[ i ] !== abre ) {
				if ( source[ i ] === '\\' ) {
					valor += source[ i + 1 ] || '';
					i += 2;
					continue;
				}
				if ( abre === '`' && source.startsWith( '${', i ) ) {
					interpolado = true;
				}
				valor += source[ i ];
				i += 1;
			}
			literais.push( { valor, interpolado, index: comeco } );
		}
		i += 1;
	}
	return literais;
}

function check( ctx ) {
	const achados = [
		...concordam( ctx, FONTES_WP, 'WordPress' ),
		...concordam( ctx, FONTES_PHP, 'PHP' ),
	];

	if ( ctx.files.includes( MODEL_SOURCE ) ) {
		const source = ctx.read( MODEL_SOURCE );
		const literais = literaisDaDeclaracao( source );
		const linhaDe = ( idx ) => source.slice( 0, idx ).split( '\n' ).length;

		// Declaração ausente, ou presente sem literal nenhum: a regra não
		// consegue provar que o pin está certo, e silenciar seria afirmar que
		// está. Mantém a chave sem valor observado — não há valor a observar.
		if ( ! literais || ! literais.length ) {
			achados.push( {
				key: `${ MODEL_SOURCE } → model-base-url`,
				file: MODEL_SOURCE,
				line: 1,
				message: MENSAGEM_PIN,
			} );
		} else {
			// TODOS os literais da declaração, não só o primeiro. Cada um
			// carrega o valor observado na chave, para que dois ramos ruins
			// não colapsem numa entrada de `desvios:` que absolve os dois.
			for ( const lit of literais ) {
				if ( lit.interpolado ) {
					achados.push( {
						key: `${ MODEL_SOURCE } → model-base-url:interpolado`,
						file: MODEL_SOURCE,
						line: linhaDe( lit.index ),
						message: `MODEL_BASE_URL montado por interpolação não é verificável por leitura, e a regra não pode afirmar que o pin está certo — deixe a URL literal. ${ MENSAGEM_PIN }`,
					} );
					continue;
				}
				if ( ! apontaParaOMirrorFixado( lit.valor ) ) {
					achados.push( {
						key: `${ MODEL_SOURCE } → model-base-url:${ lit.valor }`,
						file: MODEL_SOURCE,
						line: linhaDe( lit.index ),
						message: MENSAGEM_PIN,
					} );
				}
			}
		}
	}

	return achados;
}

module.exports = { id: 'contract-pins', adr: '0014', check };
