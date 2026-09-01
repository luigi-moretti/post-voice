const { createContext } = require( '../context' );
const regra = require( '../rules/i18n-text-domain' );

const ctxCom = ( src ) =>
	createContext( {
		files: [ 'features/x/php/class-a.php' ],
		read: () => src,
	} );

describe( 'i18n-text-domain', () => {
	it( 'declara a ADR-0010', () => {
		expect( regra.adr ).toBe( '0010' );
		expect( regra.id ).toBe( 'i18n-text-domain' );
	} );

	// A lista completa das dezesseis funções gettext do WordPress que recebem
	// um text domain — a mesma de `wp-includes/l10n.php` e do sniff
	// `WordPress.WP.I18n` do WPCS. Cada linha usa a aridade real da
	// assinatura, com o domínio no ÚLTIMO argumento. Uma função que falte na
	// regra não vira "cobertura parcial": a chamada não é vista, e um domínio
	// errado nela passa em silêncio — por isso cada nome aparece aqui duas
	// vezes, uma aceitando e uma acusando.
	const CHAMADAS = [
		[ '__', "__( 'Olá', %d )" ],
		[ '_e', "_e( 'Olá', %d )" ],
		[ 'esc_attr__', "esc_attr__( 'Olá', %d )" ],
		[ 'esc_attr_e', "esc_attr_e( 'Olá', %d )" ],
		[ 'esc_html__', "esc_html__( 'Olá', %d )" ],
		[ 'esc_html_e', "esc_html_e( 'Olá', %d )" ],
		[ 'translate', "translate( 'Olá', %d )" ],
		[ '_x', "_x( 'Olá', 'saudação', %d )" ],
		[ '_ex', "_ex( 'Olá', 'saudação', %d )" ],
		[ 'esc_attr_x', "esc_attr_x( 'Olá', 'saudação', %d )" ],
		[ 'esc_html_x', "esc_html_x( 'Olá', 'saudação', %d )" ],
		[
			'translate_with_gettext_context',
			"translate_with_gettext_context( 'Olá', 'saudação', %d )",
		],
		[ '_n_noop', "_n_noop( 'um', 'dois', %d )" ],
		[ '_nx_noop', "_nx_noop( 'um', 'dois', 'contagem', %d )" ],
		[ '_n', "_n( 'um', 'dois', $n, %d )" ],
		[ '_nx', "_nx( 'um', 'dois', $n, 'contagem', %d )" ],
	];
	const comDominio = ( molde, dominio ) => molde.replace( '%d', dominio );

	it( 'cobre as dezesseis funções gettext do WordPress, e só elas', () => {
		expect( CHAMADAS ).toHaveLength( 16 );
		expect( new Set( CHAMADAS.map( ( [ fn ] ) => fn ) ).size ).toBe( 16 );
	} );

	it.each( CHAMADAS )( 'aceita %s com o domínio certo', ( fn, molde ) => {
		const src = `<?php\n${ comDominio( molde, "'post-voice'" ) };\n`;
		expect( regra.check( ctxCom( src ) ) ).toEqual( [] );
		expect( regra.gettextCalls( src )[ 0 ].fn ).toBe( fn );
	} );

	it.each( CHAMADAS )( 'acusa %s com o domínio errado', ( fn, molde ) => {
		const src = `<?php\n${ comDominio( molde, "'outro'" ) };\n`;
		const a = regra.check( ctxCom( src ) );
		expect( a ).toHaveLength( 1 );
		// A chave nomeia a função de verdade: ler `_n_noop` como `_n`, ou
		// `translate_with_gettext_context` como `translate`, produziria a
		// chave errada — e, com a aridade errada junto, o tipo errado.
		expect( a[ 0 ].key ).toBe(
			`features/x/php/class-a.php → ${ fn }-dominio-errado:'outro'`
		);
	} );

	it.each( CHAMADAS )( 'acusa %s sem o domínio', ( fn, molde ) => {
		// A mesma chamada com o último argumento removido: aridade abaixo do
		// mínimo é "ausente", não "errado".
		const src = `<?php\n${ molde.replace( /,\s*%d/, '' ) };\n`;
		const a = regra.check( ctxCom( src ) );
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].key ).toBe(
			`features/x/php/class-a.php → ${ fn }-dominio-ausente`
		);
	} );

	it( 'acusa domínio errado', () => {
		const a = regra.check( ctxCom( "<?php\n__( 'Olá', 'outro' );\n" ) );
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].line ).toBe( 2 );
		expect( a[ 0 ].message ).toMatch( /post-voice/ );
	} );

	it( 'dá chaves distintas a dois domínios estrangeiros diferentes', () => {
		// Dois domínios errados são dois defeitos: uma chave só deixaria uma
		// linha de `desvios:` absolver os dois. É a escolha que
		// `rest-namespace` já faz ao pôr o namespace observado na chave.
		const a = regra.check(
			ctxCom(
				"<?php\n__( 'A', 'outro-plugin' );\n__( 'B', 'wordpress' );\n"
			)
		);
		expect( a ).toHaveLength( 2 );
		expect( new Set( a.map( ( f ) => f.key ) ).size ).toBe( 2 );
		expect( a[ 0 ].key ).toBe(
			"features/x/php/class-a.php → __-dominio-errado:'outro-plugin'"
		);
	} );

	it( 'separa o domínio literal da variável de mesmo texto', () => {
		// A chave carrega o argumento CRU, com as aspas: `'$d'` é um domínio
		// literal errado e `$d` é uma expressão, e colapsá-los na mesma chave
		// absolveria os dois de uma vez.
		const chaves = regra
			.check( ctxCom( "<?php\n__( 'A', '$d' );\n__( 'B', $d );\n" ) )
			.map( ( f ) => f.key );
		expect( new Set( chaves ).size ).toBe( 2 );
	} );

	it( 'acusa domínio ausente', () => {
		expect( regra.check( ctxCom( "<?php\n__( 'Olá' );\n" ) ) ).toHaveLength(
			1
		);
	} );

	it( 'lida com parêntese dentro do argumento', () => {
		expect(
			regra.check(
				ctxCom(
					"<?php\n__( sprintf( '%s (x)', $a ), 'post-voice' );\n"
				)
			)
		).toEqual( [] );
	} );

	it( 'ignora chamada em comentário', () => {
		expect(
			regra.check( ctxCom( "<?php\n// __( 'Olá', 'outro' );\n" ) )
		).toEqual( [] );
	} );

	it( 'não confunde uma função cujo nome termina em __', () => {
		expect(
			regra.check( ctxCom( '<?php\nmy_helper__( $a );\n' ) )
		).toEqual( [] );
	} );

	it( 'não lê esc_html__ como __ com os argumentos deslocados', () => {
		// Se a alternação ou a guarda de fronteira lesse só "__(" aqui, o
		// argumento "capturado" começaria em "( 'Olá'" de qualquer forma — o
		// que mascararia o bug. O teste que realmente pega a confusão é: uma
		// chamada esc_html__ com domínio ERRADO tem de acusar com fn ===
		// 'esc_html__' na chave, não 'esc_html__' lido como '__'.
		const a = regra.check(
			ctxCom( "<?php\nesc_html__( 'Olá', 'outro' );\n" )
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].key ).toBe(
			"features/x/php/class-a.php → esc_html__-dominio-errado:'outro'"
		);
	} );

	it( 'domínio errado e domínio ausente no mesmo arquivo geram chaves distintas', () => {
		const src = "<?php\n__( 'Olá', 'outro' );\n__( 'Tchau' );\n";
		const a = regra.check( ctxCom( src ) );
		expect( a ).toHaveLength( 2 );
		const chaves = a.map( ( f ) => f.key );
		expect( new Set( chaves ).size ).toBe( 2 );
		expect( chaves ).toContain(
			"features/x/php/class-a.php → __-dominio-errado:'outro'"
		);
		expect( chaves ).toContain(
			'features/x/php/class-a.php → __-dominio-ausente'
		);
	} );

	it( 'não confunde uma string cujo conteúdo parece uma chamada com domínio errado', () => {
		// Padrão de duas fontes: a chamada é reconhecida em `codigo`
		// (`stripPhpNoise`, com o corpo das strings apagado), então o texto
		// dentro deste literal PHP de verdade — que não é código nenhum —
		// não casa. Uma versão de uma fonte só (reconhecendo a chamada
		// direto sobre `source`, com o corpo das strings intacto) acusaria
		// isto como `__-dominio-errado`, porque o texto "__( 'x',
		// 'wrong-domain' )" está ali dentro, caractere por caractere.
		const src = "<?php\n$msg = \"chame __( 'x', 'wrong-domain' )\";\n";
		expect( regra.check( ctxCom( src ) ) ).toEqual( [] );
	} );

	// Nome de função em PHP não diferencia maiúsculas de minúsculas: `_X(` é
	// uma chamada a `_x()`. Uma `CALL_RE` sensível à caixa simplesmente não
	// via a chamada — falso negativo silencioso, não um alarme a menos.
	describe( 'caixa do nome da função', () => {
		it( 'aceita `_X` com o domínio certo', () => {
			expect(
				regra.check(
					ctxCom( "<?php\n_X( 'Olá', 'saudação', 'post-voice' );\n" )
				)
			).toEqual( [] );
		} );

		it( 'acusa `_X` com o domínio errado, sob a chave canônica `_x`', () => {
			const a = regra.check(
				ctxCom( "<?php\n_X( 'Olá', 'saudação', 'outro' );\n" )
			);
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].key ).toBe(
				"features/x/php/class-a.php → _x-dominio-errado:'outro'"
			);
		} );

		it( '`_X` e `_x` no mesmo arquivo são o MESMO defeito, uma chave só', () => {
			// A chave é identidade de desvio, casada caractere a caractere no
			// front-matter da ADR. Duas grafias da mesma função não podem
			// virar duas identidades — uma entrada de `desvios:` tem de
			// absolver as duas ou nenhuma.
			const src =
				"<?php\n_X( 'a', 'c', 'outro' );\n_x( 'b', 'c', 'outro' );\n";
			const chaves = regra.check( ctxCom( src ) ).map( ( f ) => f.key );
			expect( chaves ).toHaveLength( 2 );
			expect( new Set( chaves ).size ).toBe( 1 );
		} );

		it( '`_X` sem domínio é AUSENTE — a aridade é lida pelo nome canônico', () => {
			// `ARIDADE` é indexada em minúsculas. Sem canonizar `fn`, a
			// consulta devolveria `undefined`, `partes.length < undefined`
			// seria falso, e o defeito viraria "errado" — outra chave, outro
			// conserto, para o mesmo problema.
			const a = regra.check(
				ctxCom( "<?php\n_X( 'Olá', 'saudação' );\n" )
			);
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].key ).toBe(
				'features/x/php/class-a.php → _x-dominio-ausente'
			);
		} );

		it( 'a guarda de fronteira continua valendo com a caixa ignorada', () => {
			expect(
				regra.check(
					ctxCom( "<?php\n$o->_X( 'a' );\nSelf::_X( 'b' );\n" )
				)
			).toEqual( [] );
			expect(
				regra.check( ctxCom( '<?php\nmy_helper_X( $a );\n' ) )
			).toEqual( [] );
		} );
	} );

	// `nome(` não distingue chamada de declaração nem de instanciação. O
	// buraco é anterior à lista completa de dezesseis nomes — `function __(
	// $a, $b )` já acusava — mas `translate` é uma palavra inglesa comum, e a
	// lista completa a transformou em gatilho: o primeiro `public function
	// translate( … )` numa classe `Post_Voice_*` reprovaria o `lint:arch` em
	// código correto.
	describe( 'declaração e instanciação não são chamada', () => {
		it.each( [
			[ 'new', 'new Translate( $a, $b );' ],
			[ 'new com dois espaços', 'new  Translate( $a );' ],
			[ 'new minúsculo', 'new translate( $a );' ],
			[ 'function', 'function translate( $text, $domain ) {}' ],
			[
				'method',
				'public function translate( $text, $domain = null ) {}',
			],
			[ 'function com quebra de linha', 'function\ntranslate( $t ) {}' ],
			[ 'static method', 'private static function translate( $t ) {}' ],
			[ 'chamada por variável', "$translate( 'a', 'b' );" ],
			// Entre a palavra-chave e o nome cabe mais coisa do que a
			// primeira versão da guarda previu. Cada uma destas é PHP legal
			// (`php -l` 8.2) que a regra acusava — falso positivo, CI
			// reprovado em código correto.
			[ 'new qualificado da raiz', 'new \\Translate( $a );' ],
			[ 'new qualificado por namespace', 'new Foo\\Translate( $a );' ],
			[
				'new qualificado com vários segmentos',
				'new \\Foo\\Bar\\Translate( $a );',
			],
			[ 'new qualificado, um dos dezesseis nomes', 'new \\_x( $a );' ],
			[ 'retorno por referência', 'function &translate( $t ) {}' ],
			[
				'retorno por referência com espaços',
				'function & translate( $t ) {}',
			],
			[
				'retorno por referência sem espaço',
				'function&translate( $t ) {}',
			],
			[
				'método com retorno por referência',
				'public static function &translate( $t ) {}',
			],
		] )( 'não acusa %s', ( _rotulo, linha ) => {
			expect( regra.check( ctxCom( `<?php\n${ linha }\n` ) ) ).toEqual(
				[]
			);
		} );

		it( 'a guarda vale para os dezesseis nomes, não só para translate', () => {
			const src =
				'<?php\nnew _x( $a );\nfunction __( $t, $d ) {}\n$_n( 1, 2 );\n';
			expect( regra.check( ctxCom( src ) ) ).toEqual( [] );
		} );

		it( 'mas a chamada de verdade continua acusando', () => {
			// A metade que importa: um falso negativo aqui seria pior que o
			// falso positivo que a guarda corrige. Cada forma abaixo é uma
			// chamada de verdade que passa perto de uma das guardas.
			for ( const linha of [
				"translate( 'x', 'outro' );",
				"$a = translate( 'x', 'outro' );",
				"return translate( 'x', 'outro' );",
				// "renew" termina em "new", mas não É `new` — o `(?<![\w$])`
				// aninhado dentro do lookbehind é o que separa os dois.
				"renew translate( 'x', 'outro' );",
				// A forma qualificada da função global: chamada de verdade,
				// e o `\` NÃO pode fazê-la passar pela guarda de `new`.
				"\\translate( 'x', 'outro' );",
				"renew \\translate( 'x', 'outro' );",
				// O `$` de `(?<![\w$])` é o que segura estas duas: um E bit a
				// bit sobre o retorno de uma chamada de verdade é PHP legal
				// (`php -l` 8.2), e sem excluir o `$` a alternativa `\s*&\s*`
				// da guarda de `function` absolveria a chamada — trocaria o
				// falso positivo do retorno por referência por um falso
				// negativo, que é a direção pior.
				"$function & translate( 'x', 'outro' );",
				"$function&translate( 'x', 'outro' );",
				// O mesmo `$`, agora na guarda de `new`. Esta linha NÃO é PHP
				// que o parser aceite (duas expressões sem operador entre
				// elas) — está aqui pelo mesmo critério que fez a rodada 2b
				// tratar `<<<EOT `: é o que trava a guarda no lugar. Sem o
				// `$`, `new\s+\\?` absolveria a chamada, e no dia em que
				// alguém alargar essa guarda por reflexo o teste avisa.
				"$new \\translate( 'x', 'outro' );",
				// Instanciação e chamada na mesma linha: a guarda de `new`
				// absolve o nome da classe, não o argumento.
				"$a = new Foo( translate( 'x', 'outro' ) );",
				"$a = new \\Foo( \\translate( 'x', 'outro' ) );",
			] ) {
				const a = regra.check( ctxCom( `<?php\n${ linha }\n` ) );
				expect( { linha, achados: a.length } ).toEqual( {
					linha,
					achados: 1,
				} );
				expect( a[ 0 ].key ).toBe(
					"features/x/php/class-a.php → translate-dominio-errado:'outro'"
				);
			}
		} );
	} );

	// PHP legal que a regra reprovava.
	describe( 'formas legais do argumento de domínio', () => {
		it( 'aceita o domínio entre aspas duplas', () => {
			expect(
				regra.check( ctxCom( '<?php\n__( \'Olá\', "post-voice" );\n' ) )
			).toEqual( [] );
		} );

		it( 'não aceita interpolação nem concatenação como se fossem o domínio', () => {
			// `"post-$voice"` e `'post' . '-voice'` podem valer "post-voice"
			// em tempo de execução, mas daqui não dá para saber — e tratá-los
			// como o domínio seria aceitar qualquer expressão que por acaso
			// contenha o texto.
			for ( const arg of [
				'"post-$voice"',
				'"post-{$voice}"',
				"'post' . '-voice'",
				'$dominio',
			] ) {
				const a = regra.check(
					ctxCom( `<?php\n__( 'Olá', ${ arg } );\n` )
				);
				expect( { arg, achados: a.length } ).toEqual( {
					arg,
					achados: 1,
				} );
				expect( a[ 0 ].key ).toBe(
					`features/x/php/class-a.php → __-dominio-errado:${ arg }`
				);
			}
		} );

		it( 'uma vírgula escapada dentro do texto não separa argumentos', () => {
			// `dividirArgumentos` só conta vírgulas de nível superior e fora de
			// aspas; a aspa escapada não fecha a string, então a vírgula que
			// vem depois dela continua sendo texto. Sem isso, o "último
			// argumento" seria ` ok'` e o domínio certo seria reprovado.
			const src =
				"<?php\n__( 'it\\'s, ok', 'post-voice' );\n" +
				'__( "a\\", b", \'outro\' );\n';
			const a = regra.check( ctxCom( src ) );
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].line ).toBe( 3 );
			expect( a[ 0 ].key ).toBe(
				"features/x/php/class-a.php → __-dominio-errado:'outro'"
			);
		} );

		it( 'aceita vírgula à direita (PHP 8.0+)', () => {
			expect(
				regra.check( ctxCom( "<?php\n__( 'Olá', 'post-voice', );\n" ) )
			).toEqual( [] );
			expect(
				regra.check(
					ctxCom( "<?php\n_n( 'um', 'dois', $n, 'post-voice', );\n" )
				)
			).toEqual( [] );
		} );

		it( 'vírgula à direita sem domínio continua sendo domínio AUSENTE', () => {
			// A parte vazia depois da última vírgula não é um argumento. Se
			// entrasse na contagem, `__( 'Olá', )` viraria "domínio errado" —
			// outro defeito, outra chave, outra correção.
			const a = regra.check( ctxCom( "<?php\n__( 'Olá', );\n" ) );
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].key ).toBe(
				'features/x/php/class-a.php → __-dominio-ausente'
			);
		} );
	} );

	// A regra faz DUAS passadas independentes sobre o arquivo CRU, como
	// `rest-namespace.js` e `php-class-naming.js`. Ela já compôs — rodava
	// `stripPhpNoise` sobre a saída de `stripPhpComments` — e a composição
	// sintetizava cabeçalho de heredoc: falso negativo silencioso.
	describe( 'as duas passadas são sobre o arquivo cru', () => {
		it( 'um comentário no cabeçalho do heredoc não engole a chamada seguinte', () => {
			// O vetor: `stripPhpComments` apaga `/*x*/` para espaço, e
			// `<<< EOT` (espaço à esquerda do rótulo) é PHP legal — então a
			// segunda passada, se rodasse sobre a saída da primeira, leria
			// `<<<     EOT\n` como cabeçalho de verdade e o corpo sintético
			// engoliria o resto do arquivo, com a violação dentro.
			const src = "<?php\n$a = <<</*x*/EOT\n__( 'Olá', 'outro' );\n";
			const a = regra.check( ctxCom( src ) );
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].line ).toBe( 3 );
			expect( a[ 0 ].key ).toBe(
				"features/x/php/class-a.php → __-dominio-errado:'outro'"
			);
			// `contarChamadas` é a terceira peça do FIX D, e a única sem rede
			// própria: `check` já prova, com o mesmo vetor, que a chamada é
			// vista. Se `contarChamadas` voltasse a passar o texto já
			// strippado a `gettextCalls` (em vez do cru), o corpo sintético do
			// heredoc engoliria a chamada e a contagem cairia para 0 em
			// silêncio — falso negativo na mesma direção do teste acima, só
			// que sem nenhum teste vermelho até agora.
			expect( regra.contarChamadas( ctxCom( src ) ) ).toBe( 1 );
		} );

		it( 'e um heredoc de verdade continua opaco, com a chamada depois dele visível', () => {
			// A outra metade: matar a composição não pode custar o suporte a
			// heredoc. O corpo segue apagado (o apóstrofo não abre string), e
			// a chamada depois do terminador — precedida de um comentário —
			// continua sendo vista.
			const src =
				"<?php\n$a = <<<EOT\nd'água __( 'x', 'outro' )\nEOT;\n" +
				"/* c */ __( 'Olá', 'outro' );\n";
			const a = regra.check( ctxCom( src ) );
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].line ).toBe( 5 );
		} );

		it( 'gettextCalls recebe o CRU: um comentário não vira argumento', () => {
			// A assinatura mudou de "arquivo já sem comentários" para o cru.
			// O argumento continua vindo de `stripPhpComments`, então o
			// comentário entre os argumentos vira espaço e não entra no
			// literal — se `args` viesse do cru, o domínio lido seria
			// `/* c */ 'post-voice'`, que não é literal nenhum, e a regra
			// acusaria PHP correto.
			const src = "<?php\n__( 'Olá', /* c */ 'post-voice' );\n";
			expect( regra.check( ctxCom( src ) ) ).toEqual( [] );
			expect( regra.gettextCalls( src ) ).toHaveLength( 1 );
		} );
	} );

	it( 'gettextCalls devolve fn, args e index', () => {
		const source = "<?php\n__( 'Olá', 'post-voice' );\n";
		const chamadas = regra.gettextCalls( source );
		expect( chamadas ).toEqual( [
			{ fn: '__', args: "( 'Olá', 'post-voice' )", index: 6 },
		] );
	} );

	it( 'o repo de hoje tem 48 chamadas e nenhuma fora do domínio', () => {
		const ctx = createContext();
		expect( regra.check( ctx ) ).toEqual( [] );
		expect( regra.contarChamadas( ctx ) ).toBe( 48 );
	} );
} );
