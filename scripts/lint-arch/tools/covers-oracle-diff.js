'use strict';
/**
 * Harness diferencial de `covers-annotation` contra o PHP de verdade.
 *
 *     node scripts/lint-arch/tools/covers-oracle-diff.js
 *
 * (`--verbose` lista também os casos que batem; `--keep` não apaga o diretório
 * temporário com os PHP gerados.)
 *
 * NÃO faz parte do `lint:arch` nem da CI, e teste nenhum depende dele: é
 * ferramenta de quem mexe nesta regra. Precisa do binário `php` no PATH (8.2+,
 * é o que o repo fixa) e de nada mais.
 *
 * Por que ele existe: três rodadas de correção seguidas fecharam um defeito de
 * fronteira de texto e abriram outro, cada uma passando na própria suíte de
 * fixtures escritas à mão. Fixture escrita à mão prova o que o autor achava
 * que a linguagem faz. Aqui o esperado não é escrito por ninguém (*) — ele
 * é perguntado ao PHP:
 *
 *     ( new ReflectionClass( 'X' ) )->getDocComment()
 *
 * que é exatamente a fonte que o PHPUnit 9.6 lê para achar `@covers`.
 * (*) Só metade: o PHP responde QUAL docblock a classe recebe; o que esse
 * docblock significa é decidido por uma cópia de `COVERS_RE` mais abaixo.
 * Essa segunda metade é fixada por fixture, não por este oráculo — está
 * explicado no bloco junto de `esperadoDoOraculo`. O
 * harness gera arquivos PHP de formas variadas (docblock × separador ×
 * declaração), pergunta ao PHP qual docblock ele associa a cada classe,
 * pergunta à regra o que ela conclui, e separa as divergências em falso
 * positivo (bloqueia código correto) e falso negativo (deixa passar violação).
 *
 * O oráculo responde três coisas, não duas: a classe EXISTE? e, se existe,
 * QUAL docblock ela recebe? A terceira resposta — "essa classe não existe" —
 * é o que torna mensurável a família de falso positivo em região não-PHP:
 * texto entre `?>` e `<?php`, ou num arquivo sem tag nenhuma, é saída
 * literal, e `class Fantasma extends Nada` ali é prosa, não declaração. Além
 * da conclusão sobre a classe do caso, o harness confere TODO nome que a
 * regra acusou contra o `class_exists` do PHP (coluna CLASSE INVENTADA):
 * acusar um nome que não existe põe, na linha `desvios:` da ADR-0013, uma
 * classe que ninguém vai encontrar.
 *
 * O que o harness ACHA vira fixture Jest em `tests/rule-covers.test.js`: ele
 * acha, as fixtures travam.
 *
 * Uma terceira coluna, `divergência ratificada`, existe porque a regra é
 * deliberadamente mais estrita que o PHP num ponto: uma linha de CÓDIGO entre
 * o docblock e a classe não impede o PHP de anexar, e aqui quebra a
 * adjacência (decisão da rodada 2, mantida por todos os briefs seguintes). Os
 * separadores que caem nessa conta são marcados na ORIGEM — `codigo: true` no
 * gerador — e não em cima do resultado, para que nenhum defeito novo consiga
 * se esconder nessa coluna.
 *
 * Custo: `php` neste ambiente leva ~350ms só para subir, então os casos vão em
 * lotes — um processo por lote, um `class Sentinela {}` entre um caso e o
 * seguinte para que nenhum docblock pendente atravesse a fronteira. Um lote
 * que não compila (combinação que a linguagem recusa) é remedido caso a caso,
 * um processo por vez, para que um caso inválido não apague a medição de 39
 * válidos.
 */
const { execFileSync } = require( 'node:child_process' );
const fs = require( 'node:fs' );
const os = require( 'node:os' );
const path = require( 'node:path' );
const { createContext } = require( '../context' );
const regra = require( '../rules/covers-annotation' );

const ARQUIVO_NO_ESCOPO = 'features/narration/tests/php/test-caso.php';
// As duas bases que os casos estendem. Nenhuma das duas estende nada, então
// nenhuma entra em escopo pela regra — elas só existem para o PHP compilar.
const PRELUDIO = '<?php\nclass A {}\nreadonly class R {}\n\n';
const TAMANHO_DO_LOTE = 40;

const DOCBLOCKS = [
	{ id: 'sem-docblock', texto: '' },
	{ id: 'doc-covers-multi', texto: '/**\n * @covers Post_Voice_Assets\n */' },
	{ id: 'doc-covers-uma-linha', texto: '/** @covers Post_Voice_Assets */' },
	{
		id: 'doc-covers-default-class',
		texto: '/** @coversDefaultClass Post_Voice_Assets */',
	},
	{ id: 'doc-sem-covers', texto: '/** nota qualquer */' },
	{ id: 'doc-covers-nothing', texto: '/** @coversNothing */' },
	// Não são docblocks para o lexer do PHP (`/**` tem de ser seguido de
	// espaço em branco), então o PHPUnit não lê o `@covers` de dentro deles.
	{ id: 'nao-doc-sem-espaco', texto: '/**@covers Post_Voice_Assets*/' },
	{ id: 'nao-doc-tres-estrelas', texto: '/*** @covers Post_Voice_Assets */' },
	{ id: 'nao-doc-bloco-comum', texto: '/* @covers Post_Voice_Assets */' },
	{
		id: 'doc-com-barra-barra',
		texto: '/** @covers Post_Voice_Assets — ver [1]// nota */',
	},
	{
		id: 'doc-com-covers-class-dentro',
		texto: '/** @see #[CoversClass( Post_Voice_Assets::class )] */',
	},
	{ id: 'doc-vazio', texto: '/** */' },
];

const SEPARADORES = [
	{ id: 'nada', texto: '\n' },
	{ id: 'mesma-linha', texto: ' ' },
	{ id: 'linhas-em-branco', texto: '\n\n\n' },
	{ id: 'bloco-uma-linha', texto: '\n/* banner */\n' },
	{ id: 'bloco-varias-linhas', texto: '\n/*\n * banner\n */\n' },
	{ id: 'bloco-com-abre-doc-dentro', texto: '\n/* nota: /** x */\n' },
	{ id: 'linha-barra-barra', texto: '\n// nota\n' },
	{ id: 'linha-cerquilha', texto: '\n# nota\n' },
	{ id: 'atributo', texto: "\n#[Group( 'lento' )]\n" },
	{ id: 'atributo-varias-linhas', texto: "\n#[Group(\n\t'lento'\n)]\n" },
	{ id: 'dois-atributos', texto: "\n#[Group( 'a' )]\n#[Isolated]\n" },
	{ id: 'atributo-colchete-em-string', texto: "\n#[Group( ']//' )]\n" },
	{ id: 'atributo-fecha-doc-em-string', texto: "\n#[Group( '*/ //' )]\n" },
	{ id: 'atributo-cerquilha-em-string', texto: "\n#[Group( ']#x' )]\n" },
	{ id: 'atributo-comentario-grudado', texto: "\n#[Group( 'a' )] // nota\n" },
	{ id: 'comentario-grudado', texto: ' // nota\n' },
	{ id: 'atributo-e-comentario', texto: "\n// nota\n#[Group( 'a' )]\n" },
	{ id: 'atributo-mesma-linha', texto: " #[Group( 'a' )] " },
	// Token de código entre o docblock e a classe: o PHP anexa através de
	// tudo isto, a regra deliberadamente não. Ver o cabeçalho. A tag de
	// fechamento entra aqui porque `?>` é um token como outro qualquer para
	// a regra de adjacência ratificada — inclusive quando quem a traz é um
	// comentário de linha que termina nela.
	{ id: 'codigo-atribuicao', texto: '\n$x = 1;\n', codigo: true },
	{ id: 'codigo-fecha-tag', texto: '\n?>\n<?php\n', codigo: true },
	{
		id: 'codigo-comentario-ate-fecha-tag',
		texto: '\n// nota ?>\n<?php\n',
		codigo: true,
	},
	// Região NÃO-PHP com CONTEÚDO, e com uma classe fantasma dentro dela.
	// `?>` seguido de `<?php` sem nada no meio (o separador acima) não
	// exercita o que importa: o texto entre as duas tags é saída literal, o
	// PHP nunca o compila, e uma classe "declarada" ali não existe. `NOME` é
	// substituído aqui como nas declarações, para que o nome fantasma seja
	// único por caso e o oráculo possa ser perguntado sobre ele.
	{
		id: 'codigo-html-com-conteudo',
		texto:
			'\n?>\n<p>and the class NOME_Fantasma extends nothing here</p>\n' +
			'<?php\n',
		codigo: true,
	},
];

const DECLARACOES = [
	{ id: 'simples', texto: 'class NOME extends A {}' },
	{ id: 'final', texto: 'final class NOME extends A {}' },
	{ id: 'final-linha-propria', texto: 'final\nclass NOME extends A {}' },
	// `extends R`, e não `extends A`: uma classe readonly só pode estender
	// uma classe readonly (fatal em tempo de compilação, PHP 8.2). O nome da
	// base é indiferente para a regra, que só olha se HÁ `extends`.
	{ id: 'readonly', texto: 'readonly class NOME extends R {}' },
	{ id: 'final-readonly', texto: 'final readonly class NOME extends R {}' },
	{
		id: 'atributo-na-mesma-linha',
		texto: "#[Group( 'a' )] class NOME extends A {}",
	},
	{
		id: 'corpo-com-metodo',
		texto: "class NOME extends A {\n\tpublic function t() { $s = '@covers X'; }\n}",
	},
	// Fora de escopo por decisão da ADR/brief: a regra nunca acusa estas, dê
	// o PHP o docblock que der.
	{
		id: 'abstrata',
		texto: 'abstract class NOME extends A {}',
		foraDeEscopo: true,
	},
	{ id: 'sem-extends', texto: 'class NOME {}', foraDeEscopo: true },
	// A classe do caso é declarada FORA da tag PHP: é texto de saída, o PHP
	// não a compila, e `class_exists` responde false. O esperado, portanto, é
	// que a regra fique CALADA — qualquer acusação aqui é falso positivo, e
	// o nome que apareceria na linha `desvios:` da ADR seria o de uma classe
	// que não existe.
	//
	// A classe `NOME_Real` antes do `?>` não é decoração: sem ela, um
	// separador que termina em atributo (`#[Group( 'a' )]`) ficaria colado na
	// tag de fechamento, e `#[…] ?>` é ERRO DE SINTAXE (o `?>` fecha o
	// statement, e um atributo não pode ficar sozinho). Medido com `php -l`.
	// Com ela, todas as 22 × 12 combinações compilam, e a coluna SEM VERDADE
	// DE CAMPO continua em 0.
	{
		id: 'fora-de-tag-declaracao',
		texto: 'class NOME_Real extends A {}\n?>\nclass NOME extends A {}\n<?php',
	},
	{
		id: 'fora-de-tag-prosa',
		texto:
			'class NOME_Real extends A {}\n?>\n' +
			'<p>the class NOME extends nothing here</p>\n<?php',
	},
];

// A metade fácil do oráculo — com um asterisco, e o asterisco importa. O PHP
// responde QUAL docblock a classe recebe (é a pergunta difícil, a que três
// rodadas erraram); O QUE esse docblock significa é decidido aqui por uma
// CÓPIA das regexes da regra. Se `COVERS_RE` tiver defeito, `esperadoDoOraculo`
// se move junto e o harness não enxerga nada — por construção, não por
// descuido: o PHP não tem opinião sobre `@covers`, quem tem é o PHPUnit, e
// carregar o PHPUnit aqui trocaria um harness de 20 s por um de minutos.
// Essa segunda metade é fixada por FIXTURE, não pelo oráculo: o fixture
// M-P em `tests/rule-covers.test.js` (`#[CoversClass( ... )]` dentro de um
// docblock continua sendo acusado) mata o mutante `COVERS_RE` que aceitaria
// `CoversClass`. Ao ler "o esperado não é escrito por ninguém" no cabeçalho,
// leia "para qual docblock a classe recebe".
const COVERS_RE = /@covers(?:DefaultClass)?\b/;
const COVERS_NOTHING_RE = /@coversNothing\b/;
const MARCA_RE = /\x01([A-Za-z_0-9]+)\x02([a-z-]+)\x04([\s\S]*?)\x03/g;

// O que o PHP respondeu sobre um nome. `ausente` é o terceiro estado, e ele é
// verdade de campo tanto quanto os outros dois: uma classe que a regra
// "descobriu" em texto que o PHP nunca compilou (HTML, prosa depois de `?>`)
// simplesmente NÃO EXISTE, e acusá-la é falso positivo.
const AUSENTE = 'ausente';
const SEM_DOC = 'sem-doc';
const COM_DOC = 'doc';

/**
 * O programa PHP que responde, para cada nome, se a classe existe e o que
 * `getDocComment()` dá.
 *
 * @param {string}   arquivo caminho absoluto do .php a carregar
 * @param {string[]} nomes   classes a consultar
 * @return {string} código para `php -r`
 */
function programaDoOraculo( arquivo, nomes ) {
	const lista = JSON.stringify( JSON.stringify( nomes ) );
	return `error_reporting( 0 );
require ${ JSON.stringify( arquivo ) };
foreach ( json_decode( ${ lista } ) as $nome ) {
	if ( ! class_exists( $nome, false ) ) {
		echo "\\x01", $nome, "\\x02${ AUSENTE }\\x04\\x03";
		continue;
	}
	$d = ( new ReflectionClass( $nome ) )->getDocComment();
	echo "\\x01", $nome, "\\x02", $d === false ? "${ SEM_DOC }\\x04" : "${ COM_DOC }\\x04$d", "\\x03";
}`;
}

/**
 * Roda o PHP sobre um arquivo e devolve, para cada classe pedida, o que ele
 * respondeu. Mapa vazio quando o arquivo não compila (ou quando o `php` não
 * roda — mas esse caso é barrado antes, em `exigirPhp`).
 *
 * @param {string}   arquivo caminho absoluto do .php
 * @param {string[]} nomes   classes a consultar
 * @return {Map<string, {existe:boolean, doc:(string|null)}>} nome → resposta
 */
function oraculo( arquivo, nomes ) {
	const fora = new Map();
	let saida;
	try {
		saida = execFileSync(
			'php',
			[ '-r', programaDoOraculo( arquivo, nomes ) ],
			{
				encoding: 'utf8',
				stdio: [ 'ignore', 'pipe', 'ignore' ],
				maxBuffer: 32 * 1024 * 1024,
			}
		);
	} catch ( e ) {
		return fora;
	}
	MARCA_RE.lastIndex = 0;
	let m;
	while ( ( m = MARCA_RE.exec( saida ) ) !== null ) {
		fora.set( m[ 1 ], {
			existe: m[ 2 ] !== AUSENTE,
			doc: m[ 2 ] === COM_DOC ? m[ 3 ] : null,
		} );
	}
	return fora;
}

/**
 * Falha duro se o `php` não roda. Sem isto, "o oráculo nunca rodou" e "o PHP
 * concorda com a regra em tudo" produzem a mesma saída verde — que é
 * exatamente a forma de falha que este harness existe para eliminar.
 *
 * @return {void} sai do processo com código 2 quando o `php` não responde
 */
function exigirPhp() {
	try {
		execFileSync( 'php', [ '-r', 'echo "ok";' ], {
			encoding: 'utf8',
			stdio: [ 'ignore', 'pipe', 'ignore' ],
		} );
	} catch ( e ) {
		process.stderr.write(
			`o binário \`php\` não executou (${ e.code || e.message }).\n` +
				'Este harness NÃO tem valor sem ele: o esperado de cada caso é ' +
				'o que o PHP responde.\n' +
				'Instale o PHP 8.2+ e ponha no PATH.\n'
		);
		process.exit( 2 );
	}
}

/**
 * O que a regra conclui SOBRE A CLASSE DO CASO ('limpo', 'sem-covers' ou
 * 'covers-nothing'), e TODOS os nomes de classe que ela acusou no arquivo.
 *
 * A conclusão filtra pelo nome da classe do caso porque o prelúdio declara
 * duas bases (`A` e `R`) e uma revisão antiga da regra pode acusá-las — a
 * medição não pode confundir "acusou a base" com "acusou o caso". Uma revisão
 * cuja chave não carrega nome de classe (a de `92fb2c0` era por arquivo) cai
 * no primeiro achado.
 *
 * A lista de nomes existe para uma pergunta diferente e independente: o PHP
 * conhece todas essas classes? Um nome que a regra acusa e que o PHP nunca
 * compilou é uma CLASSE INVENTADA — falso positivo cuja saída, para quem for
 * barrado, seria uma linha `desvios:` na ADR-0013 nomeando algo que não
 * existe.
 *
 * @param {string} fonte conteúdo do arquivo PHP
 * @param {string} nome  a classe do caso
 * @return {{conclusao:string, nomesAcusados:string[]}} o que a regra disse
 */
function conclusaoDaRegra( fonte, nome ) {
	const achados = regra.check(
		createContext( { files: [ ARQUIVO_NO_ESCOPO ], read: () => fonte } )
	);
	const porNome = achados.filter( ( a ) => a.key.endsWith( `:${ nome }` ) );
	const semNome = achados.filter( ( a ) => ! a.key.includes( ':' ) );
	const meu = porNome.length > 0 ? porNome[ 0 ] : semNome[ 0 ];
	const nomesAcusados = [
		...new Set(
			achados
				.filter( ( a ) => a.key.includes( ':' ) )
				.map( ( a ) => a.key.split( ':' ).pop() )
				.filter( ( n ) => /^[A-Za-z_]\w*$/.test( n ) )
		),
	];
	return {
		conclusao:
			meu === undefined
				? 'limpo'
				: meu.key.split( '→ ' )[ 1 ].split( ':' )[ 0 ],
		nomesAcusados,
	};
}

/**
 * A resposta do PHP em uma linha, para o relatório de divergência.
 *
 * @param {{existe:boolean, doc:(string|null)}} resposta o que o PHP disse
 * @return {string} texto
 */
function descreverResposta( resposta ) {
	if ( ! resposta.existe ) {
		return 'a classe NÃO EXISTE (o PHP nunca a compilou)';
	}
	return JSON.stringify( resposta.doc );
}

/**
 * O que a regra DEVERIA concluir, derivado só do que o PHP respondeu.
 *
 * @param {{existe:boolean, doc:(string|null)}} resposta o que o PHP disse
 * @return {string} 'limpo', 'sem-covers' ou 'covers-nothing'
 */
function esperadoDoOraculo( resposta ) {
	// Classe que o PHP não conhece não é classe de teste nenhuma: a regra tem
	// de ficar calada. `limpo` aqui significa "não acuse", e qualquer acusação
	// vira falso positivo pelo caminho normal.
	if ( ! resposta.existe ) {
		return 'limpo';
	}
	const docblock = resposta.doc;
	if ( docblock !== null && COVERS_NOTHING_RE.test( docblock ) ) {
		// Ratificado desde a rodada 1: recusado, com chave própria.
		return 'covers-nothing';
	}
	if ( docblock !== null && COVERS_RE.test( docblock ) ) {
		return 'limpo';
	}
	return 'sem-covers';
}

/**
 * A matriz inteira.
 *
 * @return {{id:string, nome:string, corpo:string, fonte:string, codigoEntre:boolean, foraDeEscopo:boolean}[]} os casos
 */
function gerarCasos() {
	const casos = [];
	for ( const doc of DOCBLOCKS ) {
		for ( const sep of SEPARADORES ) {
			for ( const decl of DECLARACOES ) {
				const nome = `Caso_${ casos.length + 1 }`;
				// `split`/`join` e não `replace`: `String.replace` com um
				// literal troca só a PRIMEIRA ocorrência, e as formas de
				// região não-PHP têm duas ou três.
				const comNome = ( t ) => t.split( 'NOME' ).join( nome );
				const corpo =
					doc.texto +
					comNome( sep.texto ) +
					comNome( decl.texto ) +
					'\n';
				casos.push( {
					id: `${ doc.id } | ${ sep.id } | ${ decl.id }`,
					nome,
					corpo,
					fonte: PRELUDIO + corpo,
					codigoEntre: Boolean( sep.codigo ) && doc.texto !== '',
					foraDeEscopo: Boolean( decl.foraDeEscopo ),
				} );
			}
		}
	}
	return casos;
}

/**
 * Mede o oráculo para um lote de casos num processo só; se o lote não
 * compilar, remede caso a caso.
 *
 * O `class Sentinela {}` entre um caso e o seguinte garante que o lote mede a
 * mesma coisa que o caso isolado mediria: uma declaração de classe consome
 * qualquer docblock pendente, então nada atravessa a fronteira entre dois
 * casos. É também o mesmo contexto que o caso isolado tem (`class A {}` antes
 * dele).
 *
 * A pergunta ao PHP cobre a classe do caso E todo nome que a regra acusou
 * nele: é assim que uma classe INVENTADA (acusada num texto que o PHP nunca
 * compilou) tem verdade de campo para ser comparada. Os nomes são únicos por
 * caso, então o lote não os confunde.
 *
 * @param {Object[]} lote casos, já com `nomesAcusados`
 * @param {string}   dir  diretório temporário
 * @return {Map<string, {existe:boolean, doc:(string|null)}>} nome → resposta
 */
function medirLote( lote, dir ) {
	const arquivo = path.join( dir, `lote-${ lote[ 0 ].nome }.php` );
	const fonte =
		PRELUDIO +
		lote
			.map( ( c ) => `class Sentinela_${ c.nome } {}\n\n${ c.corpo }` )
			.join( '\n' );
	fs.writeFileSync( arquivo, fonte );
	const perguntar = ( c ) => [ ...new Set( [ c.nome, ...c.nomesAcusados ] ) ];
	const nomes = [ ...new Set( lote.flatMap( perguntar ) ) ];
	const medido = oraculo( arquivo, nomes );
	if ( medido.size === nomes.length ) {
		return medido;
	}
	const um = new Map();
	for ( const caso of lote ) {
		const isolado = path.join( dir, `${ caso.nome }.php` );
		fs.writeFileSync( isolado, caso.fonte );
		for ( const [ k, v ] of oraculo( isolado, perguntar( caso ) ) ) {
			um.set( k, v );
		}
	}
	return um;
}

function main() {
	const verbose = process.argv.includes( '--verbose' );
	exigirPhp();
	const dir = fs.mkdtempSync( path.join( os.tmpdir(), 'covers-oracle-' ) );
	const casos = gerarCasos();
	const contagem = {
		total: casos.length,
		ok: 0,
		falsoPositivo: 0,
		falsoNegativo: 0,
		chaveDivergente: 0,
		divergenciaRatificada: 0,
		semVerdadeDeCampo: 0,
		classeInventada: 0,
	};
	const linhas = [];
	for ( let i = 0; i < casos.length; i += TAMANHO_DO_LOTE ) {
		const lote = casos.slice( i, i + TAMANHO_DO_LOTE );
		// A regra roda ANTES do PHP: são os nomes que ela acusa que dizem
		// sobre o que mais o oráculo precisa ser perguntado.
		for ( const caso of lote ) {
			const dito = conclusaoDaRegra( caso.fonte, caso.nome );
			caso.obtido = dito.conclusao;
			caso.nomesAcusados = dito.nomesAcusados;
		}
		const medido = medirLote( lote, dir );
		for ( const caso of lote ) {
			if ( ! medido.has( caso.nome ) ) {
				// Sem verdade de campo: ou o arquivo não compilou, ou o
				// `php` parou de responder no meio da corrida. Não é
				// "concordam com o PHP", e não pode sair 0.
				contagem.semVerdadeDeCampo += 1;
				linhas.push(
					`?     ${ caso.id } (o PHP não respondeu: o arquivo não compilou, ou o php falhou)\n` +
						`      fonte: ${ JSON.stringify( caso.fonte ) }`
				);
				continue;
			}
			const doPhp = medido.get( caso.nome );
			const obtido = caso.obtido;
			const esperado = caso.foraDeEscopo
				? 'limpo'
				: esperadoDoOraculo( doPhp );
			// Toda classe acusada que o PHP não conhece, conte-se o caso como
			// se contar. É uma checagem SEPARADA da conclusão do caso, porque
			// o fantasma pode ter outro nome (uma classe em prosa no meio de
			// HTML, por exemplo) e nunca apareceria na conclusão.
			for ( const acusado of caso.nomesAcusados ) {
				const resp = medido.get( acusado );
				if ( resp !== undefined && ! resp.existe ) {
					contagem.classeInventada += 1;
					linhas.push(
						`INV   ${ caso.id }\n` +
							`      a regra acusou "${ acusado }", que o PHP nunca compilou\n` +
							`      fonte: ${ JSON.stringify( caso.fonte ) }`
					);
				}
			}
			if ( obtido === esperado ) {
				contagem.ok += 1;
				if ( verbose ) {
					linhas.push( `ok    ${ caso.id } → ${ obtido }` );
				}
				continue;
			}
			// A divergência ratificada tem uma forma só: com um token de
			// código no meio, a regra não enxerga docblock NENHUM, então
			// responde `sem-covers` — qualquer que fosse o docblock (com
			// `@covers`, ou com `@coversNothing`, cuja chave própria ela
			// deixa de usar). A condição exige que a regra esteja ACUSANDO,
			// então nenhum falso negativo cabe nesta coluna. E exige que a
			// CLASSE EXISTA: a ratificação é sobre adjacência de docblock numa
			// classe de verdade, nunca sobre acusar uma classe que o PHP não
			// compilou — sem essa metade, um falso positivo de região não-PHP
			// se esconderia aqui.
			if ( caso.codigoEntre && obtido === 'sem-covers' && doPhp.existe ) {
				contagem.divergenciaRatificada += 1;
				if ( verbose ) {
					linhas.push( `rat.  ${ caso.id }` );
				}
				continue;
			}
			// Três divergências, não duas: acusar quando não devia (FP,
			// bloqueia código correto), não acusar quando devia (FN, deixa
			// passar violação) e acusar com a chave errada (a chave é a
			// identidade do desvio na ADR — duas causas diferentes não podem
			// dividir a mesma).
			let tipo = 'chaveDivergente';
			if ( esperado === 'limpo' ) {
				tipo = 'falsoPositivo';
			} else if ( obtido === 'limpo' ) {
				tipo = 'falsoNegativo';
			}
			const sigla = {
				falsoPositivo: 'FP',
				falsoNegativo: 'FN',
				chaveDivergente: 'KEY',
			}[ tipo ];
			contagem[ tipo ] += 1;
			linhas.push(
				`${ sigla }   ${ caso.id }\n` +
					`      PHP: ${ descreverResposta( doPhp ) }\n` +
					`      esperado: ${ esperado } · regra: ${ obtido }\n` +
					`      fonte: ${ JSON.stringify( caso.fonte ) }`
			);
		}
	}
	if ( process.argv.includes( '--keep' ) ) {
		linhas.push( `arquivos gerados em ${ dir }` );
	} else {
		fs.rmSync( dir, { recursive: true, force: true } );
	}

	process.stdout.write(
		linhas.join( '\n' ) + ( linhas.length > 0 ? '\n\n' : '' )
	);
	process.stdout.write(
		[
			`casos gerados            ${ contagem.total }`,
			`  SEM VERDADE DE CAMPO   ${ contagem.semVerdadeDeCampo } (o arquivo não compilou, ou o php falhou)`,
			`  CLASSE INVENTADA       ${ contagem.classeInventada } (acusou nome que o PHP nunca compilou)`,
			`  concordam com o PHP    ${ contagem.ok }`,
			`  divergência ratificada ${ contagem.divergenciaRatificada } (token de código entre docblock e classe)`,
			`  FALSO POSITIVO         ${ contagem.falsoPositivo }`,
			`  FALSO NEGATIVO         ${ contagem.falsoNegativo }`,
			`  CHAVE DIVERGENTE       ${ contagem.chaveDivergente }`,
			'',
		].join( '\n' )
	);
	// `semVerdadeDeCampo` entra na soma. Antes ficava de fora, e com isso o
	// harness saía 0 num estado em que o oráculo não tinha rodado para caso
	// nenhum (`php` fora do PATH: todos os casos sem verdade de campo,
	// FP/FN/CHAVE em 0, exit 0). Um verde que pode significar "não medi nada"
	// é a forma de falha que este harness existe para eliminar. `exigirPhp` já
	// barra o binário ausente; esta soma cobre o resto — um php que morre no
	// meio da corrida, e um gerador que passe a emitir PHP que não compila.
	process.exitCode =
		contagem.falsoPositivo +
			contagem.falsoNegativo +
			contagem.chaveDivergente +
			contagem.classeInventada +
			contagem.semVerdadeDeCampo ===
		0
			? 0
			: 1;
}

if ( require.main === module ) {
	main();
}

// Exportado para que uma sessão de investigação possa gerar a MESMA matriz e
// rodá-la contra outra implementação (uma revisão antiga em worktree, por
// exemplo) sem duplicar o gerador.
module.exports = { gerarCasos };
