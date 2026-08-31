const { createContext } = require( '../context' );
const naming = require( '../rules/php-class-naming' );
const rest = require( '../rules/rest-namespace' );

// Inclui um post-voice.php sintético com o require_once correspondente a
// `file`, para que os testes que não são sobre a checagem de require_once
// não sejam pegos por ela incidentalmente — os cenários de
// require_once ausente/órfão usam `ctxArquivos` para controlar isso à mão.
const ctxCom = ( file, src ) =>
	createContext( {
		files: [ file, 'post-voice.php' ],
		read: ( f ) =>
			f === 'post-voice.php'
				? `<?php\nrequire_once POST_VOICE_PATH . '${ file }';\n`
				: src,
	} );

// Para cenários com mais de um arquivo (post-voice.php + um arquivo de
// classe), onde cada `read` precisa devolver algo diferente por caminho.
const ctxArquivos = ( mapa ) =>
	createContext( {
		files: Object.keys( mapa ),
		read: ( f ) => mapa[ f ],
	} );

describe( 'php-class-naming', () => {
	it( 'declara a ADR-0006', () => {
		expect( naming.adr ).toBe( '0006' );
	} );

	it( 'aceita classe bem nomeada no arquivo certo', () => {
		expect(
			naming.check(
				ctxCom(
					'features/x/php/class-rest-api.php',
					'<?php\nclass Post_Voice_Rest_Api {}\n'
				)
			)
		).toEqual( [] );
	} );

	it( 'acusa nome de arquivo que não deriva da classe', () => {
		const a = naming.check(
			ctxCom(
				'features/x/php/class-api.php',
				'<?php\nclass Post_Voice_Rest_Api {}\n'
			)
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /class-rest-api\.php/ );
	} );

	// Achado ALTO da revisão final da branch: `classFiles` só inspecionava
	// arquivos JÁ chamados `class-<slug>.php`, então uma classe posta em
	// qualquer outro nome de arquivo saía com zero achados AQUI e zero em
	// `feature-layout` — a ADR-0006 inteira escapava pelo próprio ato que ela
	// proíbe. Quem quebra o padrão de nome ficava invisível justamente para a
	// regra que confere o padrão de nome.
	describe( 'classe em arquivo fora do padrão class-*.php', () => {
		it( 'acusa, mesmo sem o prefixo', () => {
			const a = naming.check(
				ctxCom(
					'features/narration/php/helpers.php',
					'<?php\nclass minhaClasseSemPrefixo {}\n'
				)
			);
			expect( a.length ).toBeGreaterThan( 0 );
			expect( a[ 0 ].file ).toBe( 'features/narration/php/helpers.php' );
		} );

		it( 'acusa mesmo com o prefixo certo: o arquivo é que está errado', () => {
			const a = naming.check(
				ctxCom(
					'features/narration/php/helpers.php',
					'<?php\nclass Post_Voice_Helpers {}\n'
				)
			);
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].message ).toMatch( /class-helpers\.php/ );
		} );

		it( 'dá chave distinta por classe, para uma linha de desvio não absolver duas', () => {
			const a = naming.check(
				ctxCom(
					'features/narration/php/helpers.php',
					'<?php\nclass Post_Voice_A {}\nclass Post_Voice_B {}\n'
				)
			);
			expect( a ).toHaveLength( 2 );
			expect( new Set( a.map( ( x ) => x.key ) ).size ).toBe( 2 );
		} );

		it( 'não acusa arquivo sem classe nenhuma', () => {
			expect(
				naming.check(
					ctxCom(
						'features/narration/php/helpers.php',
						'<?php\nfunction pv_ajuda() {}\n'
					)
				)
			).toEqual( [] );
		} );

		it( 'não acusa arquivo de teste', () => {
			expect(
				naming.check(
					ctxArquivos( {
						'features/narration/tests/php/test-x.php':
							'<?php\nclass Test_X {}\n',
						'post-voice.php': '<?php\n',
					} )
				)
			).toEqual( [] );
		} );
	} );

	it( 'acusa classe sem o prefixo', () => {
		const a = naming.check(
			ctxCom( 'features/x/php/class-api.php', '<?php\nclass Api {}\n' )
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /Post_Voice_/ );
	} );

	it( 'acusa duas classes no mesmo arquivo', () => {
		const a = naming.check(
			ctxCom(
				'features/x/php/class-a.php',
				'<?php\nclass Post_Voice_A {}\nclass Post_Voice_B {}\n'
			)
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /uma classe/ );
	} );

	it( 'ignora a palavra class dentro de comentário ou string', () => {
		expect(
			naming.check(
				ctxCom(
					'features/x/php/class-a.php',
					"<?php\n// class Post_Voice_Z {}\n$s = 'class Post_Voice_W';\nclass Post_Voice_A {}\n"
				)
			)
		).toEqual( [] );
	} );

	it( 'expõe o mapa classe → feature', () => {
		const mapa = naming.phpClassOwners(
			createContext( {
				files: [
					'features/narration/php/class-post-meta.php',
					'shared/php/class-settings-page.php',
				],
				read: ( f ) =>
					f.includes( 'post-meta' )
						? '<?php\nclass Post_Voice_Post_Meta {}\n'
						: '<?php\nclass Post_Voice_Settings_Page {}\n',
			} )
		);
		expect( mapa.get( 'Post_Voice_Post_Meta' ).feature ).toBe(
			'narration'
		);
		expect( mapa.get( 'Post_Voice_Settings_Page' ).feature ).toBe(
			'shared'
		);
	} );

	it( 'aceita Class maiúsculo — a palavra-chave do PHP não diferencia caixa', () => {
		expect(
			naming.check(
				ctxArquivos( {
					'features/x/php/class-rest-api.php':
						'<?php\nClass Post_Voice_Rest_Api {}\n',
					'post-voice.php':
						"<?php\nrequire_once POST_VOICE_PATH . 'features/x/php/class-rest-api.php';\n",
				} )
			)
		).toEqual( [] );
	} );

	it( 'reescreve a mensagem de zero classes para apontar interface/trait', () => {
		const a = naming.check(
			ctxArquivos( {
				'features/x/php/class-foo.php':
					'<?php\ninterface Post_Voice_Foo {}\n',
				'post-voice.php': '<?php\n',
			} )
		);
		const semClasse = a.find(
			( f ) =>
				f.key ===
				'features/x/php/class-foo.php → uma-classe-por-arquivo'
		);
		expect( semClasse.message ).toMatch( /interface ou trait/ );
		expect( semClasse.message ).not.toMatch( /^0 classes/ );
	} );

	it( 'não exporta esperadoParaClasse — não é usado fora do módulo', () => {
		expect( naming.esperadoParaClasse ).toBeUndefined();
	} );

	describe( 'require_once correspondente em post-voice.php', () => {
		it( 'acusa classe sem require_once correspondente', () => {
			const a = naming.check(
				ctxArquivos( {
					'features/x/php/class-rest-api.php':
						'<?php\nclass Post_Voice_Rest_Api {}\n',
					'post-voice.php': '<?php\n// nada requerido aqui\n',
				} )
			);
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].key ).toBe(
				'features/x/php/class-rest-api.php → require-once-ausente'
			);
		} );

		it( 'acusa require_once órfão — caminho não corresponde a arquivo versionado', () => {
			const a = naming.check(
				ctxArquivos( {
					'post-voice.php':
						"<?php\nrequire_once POST_VOICE_PATH . 'features/x/php/class-ghost.php';\n",
				} )
			);
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].key ).toBe(
				'post-voice.php → require-once-orfao:features/x/php/class-ghost.php'
			);
		} );

		it( 'dá chaves distintas a dois require_once órfãos no mesmo arquivo', () => {
			const a = naming.check(
				ctxArquivos( {
					'post-voice.php':
						"<?php\nrequire_once POST_VOICE_PATH . 'features/x/php/class-a.php';\nrequire_once POST_VOICE_PATH . 'features/x/php/class-b.php';\n",
				} )
			);
			expect( a ).toHaveLength( 2 );
			expect( new Set( a.map( ( f ) => f.key ) ).size ).toBe( 2 );
		} );

		it( 'não confunde um literal de string cujo conteúdo parece um require_once', () => {
			// Regressão: antes do fix, o texto dentro da string era lido como um
			// require_once de verdade e virava um require-once-orfao fabricado.
			expect(
				naming.check(
					ctxArquivos( {
						'post-voice.php':
							'<?php\n$doc = "Exemplo: require_once POST_VOICE_PATH . \'features/x/php/class-fake.php\';";\n',
					} )
				)
			).toEqual( [] );
		} );

		it( 'ainda acusa require_once órfão de verdade quando há string parecida por perto', () => {
			const a = naming.check(
				ctxArquivos( {
					'post-voice.php':
						"<?php\n$doc = \"Exemplo: require_once POST_VOICE_PATH . 'features/x/php/class-fake.php';\";\nrequire_once POST_VOICE_PATH . 'features/x/php/class-ghost.php';\n",
				} )
			);
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].key ).toBe(
				'post-voice.php → require-once-orfao:features/x/php/class-ghost.php'
			);
		} );

		it( 'não acusa nada quando classe e require_once correspondem', () => {
			expect(
				naming.check(
					ctxArquivos( {
						'features/x/php/class-rest-api.php':
							'<?php\nclass Post_Voice_Rest_Api {}\n',
						'post-voice.php':
							"<?php\nrequire_once POST_VOICE_PATH . 'features/x/php/class-rest-api.php';\n",
					} )
				)
			).toEqual( [] );
		} );

		it( 'post-voice.php de verdade requer as 10 classes do repo', () => {
			expect( naming.check( createContext() ) ).toEqual( [] );
		} );
	} );
} );

describe( 'rest-namespace', () => {
	it( 'declara a ADR-0007', () => {
		expect( rest.adr ).toBe( '0007' );
	} );

	it( 'aceita namespace literal correto', () => {
		expect(
			rest.check(
				ctxCom(
					'features/x/php/class-rest-api.php',
					"<?php\nregister_rest_route( 'post-voice/v1', '/a', [] );\n"
				)
			)
		).toEqual( [] );
	} );

	it( 'resolve constante de classe do mesmo arquivo', () => {
		expect(
			rest.check(
				ctxCom(
					'features/x/php/class-rest-api.php',
					"<?php\nclass A {\nprivate const NS = 'post-voice/v1';\nfunction r() { register_rest_route( self::NS, '/a', [] ); }\n}\n"
				)
			)
		).toEqual( [] );
	} );

	it( 'acusa namespace errado', () => {
		const a = rest.check(
			ctxCom(
				'features/x/php/class-rest-api.php',
				"<?php\nregister_rest_route( 'wp/v2', '/a', [] );\n"
			)
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /post-voice\/v1/ );
	} );

	it( 'acusa constante que resolve para o namespace errado', () => {
		const a = rest.check(
			ctxCom(
				'features/x/php/class-rest-api.php',
				"<?php\nprivate const NS = 'outro/v1';\nregister_rest_route( self::NS, '/a', [] );\n"
			)
		);
		expect( a ).toHaveLength( 1 );
	} );

	it( 'acusa primeiro argumento que não resolve estaticamente', () => {
		const a = rest.check(
			ctxCom(
				'features/x/php/class-rest-api.php',
				'<?php\nregister_rest_route( $ns, "/a", [] );\n'
			)
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /não resolve/ );
	} );

	it( 'dá chaves distintas a duas expressões dinâmicas diferentes', () => {
		// Duas expressões que a regra não resolveu podem valer coisas
		// diferentes — é o desconhecimento que a chave registra. Uma chave só
		// deixaria uma linha de `desvios:` absolver as duas de uma vez.
		const a = rest.check(
			ctxCom(
				'features/x/php/class-rest-api.php',
				'<?php\nregister_rest_route( $ns_um, "/a", [] );\nregister_rest_route( $ns_dois, "/b", [] );\n'
			)
		);
		expect( a ).toHaveLength( 2 );
		expect( new Set( a.map( ( f ) => f.key ) ).size ).toBe( 2 );
		expect( a[ 0 ].key ).toContain( '$ns_um' );
		expect( a[ 1 ].key ).toContain( '$ns_dois' );
	} );

	it( 'não confunde um literal de string cujo conteúdo parece uma chamada', () => {
		// Regressão: antes do fix, o texto dentro da string era lido como uma
		// chamada de verdade e virava um achado de namespace-dinamico.
		expect(
			rest.check(
				ctxCom(
					'features/x/php/class-rest-api.php',
					"<?php\n$msg = 'lembrete: chame register_rest_route( \\'wp/v2\\', ... ) no init';\n"
				)
			)
		).toEqual( [] );
	} );

	it( 'não confunde uma função cujo nome só termina em register_rest_route', () => {
		// Regressão: sem guarda de fronteira, tanto a linha de definição quanto
		// a chamada do wrapper eram lidas como chamadas de register_rest_route.
		expect(
			rest.check(
				ctxCom(
					'features/x/php/class-rest-api.php',
					"<?php\nfunction custom_register_rest_route( $ns, $route ) {\n\treturn $ns;\n}\ncustom_register_rest_route( 'wp/v2', '/a' );\n"
				)
			)
		).toEqual( [] );
	} );

	it( 'não confunde um método de instância chamado ->register_rest_route(', () => {
		expect(
			rest.check(
				ctxCom(
					'features/x/php/class-rest-api.php',
					"<?php\n$obj->register_rest_route( 'wp/v2', '/a' );\n"
				)
			)
		).toEqual( [] );
	} );
} );

describe( 'o repo de hoje', () => {
	it( 'php-class-naming não acusa nada nas 10 classes', () => {
		expect( naming.check( createContext() ) ).toEqual( [] );
	} );

	it( 'rest-namespace não acusa nada', () => {
		expect( rest.check( createContext() ) ).toEqual( [] );
	} );

	it( 'mapeia as 10 classes do repo', () => {
		expect( naming.phpClassOwners( createContext() ).size ).toBe( 10 );
	} );
} );
