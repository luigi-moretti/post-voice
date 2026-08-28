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
 * que a linguagem faz. Aqui o esperado não é escrito por ninguém — ele é
 * perguntado ao PHP:
 *
 *     ( new ReflectionClass( 'X' ) )->getDocComment()
 *
 * que é exatamente a fonte que o PHPUnit 9.6 lê para achar `@covers`. O
 * harness gera arquivos PHP de formas variadas (docblock × separador ×
 * declaração), pergunta ao PHP qual docblock ele associa a cada classe,
 * pergunta à regra o que ela conclui, e separa as divergências em falso
 * positivo (bloqueia código correto) e falso negativo (deixa passar violação).
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
];

const COVERS_RE = /@covers(?:DefaultClass)?\b/;
const COVERS_NOTHING_RE = /@coversNothing\b/;
const MARCA_RE = /\x01([A-Za-z_0-9]+)\x02([\s\S]*?)\x03/g;

/**
 * O programa PHP que responde, para cada nome, o que `getDocComment()` dá.
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
	$d = ( new ReflectionClass( $nome ) )->getDocComment();
	echo "\\x01", $nome, "\\x02", $d === false ? "" : $d, "\\x03";
}`;
}

/**
 * Roda o PHP sobre um arquivo e devolve o docblock que ele associa a cada
 * classe pedida. Mapa vazio quando o arquivo não compila.
 *
 * @param {string}   arquivo caminho absoluto do .php
 * @param {string[]} nomes   classes a consultar
 * @return {Map<string, (string|null)>} nome → docblock (null = nenhum)
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
		fora.set( m[ 1 ], m[ 2 ] === '' ? null : m[ 2 ] );
	}
	return fora;
}

/**
 * O que a regra conclui SOBRE A CLASSE DO CASO: 'limpo', 'sem-covers' ou
 * 'covers-nothing'.
 *
 * Filtra pelo nome da classe porque o prelúdio declara duas bases (`A` e `R`)
 * e uma revisão antiga da regra pode acusá-las — a medição não pode confundir
 * "acusou a base" com "acusou o caso". Uma revisão cuja chave não carrega
 * nome de classe (a de `92fb2c0` era por arquivo) cai no primeiro achado.
 *
 * @param {string} fonte conteúdo do arquivo PHP
 * @param {string} nome  a classe do caso
 * @return {string} a conclusão
 */
function conclusaoDaRegra( fonte, nome ) {
	const achados = regra.check(
		createContext( { files: [ ARQUIVO_NO_ESCOPO ], read: () => fonte } )
	);
	const porNome = achados.filter( ( a ) => a.key.endsWith( `:${ nome }` ) );
	const semNome = achados.filter( ( a ) => ! a.key.includes( ':' ) );
	const meu = porNome.length > 0 ? porNome[ 0 ] : semNome[ 0 ];
	if ( meu === undefined ) {
		return 'limpo';
	}
	return meu.key.split( '→ ' )[ 1 ].split( ':' )[ 0 ];
}

/**
 * O que a regra DEVERIA concluir, derivado só do que o PHP respondeu.
 *
 * @param {string|null} docblock o que `getDocComment()` devolveu
 * @return {string} 'limpo', 'sem-covers' ou 'covers-nothing'
 */
function esperadoDoOraculo( docblock ) {
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
				const corpo =
					doc.texto +
					sep.texto +
					decl.texto.replace( 'NOME', nome ) +
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
 * @param {Object[]} lote casos
 * @param {string}   dir  diretório temporário
 * @return {Map<string, (string|null)>} nome → docblock; sem entrada = PHP não carregou
 */
function medirLote( lote, dir ) {
	const arquivo = path.join( dir, `lote-${ lote[ 0 ].nome }.php` );
	const fonte =
		PRELUDIO +
		lote
			.map( ( c ) => `class Sentinela_${ c.nome } {}\n\n${ c.corpo }` )
			.join( '\n' );
	fs.writeFileSync( arquivo, fonte );
	const nomes = lote.map( ( c ) => c.nome );
	const medido = oraculo( arquivo, nomes );
	if ( medido.size === nomes.length ) {
		return medido;
	}
	const um = new Map();
	for ( const caso of lote ) {
		const isolado = path.join( dir, `${ caso.nome }.php` );
		fs.writeFileSync( isolado, caso.fonte );
		for ( const [ k, v ] of oraculo( isolado, [ caso.nome ] ) ) {
			um.set( k, v );
		}
	}
	return um;
}

function main() {
	const verbose = process.argv.includes( '--verbose' );
	const dir = fs.mkdtempSync( path.join( os.tmpdir(), 'covers-oracle-' ) );
	const casos = gerarCasos();
	const contagem = {
		total: casos.length,
		ok: 0,
		falsoPositivo: 0,
		falsoNegativo: 0,
		chaveDivergente: 0,
		divergenciaRatificada: 0,
		phpNaoCarregou: 0,
	};
	const linhas = [];
	for ( let i = 0; i < casos.length; i += TAMANHO_DO_LOTE ) {
		const lote = casos.slice( i, i + TAMANHO_DO_LOTE );
		const medido = medirLote( lote, dir );
		for ( const caso of lote ) {
			if ( ! medido.has( caso.nome ) ) {
				// PHP inválido: não há verdade de campo a comparar.
				contagem.phpNaoCarregou += 1;
				linhas.push( `?     ${ caso.id } (PHP não carregou)` );
				continue;
			}
			const doPhp = medido.get( caso.nome );
			const obtido = conclusaoDaRegra( caso.fonte, caso.nome );
			const esperado = caso.foraDeEscopo
				? 'limpo'
				: esperadoDoOraculo( doPhp );
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
			// então nenhum falso negativo cabe nesta coluna.
			if ( caso.codigoEntre && obtido === 'sem-covers' ) {
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
					`      PHP: ${ JSON.stringify( doPhp ) }\n` +
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
			`  PHP não carregou       ${ contagem.phpNaoCarregou } (combinação inválida, sem verdade de campo)`,
			`  concordam com o PHP    ${ contagem.ok }`,
			`  divergência ratificada ${ contagem.divergenciaRatificada } (token de código entre docblock e classe)`,
			`  FALSO POSITIVO         ${ contagem.falsoPositivo }`,
			`  FALSO NEGATIVO         ${ contagem.falsoNegativo }`,
			`  CHAVE DIVERGENTE       ${ contagem.chaveDivergente }`,
			'',
		].join( '\n' )
	);
	process.exitCode =
		contagem.falsoPositivo +
			contagem.falsoNegativo +
			contagem.chaveDivergente ===
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
