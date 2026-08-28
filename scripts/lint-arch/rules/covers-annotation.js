'use strict';
const { stripPhpNoise } = require( '../context' );

// As quatro pastas que o PHPUnit de fato descobre — copiadas dos quatro
// `<directory suffix=".php">` do `<testsuite>` em `phpunit.xml.dist`, não uma
// suposição própria. `<directory>` ali é recursivo e filtra só por sufixo
// `.php`, sem padrão de nome — é essa a autoridade sobre "classe de teste
// PHPUnit", não uma convenção de nome de arquivo. Uma quinta feature com
// `tests/php` precisa entrar aqui E em `phpunit.xml.dist`; nada neste arquivo
// deriva um do outro automaticamente.
const TEST_DIRS = [
	'features/narration/tests/php',
	'features/pronunciation/tests/php',
	'features/player-style/tests/php',
	'shared/tests/php',
];

const emPastaDeTeste = ( f ) =>
	f.endsWith( '.php' ) &&
	TEST_DIRS.some( ( dir ) => f.startsWith( `${ dir }/` ) );

// Opcionalmente `final` e/ou `abstract`, então `class Nome`. Ancorada em
// início de linha (`^` com a flag `m`) para que `m.index` seja o início da
// linha de declaração — usado tanto para o número da linha quanto como
// fronteira para achar o docblock que precede a classe (ver
// `docblockDaClasse`). Rodada sobre `stripPhpNoise`, não sobre o cru: uma
// string `'class Foo'` ou um comentário `// esta class faz X` não declaram
// nada, e stripPhpNoise apaga os dois para espaço — sem apagar comprimento
// nem quebra de linha, então o mesmo offset vale no arquivo cru.
const CLASS_DECL_RE = /^([ \t]*)(?:final\s+)?(abstract\s+)?class\s+(\w+)/gim;

/**
 * As classes NÃO abstratas declaradas em `file`.
 *
 * Uma classe abstrata é pulada aqui, na descoberta — não filtrada depois nem
 * absolvida por uma anotação de escape. PHPUnit não instancia uma classe
 * abstrata; ela não é "classe de teste PHPUnit" no sentido do `## Contexto`
 * da ADR-0013 (não gera número de cobertura nenhum para atribuir mal), é
 * infraestrutura — uma base compartilhada por subclasses que, essas sim, são
 * verificadas. Isto não é uma permissão nova: sem este pulo, a única saída
 * para uma base abstrata seria `@coversNothing`, que esta regra recusa (ver
 * `check`).
 *
 * @param {Object} ctx
 * @param {string} file
 * @return {{nome:string, line:number, declStart:number}[]} uma por classe não abstrata
 */
function classesNoArquivo( ctx, file ) {
	const codigo = stripPhpNoise( ctx.read( file ) );
	CLASS_DECL_RE.lastIndex = 0;
	const out = [];
	let m;
	while ( ( m = CLASS_DECL_RE.exec( codigo ) ) !== null ) {
		if ( m[ 2 ] ) {
			continue; // abstract — pulada, ver JSDoc acima
		}
		out.push( {
			nome: m[ 3 ],
			line: codigo.slice( 0, m.index ).split( '\n' ).length,
			declStart: m.index,
		} );
	}
	return out;
}

/**
 * Toda classe de teste PHPUnit em escopo — uma entrada por classe, não por
 * arquivo, porque a ADR fala em classe ("toda classe de teste PHPUnit...") e
 * um arquivo pode declarar mais de uma. Um arquivo que não declara nenhuma
 * classe (os dois traits auxiliares, `bootstrap.php`, `wp-tests-config.php`)
 * não contribui entrada nenhuma — sem precisar de um filtro de nome
 * separado para excluí-los.
 *
 * @param {Object} ctx
 * @return {{file:string, nome:string, line:number, declStart:number}[]} uma por classe não abstrata em escopo
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
// acusada. Migrar para PHPUnit 10+ é o que reabriria esta decisão.
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

/**
 * O offset, no arquivo CRU, de onde termina o que pode legitimamente separar
 * um docblock do início da linha de declaração da classe sem quebrar a
 * adjacência entre os dois: espaço em branco, um atributo do PHP 8 (código
 * de verdade, mas não é o que `docblockDaClasse` está procurando), ou um
 * comentário de linha inteira. Os três podem se repetir e se intercalar —
 * dois atributos empilhados, um comentário entre eles — por isso o laço
 * insiste até uma volta não mudar nada.
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
		const semAtributo = pularAtributoQueTermina( codigo, fim );
		if ( semAtributo !== fim ) {
			fim = semAtributo;
			mudou = true;
			continue;
		}
		const semComentario = pularComentarioDeLinhaQueTermina( raw, fim );
		if ( semComentario !== fim ) {
			fim = semComentario;
			mudou = true;
		}
	}
	return fim;
}

/**
 * O docblock imediatamente antes da declaração da classe — tolerando, entre
 * os dois, o ruído que `limiteAntesDoDocblock` reconhece (espaço em branco,
 * atributo do PHP 8, comentário de linha).
 *
 * Lido do arquivo CRU — não de `stripPhpNoise` nem de `stripPhpComments`,
 * porque `strip()` em `context.js` apaga comentário incondicionalmente (o
 * parâmetro `strings` decide só se o corpo de string TAMBÉM é apagado); os
 * dois strippers apagariam o próprio docblock que esta função lê. O cru é a
 * única fonte onde ele sobrevive.
 *
 * A barreira de adjacência resolve, de graça, dois problemas:
 *   - por classe, não por arquivo (ADR-0013 fala em classe): o docblock de UM
 *     método, ou o de uma classe vizinha no mesmo arquivo, nunca é o que
 *     precede esta linha de declaração (com ou sem ruído tolerado no meio),
 *     então nunca é lido aqui;
 *   - `@covers` dentro de uma string, heredoc ou HTML antes de `<?php`: esse
 *     texto também nunca é o que precede imediatamente uma linha `class ...`,
 *     então nunca chega a ser candidato.
 * Uma linha de código de verdade no meio (um `use Trait;`, uma constante)
 * ainda quebra a adjacência e a classe conta como sem docblock — ver o JSDoc
 * de `limiteAntesDoDocblock`.
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
	return inicio === -1 ? null : antes.slice( inicio );
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
