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
const NOME_PIN = 'MODEL_BASE_URL';

// O que precede o nome numa DECLARAÇÃO. A guarda de fronteira sozinha aceitava
// qualquer menção ao identificador: um `X = MODEL_BASE_URL + '...'` correto
// virava violação (a regra lia `'voices.json'` como se fosse o pin), e um
// `MODEL_BASE_URL = '<url boa>'` dentro de um comentário lido como código por
// dessincronização absolvia a declaração de verdade. Exigir a declaração fecha
// os dois: comentário e segunda referência não têm `const` antes.
const DECLARACAO_RE = /(?:^|[;{}()\s])(?:export\s+)?(?:const|let|var)\s+$/;

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
 * Percorre TypeScript pulando comentário e string, e devolve os offsets em que
 * `nome` aparece em CÓDIGO de verdade.
 *
 * Existe porque a versão anterior fazia `source.indexOf( 'MODEL_BASE_URL' )` no
 * arquivo CRU — a primeira ocorrência TEXTUAL, comentário incluído. Medido: um
 * comentário acima da declaração que nomeie a constante, cite a URL fixada
 * entre aspas e termine em `;` fazia a varredura parar dentro do próprio
 * comentário; a declaração real, apontando para outro host, nunca era olhada, e
 * `check` devolvia zero achado. Gate verde sobre pin de contrato violado — e o
 * que esse pin protege é de onde o navegador do autor baixa ~190 MB de modelo.
 *
 * A varredura NÃO conhece literal de regex nem interpolação de template, e por
 * isso pode dessincronizar: num `/'/`, a aspa de dentro abre uma pseudo-string
 * e daí em diante um trecho de comentário pode ser lido como código. Uma versão
 * anterior deste comentário afirmava que dessincronizar "erra na direção
 * segura, achando MENOS ocorrências". Isso era FALSO, e foi medido: com um
 * regex desses e um comentário-isca contendo a URL fixada, a declaração de
 * verdade era engolida pela pseudo-string, a isca era lida como código e a
 * regra devolvia zero achado com o pin apontando para outro host.
 *
 * O que torna a dessincronização inofensiva não é a varredura, é a ÂNCORA: só
 * conta como ocorrência o nome precedido de uma declaração de verdade
 * (`const`/`let`/`var`, com `export` opcional). Texto solto num comentário não
 * tem `const` antes; uma segunda referência à constante — `X = MODEL_BASE_URL +
 * '...'` — também não. Assim, dessincronizar só pode fazer a conta CAIR, e
 * zero ocorrência com o nome presente no cru é tratado pelo chamador como "não
 * consigo provar o pin", que acusa.
 *
 * @param {string} source conteúdo do arquivo
 * @param {string} nome   o identificador procurado
 * @return {number[]} offsets das ocorrências em código
 */
function ocorrenciasEmCodigo( source, nome ) {
	const out = [];
	let i = 0;
	while ( i < source.length ) {
		const c = source[ i ];
		if ( c === '/' && source[ i + 1 ] === '/' ) {
			const fim = source.indexOf( '\n', i );
			i = fim === -1 ? source.length : fim + 1;
			continue;
		}
		if ( c === '/' && source[ i + 1 ] === '*' ) {
			const fim = source.indexOf( '*/', i + 2 );
			i = fim === -1 ? source.length : fim + 2;
			continue;
		}
		if ( c === "'" || c === '"' || c === '`' ) {
			i = fimDaString( source, i ) + 1;
			continue;
		}
		if (
			source.startsWith( nome, i ) &&
			! /[\w$]/.test( source[ i + nome.length ] || '' ) &&
			DECLARACAO_RE.test( source.slice( Math.max( 0, i - 40 ), i ) )
		) {
			out.push( i );
			i += nome.length;
			continue;
		}
		i += 1;
	}
	return out;
}

/**
 * Offset da aspa que fecha a string aberta em `abre`.
 *
 * @param {string} source
 * @param {number} abre   offset da aspa de abertura
 * @return {number} offset da aspa de fechamento, ou o fim do arquivo
 */
function fimDaString( source, abre ) {
	const aspa = source[ abre ];
	let i = abre + 1;
	while ( i < source.length ) {
		if ( source[ i ] === '\\' ) {
			i += 2;
			continue;
		}
		if ( source[ i ] === aspa ) {
			return i;
		}
		i += 1;
	}
	return source.length;
}

/**
 * Lê a declaração que começa em `inicio` — do nome até o `;` que a fecha FORA
 * de string e FORA de comentário — e devolve os literais de texto que ela
 * contém.
 *
 * Varre caractere a caractere em vez de usar regex por duas razões: é preciso
 * saber se um `;` está dentro de string (`'https://x/;y/'` não fecha nada) ou
 * dentro de comentário, e é preciso ver TODOS os literais. A versão original
 * usava `MODEL_BASE_URL\s*=\s*[\s\S]*?'([^']+)'`, e o `*?` preguiçoso casa a
 * PRIMEIRA string depois do `=`: num ternário cujo primeiro ramo é o mirror
 * fixado, o segundo ramo nunca era olhado.
 *
 * @param {string} source conteúdo do arquivo
 * @param {number} inicio offset do nome da constante, já em código
 * @return {Object[]} literais `{ valor, interpolado, index }`
 */
function literaisDaDeclaracao( source, inicio ) {
	const literais = [];
	let i = inicio;
	while ( i < source.length ) {
		const c = source[ i ];
		if ( c === ';' ) {
			break;
		}
		if ( c === '/' && source[ i + 1 ] === '/' ) {
			const fim = source.indexOf( '\n', i );
			i = fim === -1 ? source.length : fim + 1;
			continue;
		}
		if ( c === '/' && source[ i + 1 ] === '*' ) {
			const fim = source.indexOf( '*/', i + 2 );
			i = fim === -1 ? source.length : fim + 2;
			continue;
		}
		if ( c === "'" || c === '"' || c === '`' ) {
			const comeco = i;
			const fim = fimDaString( source, i );
			const corpo = source.slice( comeco + 1, fim );
			literais.push( {
				valor: corpo.replace( /\\(.)/g, '$1' ),
				interpolado: c === '`' && corpo.includes( '${' ),
				index: comeco,
			} );
			i = fim + 1;
			continue;
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
		const linhaDe = ( idx ) => source.slice( 0, idx ).split( '\n' ).length;

		// TODAS as declarações em código, não a primeira ocorrência textual.
		// Uma só é o caso real; mais de uma seria redeclaração, e olhar as
		// duas é mais barato que decidir qual vale.
		const literais = ocorrenciasEmCodigo( source, NOME_PIN ).flatMap(
			( inicio ) => literaisDaDeclaracao( source, inicio )
		);

		// Declaração ausente do código, ou presente sem literal nenhum: a
		// regra não consegue provar que o pin está certo, e silenciar seria
		// afirmar que está. Mantém a chave sem valor observado — não há valor
		// a observar. Cai aqui também quando o nome só aparece em comentário
		// ou em string, que é exatamente o caso que antes zerava os achados.
		if ( ! literais.length ) {
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
						// Espaço em branco normalizado, como nas regras
						// irmãs: um template literal pode quebrar linha, e uma
						// chave com `\n` dentro não sobrevive a virar uma
						// linha de `desvios:` — a violação seria incongelável.
						key: `${ MODEL_SOURCE } → model-base-url:${ lit.valor
							.replace( /\s+/g, ' ' )
							.trim() }`,
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
