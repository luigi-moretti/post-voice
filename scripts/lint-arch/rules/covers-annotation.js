'use strict';
const {
	phpOpenTagAt,
	stripPhpComments,
	stripPhpNoise,
} = require( '../context' );

// O glob que a ADR-0013 usa literalmente ("toda classe de teste PHPUnit sob
// `features/*/tests/php/` e `shared/tests/php/`"), não uma cópia das pastas
// que `phpunit.xml.dist` declara hoje. As duas coincidem agora, mas a regra
// tem de aplicar o CONTRATO da ADR — senão uma quinta feature com
// `tests/php` fica invisível para o gate mesmo depois de entrar no
// `phpunit.xml.dist`. Checar que o XML concorda com este glob é um defeito
// diferente (teste que existe e não roda) e pertence a `contract-pins`, uma
// task futura — não é este arquivo que deve fechar essa ponta.
//
// A barra final de cada alternativa é carga: sem ela, `tests/phpstan/` e
// `tests/php-helpers/` (que existem no repo) entrariam na checagem, porque
// `tests/php` é prefixo dos dois.
const EM_PASTA_DE_TESTE_RE =
	/^(?:features\/[^/]+\/tests\/php\/|shared\/tests\/php\/)/;

const emPastaDeTeste = ( f ) =>
	f.endsWith( '.php' ) && EM_PASTA_DE_TESTE_RE.test( f );

// Palavras que podem preceder `class` sem quebrar a ligação com o docblock:
// o PHP anexa o docblock normalmente através delas, em qualquer combinação e
// capitalização. `abstract` é a única que muda o resultado (a classe sai de
// escopo); as outras só são atravessadas.
const MODIFICADORES_DE_CLASSE = new Set( [ 'abstract', 'final', 'readonly' ] );

// Um identificador PHP a partir da posição corrente (sticky). `\w` basta:
// nomes de classe fora de [A-Za-z0-9_] não existem neste repo e o critério
// anterior era o mesmo.
const IDENTIFICADOR_RE = /[A-Za-z_]\w*/y;

// `class` seguido do nome, com o `extends` opcional logo depois. Rodam sobre
// `codigo` (stripPhpNoise), onde comentário e corpo de string já são espaço —
// então um comentário entre `class` e o nome, ou entre o nome e `extends`,
// é atravessado sem tratamento especial.
const NOME_DA_CLASSE_RE = /\s+(\w+)/y;
const EXTENDS_RE = /\s*extends\s+[\w\\]+/iy;

// A regra do próprio lexer do PHP para o que é um DOCBLOCK e não um
// comentário de bloco qualquer: `/**` seguido de espaço em branco. Verificado
// contra `ReflectionClass::getDocComment()` do PHP 8.2.32 —
// `/**@covers Foo*/` (sem o espaço), `/*** @covers Foo */` (três estrelas) e
// `/**/` NÃO são docblocks para o PHP, e portanto o PHPUnit não lê `@covers`
// nenhum ali. Aceitá-los aqui seria absolver uma classe que o PHPUnit conta
// como sem cobertura declarada — falso negativo, a direção pior.
const ABRE_DOCBLOCK_RE = /^\/\*\*[ \t\r\n]/;

// `@coversNothing` é checada à parte, NUNCA por esta — ver `check`. Sem a
// alternância "Nothing" aqui, `@covers\b` sozinho não casa "@coversNothing"
// (depois de "@covers" vem "N", caractere de palavra, então não há fronteira
// de palavra ali) — é por isso que a rejeição de `@coversNothing` precisa da
// sua própria regex, não de mais um ramo desta.
//
// `#[CoversClass( Foo::class )]` (o atributo do PHPUnit 10 equivalente a
// `@covers`) não entra nem aqui nem em `COVERS_NOTHING_RE`, de propósito:
// `composer.json` fixa `phpunit/phpunit: ^9.6` (9.6.36 travado no lock), e a
// série 9.6 lê anotação de docblock e ignora atributo — cobertura por
// atributo só existe a partir do PHPUnit 10. Uma classe cujo único "covers"
// é um atributo não tem cobertura declarada de fato hoje, e é corretamente
// acusada. Migrar para PHPUnit 10+ é o que reabriria esta decisão. O atributo
// também nunca chega a ser lido: a varredura pula atributo inteiro, e o que
// `COVERS_RE` recebe é sempre texto de dentro de um docblock. As duas
// proteções são independentes de propósito, e as duas têm teste.
const COVERS_RE = /@covers(?:DefaultClass)?\b/;
const COVERS_NOTHING_RE = /@coversNothing\b/;

const ehBranco = ( ch ) => ch === undefined || /\s/.test( ch );

/**
 * O fim (exclusivo) do comentário que começa em `i`.
 *
 * Mesmas fronteiras que `strip` em `context.js` usa, porque é o mesmo texto
 * sendo lido: um `/* ... *\/` termina no primeiro `*\/` (não há aninhamento em
 * PHP) ou no fim do arquivo; um comentário de linha termina na quebra de
 * linha OU numa tag `?>`, o que vier primeiro — a tag fecha o comentário e
 * volta a ser sintaxe, então ela não pode ser engolida aqui.
 *
 * @param {string} raw arquivo cru
 * @param {number} i   offset do primeiro caractere do comentário
 * @return {number} offset exclusivo do fim do comentário
 */
function fimDoComentario( raw, i ) {
	if ( raw.startsWith( '/*', i ) ) {
		const fecha = raw.indexOf( '*/', i + 2 );
		return fecha === -1 ? raw.length : fecha + 2;
	}
	const fimLinha = raw.indexOf( '\n', i );
	const fimTag = raw.indexOf( '?>', i );
	if ( fimTag !== -1 && ( fimLinha === -1 || fimTag < fimLinha ) ) {
		return fimTag;
	}
	return fimLinha === -1 ? raw.length : fimLinha;
}

/**
 * O offset logo depois do `]` que fecha o atributo do PHP 8 aberto em `i`
 * (`codigo[i]` é `#` e `codigo[i+1]` é `[`), ou `i` quando o colchete não
 * fecha.
 *
 * Conta profundidade sobre `codigo` (stripPhpNoise), nunca sobre o cru: um
 * `]` dentro de uma string do atributo — `#[Group( ']' )]` — é corpo de
 * string, não estrutura, e contá-lo fecharia o atributo cedo demais. Em
 * `codigo` o corpo da string já é espaço, então os únicos colchetes que
 * sobram são os de verdade. Este é o padrão de duas fontes do projeto:
 * ESTRUTURA sai de `codigo`, CONTEÚDO sai do cru — e os dois têm o mesmo
 * comprimento, então o offset vale nos dois.
 *
 * @param {string} codigo arquivo com stripPhpNoise
 * @param {number} i      offset do `#` que abre o atributo
 * @return {number} offset após o `]` de fechamento, ou `i` se não fecha
 */
function fimDoAtributo( codigo, i ) {
	let profundidade = 0;
	for ( let j = i + 1; j < codigo.length; j++ ) {
		if ( codigo[ j ] === '[' ) {
			profundidade++;
		} else if ( codigo[ j ] === ']' ) {
			profundidade--;
			if ( profundidade === 0 ) {
				return j + 1;
			}
		}
	}
	return i;
}

/**
 * Varre o arquivo UMA VEZ, da esquerda para a direita, e devolve as classes
 * em escopo com o docblock que o PHP anexaria a cada uma.
 *
 * Por que uma varredura para a frente, e não a busca para trás que as rodadas
 * 1-3 tinham: a pergunta que a regra faz — "qual docblock o PHP associa a esta
 * classe?" — é respondida pelo lexer do PHP, que caminha para a frente
 * guardando o último docblock visto e o entrega à próxima declaração. Toda
 * tentativa de responder isso andando para trás a partir da classe vira uma
 * lista de "o que pode separar os dois", e cada rodada de correção descobriu
 * mais um item que faltava (comentário de bloco, modificador em linha própria,
 * `]` dentro de string). Andando para a frente não existe lista: cada coisa
 * que aparece é classificada uma vez, e o docblock em vigor sobrevive ou não.
 *
 * O modelo, verificado caso a caso contra `getDocComment()` do PHP 8.2.32
 * (ver `tools/covers-oracle-diff.js`):
 *
 * - o arquivo começa FORA do PHP, e só o que está DENTRO de `<?php … ?>`
 *   (ou `<?= … ?>`) é código. Fora, o texto é saída literal: `class Fantasma
 *   extends Nada` no meio de um HTML é prosa, e o PHP nunca a compila —
 *   acusá-la seria pôr na linha `desvios:` da ADR-0013 uma classe que não
 *   existe. `__halt_compiler()` tem o mesmo efeito daí para a frente: o resto
 *   do arquivo é dado, não código (medido: `class_exists` responde false para
 *   uma classe declarada depois dele);
 * - um DOCBLOCK passa a ser o docblock em vigor (o mais próximo vence,
 *   porque o seguinte simplesmente sobrescreve o anterior);
 * - espaço em branco, comentário comum (`/* *\/`, `//`, `#`), atributo do
 *   PHP 8 e os modificadores `final`/`readonly`/`abstract` preservam o
 *   docblock em vigor — o PHP também anexa através de todos eles;
 * - QUALQUER outro token o descarta;
 * - uma declaração de classe CONSOME o docblock em vigor, mesmo quando a
 *   classe está fora de escopo — é assim que o `@covers` de uma classe não
 *   vaza para a seguinte, e é o que o PHP faz.
 *
 * A terceira regra é deliberadamente mais estrita que o PHP: `$x = 1;` entre
 * o docblock e a classe não impede o PHP de anexar, e aqui quebra a
 * adjacência. É a divergência ratificada do brief da rodada 2 ("uma linha de
 * código entre o docblock e a classe quebra a adjacência"), e ela é
 * conservadora: erra acusando, nunca absolvendo. O conjunto de separadores
 * que ESTA função aceita é subconjunto estrito do que o PHP aceita, então
 * nenhuma classe é absolvida por um docblock que o PHPUnit não veria.
 *
 * Fontes, e por que são três:
 * - `codigo` (stripPhpNoise) responde ESTRUTURA: o que é código de verdade,
 *   já sem corpo de string e sem comentário;
 * - `semComentarios` (stripPhpComments) separa as duas coisas que ficam em
 *   branco em `codigo`: onde ele também está em branco era COMENTÁRIO, onde
 *   ele preserva o texto era CORPO DE STRING;
 * - o cru responde CONTEÚDO: o texto do docblock só existe nele.
 * Os três têm o mesmo comprimento em bytes (os strippers apagam PARA ESPAÇO),
 * então um offset vale nos três. Os dois strippers rodam sobre o cru, em
 * passadas independentes — compô-los é proibido, ver `context.js`.
 *
 * Classe abstrata é pulada aqui, na descoberta — não filtrada depois nem
 * absolvida por uma anotação de escape. PHPUnit não instancia uma classe
 * abstrata; ela não é "classe de teste PHPUnit" no sentido do `## Contexto`
 * da ADR-0013 (não gera número de cobertura nenhum para atribuir mal), é
 * infraestrutura.
 *
 * "Não estende nada" também é pulada: sob `phpunit/phpunit: ^9.6` (9.6.36 no
 * lock) uma classe só é coletada como teste se estende `TestCase` — não
 * existe coleta por atributo antes do PHPUnit 10 (mesma razão do comentário
 * perto de `COVERS_RE`). Sem esse pulo, uma classe concreta auxiliar (um
 * stub, um builder de dados) ficaria em escopo sem NENHUMA saída. As 10
 * classes reais do repo estendem `WP_UnitTestCase`.
 *
 * @param {string} raw arquivo cru
 * @return {{nome:string, line:number, docblock:(string|null)}[]} uma por classe em escopo
 */
function varrerClasses( raw ) {
	const codigo = stripPhpNoise( raw );
	const semComentarios = stripPhpComments( raw );
	const encontradas = [];
	let i = 0;
	// O arquivo começa FORA do PHP, como em `strip`. Para os arquivos que
	// começam com `<?php` — todos os do repo — a fatia "fora" é vazia.
	let dentro = false;
	let docblock = null;
	let abstrata = false;
	let palavraAnterior = null;
	// Os dois últimos caracteres de ESTRUTURA vistos, para distinguir a
	// declaração `class X` de `Foo::class` e `$obj->class`, que são busca de
	// constante. `\b` não serviria: ele não separa `::` nem `->` do nome que
	// os segue.
	let doisAnteriores = '';
	while ( i < raw.length ) {
		if ( ! dentro ) {
			// Saída literal: nada aqui é código, então nada aqui é
			// declaração, comentário ou docblock. Só a tag de abertura
			// interessa — e ela é a MESMA definição que `strip` usa, para que
			// as duas não possam divergir sobre onde o código começa.
			const abre = phpOpenTagAt( codigo, i );
			if ( abre !== 0 ) {
				dentro = true;
				i += abre;
				continue;
			}
			i += 1;
			continue;
		}

		if ( codigo[ i ] === '?' && codigo[ i + 1 ] === '>' ) {
			// A tag de fechamento é um token como outro qualquer para a
			// adjacência (descarta o docblock em vigor — divergência
			// ratificada), e além disso volta o arquivo para saída literal.
			// Um `?>` dentro de string, heredoc ou `/* */` não chega aqui:
			// em `codigo` esses corpos já são espaço. Um `?>` que fecha um
			// comentário de LINHA chega, porque `fimDoComentario` para nele.
			docblock = null;
			abstrata = false;
			palavraAnterior = null;
			doisAnteriores = '?>';
			dentro = false;
			i += 2;
			continue;
		}

		if ( ehBranco( codigo[ i ] ) ) {
			// Em branco em `codigo` é uma de três coisas. Comentário: em
			// branco também em `semComentarios`, com texto no cru. Corpo de
			// string: `semComentarios` preservou o texto. Espaço de verdade:
			// o cru já é branco. Só a primeira precisa de tratamento — as
			// outras duas são atravessadas, e as aspas que delimitam a string
			// são estrutura, então elas mesmas já descartam o docblock.
			if ( ! ehBranco( raw[ i ] ) && ehBranco( semComentarios[ i ] ) ) {
				const fim = fimDoComentario( raw, i );
				const texto = raw.slice( i, fim );
				if ( ABRE_DOCBLOCK_RE.test( texto ) ) {
					docblock = texto;
				}
				i = fim;
				continue;
			}
			i += 1;
			continue;
		}

		if ( codigo[ i ] === '#' && codigo[ i + 1 ] === '[' ) {
			const fim = fimDoAtributo( codigo, i );
			if ( fim !== i ) {
				// Atributo inteiro pulado sem tocar no docblock em vigor —
				// o PHP anexa através dele.
				i = fim;
				continue;
			}
		}

		IDENTIFICADOR_RE.lastIndex = i;
		const ident = IDENTIFICADOR_RE.exec( codigo );
		if ( ident === null ) {
			// Pontuação, aspa, tag `<?php`/`?>`, dígito: token de verdade.
			doisAnteriores = ( doisAnteriores + codigo[ i ] ).slice( -2 );
			docblock = null;
			abstrata = false;
			palavraAnterior = null;
			i += 1;
			continue;
		}

		const palavra = ident[ 0 ].toLowerCase();
		let fim = i + ident[ 0 ].length;
		if (
			palavra === '__halt_compiler' &&
			doisAnteriores !== '::' &&
			doisAnteriores !== '->'
		) {
			// Daqui para a frente o arquivo é DADO: o PHP para de compilar, e
			// uma classe declarada depois disto não existe (medido com
			// `class_exists`). A guarda `->` não é decoração:
			// `$o->__halt_compiler` é busca de propriedade, PHP válido, e não
			// para compilação nenhuma — sem ela a varredura abandonaria o
			// resto do arquivo e perderia as classes seguintes (falso
			// negativo).
			break;
		}
		if ( palavra === 'class' ) {
			NOME_DA_CLASSE_RE.lastIndex = fim;
			const nome = NOME_DA_CLASSE_RE.exec( codigo );
			const declaracao =
				nome !== null &&
				palavraAnterior !== 'new' &&
				doisAnteriores !== '::' &&
				doisAnteriores !== '->';
			if ( declaracao ) {
				fim = NOME_DA_CLASSE_RE.lastIndex;
				EXTENDS_RE.lastIndex = fim;
				const estende = EXTENDS_RE.exec( codigo ) !== null;
				if ( ! abstrata && estende ) {
					encontradas.push( {
						nome: nome[ 1 ],
						line: raw.slice( 0, i ).split( '\n' ).length,
						docblock,
					} );
				}
			}
			// Consumido pela declaração — inclusive quando a classe está fora
			// de escopo, e inclusive quando isto era `Foo::class` (aí o
			// docblock já tinha sido descartado pelo `::`).
			docblock = null;
			abstrata = false;
			palavraAnterior = 'class';
			doisAnteriores = codigo.slice( fim - 2, fim );
			i = fim;
			continue;
		}

		if ( MODIFICADORES_DE_CLASSE.has( palavra ) ) {
			abstrata = abstrata || palavra === 'abstract';
		} else {
			docblock = null;
			abstrata = false;
		}
		palavraAnterior = palavra;
		doisAnteriores = ident[ 0 ].slice( -2 );
		i = fim;
	}
	return encontradas;
}

/**
 * Toda classe de teste PHPUnit em escopo — uma entrada por classe, não por
 * arquivo, porque a ADR fala em classe ("toda classe de teste PHPUnit...") e
 * um arquivo pode declarar mais de uma. Um arquivo que não declara nenhuma
 * classe elegível (os dois traits auxiliares, `bootstrap.php`,
 * `wp-tests-config.php`) não contribui entrada nenhuma.
 *
 * @param {Object} ctx
 * @return {{file:string, nome:string, line:number, docblock:(string|null)}[]} uma por classe em escopo
 */
function classesDeTeste( ctx ) {
	const out = [];
	for ( const file of ctx.files.filter( emPastaDeTeste ) ) {
		for ( const c of varrerClasses( ctx.read( file ) ) ) {
			out.push( { file, ...c } );
		}
	}
	return out;
}

function check( ctx ) {
	const achados = [];
	for ( const { file, nome, line, docblock } of classesDeTeste( ctx ) ) {
		if ( docblock && COVERS_NOTHING_RE.test( docblock ) ) {
			achados.push( {
				key: `${ file } → covers-nothing:${ nome }`,
				file,
				line,
				message: `a classe "${ nome }" está anotada com @coversNothing; a ADR-0013 exige @covers apontando para a classe que o teste de fato exercita — troque por "@covers <Classe>" (ou "@coversDefaultClass <Classe>") apontando para a classe sob teste (ADR-0013)`,
			} );
			continue;
		}

		if ( ! docblock || ! COVERS_RE.test( docblock ) ) {
			achados.push( {
				key: `${ file } → sem-covers:${ nome }`,
				file,
				line,
				message: `a classe "${ nome }" é uma classe de teste PHPUnit sem anotação @covers; sem ela a cobertura credita colaboradores à classe sob teste — acrescente um docblock imediatamente antes de "class ${ nome }" com "@covers <Classe>" apontando para a classe que este teste exercita (ADR-0013)`,
			} );
		}
	}
	return achados;
}

module.exports = {
	id: 'covers-annotation',
	adr: '0013',
	check,
	classesDeTeste,
};
