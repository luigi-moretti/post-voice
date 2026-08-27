const {
	createContext,
	stripPhpComments,
	stripPhpNoise,
	isTestPath,
	phpSources,
} = require( '../context' );

describe( 'stripPhpComments', () => {
	it( 'apaga // mantendo o número da linha', () => {
		const out = stripPhpComments( 'a();\n// exec( 1 );\nb();\n' );
		expect( out ).not.toMatch( /exec/ );
		expect( out.split( '\n' ) ).toHaveLength( 4 );
		expect( out.split( '\n' )[ 2 ] ).toBe( 'b();' );
	} );

	it( 'apaga bloco /* */ preservando as quebras de linha', () => {
		const out = stripPhpComments( 'a();\n/* exec\n   exec */\nb();\n' );
		expect( out ).not.toMatch( /exec/ );
		expect( out.split( '\n' ) ).toHaveLength( 5 );
	} );

	it( 'apaga # mas não confunde com atributo #[Foo]', () => {
		expect( stripPhpComments( '# exec();\n' ) ).not.toMatch( /exec/ );
		expect( stripPhpComments( '#[Attr]\nexec();\n' ) ).toMatch( /exec/ );
	} );

	it( 'não apaga o que está dentro de string', () => {
		expect( stripPhpComments( "$a = '// exec';\n" ) ).toMatch( /exec/ );
	} );

	it( 'preserva literais de string inteiros', () => {
		expect( stripPhpComments( "__( 'ola', 'post-voice' );\n" ) ).toMatch(
			/'post-voice'/
		);
	} );
} );

describe( 'stripPhpNoise', () => {
	it( 'apaga também o corpo das strings', () => {
		expect( stripPhpNoise( "$a = 'exec';\n" ) ).not.toMatch( /exec/ );
	} );

	it( 'mantém as aspas, para o código continuar parseável', () => {
		expect( stripPhpNoise( "$a = 'exec';\n" ) ).toMatch( /'\s+'/ );
	} );

	it( 'respeita escape dentro de string', () => {
		expect( stripPhpNoise( "$a = 'x\\'exec';\nexec();\n" ) ).toMatch(
			/^exec\(\);$/m
		);
	} );

	it( 'não muda o comprimento total', () => {
		const src = "// c\n$a = 'x';\n";
		expect( stripPhpNoise( src ) ).toHaveLength( src.length );
	} );
} );

describe( 'isTestPath', () => {
	it.each( [
		[ 'features/narration/tests/php/test-assets.php', true ],
		[ 'tests/php/bootstrap.php', true ],
		[ 'test/jest.setup.js', true ],
		[ 'scripts/lint-arch/tests/adr.test.js', true ],
		[ 'features/narration/php/class-assets.php', false ],
		[ 'e2e/narration.spec.ts', false ],
	] )( '%s → %s', ( file, esperado ) => {
		expect( isTestPath( file ) ).toBe( esperado );
	} );
} );

describe( 'createContext', () => {
	it( 'aceita arquivos e leitor injetados', () => {
		const ctx = createContext( {
			root: '/repo',
			files: [ 'a.php' ],
			read: ( f ) => `conteúdo de ${ f }`,
		} );
		expect( ctx.files ).toEqual( [ 'a.php' ] );
		expect( ctx.read( 'a.php' ) ).toBe( 'conteúdo de a.php' );
	} );

	it( 'lê cada arquivo uma vez só', () => {
		let leituras = 0;
		const ctx = createContext( {
			files: [ 'a.php' ],
			read: () => {
				leituras += 1;
				return 'x';
			},
		} );
		ctx.read( 'a.php' );
		ctx.read( 'a.php' );
		expect( leituras ).toBe( 1 );
	} );
} );

describe( 'phpSources', () => {
	it( 'exclui PHP de ferramental — e2e/mu-plugins e scripts/', () => {
		const ctx = createContext( {
			files: [
				'features/narration/php/class-assets.php',
				'e2e/mu-plugins/coop-coep-headers.php',
				'scripts/check-coverage-threshold.php',
				'post-voice.php',
			],
			read: () => '',
		} );
		expect( phpSources( ctx ) ).toEqual( [
			'features/narration/php/class-assets.php',
			'post-voice.php',
		] );
	} );

	it( 'devolve só .php de produção', () => {
		const ctx = createContext( {
			files: [
				'features/narration/php/class-assets.php',
				'features/narration/tests/php/test-assets.php',
				'post-voice.php',
				'features/narration/editor/index.tsx',
			],
			read: () => '',
		} );
		expect( phpSources( ctx ) ).toEqual( [
			'features/narration/php/class-assets.php',
			'post-voice.php',
		] );
	} );
} );
