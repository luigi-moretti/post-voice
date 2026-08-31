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
// qualquer menção: `X = MODEL_BASE_URL + '...'`, correto, virava violação
// porque a regra lia `'voices.json'` como se fosse o pin.
//
// Isto é conferido contra `codigoDe( source )`, NUNCA contra o cru. Uma versão
// anterior testava a fatia crua e justificava-se dizendo "texto solto num
// comentário não tem `const` antes" — o contraexemplo é a coisa mais comum que
// existe dentro de um comentário, código comentado, e foi medido: três vetores
// devolviam zero achado com o pin apontando para outro host. Na cópia
// branqueada não há `const` de comentário nenhum para satisfazer a âncora.
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
 * Branqueia comentário e corpo de string, preservando comprimento e linhas.
 *
 * Mesmo padrão de duas fontes que as regras de PHP usam: apagar PARA ESPAÇO em
 * vez de remover mantém cada offset válido nas duas cópias, então dá para achar
 * ESTRUTURA na cópia branqueada e ler CONTEÚDO no cru, no mesmo índice.
 *
 * Duas rodadas de review provaram que as duas alternativas mais baratas não
 * funcionam. Procurar o nome no cru deixava um comentário citando a constante
 * ancorar a varredura (round 1). Procurar em código mas conferir a âncora de
 * declaração numa fatia CRUA deixava passar a coisa mais comum que existe
 * dentro de um comentário — código comentado, que tem `const` (round 2). A
 * âncora tem de ler a MESMA cópia em que a ocorrência foi achada.
 *
 * @param {string} source conteúdo do arquivo
 * @return {string} o mesmo texto com comentário e corpo de string em branco
 */
function codigoDe( source ) {
	let out = '';
	let i = 0;
	const branco = ( trecho ) => trecho.replace( /[^\n]/g, ' ' );
	while ( i < source.length ) {
		const c = source[ i ];
		if ( c === '/' && source[ i + 1 ] === '/' ) {
			const fim = source.indexOf( '\n', i );
			const ate = fim === -1 ? source.length : fim;
			out += branco( source.slice( i, ate ) );
			i = ate;
			continue;
		}
		if ( c === '/' && source[ i + 1 ] === '*' ) {
			const fim = source.indexOf( '*/', i + 2 );
			const ate = fim === -1 ? source.length : fim + 2;
			out += branco( source.slice( i, ate ) );
			i = ate;
			continue;
		}
		if ( c === "'" || c === '"' || c === '`' ) {
			const fim = fimDaString( source, i );
			// As aspas ficam; só o CORPO some. Um `;` dentro de string deixa de
			// fechar declaração, e um literal de regex com aspa dentro deixa de
			// engolir as linhas seguintes — porque `'` e `"` não atravessam
			// quebra de linha em JavaScript, e `fimDaString` respeita isso.
			out +=
				c +
				branco( source.slice( i + 1, fim ) ) +
				( source[ fim ] || '' );
			i = fim + 1;
			continue;
		}
		out += c;
		i += 1;
	}
	return out;
}

/**
 * Offsets em que `nome` aparece como DECLARAÇÃO, em código.
 *
 * Declaração, e não menção: sem isso, `X = MODEL_BASE_URL + '...'` fazia a
 * regra ler `'...'` como se fosse o pin e reprovar código correto.
 *
 * @param {string} codigo saída de `codigoDe`
 * @param {string} nome   o identificador procurado
 * @return {number[]} offsets das declarações
 */
function ocorrenciasEmCodigo( codigo, nome ) {
	const out = [];
	let i = 0;
	while ( i < codigo.length ) {
		if (
			codigo.startsWith( nome, i ) &&
			! /[\w$]/.test( codigo[ i + nome.length ] || '' ) &&
			DECLARACAO_RE.test( codigo.slice( Math.max( 0, i - 40 ), i ) )
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
		// `'` e `"` não atravessam quebra de linha em JavaScript; só a crase
		// atravessa. Sem esta parada, uma aspa solta — dentro de um literal de
		// regex, tipicamente — abria uma pseudo-string que engolia o resto do
		// arquivo, e a declaração de verdade deixava de ser vista. Foi o vetor
		// de dois falsos negativos seguidos nesta regra.
		if ( aspa !== '`' && source[ i ] === '\n' ) {
			return i - 1;
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
 * @param {string} source conteúdo cru do arquivo, de onde sai o VALOR
 * @param {string} codigo `codigoDe( source )`, de onde sai a ESTRUTURA
 * @param {number} inicio offset do nome da constante, já em código
 * @return {Object[]} literais `{ valor, interpolado, index }`
 */
function literaisDaDeclaracao( source, codigo, inicio ) {
	const literais = [];
	let i = inicio;
	while ( i < source.length ) {
		// A ESTRUTURA sai de `codigo`: um `;` dentro de comentário ou de string
		// não fecha declaração nenhuma, e ali ele já é espaço. O VALOR sai de
		// `source`, no mesmo offset.
		const c = codigo[ i ];
		if ( c === ';' ) {
			break;
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
		// Duas fontes: `codigo` tem comentário e corpo de string em branco e é
		// onde a DECLARAÇÃO é reconhecida; `source` é o cru, de onde sai o
		// VALOR do literal. Os dois têm o mesmo comprimento, então um offset
		// achado num vale no outro.
		const codigo = codigoDe( source );
		const literais = ocorrenciasEmCodigo( codigo, NOME_PIN ).flatMap(
			( inicio ) => literaisDaDeclaracao( source, codigo, inicio )
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
