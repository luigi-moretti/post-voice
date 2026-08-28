'use strict';
const { stripPhpNoise } = require( '../context' );

// O glob que a ADR-0013 usa literalmente ("toda classe de teste PHPUnit sob
// `features/*/tests/php/` e `shared/tests/php/`"), não uma cópia das pastas
// que `phpunit.xml.dist` declara hoje. As duas coincidem agora, mas a regra
// tem de aplicar o CONTRATO da ADR — senão uma quinta feature com
// `tests/php` fica invisível para o gate mesmo depois de entrar no
// `phpunit.xml.dist`. Checar que o XML concorda com este glob é um defeito
// diferente (teste que existe e não roda) e pertence a `contract-pins`, uma
// task futura — não é este arquivo que deve fechar essa ponta.
const EM_PASTA_DE_TESTE_RE =
	/^(?:features\/[^/]+\/tests\/php\/|shared\/tests\/php\/)/;

const emPastaDeTeste = ( f ) =>
	f.endsWith( '.php' ) && EM_PASTA_DE_TESTE_RE.test( f );

// `class Nome`, opcionalmente seguido de `extends Alvo` — sem âncora de
// início de linha. A âncora `^` que a rodada 1 usava perdia qualquer
// declaração que não abrisse a própria linha: `<?php class X_Test extends A
// {}` (tudo numa linha só) e `#[Group('a')] class X_Test {}` (atributo antes,
// mesma linha) ficavam com ZERO classes descobertas — o arquivo inteiro
// desaparecia da checagem, em silêncio.
//
// Guarda de fronteira em três partes, e não `\b` (mesma técnica de
// `rest-namespace.js` e `php-class-naming.js`): `\b` não separa `->` nem
// `::` do nome que os segue, então sem as duas partes extras isto casaria
// `$obj->class` e `Foo::class` como se fossem declaração.
//
// O grupo de `extends` existe só para FIX 3 (ver `classesNoArquivo`) — decidir
// se a classe é "de teste" não depende dele, decidir se ela ENTRA na
// descoberta depende.
const CLASS_RE =
	/(?<!\w)(?<!->)(?<!::)class\s+(\w+)(?:\s+extends\s+([\w\\]+))?/gi;

// Palavras que podem preceder `class` sem impedir que ela seja descoberta —
// paradas no meio de uma varredura para trás por `classeEhAbstrata` sem que
// a varredura desista. `abstract` é a única que muda o resultado; as outras
// só são "atravessadas".
const MODIFICADORES_DE_CLASSE = new Set( [ 'abstract', 'final', 'readonly' ] );
const ULTIMA_PALAVRA_RE = /[A-Za-z_]\w*$/;

/**
 * Anda para trás a partir de `matchStart` (o início do match de `CLASS_RE`,
 * isto é, o começo da palavra `class`) pulando modificadores conhecidos
 * (`final`, `readonly`, em qualquer combinação e capitalização) até achar
 * `abstract` (verdadeiro) ou uma palavra que não é modificador — ou o início
 * do arquivo (falso).
 *
 * Roda sobre `codigo` (stripPhpNoise): um comentário ou uma string logo
 * antes de `class` não pode ser lido como se fosse `abstract`.
 *
 * @param {string} codigo     arquivo com stripPhpNoise
 * @param {number} matchStart offset de início do match de `CLASS_RE`
 * @return {boolean} verdadeiro quando a classe é abstrata
 */
function classeEhAbstrata( codigo, matchStart ) {
	let pos = matchStart;
	while ( true ) {
		while ( pos > 0 && /\s/.test( codigo[ pos - 1 ] ) ) {
			pos--;
		}
		const m = ULTIMA_PALAVRA_RE.exec( codigo.slice( 0, pos ) );
		if ( ! m ) {
			return false;
		}
		const palavra = m[ 0 ].toLowerCase();
		if ( palavra === 'abstract' ) {
			return true;
		}
		if ( ! MODIFICADORES_DE_CLASSE.has( palavra ) ) {
			return false;
		}
		pos -= m[ 0 ].length;
	}
}

/**
 * As classes em escopo — não abstratas, e que estendem alguma coisa.
 *
 * Abstrata é pulada aqui, na descoberta — não filtrada depois nem absolvida
 * por uma anotação de escape. PHPUnit não instancia uma classe abstrata; ela
 * não é "classe de teste PHPUnit" no sentido do `## Contexto` da ADR-0013
 * (não gera número de cobertura nenhum para atribuir mal), é infraestrutura.
 *
 * "Não estende nada" também é pulada — e esta é uma correção sobre a rodada
 * anterior, não uma permissão nova dela: fechar `@coversNothing` sem abrir
 * mais nada deixava uma classe concreta auxiliar (um stub, um builder de
 * dados) em escopo sem NENHUMA saída. Sob `phpunit/phpunit: ^9.6` (9.6.36 no
 * lock), uma classe só é coletada como teste se estende `TestCase` — não
 * existe coleta por atributo antes do PHPUnit 10 (mesma razão do comentário
 * perto de `COVERS_RE`). "Não estende nada" implica com segurança "não é
 * classe de teste" sob esta versão; as 10 classes reais do repo estendem
 * `WP_UnitTestCase`, nenhuma estende nada. Migrar para o PHPUnit 10+ é o que
 * reabriria esta decisão — assim como reabriria a de `COVERS_RE`.
 *
 * @param {Object} ctx
 * @param {string} file
 * @return {{nome:string, line:number, declStart:number}[]} uma por classe em escopo
 */
function classesNoArquivo( ctx, file ) {
	const codigo = stripPhpNoise( ctx.read( file ) );
	CLASS_RE.lastIndex = 0;
	const out = [];
	let m;
	while ( ( m = CLASS_RE.exec( codigo ) ) !== null ) {
		if ( classeEhAbstrata( codigo, m.index ) ) {
			continue; // abstract — pulada, ver JSDoc acima
		}
		if ( ! m[ 2 ] ) {
			continue; // não estende nada — pulada, ver JSDoc acima
		}
		const inicioLinha = codigo.lastIndexOf( '\n', m.index ) + 1;
		out.push( {
			nome: m[ 1 ],
			line: codigo.slice( 0, inicioLinha ).split( '\n' ).length,
			declStart: inicioLinha,
		} );
	}
	return out;
}

/**
 * Toda classe de teste PHPUnit em escopo — uma entrada por classe, não por
 * arquivo, porque a ADR fala em classe ("toda classe de teste PHPUnit...") e
 * um arquivo pode declarar mais de uma. Um arquivo que não declara nenhuma
 * classe elegível (os dois traits auxiliares, `bootstrap.php`,
 * `wp-tests-config.php`) não contribui entrada nenhuma.
 *
 * @param {Object} ctx
 * @return {{file:string, nome:string, line:number, declStart:number}[]} uma por classe em escopo
 */
function classesDeTeste( ctx ) {
	const out = [];
	for ( const file of ctx.files.filter( emPastaDeTeste ) ) {
		for ( const c of classesNoArquivo( ctx, file ) ) {
			out.push( { file, ...c } );
		}
	}
	return out;
}

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
// acusada. Migrar para PHPUnit 10+ é o que reabriria esta decisão. Isto não
// depende de `COVERS_RE` "recusar" o atributo — o atributo nunca chega a ser
// lido por `COVERS_RE`, porque `docblockDaClasse` só devolve texto de dentro
// de um docblock (ver abaixo), e um atributo não é um docblock.
const COVERS_RE = /@covers(?:DefaultClass)?\b/;
const COVERS_NOTHING_RE = /@coversNothing\b/;

/**
 * Tenta ler `codigo[ fim - 1 ]` como o `]` de fechamento de um atributo do
 * PHP 8 (`#[ ... ]`) e devolve o offset do `#` que o abre, ou `fim` sem
 * mudança quando não é um atributo.
 *
 * Roda sobre `codigo` (stripPhpNoise), não sobre o cru: uma string dentro do
 * atributo — `#[Group('lento')]` — teria colchetes de verdade se o corpo da
 * string sobrevivesse, e um `]` dentro dela contaria errado na contagem de
 * profundidade. stripPhpNoise apaga o corpo da string para espaço, então os
 * únicos `[`/`]` que sobram em `codigo` são estrutura de código de verdade.
 *
 * @param {string} codigo arquivo com stripPhpNoise
 * @param {number} fim    offset exclusivo — `codigo[fim-1]` é o candidato a `]`
 * @return {number} offset do `#` que abre o atributo, ou `fim` inalterado
 */
function pularAtributoQueTermina( codigo, fim ) {
	if ( codigo[ fim - 1 ] !== ']' ) {
		return fim;
	}
	let profundidade = 0;
	for ( let j = fim - 1; j >= 0; j-- ) {
		if ( codigo[ j ] === ']' ) {
			profundidade++;
		} else if ( codigo[ j ] === '[' ) {
			profundidade--;
			if ( profundidade === 0 ) {
				return j > 0 && codigo[ j - 1 ] === '#' ? j - 1 : fim;
			}
		}
	}
	return fim; // colchete sem par — não é atributo, não pula nada
}

/**
 * Quando a linha que termina em `fim` (sem contar espaço em branco à
 * direita, já removido por quem chama) é um comentário de linha inteira —
 * `//...` ou `#...` que não seja `#[` (isso é atributo, não comentário) —
 * devolve o início dessa linha. Senão devolve `fim` inalterado.
 *
 * Lida sobre o arquivo CRU: em `codigo` (qualquer um dos dois strippers) o
 * comentário já é espaço em branco, e não dá para diferenciar "era um
 * comentário de linha inteira" de "era espaço de verdade" — o que não
 * importa para o valor de retorno (os dois são pulados), mas importa para
 * achar o INÍCIO da linha corretamente quando o comentário tem texto.
 *
 * @param {string} raw arquivo cru
 * @param {number} fim offset exclusivo, já sem espaço em branco à direita
 * @return {number} início da linha de comentário, ou `fim` inalterado
 */
function pularComentarioDeLinhaQueTermina( raw, fim ) {
	const inicioLinha = raw.lastIndexOf( '\n', fim - 1 ) + 1;
	const linha = raw.slice( inicioLinha, fim ).replace( /^[ \t]*/, '' );
	const ehComentarioDeLinha =
		linha.startsWith( '//' ) ||
		( linha.startsWith( '#' ) && ! linha.startsWith( '#[' ) );
	return ehComentarioDeLinha ? inicioLinha : fim;
}

// `]` (fecha atributo) ou `*/` (fecha docblock ou comentário de bloco comum)
// seguido, na mesma linha, de espaço opcional e então um comentário de linha
// (`//` ou `#` que não seja `#[`). Ancorar em `]`/`*/` — e não procurar
// `//`/`#` soltos em qualquer ponto da linha — é o que impede isto de
// confundir um `//` que apareça DENTRO do próprio texto de um docblock
// (`/** ver http://x */`) com um comentário de verdade: esse `//` nunca vem
// logo depois de `]` ou `*/`. `g` para achar TODAS as ocorrências na linha —
// só a ÚLTIMA interessa (ver `pularComentarioGrudadoQueTermina`).
const COMENTARIO_GRUDADO_RE = /(\]|\*\/)([ \t]*)(?:\/\/|#(?!\[))/g;

/**
 * Um comentário de linha GRUDADO depois de código de verdade na MESMA linha
 * — `#[Group('a')] // nota`, ou um docblock de uma linha só seguido de
 * `// nota` na mesma linha — em vez de sozinho na linha inteira (isso é
 * `pularComentarioDeLinhaQueTermina`).
 *
 * Sem isto, `pularAtributoQueTermina` exige `]` no fim do trecho e recusa
 * quando o que sobra é o espaço que o comentário deixou; e
 * `pularComentarioDeLinhaQueTermina` exige a linha inteira ser comentário e
 * recusa uma linha que comece com `#[` (atributo). Os dois se recusam, e a
 * adjacência quebrava onde o PHP prende o docblock normalmente.
 *
 * @param {string} raw arquivo cru
 * @param {number} fim offset exclusivo, já sem espaço em branco à direita
 * @return {number} offset logo após o `]` ou o fecha-comentário mais próximo
 *                   de `fim` que abre um comentário de linha, ou `fim`
 *                   inalterado
 */
function pularComentarioGrudadoQueTermina( raw, fim ) {
	const inicioLinha = raw.lastIndexOf( '\n', fim - 1 ) + 1;
	const linha = raw.slice( inicioLinha, fim );
	COMENTARIO_GRUDADO_RE.lastIndex = 0;
	let ultimo = null;
	let m;
	while ( ( m = COMENTARIO_GRUDADO_RE.exec( linha ) ) !== null ) {
		ultimo = m;
	}
	return ultimo === null
		? fim
		: inicioLinha + ultimo.index + ultimo[ 1 ].length;
}

/**
 * O offset, no arquivo CRU, de onde termina o que pode legitimamente separar
 * um docblock do início da linha de declaração da classe sem quebrar a
 * adjacência entre os dois: espaço em branco, um atributo do PHP 8, um
 * comentário de linha inteira, ou um comentário de linha grudado depois de
 * um atributo/docblock na mesma linha. Todos podem se repetir e se
 * intercalar — por isso o laço insiste até uma volta não mudar nada.
 *
 * Deliberadamente NÃO pula: um comentário de bloco comum, que não abre com
 * o segundo `*` de um docblock, nem qualquer código de verdade
 * (`declare(...)`, `use Trait;`, uma constante). Nenhum dos dois foi pedido,
 * e alargar demais aqui troca o falso positivo que este laço resolve por um
 * falso negativo — um `@covers` distante passando a contar — que é a
 * direção pior.
 *
 * @param {string} raw       arquivo cru
 * @param {string} codigo    o mesmo arquivo com stripPhpNoise (mesmo comprimento)
 * @param {number} declStart offset de início da linha de declaração da classe
 * @return {number} offset após o último ruído reconhecido, andando para trás
 */
function limiteAntesDoDocblock( raw, codigo, declStart ) {
	let fim = declStart;
	let mudou = true;
	while ( mudou ) {
		mudou = false;
		while ( fim > 0 && /\s/.test( raw[ fim - 1 ] ) ) {
			fim--;
			mudou = true;
		}
		const semGrudado = pularComentarioGrudadoQueTermina( raw, fim );
		if ( semGrudado !== fim ) {
			fim = semGrudado;
			mudou = true;
			continue;
		}
		const semComentario = pularComentarioDeLinhaQueTermina( raw, fim );
		if ( semComentario !== fim ) {
			fim = semComentario;
			mudou = true;
			continue;
		}
		const semAtributo = pularAtributoQueTermina( codigo, fim );
		if ( semAtributo !== fim ) {
			fim = semAtributo;
			mudou = true;
		}
	}
	return fim;
}

/**
 * O docblock imediatamente antes da declaração da classe — tolerando, entre
 * os dois, o ruído que `limiteAntesDoDocblock` reconhece.
 *
 * Lido do arquivo CRU — não de `stripPhpNoise` nem de `stripPhpComments`,
 * porque `strip()` em `context.js` apaga comentário incondicionalmente (o
 * parâmetro `strings` decide só se o corpo de string TAMBÉM é apagado); os
 * dois strippers apagariam o próprio docblock que esta função lê. O cru é a
 * única fonte onde ele sobrevive.
 *
 * Não basta achar UM `/**` antes de um fecha-comentário: tem de ser o
 * `/**` QUE ABRE esse fecha-comentário especificamente — senão um
 * comentário de bloco comum solto entre duas classes (um separador
 * visual) deixa a busca atravessar código arbitrário até um docblock
 * alheio, herdando o `@covers` de uma classe vizinha (e, pior, confundindo
 * a IDENTIDADE do defeito quando esse alheio é `@coversNothing` — o achado
 * sairia com a chave errada). A checagem é: a partir do `/**` achado, o
 * primeiro fecha-comentário que aparece tem de ser exatamente o que fecha
 * `antes` — não pode haver nenhum outro fecha-comentário mais cedo no
 * meio; isso significaria que o `/**` achado não é o dono do fechamento
 * final.
 *
 * A barreira de adjacência (mais esta checagem de par) resolve, de graça,
 * dois problemas:
 *   - por classe, não por arquivo (ADR-0013 fala em classe): o docblock de UM
 *     método, de uma classe vizinha, ou de um comentário de bloco solto no
 *     meio, nunca é lido como o desta classe;
 *   - `@covers` dentro de uma string, heredoc ou HTML antes de `<?php`: esse
 *     texto nunca é o que precede imediatamente uma linha `class ...`,
 *     então nunca chega a ser candidato.
 *
 * @param {string} raw       arquivo cru
 * @param {string} codigo    o mesmo arquivo com stripPhpNoise
 * @param {number} declStart offset (igual em raw e em stripPhpNoise) do
 *                           início da linha de declaração da classe
 * @return {string|null} o texto do docblock completo, delimitadores incluídos, ou null
 */
function docblockDaClasse( raw, codigo, declStart ) {
	const antes = raw.slice(
		0,
		limiteAntesDoDocblock( raw, codigo, declStart )
	);
	if ( ! antes.endsWith( '*/' ) ) {
		return null;
	}
	const inicio = antes.lastIndexOf( '/**' );
	if ( inicio === -1 ) {
		return null;
	}
	// O primeiro `*/` depois de `/**` tem de ser exatamente o que fecha
	// `antes` — ver o JSDoc acima. `indexOf` (não `lastIndexOf`) porque um
	// comentário de verdade não pode conter `*/` no meio do próprio corpo
	// sem terminar ali (não há aninhamento de comentário em PHP).
	if ( antes.indexOf( '*/', inicio + 3 ) !== antes.length - 2 ) {
		return null;
	}
	return antes.slice( inicio );
}

function check( ctx ) {
	const achados = [];
	for ( const { file, nome, line, declStart } of classesDeTeste( ctx ) ) {
		const raw = ctx.read( file );
		const docblock = docblockDaClasse(
			raw,
			stripPhpNoise( raw ),
			declStart
		);

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
