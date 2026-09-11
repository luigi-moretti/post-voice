const { createContext } = require( '../context' );
const regra = require( '../rules/covers-annotation' );

const ARQ = 'features/narration/tests/php/test-assets.php';

// A classe de produção entra no ctx porque a regra agora confere se um alvo
// `Post_Voice_*` existe de fato na árvore. Sem ela, todo `@covers
// Post_Voice_Assets` dos cenários abaixo seria "alvo inexistente" — e o que
// falharia seria o fixture, não o comportamento sob teste.
const CLASSE_PROD = 'features/narration/php/class-assets.php';
const FONTE_PROD = '<?php\nclass Post_Voice_Assets {}\n';
const ctxCom = ( src ) =>
	createContext( {
		files: [ ARQ, CLASSE_PROD ],
		read: ( f ) => ( f === CLASSE_PROD ? FONTE_PROD : src ),
	} );

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

	// Achado da revisão final da branch. `COVERS_RE` conferia só a PRESENÇA do
	// token, então `@covers` sem alvo passava. Medido contra o PHPUnit real
	// (o parser de anotação dele, em vendor/): a anotação é registrada como
	// [""], e `getLinesToBeCovered` lança InvalidCoversTargetException com
	// `"@covers " is invalid`. Ou seja, não é falha silenciosa — mas quem paga
	// é o job de cobertura, o mais caro da CI, com uma mensagem que não diz o
	// que fazer. `npm run test:php` sem cobertura passa verde (medido).
	// Achado da revisão final da branch: remover o `docblock = null` do ramo de
	// pontuação sobrevivia aos 496 testes, embora o ramo seja alcançável. É a
	// ÚNICA divergência deliberada em relação ao lexer do PHP nesta regra, e
	// era justamente a que nenhum teste fixava.
	//
	// Atenção ao que este teste fixa: o PHP ANEXA o docblock através do `;`
	// — perguntei a ele (`ReflectionClass::getDocComment` devolve o docblock
	// nesse arranjo), e o PHPUnit lê pelo mesmo caminho. A regra é estrita de
	// propósito aqui, e o cabeçalho de `covers-annotation.js` registra a
	// ratificação: o conjunto de separadores que ela aceita é subconjunto
	// estrito do que o PHP aceita, então ela erra ACUSANDO, nunca absolvendo.
	// Para um gate é a direção certa — um falso positivo aparece e se
	// conserta, um falso negativo mede cobertura errada em silêncio.
	it( 'pontuação entre o docblock e a classe quebra a adjacência', () => {
		const a = regra.check(
			ctxCom(
				'<?php\n/** @covers Post_Voice_Assets */\n;\nclass Test_B extends A {}\n'
			)
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].key ).toContain( 'sem-covers:Test_B' );
	} );

	describe( 'o @covers precisa de alvo', () => {
		it( 'acusa @covers sem alvo nenhum', () => {
			const a = regra.check(
				ctxCom( '<?php\n/**\n * @covers\n */\nclass X extends A {}\n' )
			);
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].message ).toMatch( /alvo/ );
		} );

		it( 'acusa @coversDefaultClass sem alvo', () => {
			const a = regra.check(
				ctxCom(
					'<?php\n/**\n * @coversDefaultClass\n */\nclass X extends A {}\n'
				)
			);
			expect( a ).toHaveLength( 1 );
		} );

		// O oráculo do linter (as classes da árvore) é MAIS FRACO que o do
		// PHPUnit (autoload de verdade): marcar todo alvo desconhecido criaria
		// falso positivo em classe de dependência ou trait. Então só se opina
		// sobre o que é seguramente nosso e seguramente errado — prefixo
		// Post_Voice_ que não existe na árvore, que é o erro de digitação.
		it( 'acusa alvo Post_Voice_ que não existe na árvore', () => {
			const a = regra.check(
				ctxArquivos( {
					'features/narration/php/class-assets.php':
						'<?php\nclass Post_Voice_Assets {}\n',
					[ ARQ ]:
						'<?php\n/**\n * @covers Post_Voice_Reset_Api\n */\nclass X extends A {}\n',
				} )
			);
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].key ).toContain( 'Post_Voice_Reset_Api' );
		} );

		// Reversão de um critério que eu mesmo escrevi na primeira rodada:
		// "não opinar sobre alvo sem o prefixo". Estava errado. A ADR-0013 diz
		// "apontando para a classe que de fato exercita", e um teste deste
		// plugin exercita classe deste plugin — cobrir `WP_REST_Request`
		// creditaria cobertura ao WP core, que não é medido por gate nenhum.
		// Com o prefixo obrigatório, o caso de prosa (`@covers porque ...`)
		// fecha pela mesma regra, sem critério separado.
		it( 'acusa alvo que não é classe do plugin', () => {
			const a = regra.check(
				ctxArquivos( {
					'features/narration/php/class-assets.php':
						'<?php\nclass Post_Voice_Assets {}\n',
					[ ARQ ]:
						'<?php\n/**\n * @covers WP_REST_Request\n */\nclass X extends A {}\n',
				} )
			);
			expect( a ).toHaveLength( 1 );
		} );

		// O caso que eu tinha deixado aberto: o token citado em prosa. O
		// PHPUnit não ancora a anotação no início da linha (DocBlock.php:512),
		// então para ele isto É um @covers, de valor "porque"; ele pega a
		// primeira palavra e lança no job de cobertura. Aqui fecha pelo
		// prefixo, sem precisar divergir do parser dele.
		it( 'acusa @covers citado em prosa', () => {
			const a = regra.check(
				ctxCom(
					'<?php\n/**\n * Este teste nao declara @covers porque exercita varias classes.\n */\nclass X extends A {}\n'
				)
			);
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].key ).toContain(
				'covers-alvo-inexistente:X:porque'
			);
		} );

		// Achado da revisão das correções: a chave do alvo inexistente não
		// carregava o nome da classe de teste, ao contrário das três chaves
		// irmãs desta regra. Duas classes no mesmo arquivo com o MESMO alvo
		// ruim colapsavam numa chave só, e uma linha de `desvios:` absolvia as
		// duas.
		// A guarda de prefixo NÃO é redundante com `donos.has`, embora um
		// mutante que a removesse sobrevivesse à suíte: `phpClassOwners`
		// mapeia toda classe declarada num `class-*.php`, com prefixo ou sem.
		// Uma classe sem prefixo existente na árvore entra em `donos`, e só a
		// guarda a reprova aqui. Ela já viola a ADR-0006 por outro gate; o
		// ponto é o @covers não creditar cobertura a ela como se fosse nossa.
		it( 'alvo existente mas sem o prefixo do plugin é acusado', () => {
			const a = regra.check(
				createContext( {
					files: [
						'features/narration/tests/php/test-x.php',
						'features/narration/php/class-fora.php',
					],
					read: ( f ) =>
						f.includes( 'tests' )
							? '<?php\n/**\n * @covers Classe_Sem_Prefixo\n */\nclass A_Test extends WP_UnitTestCase {}\n'
							: '<?php\nclass Classe_Sem_Prefixo {}\n',
				} )
			);
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].key ).toContain(
				'covers-alvo-inexistente:A_Test:Classe_Sem_Prefixo'
			);
		} );

		// Achado M1 da re-review: `@coversDefaultClass X` + `@covers ::metodo`
		// é sintaxe legítima do PHPUnit, e a regra a tratava como alvo de
		// classe vazio — dois métodos viravam dois achados sob UMA chave
		// terminada em `:`, com o nome da classe em branco na mensagem.
		it( 'aceita @coversDefaultClass com métodos em ::', () => {
			expect(
				regra.check(
					ctxCom(
						'<?php\n/**\n * @coversDefaultClass Post_Voice_Assets\n * @covers ::render\n * @covers ::enqueue\n */\nclass A_Test extends WP_UnitTestCase {}\n'
					)
				)
			).toEqual( [] );
		} );

		it( 'acusa ::metodo sem @coversDefaultClass, sob chave própria', () => {
			const a = regra.check(
				ctxCom(
					'<?php\n/**\n * @covers ::render\n */\nclass A_Test extends WP_UnitTestCase {}\n'
				)
			);
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].key ).toContain(
				'covers-metodo-sem-default:A_Test:::render'
			);
		} );

		it( 'um @coversDefaultClass inexistente é UM defeito, não um por método', () => {
			const a = regra.check(
				ctxCom(
					'<?php\n/**\n * @coversDefaultClass Post_Voice_Nao_Existe\n * @covers ::render\n * @covers ::enqueue\n */\nclass A_Test extends WP_UnitTestCase {}\n'
				)
			);
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].key ).toContain(
				'covers-alvo-inexistente:A_Test:Post_Voice_Nao_Existe'
			);
		} );

		it( 'duas classes com o MESMO alvo ruim são duas chaves', () => {
			const a = regra.check(
				ctxCom(
					'<?php\n/**\n * @covers Post_Voice_Nao_Existe\n */\nclass A_Test extends WP_UnitTestCase {}\n\n/**\n * @covers Post_Voice_Nao_Existe\n */\nclass B_Test extends WP_UnitTestCase {}\n'
				)
			);
			expect( a ).toHaveLength( 2 );
			expect( new Set( a.map( ( f ) => f.key ) ).size ).toBe( 2 );
			expect( a[ 0 ].key ).toContain( ':A_Test:' );
			expect( a[ 1 ].key ).toContain( ':B_Test:' );
		} );

		it( '@coversNothing não é lido como alvo "Nothing"', () => {
			const a = regra.check(
				ctxCom(
					'<?php\n/**\n * @coversNothing\n */\nclass X extends A {}\n'
				)
			);
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].key ).toContain( 'covers-nothing' );
		} );

		it( 'aceita alvo Post_Voice_ que existe', () => {
			expect(
				regra.check(
					ctxArquivos( {
						'features/narration/php/class-assets.php':
							'<?php\nclass Post_Voice_Assets {}\n',
						[ ARQ ]:
							'<?php\n/**\n * @covers Post_Voice_Assets\n */\nclass X extends A {}\n',
					} )
				)
			).toEqual( [] );
		} );
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

	// A rodada 4 trocou a busca para trás ("o que pode separar o docblock da
	// classe?") por uma varredura para a frente que imita o lexer do PHP. Os
	// fixtures abaixo vieram do harness diferencial
	// (`tools/covers-oracle-diff.js`), não de expectativa escrita à mão: em
	// cada um, o valor esperado é o que `ReflectionClass::getDocComment()`
	// respondeu sob PHP 8.2.32.
	describe( 'rodada 4 — fronteira medida contra o PHP', () => {
		describe( 'D1 — comentário de bloco comum entre o docblock e a classe', () => {
			it( 'um banner de uma linha não quebra a adjacência (o PHP anexa)', () => {
				const src =
					'<?php\n/**\n * @covers Post_Voice_Assets\n */\n/* Testes da fatia de assets */\nclass X extends A {}\n';
				expect( regra.check( ctxCom( src ) ) ).toEqual( [] );
			} );

			it( 'um banner de várias linhas também não quebra', () => {
				const src =
					'<?php\n/**\n * @covers Post_Voice_Assets\n */\n/*\n * banner\n */\nclass X extends A {}\n';
				expect( regra.check( ctxCom( src ) ) ).toEqual( [] );
			} );
		} );

		describe( 'D2 — a declaração não começa no início da linha física', () => {
			it( 'docblock na MESMA linha da classe é encontrado', () => {
				const src =
					'<?php\n/** @covers Post_Voice_Assets */ class X extends A {}\n';
				expect( regra.check( ctxCom( src ) ) ).toEqual( [] );
			} );

			it( 'docblock na mesma linha, com atributo no meio, é encontrado', () => {
				const src =
					"<?php\n/** @covers Post_Voice_Assets */ #[Group( 'a' )] class X extends A {}\n";
				expect( regra.check( ctxCom( src ) ) ).toEqual( [] );
			} );

			it( '"final" numa linha própria não quebra a adjacência', () => {
				const src =
					'<?php\n/**\n * @covers Post_Voice_Assets\n */\nfinal\nclass X extends A {}\n';
				expect( regra.check( ctxCom( src ) ) ).toEqual( [] );
			} );

			it( '"final readonly" quebrado em duas linhas também não quebra', () => {
				const src =
					'<?php\n/**\n * @covers Post_Voice_Assets\n */\nfinal\nreadonly\nclass X extends A {}\n';
				expect( regra.check( ctxCom( src ) ) ).toEqual( [] );
			} );
		} );

		describe( 'D3 — corpo de string não é estrutura', () => {
			it( 'um `]` dentro da string de um atributo não quebra a adjacência', () => {
				const src =
					"<?php\n/** @covers Post_Voice_Assets */\n#[Group( ']//' )]\nclass X extends A {}\n";
				expect( regra.check( ctxCom( src ) ) ).toEqual( [] );
			} );

			it( 'um `*/` dentro da string de um atributo não quebra a adjacência', () => {
				const src =
					"<?php\n/** @covers Post_Voice_Assets */\n#[Group( '*/ //' )]\nclass X extends A {}\n";
				expect( regra.check( ctxCom( src ) ) ).toEqual( [] );
			} );

			it( 'um `]` em string dentro de atributo seguido de comentário grudado', () => {
				const src =
					"<?php\n/** @covers Post_Voice_Assets */\n#[TestWith( ['a]//b'] )] // nota\nclass X extends A {}\n";
				expect( regra.check( ctxCom( src ) ) ).toEqual( [] );
			} );

			it( 'um `//` dentro do TEXTO do próprio docblock não o invalida', () => {
				const src =
					'<?php\n/** @covers Post_Voice_Assets — ver [1]// nota */\nclass X extends A {}\n';
				expect( regra.check( ctxCom( src ) ) ).toEqual( [] );
			} );
		} );

		describe( 'o que é um docblock é a regra do lexer do PHP, não "parece um"', () => {
			it( '`/**` sem espaço depois não é docblock para o PHP — a classe é acusada', () => {
				// `getDocComment()` devolve false para `/**@covers X*/`: o lexer
				// exige `/**` seguido de espaço em branco. O PHPUnit 9.6 não vê
				// `@covers` nenhum aqui, então aceitar seria falso NEGATIVO.
				const src =
					'<?php\n/**@covers Post_Voice_Assets*/\nclass X extends A {}\n';
				const a = regra.check( ctxCom( src ) );
				expect( a ).toHaveLength( 1 );
				expect( a[ 0 ].key ).toBe( `${ ARQ } → sem-covers:X` );
			} );

			it( '`/***` (três estrelas) também não é docblock para o PHP', () => {
				const src =
					'<?php\n/*** @covers Post_Voice_Assets */\nclass X extends A {}\n';
				const a = regra.check( ctxCom( src ) );
				expect( a ).toHaveLength( 1 );
				expect( a[ 0 ].key ).toBe( `${ ARQ } → sem-covers:X` );
			} );

			it( 'um `/**` no CORPO de um comentário de bloco comum não empresta o @covers (R1-resto)', () => {
				const src =
					'<?php\n/* nota: /** @covers Post_Voice_Assets */\nclass X extends A {}\n';
				const a = regra.check( ctxCom( src ) );
				expect( a ).toHaveLength( 1 );
				expect( a[ 0 ].key ).toBe( `${ ARQ } → sem-covers:X` );
			} );
		} );

		describe( 'o docblock é CONSUMIDO pela declaração, como no PHP', () => {
			it( 'a classe seguinte não herda o @covers da anterior', () => {
				const src =
					'<?php\n/** @covers Post_Voice_Assets */\nclass A_Test extends A {}\nclass B_Test extends A {}\n';
				const a = regra.check( ctxCom( src ) );
				expect( a.map( ( x ) => x.key ) ).toEqual( [
					`${ ARQ } → sem-covers:B_Test`,
				] );
			} );

			it( 'nem quando as duas estão na MESMA linha', () => {
				const src =
					'<?php\n/** @covers Post_Voice_Assets */\nclass A_Test extends A {} class B_Test extends A {}\n';
				const a = regra.check( ctxCom( src ) );
				expect( a.map( ( x ) => x.key ) ).toEqual( [
					`${ ARQ } → sem-covers:B_Test`,
				] );
			} );

			it( 'uma classe abstrata no meio também consome o docblock', () => {
				const src =
					'<?php\n/** @covers Post_Voice_Assets */\nabstract class Base_Test extends A {}\nclass X_Test extends A {}\n';
				const a = regra.check( ctxCom( src ) );
				expect( a.map( ( x ) => x.key ) ).toEqual( [
					`${ ARQ } → sem-covers:X_Test`,
				] );
			} );
		} );

		describe( 'a varredura não confunde `class` de expressão com declaração', () => {
			it( '`Foo::class` no corpo de um método não vira classe descoberta', () => {
				const src =
					'<?php\n/** @covers Post_Voice_Assets */\nclass X extends A {\n\tpublic function t() { return Post_Voice_Assets::class; }\n}\n';
				const ctx = ctxCom( src );
				expect( regra.classesDeTeste( ctx ) ).toHaveLength( 1 );
				expect( regra.check( ctx ) ).toEqual( [] );
			} );

			it( '`$obj->class` também não', () => {
				const src =
					'<?php\n/** @covers Post_Voice_Assets */\nclass X extends A {\n\tpublic function t() { return $o->class; }\n}\n';
				expect( regra.classesDeTeste( ctxCom( src ) ) ).toHaveLength(
					1
				);
			} );

			it( 'uma classe anônima não vira classe descoberta', () => {
				const src =
					'<?php\n/** @covers Post_Voice_Assets */\nclass X extends A {\n\tpublic function t() { return new class extends B {}; }\n}\n';
				const ctx = ctxCom( src );
				expect( regra.classesDeTeste( ctx ) ).toHaveLength( 1 );
				expect( regra.check( ctx ) ).toEqual( [] );
			} );

			it( '`class` como sufixo de um identificador maior não é declaração', () => {
				// A varredura lê identificadores inteiros; `myclass` é um
				// identificador só. Uma busca por substring acharia `class` no
				// meio dele e inventaria uma classe.
				expect(
					regra.classesDeTeste(
						ctxCom( '<?php\nmyclass X_Test extends A {}\n' )
					)
				).toEqual( [] );
			} );
		} );

		describe( 'buracos de teste que a review 3 mediu vivos', () => {
			it( 'a barra final do glob importa: tests/phpstan/ e tests/php-helpers/ ficam fora (M-N)', () => {
				const ctx = ctxArquivos( {
					'features/narration/tests/phpstan/x.php':
						'<?php\nclass X_Test extends A {}\n',
					'shared/tests/php-helpers/x.php':
						'<?php\nclass Y_Test extends A {}\n',
				} );
				expect( regra.classesDeTeste( ctx ) ).toEqual( [] );
				expect( regra.check( ctx ) ).toEqual( [] );
			} );

			it( 'o filtro .php importa: uma fixture não-PHP na pasta de teste fica fora (M-M)', () => {
				const ctx = ctxArquivos( {
					'features/narration/tests/php/fixtures/sample.mp3':
						'<?php\nclass X_Test extends A {}\n',
				} );
				expect( regra.classesDeTeste( ctx ) ).toEqual( [] );
				expect( regra.check( ctx ) ).toEqual( [] );
			} );

			it( 'COVERS_RE não aceita a sintaxe de atributo citada DENTRO do docblock (M-P)', () => {
				// O fixture da rodada 3 deixava `CoversClass` fora da fatia que
				// COVERS_RE lê, então uma regex frouxa passava. Aqui o texto
				// está dentro do docblock: só uma regex que exige `@covers`
				// mantém a acusação.
				const src =
					'<?php\n/** @see #[CoversClass( Post_Voice_Assets::class )] */\nclass X extends A {}\n';
				const a = regra.check( ctxCom( src ) );
				expect( a ).toHaveLength( 1 );
				expect( a[ 0 ].key ).toBe( `${ ARQ } → sem-covers:X` );
			} );

			it( '`final` e `readonly` estão no conjunto de modificadores (M-J)', () => {
				// `abstract readonly class` é PHP 8.2 legal. Se `readonly` saísse
				// do conjunto, a varredura pararia nele e a classe deixaria de
				// ser reconhecida como abstrata — passaria a ser acusada.
				const src =
					'<?php\nabstract readonly class Base_Test extends R {}\n';
				expect( regra.check( ctxCom( src ) ) ).toEqual( [] );
				expect( regra.classesDeTeste( ctxCom( src ) ) ).toEqual( [] );
			} );

			it( 'corpo de string não é comentário: uma classe na mesma linha de uma string continua descoberta', () => {
				// A varredura separa "comentário" de "corpo de string" usando as
				// DUAS fontes: em `stripPhpNoise` os dois ficam em branco, e é
				// `stripPhpComments` que os distingue (ele preserva o corpo da
				// string). Se essa segunda fonte sumir, o corpo da string passa
				// a ser lido como comentário de linha e a varredura pula até o
				// fim da linha — engolindo a declaração que vem depois dela.
				// Falso NEGATIVO, a direção pior.
				const src = "<?php\n$s = 'x'; class X_Test extends A {}\n";
				const a = regra.check( ctxCom( src ) );
				expect( a ).toHaveLength( 1 );
				expect( a[ 0 ].key ).toBe( `${ ARQ } → sem-covers:X_Test` );
			} );
		} );

		describe( 'divergência ratificada: código entre o docblock e a classe', () => {
			it( 'uma atribuição quebra a adjacência, ainda que o PHP anexasse', () => {
				// O PHP anexa o docblock através de `$x = 1;` — a regra
				// deliberadamente não (decisão da rodada 2). Direção
				// conservadora: erra acusando, nunca absolvendo.
				const src =
					'<?php\n/** @covers Post_Voice_Assets */\n$x = 1;\nclass X extends A {}\n';
				const a = regra.check( ctxCom( src ) );
				expect( a ).toHaveLength( 1 );
				expect( a[ 0 ].key ).toBe( `${ ARQ } → sem-covers:X` );
			} );

			it( 'um comentário de linha que termina numa tag `?>` também quebra', () => {
				// Com a tag e o `<?php` em linhas próprias, este fixture fixa
				// só a direção ratificada — ele NÃO discrimina a parada do
				// comentário na tag, porque o `<?php` da linha seguinte
				// descarta o docblock sozinho de qualquer jeito. Quem fixa o
				// mecanismo é o `it` seguinte; medido neutralizando o `if` de
				// `fimDoComentario` e vendo este aqui continuar verde.
				const src =
					'<?php\n/** @covers Post_Voice_Assets */\n// nota ?>\n<?php\nclass X extends A {}\n';
				const a = regra.check( ctxCom( src ) );
				expect( a ).toHaveLength( 1 );
				expect( a[ 0 ].key ).toBe( `${ ARQ } → sem-covers:X` );
			} );

			it( 'o `?>` que fecha um comentário de linha volta a ser sintaxe: a classe depois dele continua descoberta', () => {
				// Input discriminante do mecanismo de `fimDoComentario`: aqui a
				// tag, o `<?php` e a classe estão todos na MESMA linha do
				// comentário. Se o comentário fosse engolido até a quebra de
				// linha, o `<?php class X extends A {}` iria junto e a classe
				// sumiria da checagem inteira — falso NEGATIVO, a direção pior.
				//
				// O esperado vem do PHP 8.2.32, não de expectativa: neste
				// arquivo `class_exists( 'X' )` é `true` e `getDocComment()`
				// devolve `/** @covers Post_Voice_Assets */` — o PHP anexa.
				// A regra acusa mesmo assim, porque o `?>` é um token de código
				// entre o docblock e a classe: é a divergência ratificada, na
				// direção conservadora.
				const src =
					'<?php\n/** @covers Post_Voice_Assets */\n// nota ?> <?php class X extends A {}\n';
				expect( regra.classesDeTeste( ctxCom( src ) ) ).toHaveLength(
					1
				);
				const a = regra.check( ctxCom( src ) );
				expect( a ).toHaveLength( 1 );
				expect( a[ 0 ].key ).toBe( `${ ARQ } → sem-covers:X` );
			} );

			it( 'um atributo sem `]` de fechamento não engole a classe seguinte', () => {
				// PHP inválido, e por isso mesmo: a varredura não pode desistir
				// do resto do arquivo por causa dele. A classe continua
				// descoberta e acusada.
				const src =
					"<?php\n/** @covers Post_Voice_Assets */\n#[Group( 'a'\nclass X extends A {}\n";
				const a = regra.check( ctxCom( src ) );
				expect( a ).toHaveLength( 1 );
				expect( a[ 0 ].key ).toBe( `${ ARQ } → sem-covers:X` );
			} );

			it( 'uma tag de fechamento também quebra', () => {
				const src =
					'<?php\n/** @covers Post_Voice_Assets */\n?>\n<?php\nclass X extends A {}\n';
				const a = regra.check( ctxCom( src ) );
				expect( a ).toHaveLength( 1 );
				expect( a[ 0 ].key ).toBe( `${ ARQ } → sem-covers:X` );
			} );
		} );
	} );

	describe( 'região não-PHP: texto fora de `<?php … ?>` não é código', () => {
		// Todos os esperados desta seção vêm de `class_exists()` sob o PHP
		// 8.2.32, não de expectativa. `strip` copia o texto fora das tags ao pé
		// da letra — está certo e está documentado —, e a varredura precisa
		// saber disso: `class <Ident> extends <Ident>` em prosa NÃO é uma
		// declaração, e acusá-la punha na linha `desvios:` da ADR-0013 o nome
		// de uma classe que não existe.

		it( 'classe em prosa dentro do HTML entre `?>` e `<?php` não é descoberta, e a classe depois dele é', () => {
			// PHP: `class_exists( 'Fantasma' )` é false; `P02b` e `Depois`
			// existem. A varredura tem de pular o HTML sem parar nele: se
			// desistisse do arquivo no `?>`, `Depois` sumiria (falso negativo).
			const src =
				'<?php\nclass P02b extends A {} ?>\n' +
				'<p>the class Fantasma extends nothing here</p>\n' +
				'<?php\nclass Depois extends A {}\n';
			expect(
				regra.classesDeTeste( ctxCom( src ) ).map( ( c ) => c.nome )
			).toEqual( [ 'P02b', 'Depois' ] );
			expect(
				regra.check( ctxCom( src ) ).map( ( x ) => x.key )
			).toEqual( [
				`${ ARQ } → sem-covers:P02b`,
				`${ ARQ } → sem-covers:Depois`,
			] );
		} );

		it( 'arquivo sem tag PHP nenhuma não declara classe nenhuma', () => {
			// PHP: nada neste arquivo é compilado, `class_exists( 'P08' )` é
			// false. O arquivo começa FORA do PHP.
			const src = '<h1>sem php</h1>\n<p>class P08 extends A</p>\n';
			expect( regra.classesDeTeste( ctxCom( src ) ) ).toEqual( [] );
			expect( regra.check( ctxCom( src ) ) ).toEqual( [] );
		} );

		it( 'a tag de reabertura em maiúsculas volta a valer como código', () => {
			// PHP: `Dois` existe (a tag não diferencia caixa). Se a varredura
			// exigisse `<?php` minúsculo, o resto do arquivo viraria prosa e
			// `Dois` sumiria — falso negativo.
			const src =
				'<?php\n/** @covers Post_Voice_Assets */\nclass Um extends A {} ?>\n' +
				'<p>texto</p>\n<?PHP\nclass Dois extends A {}\n';
			expect(
				regra.classesDeTeste( ctxCom( src ) ).map( ( c ) => c.nome )
			).toEqual( [ 'Um', 'Dois' ] );
			const a = regra.check( ctxCom( src ) );
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].key ).toBe( `${ ARQ } → sem-covers:Dois` );
		} );

		it( '`__halt_compiler()` termina o código: o que vem depois é dado', () => {
			// PHP: `Q9` existe, `Falsa` NÃO — a compilação para na chamada e o
			// resto do arquivo é dado.
			const src =
				'<?php\nclass Q9 extends A {}\n__halt_compiler();\nclass Falsa extends A {}\n';
			expect(
				regra.classesDeTeste( ctxCom( src ) ).map( ( c ) => c.nome )
			).toEqual( [ 'Q9' ] );
		} );

		it( 'uma PROPRIEDADE chamada `__halt_compiler` não termina nada', () => {
			// `$o->__halt_compiler` é busca de propriedade, PHP válido (só um
			// aviso em tempo de execução), e `class_exists( 'B' )` é true.
			// Sem a guarda `->`, a varredura abandonaria o resto do arquivo.
			const src =
				'<?php\n$o = new A();\nvar_dump( $o->__halt_compiler );\nclass B extends A {}\n';
			expect(
				regra.classesDeTeste( ctxCom( src ) ).map( ( c ) => c.nome )
			).toEqual( [ 'B' ] );
		} );

		it( 'o docblock não atravessa a região não-PHP (divergência ratificada)', () => {
			// PHP anexa: `getDocComment()` de `Tres` devolve o docblock, mesmo
			// com HTML no meio. A regra acusa assim mesmo, porque o `?>` é
			// token de código entre os dois — conservador, erra acusando.
			const src =
				'<?php\n/** @covers Post_Voice_Assets */ ?>\n<p>html</p>\n' +
				'<?php\nclass Tres extends A {}\n';
			const a = regra.check( ctxCom( src ) );
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].key ).toBe( `${ ARQ } → sem-covers:Tres` );
		} );

		it.each( [
			[ 'aspas duplas', '$d = "a ?> b";', 'StrD' ],
			[ 'aspas simples', "$s = 'a ?> b';", 'StrS' ],
			[ 'heredoc', '$h = <<<T\na ?> b\nT;', 'Here' ],
			[ 'nowdoc', "$n = <<<'N'\na ?> b\nN;", 'Now' ],
		] )(
			'um `?>` em %s não sai do código: a classe depois dele continua descoberta',
			( _forma, literal, nome ) => {
				// O ramo que faz `?>` sair do modo código lê de `codigo`
				// (`stripPhpNoise`), onde corpo de string, de heredoc e de
				// `/* */` já é espaço — então um `?>` ali dentro nunca chega
				// nele. Ler do CRU em vez de `codigo` deixa a suíte inteira
				// verde e o harness em 0/0/0, e mesmo assim some com estas
				// quatro classes: falso NEGATIVO, a direção que este arquivo
				// declara em três lugares que não vai tomar.
				//
				// Esperado do PHP 8.2.32, não de expectativa: nos quatro
				// arquivos `class_exists( <nome> )` é `true` e
				// `getDocComment()` é `false` — sem docblock, a acusação é a
				// resposta certa, não uma divergência ratificada.
				const src = `<?php\n${ literal }\nclass ${ nome } extends A {}\n`;
				expect(
					regra.classesDeTeste( ctxCom( src ) ).map( ( c ) => c.nome )
				).toEqual( [ nome ] );
				const a = regra.check( ctxCom( src ) );
				expect( a ).toHaveLength( 1 );
				expect( a[ 0 ].key ).toBe( `${ ARQ } → sem-covers:${ nome }` );
			}
		);
	} );

	it( 'o repo de hoje tem 13 classes de teste, todas cobertas', () => {
		const ctx = createContext();
		expect( regra.check( ctx ) ).toEqual( [] );
		expect( regra.classesDeTeste( ctx ) ).toHaveLength( 13 );
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
