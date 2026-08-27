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

	it.each( [
		"__( 'Olá', 'post-voice' )",
		"_x( 'Olá', 'saudação', 'post-voice' )",
		"esc_html__( 'Olá', 'post-voice' )",
		"_n( 'um', 'dois', $n, 'post-voice' )",
	] )( 'aceita %s', ( chamada ) => {
		expect( regra.check( ctxCom( `<?php\n${ chamada };\n` ) ) ).toEqual(
			[]
		);
	} );

	it( 'acusa domínio errado', () => {
		const a = regra.check( ctxCom( "<?php\n__( 'Olá', 'outro' );\n" ) );
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].line ).toBe( 2 );
		expect( a[ 0 ].message ).toMatch( /post-voice/ );
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
			'features/x/php/class-a.php → esc_html__-dominio-errado'
		);
	} );

	it( 'domínio errado e domínio ausente no mesmo arquivo geram chaves distintas', () => {
		const src = "<?php\n__( 'Olá', 'outro' );\n__( 'Tchau' );\n";
		const a = regra.check( ctxCom( src ) );
		expect( a ).toHaveLength( 2 );
		const chaves = a.map( ( f ) => f.key );
		expect( new Set( chaves ).size ).toBe( 2 );
		expect( chaves ).toContain(
			'features/x/php/class-a.php → __-dominio-errado'
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
