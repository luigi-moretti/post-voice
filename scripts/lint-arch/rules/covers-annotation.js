'use strict';

// Só classes de teste de feature ou de shared. `tests/php/bootstrap.php`, o
// `wp-tests-config.php`, e os dois traits auxiliares (`trait-*.php`) moram
// em `tests/php/` na raiz, não em `features/*/tests/php/` nem em
// `shared/tests/php/` — ficam fora pela própria letra do ADR-0013, que
// escopa a regra a esses dois prefixos. Também é por isso que um trait não
// é alcançado por engano: o filtro é o caminho, e nenhum trait do repo mora
// sob um desses dois prefixos com nome `test-*.php`.
const TEST_CLASS_RE =
	/^(?:features\/[^/]+|shared)\/tests\/php\/test-[a-z0-9-]+\.php$/;

const classesDeTeste = ( ctx ) =>
	ctx.files.filter( ( f ) => TEST_CLASS_RE.test( f ) );

/**
 * `@covers`/`@coversDefaultClass`/`@coversNothing` só existem dentro de um
 * docblock — ou seja, dentro de um comentário. Nenhum dos dois strippers de
 * `context.js` serve aqui: `strip()` apaga comentário incondicionalmente,
 * então TANTO `stripPhpComments` QUANTO `stripPhpNoise` apagariam a própria
 * anotação que a regra procura (a diferença entre os dois é só se o CORPO de
 * uma string também é apagado; nenhum dos dois preserva comentário). Esta
 * checagem lê o arquivo cru, sem stripper nenhum — é a única fonte onde o
 * docblock sobrevive.
 *
 * @param {string} raw o arquivo sem nenhum stripper
 * @return {boolean} verdadeiro quando alguma variante de @covers está presente
 */
function temAnotacaoCovers( raw ) {
	return /@covers(?:DefaultClass|Nothing)?\b/.test( raw );
}

function check( ctx ) {
	return classesDeTeste( ctx )
		.filter( ( file ) => ! temAnotacaoCovers( ctx.read( file ) ) )
		.map( ( file ) => ( {
			key: `${ file } → sem-covers`,
			file,
			line: 1,
			message:
				'classe de teste PHPUnit sem anotação @covers; sem ela a cobertura credita colaboradores à classe sob teste (ADR-0013)',
		} ) );
}

module.exports = {
	id: 'covers-annotation',
	adr: '0013',
	check,
	classesDeTeste,
};
