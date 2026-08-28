const { createContext } = require( '../context' );
const regra = require( '../rules/covers-annotation' );

const ARQ = 'features/narration/tests/php/test-assets.php';
const ctxCom = ( src ) => createContext( { files: [ ARQ ], read: () => src } );

// Para cenários com mais de um arquivo, onde cada `read` precisa devolver
// algo diferente por caminho.
const ctxArquivos = ( mapa ) =>
	createContext( {
		files: Object.keys( mapa ),
		read: ( f ) => mapa[ f ],
	} );

describe( 'covers-annotation', () => {
	it( 'declara a ADR-0013', () => {
		expect( regra.adr ).toBe( '0013' );
	} );

	it( 'aceita classe de teste com @covers', () => {
		expect(
			regra.check(
				ctxCom(
					'<?php\n/**\n * @covers Post_Voice_Assets\n */\nclass X extends A {}\n'
				)
			)
		).toEqual( [] );
	} );

	it( 'aceita @coversDefaultClass', () => {
		expect(
			regra.check(
				ctxCom(
					'<?php\n/**\n * @coversDefaultClass Post_Voice_Assets\n */\nclass X extends A {}\n'
				)
			)
		).toEqual( [] );
	} );

	it( 'acusa classe de teste sem @covers, com key e line corretos', () => {
		// Três linhas de preâmbulo antes da declaração, para que `line: 1` não
		// passe por acidente (mata o mutante M11).
		const src = '<?php\ndeclare(strict_types=1);\n\nclass X extends A {}\n';
		const a = regra.check( ctxCom( src ) );
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ] ).toEqual( {
			key: `${ ARQ } → sem-covers:X`,
			file: ARQ,
			line: 4,
			message: expect.stringMatching( /@covers/ ),
		} );
	} );

	describe( 'FIX 1 — descoberta por conteúdo, não por nome de arquivo', () => {
		it( 'acusa um arquivo com nome de convenção padrão do PHPUnit (FooTest.php)', () => {
			const arq = 'features/narration/tests/php/RestApiTest.php';
			const a = regra.check(
				ctxArquivos( {
					[ arq ]: '<?php\nclass RestApiTest extends A {}\n',
				} )
			);
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].file ).toBe( arq );
		} );

		it( 'acusa um arquivo aninhado (sub/test-a.php)', () => {
			const arq = 'features/narration/tests/php/sub/test-a.php';
			const a = regra.check(
				ctxArquivos( { [ arq ]: '<?php\nclass Test_A extends A {}\n' } )
			);
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].file ).toBe( arq );
		} );

		it( 'ignora um arquivo sem class nenhuma declarada, dentro do escopo', () => {
			expect(
				regra.check(
					ctxArquivos( {
						'features/narration/tests/php/trait-with-asset-file.php':
							'<?php\ntrait T {}\n',
					} )
				)
			).toEqual( [] );
		} );

		it( 'ignora um arquivo com class declarada, mas fora das quatro pastas', () => {
			expect(
				regra.check(
					ctxArquivos( {
						'tests/php/bootstrap.php':
							'<?php\nclass Fixture_Helper {}\n',
					} )
				)
			).toEqual( [] );
		} );

		it( 'ignora o bootstrap, a config e os traits reais do root', () => {
			expect(
				regra.check(
					createContext( {
						files: [
							'tests/php/bootstrap.php',
							'tests/php/wp-tests-config.php',
							'tests/php/trait-fires-admin-init.php',
							'tests/php/trait-with-asset-file.php',
						],
						read: () => '<?php\n',
					} )
				)
			).toEqual( [] );
		} );
	} );

	describe( 'FIX 2 — @covers fora de docblock não conta', () => {
		it( 'não é enganada por @covers dentro de uma string', () => {
			const src =
				"<?php\nclass X extends A {\n\tpublic function test_a() {\n\t\t$this->assertSame( 'use @covers aqui', $m );\n\t}\n}\n";
			const a = regra.check( ctxCom( src ) );
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].key ).toBe( `${ ARQ } → sem-covers:X` );
		} );

		it( 'não é enganada por @covers dentro de um heredoc', () => {
			const src =
				'<?php\nclass X extends A {\n\tpublic function test_a() {\n\t\t$m = <<<EOT\nfalta @covers\nEOT;\n\t}\n}\n';
			const a = regra.check( ctxCom( src ) );
			expect( a ).toHaveLength( 1 );
		} );

		it( 'não é enganada por @covers em HTML literal antes de <?php', () => {
			const src = '@covers\n<?php\nclass X extends A {}\n';
			const a = regra.check( ctxCom( src ) );
			expect( a ).toHaveLength( 1 );
		} );
	} );

	describe( 'FIX 3 — a anotação vale por classe, não por arquivo', () => {
		it( 'acusa só a classe sem @covers quando há duas no mesmo arquivo', () => {
			const src =
				'<?php\n/**\n * @covers Post_Voice_Assets\n */\nclass A_Test extends A {}\n\nclass B_Test extends A {\n\tpublic function test_b() {}\n}\n';
			const a = regra.check( ctxCom( src ) );
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].key ).toBe( `${ ARQ } → sem-covers:B_Test` );
		} );

		it( 'acusa a classe quando o único @covers está no docblock de um método', () => {
			const src =
				'<?php\nclass X extends A {\n\t/**\n\t * @covers Post_Voice_Assets::foo\n\t */\n\tpublic function test_a() {}\n\tpublic function test_b() {}\n}\n';
			const a = regra.check( ctxCom( src ) );
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].key ).toBe( `${ ARQ } → sem-covers:X` );
		} );
	} );

	describe( 'FIX 4 — @coversNothing é recusado', () => {
		it( 'acusa @coversNothing com chave própria, distinta de sem-covers', () => {
			const src =
				'<?php\n/**\n * @coversNothing\n */\nclass X extends A {}\n';
			const a = regra.check( ctxCom( src ) );
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ] ).toMatchObject( {
				key: `${ ARQ } → covers-nothing:X`,
				file: ARQ,
			} );
			expect( a[ 0 ].message ).toMatch( /@coversNothing/ );
			expect( a[ 0 ].message ).toMatch( /@covers/ );
		} );
	} );

	describe( 'FIX 5 — classe abstrata é pulada', () => {
		it( 'não acusa uma base de teste abstrata sem @covers', () => {
			const src = '<?php\nabstract class Base_Test extends A {}\n';
			expect( regra.check( ctxCom( src ) ) ).toEqual( [] );
		} );

		it( 'não lista a classe abstrata em classesDeTeste', () => {
			const src = '<?php\nabstract class Base_Test extends A {}\n';
			expect( regra.classesDeTeste( ctxCom( src ) ) ).toEqual( [] );
		} );
	} );

	describe( 'FIX round 2 — atributo e comentário de linha entre docblock e classe', () => {
		it( 'um atributo do PHP 8 não quebra a adjacência', () => {
			const src =
				"<?php\n/**\n * @covers Post_Voice_Assets\n */\n#[Group( 'lento' )]\nclass X extends A {}\n";
			expect( regra.check( ctxCom( src ) ) ).toEqual( [] );
		} );

		it( 'um comentário de linha inteira não quebra a adjacência', () => {
			const src =
				'<?php\n/**\n * @covers Post_Voice_Assets\n */\n// nota\nclass X extends A {}\n';
			expect( regra.check( ctxCom( src ) ) ).toEqual( [] );
		} );

		it( 'comentário de linha com # (não #[) também não quebra a adjacência', () => {
			const src =
				'<?php\n/**\n * @covers Post_Voice_Assets\n */\n# nota\nclass X extends A {}\n';
			expect( regra.check( ctxCom( src ) ) ).toEqual( [] );
		} );

		it( 'atributo e comentário intercalados, empilhados, ainda não quebram', () => {
			const src =
				"<?php\n/**\n * @covers Post_Voice_Assets\n */\n// nota\n#[Group( 'lento' )]\n#[Isolated]\nclass X extends A {}\n";
			expect( regra.check( ctxCom( src ) ) ).toEqual( [] );
		} );

		it( 'código de verdade entre o docblock e a classe ainda quebra a adjacência', () => {
			const src =
				'<?php\n/**\n * @covers Post_Voice_Assets\n */\nconst PREAMBULO = 1;\nclass X extends A {}\n';
			const a = regra.check( ctxCom( src ) );
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].key ).toBe( `${ ARQ } → sem-covers:X` );
		} );

		it( 'um atributo sozinho, sem docblock nenhum, não satisfaz a regra (PHPUnit 9.6 ignora atributo)', () => {
			// `#[CoversClass(...)]` só vale a partir do PHPUnit 10; este repo fixa
			// ^9.6 (ver comentário perto de COVERS_RE). Continua acusada.
			const src =
				'<?php\n#[CoversClass( Post_Voice_Assets::class )]\nclass X extends A {}\n';
			const a = regra.check( ctxCom( src ) );
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].key ).toBe( `${ ARQ } → sem-covers:X` );
		} );

		it( 'dois docblocks em sequência: vale o mais próximo, mesmo sem @covers', () => {
			const src =
				'<?php\n/**\n * @covers Post_Voice_Assets\n */\n/**\n * sem covers aqui\n */\nclass X extends A {}\n';
			const a = regra.check( ctxCom( src ) );
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].key ).toBe( `${ ARQ } → sem-covers:X` );
		} );
	} );

	describe( 'FIX 6 — buracos de teste fechados', () => {
		it( 'não aceita uma anotação parecida mas errada (mata regex frouxa)', () => {
			const src =
				'<?php\n/**\n * @coversBogus Post_Voice_Assets\n */\nclass X extends A {}\n';
			const a = regra.check( ctxCom( src ) );
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].key ).toBe( `${ ARQ } → sem-covers:X` );
		} );
	} );

	describe( 'FIX 1 — o docblock encontrado tem de ser o dono do fecha-comentário', () => {
		it( 'um comentário de bloco comum entre duas classes não empresta o @covers da vizinha (C5)', () => {
			const src =
				'<?php\n/**\n * @covers Post_Voice_Assets\n */\nclass A_Test extends A {}\n/* separador */\nclass B_Test extends A {}\n';
			const a = regra.check( ctxCom( src ) );
			const chaves = a.map( ( x ) => x.key ).sort();
			expect( chaves ).toEqual( [ `${ ARQ } → sem-covers:B_Test` ] );
		} );

		it( 'um comentário de bloco de várias linhas entre duas classes também não empresta (D3)', () => {
			const src =
				'<?php\n/**\n * @covers Post_Voice_Assets\n */\nclass A_Test extends A {}\n/*\n// nota\n*/\nclass B_Test extends A {}\n';
			const a = regra.check( ctxCom( src ) );
			const chaves = a.map( ( x ) => x.key ).sort();
			expect( chaves ).toEqual( [ `${ ARQ } → sem-covers:B_Test` ] );
		} );

		it( 'um comentário de bloco comum solto antes da classe não conta como docblock, mesmo citando @covers no texto (D1)', () => {
			const src =
				'<?php\n/**\n * doc sem covers\n */\n/* @covers Foo */\nclass X extends A {}\n';
			const a = regra.check( ctxCom( src ) );
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].key ).toBe( `${ ARQ } → sem-covers:X` );
		} );

		it( '"*/" dentro do TEXTO de um comentário de linha não é confundido com o fim de um comentário de bloco (C7)', () => {
			const src =
				'<?php\n/**\n * @covers Post_Voice_Assets\n */\nclass A_Test extends A {}\n$x = 1; // fim */\nclass B_Test extends A {}\n';
			const a = regra.check( ctxCom( src ) );
			const chaves = a.map( ( x ) => x.key ).sort();
			expect( chaves ).toEqual( [ `${ ARQ } → sem-covers:B_Test` ] );
		} );

		it( '@covers dentro de uma string de um método não empresta para a classe seguinte, mesmo atravessando um separador (D2)', () => {
			const src =
				"<?php\n/**\n * doc sem covers\n */\nclass A_Test extends A {\n\tfunction t() { $m = 'use @covers aqui'; }\n}\n/* sep */\nclass B_Test extends A {}\n";
			const a = regra.check( ctxCom( src ) );
			const chaves = a.map( ( x ) => x.key ).sort();
			expect( chaves ).toEqual(
				[
					`${ ARQ } → sem-covers:A_Test`,
					`${ ARQ } → sem-covers:B_Test`,
				].sort()
			);
		} );

		it( '@coversNothing de uma classe não vaza como a chave de outra classe sem anotação nenhuma', () => {
			const src =
				'<?php\n/**\n * @coversNothing\n */\nclass A_Test extends A {}\n/* sep */\nclass B_Test extends A {}\n';
			const a = regra.check( ctxCom( src ) );
			const porClasse = Object.fromEntries(
				a.map( ( x ) => [ x.key.split( ':' )[ 1 ], x.key ] )
			);
			expect( porClasse.A_Test ).toBe(
				`${ ARQ } → covers-nothing:A_Test`
			);
			expect( porClasse.B_Test ).toBe( `${ ARQ } → sem-covers:B_Test` );
		} );
	} );

	describe( 'FIX 2 — descoberta sem âncora de início de linha (regressão contra 92fb2c0)', () => {
		it( 'descobre e acusa uma classe declarada inteira numa linha só', () => {
			const arq = 'features/narration/tests/php/test-x.php';
			const a = regra.check(
				ctxArquivos( {
					[ arq ]: '<?php class X_Test extends A {}\n',
				} )
			);
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].key ).toBe( `${ arq } → sem-covers:X_Test` );
		} );

		it( 'descobre e acusa uma classe com atributo na mesma linha', () => {
			const arq = 'features/narration/tests/php/test-x.php';
			const a = regra.check(
				ctxArquivos( {
					[ arq ]:
						"<?php\n#[Group( 'a' )] class X_Test extends A {}\n",
				} )
			);
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].key ).toBe( `${ arq } → sem-covers:X_Test` );
		} );

		it( 'descobre e acusa uma classe "readonly" (PHP 8.2)', () => {
			const arq = 'features/narration/tests/php/test-x.php';
			const a = regra.check(
				ctxArquivos( {
					[ arq ]: '<?php\nreadonly class X_Test extends A {}\n',
				} )
			);
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].key ).toBe( `${ arq } → sem-covers:X_Test` );
		} );

		it( 'um docblock antes de uma classe com atributo na mesma linha ainda é encontrado', () => {
			const src =
				"<?php\n/**\n * @covers Post_Voice_Assets\n */\n#[Group( 'a' )] class X extends A {}\n";
			expect( regra.check( ctxCom( src ) ) ).toEqual( [] );
		} );
	} );

	describe( 'FIX 3 — classe concreta que não estende nada é pulada (falso positivo fechado)', () => {
		it( 'uma classe concreta sem "extends" nenhum não é descoberta, mesmo sem @covers', () => {
			const arq = 'features/narration/tests/php/fixtures/x.php';
			const ctx = ctxArquivos( {
				[ arq ]: '<?php\nclass Stub_Helper {}\n',
			} );
			expect( regra.classesDeTeste( ctx ) ).toEqual( [] );
			expect( regra.check( ctx ) ).toEqual( [] );
		} );

		it( 'uma classe que estende algo continua em escopo mesmo sem ser TestCase', () => {
			const arq = 'features/narration/tests/php/fixtures/x.php';
			const a = regra.check(
				ctxArquivos( { [ arq ]: '<?php\nclass X extends A {}\n' } )
			);
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].key ).toBe( `${ arq } → sem-covers:X` );
		} );
	} );

	describe( 'FIX 4 — atributo seguido de comentário na mesma linha não quebra a adjacência', () => {
		it( 'atributo de uma linha só seguido de // na mesma linha', () => {
			const src =
				"<?php\n/**\n * @covers Post_Voice_Assets\n */\n#[Group( 'a' )] // nota\nclass X extends A {}\n";
			expect( regra.check( ctxCom( src ) ) ).toEqual( [] );
		} );

		it( 'atributo de várias linhas seguido de // na linha em que fecha', () => {
			const src =
				"<?php\n/**\n * @covers Post_Voice_Assets\n */\n#[Group(\n 'a'\n)] // nota\nclass X extends A {}\n";
			expect( regra.check( ctxCom( src ) ) ).toEqual( [] );
		} );

		it( 'docblock de uma linha só seguido de // na mesma linha', () => {
			const src =
				'<?php\n/** @covers Post_Voice_Assets */ // nota\nclass X extends A {}\n';
			expect( regra.check( ctxCom( src ) ) ).toEqual( [] );
		} );
	} );

	describe( 'FIX 5 — a descoberta usa o glob da ADR, não quatro pastas copiadas', () => {
		it( 'uma quinta feature (fora das quatro do phpunit.xml.dist de hoje) é verificada', () => {
			const arq = 'features/nova-feature/tests/php/test-x.php';
			const a = regra.check(
				ctxArquivos( { [ arq ]: '<?php\nclass Test_X extends A {}\n' } )
			);
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].key ).toBe( `${ arq } → sem-covers:Test_X` );
		} );
	} );

	describe( 'Buracos de teste fechados nesta rodada', () => {
		it( 'o achado de @coversNothing fixa a line inteira, não só a key', () => {
			const src =
				'<?php\ndeclare(strict_types=1);\n\n/**\n * @coversNothing\n */\nclass X extends A {}\n';
			const a = regra.check( ctxCom( src ) );
			expect( a ).toEqual( [
				{
					key: `${ ARQ } → covers-nothing:X`,
					file: ARQ,
					line: 7,
					message: expect.stringMatching( /@coversNothing/ ),
				},
			] );
		} );

		it( '#[CoversClass] sozinho é recusado porque o docblock adjacente genuinamente não tem @covers — não porque falta docblock', () => {
			// Fixture antigo desta suíte provava a coisa errada: a classe não
			// tinha docblock ALGUM, então passava mesmo que COVERS_RE fosse
			// laxo o bastante para aceitar sintaxe de atributo por engano.
			// Este aqui tem um docblock de verdade, adjacente, sem @covers —
			// só o atributo (fora do docblock, nunca lido por COVERS_RE)
			// menciona `CoversClass`.
			const src =
				'<?php\n#[CoversClass( Post_Voice_Assets::class )]\n/**\n * sem covers aqui\n */\nclass X extends A {}\n';
			const a = regra.check( ctxCom( src ) );
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].key ).toBe( `${ ARQ } → sem-covers:X` );
		} );
	} );

	it( 'o repo de hoje tem 10 classes de teste, todas cobertas', () => {
		const ctx = createContext();
		expect( regra.check( ctx ) ).toEqual( [] );
		expect( regra.classesDeTeste( ctx ) ).toHaveLength( 10 );
	} );

	it( 'os dois traits e o bootstrap do repo de hoje não entram na lista', () => {
		const ctx = createContext();
		const arquivos = regra.classesDeTeste( ctx ).map( ( c ) => c.file );
		expect( arquivos ).not.toContain( 'tests/php/bootstrap.php' );
		expect( arquivos ).not.toContain( 'tests/php/wp-tests-config.php' );
		expect( arquivos ).not.toContain( 'tests/phpstan-bootstrap.php' );
		expect( arquivos ).not.toContain(
			'tests/php/trait-fires-admin-init.php'
		);
		expect( arquivos ).not.toContain(
			'tests/php/trait-with-asset-file.php'
		);
	} );
} );
