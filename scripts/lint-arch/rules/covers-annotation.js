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
const COVERS_RE = /@covers(?:DefaultClass)?\b/;
const COVERS_NOTHING_RE = /@coversNothing\b/;

/**
 * O docblock imediatamente antes do início da linha de declaração da classe.
 *
 * Lido do arquivo CRU — não de `stripPhpNoise` nem de `stripPhpComments`,
 * porque `strip()` em `context.js` apaga comentário incondicionalmente (o
 * parâmetro `strings` decide só se o corpo de string TAMBÉM é apagado); os
 * dois strippers apagariam o próprio docblock que esta função lê. O cru é a
 * única fonte onde ele sobrevive.
 *
 * "Imediatamente antes" é a barreira que resolve, de graça, dois problemas:
 *   - por classe, não por arquivo (ADR-0013 fala em classe): o docblock de UM
 *     método, ou o de uma classe vizinha no mesmo arquivo, nunca é o que
 *     precede esta linha de declaração, então nunca é lido aqui;
 *   - `@covers` dentro de uma string, heredoc ou HTML antes de `<?php`: esse
 *     texto também nunca é o que precede imediatamente uma linha `class ...`,
 *     então nunca chega a ser candidato.
 * Só espaço em branco pode separar o fim do docblock do início da linha da
 * classe — uma linha de código no meio (um `use Trait;`, uma constante)
 * quebra a adjacência e a classe conta como sem docblock.
 *
 * @param {string} raw       arquivo cru
 * @param {number} declStart offset (igual em raw e em stripPhpNoise) do
 *                           início da linha de declaração da classe
 * @return {string|null} o texto do docblock completo, delimitadores incluídos, ou null
 */
function docblockDaClasse( raw, declStart ) {
	const antes = raw.slice( 0, declStart ).replace( /[ \t\r\n]+$/, '' );
	if ( ! antes.endsWith( '*/' ) ) {
		return null;
	}
	const inicio = antes.lastIndexOf( '/**' );
	return inicio === -1 ? null : antes.slice( inicio );
}

function check( ctx ) {
	const achados = [];
	for ( const { file, nome, line, declStart } of classesDeTeste( ctx ) ) {
		const docblock = docblockDaClasse( ctx.read( file ), declStart );

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
