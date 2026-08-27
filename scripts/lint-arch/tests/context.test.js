const fs = require( 'node:fs' );
const path = require( 'node:path' );
const {
	createContext,
	trackedFiles,
	stripPhpComments,
	stripPhpNoise,
	isTestPath,
	phpSources,
} = require( '../context' );

const REPO_ROOT = path.join( __dirname, '..', '..', '..' );

describe( 'stripPhpComments', () => {
	// Todo fragmento aqui é prefixado com `<?php\n`: um arquivo PHP de verdade
	// sempre começa fora do modo código (ver describe 'tags PHP' abaixo), e
	// `phpSources()` só entrega `.php` versionados — que no repo sempre abrem
	// com a tag. Um fragmento sem `<?php` não é um arquivo PHP válido, e sem a
	// tag `strip` trataria o texto inteiro como HTML literal e o copiaria sem
	// interpretar nada — o que faria estes testes passarem sem exercitar a
	// lógica de comentário/string que eles afirmam testar.
	it( 'apaga // mantendo o número da linha', () => {
		const out = stripPhpComments( '<?php\na();\n// exec( 1 );\nb();\n' );
		expect( out ).not.toMatch( /exec/ );
		expect( out.split( '\n' ) ).toHaveLength( 5 );
		expect( out.split( '\n' )[ 3 ] ).toBe( 'b();' );
	} );

	it( 'apaga bloco /* */ preservando as quebras de linha', () => {
		const out = stripPhpComments(
			'<?php\na();\n/* exec\n   exec */\nb();\n'
		);
		expect( out ).not.toMatch( /exec/ );
		expect( out.split( '\n' ) ).toHaveLength( 6 );
	} );

	it( 'apaga # mas não confunde com atributo #[Foo]', () => {
		expect( stripPhpComments( '<?php\n# exec();\n' ) ).not.toMatch(
			/exec/
		);
		expect( stripPhpComments( '<?php\n#[Attr]\nexec();\n' ) ).toMatch(
			/exec/
		);
	} );

	it( 'não apaga o que está dentro de string', () => {
		expect( stripPhpComments( "<?php\n$a = '// exec';\n" ) ).toMatch(
			/exec/
		);
	} );

	it( 'preserva literais de string inteiros', () => {
		expect(
			stripPhpComments( "<?php\n__( 'ola', 'post-voice' );\n" )
		).toMatch( /'post-voice'/ );
	} );
} );

describe( 'stripPhpNoise', () => {
	// Mesmo motivo do describe acima: fragmentos prefixados com `<?php\n`.
	it( 'apaga também o corpo das strings', () => {
		expect( stripPhpNoise( "<?php\n$a = 'exec';\n" ) ).not.toMatch(
			/exec/
		);
	} );

	it( 'mantém as aspas, para o código continuar parseável', () => {
		expect( stripPhpNoise( "<?php\n$a = 'exec';\n" ) ).toMatch( /'\s+'/ );
	} );

	it( 'respeita escape dentro de string', () => {
		expect( stripPhpNoise( "<?php\n$a = 'x\\'exec';\nexec();\n" ) ).toMatch(
			/^exec\(\);$/m
		);
	} );

	it( 'não muda o comprimento total', () => {
		const src = "// c\n$a = 'x';\n";
		expect( stripPhpNoise( src ) ).toHaveLength( src.length );
	} );
} );

// Um arquivo PHP alterna entre HTML literal (fora de `<?php ... ?>`) e código
// (dentro). Estes testes cobrem essa alternância, não só o que acontece
// depois que já se está dentro do código — é a falha de origem do defeito do
// Task 12: uma aspa de atributo HTML abria rastreamento de string e apagava
// o `<?php ... ?>` embutido dentro dela.
describe( 'tags PHP (fora vs. dentro do código)', () => {
	it( 'preserva PHP embutido num atributo HTML intacto', () => {
		const src =
			'<?php\nclass A {\n function r() {\n ?>\n' +
			' <div class="<?php exec( $cmd ); ?>">\n' +
			' <?php\n }\n}\n';
		const out = stripPhpNoise( src );
		expect( out.split( '\n' )[ 4 ] ).toBe(
			' <div class="<?php exec( $cmd ); ?>">'
		);
	} );

	it( 'um `?>` dentro de uma string PHP não fecha a tag', () => {
		const src = "<?php\n$a = 'x ?> y';\nexec();\n?>\n<p>depois</p>\n";
		const out = stripPhpNoise( src );
		// A string inteira (?> incluso) some — strings=true — mas a tag só
		// fecha no `?>` de verdade, então `exec()` continua em código e
		// "depois" continua fora, sem ser apagado.
		expect( out ).not.toMatch( /x \?> y/ );
		expect( out ).toMatch( /^exec\(\);$/m );
		expect( out ).toMatch( /<p>depois<\/p>/ );
	} );

	it( 'um `?>` dentro de um comentário /* */ não fecha a tag', () => {
		const src = '<?php\n/* nota ?> ainda comentário */\nexec();\n';
		const out = stripPhpNoise( src );
		expect( out ).not.toMatch( /nota/ );
		expect( out ).toMatch( /^exec\(\);$/m );
	} );

	it( 'um `?>` dentro de um comentário // fecha a tag, sem apagá-lo', () => {
		const src = "<?php esc_html_e( 'x' ); // nota ?>\n<p>depois</p>\n";
		const out = stripPhpNoise( src );
		expect( out ).not.toMatch( /nota/ );
		expect( out ).toMatch( /\?>/ );
		expect( out ).toMatch( /<p>depois<\/p>/ );
	} );

	it( 'não interpreta // dentro de texto HTML como comentário', () => {
		const src = '<!-- // não é comentário PHP --><?php exec(); ?>\n';
		const out = stripPhpNoise( src );
		expect( out ).toMatch( /<!-- \/\/ não é comentário PHP -->/ );
	} );

	it( 'não interpreta aspa dentro de texto HTML como abertura de string', () => {
		const src = '<p data-x="a">antes<?php exec(); ?>depois"fim</p>\n';
		const out = stripPhpNoise( src );
		expect( out ).toMatch( /^<p data-x="a">antes/ );
		expect( out ).toMatch( /depois"fim<\/p>$/m );
	} );

	it( 'arquivo sem `?>` de fechamento se comporta como hoje: tudo dentro', () => {
		const src = "<?php\n$a = 'exec';\nexec();\n";
		const out = stripPhpNoise( src );
		expect( out ).not.toMatch( /'exec'/ );
		expect( out ).toMatch( /^exec\(\);$/m );
	} );

	it( '<?PHP entra em código igual a <?php — a tag não diferencia caixa', () => {
		// `<?PHP` e `<?PhP` são PHP válido; o `strip()` original só
		// reconhecia a forma minúscula, então um arquivo assim ficava
		// inteiro do lado de "fora" e string/comentário nunca eram apagados
		// — um falso positivo (a regra vê texto de menos apagado, não de
		// mais) em vez do falso negativo do Task 12.
		const minusculo = stripPhpNoise( "<?php\n$a = 'exec';\nexec();\n" );
		const maiusculo = stripPhpNoise( "<?PHP\n$a = 'exec';\nexec();\n" );
		// A tag em si preserva a caixa original — só o que vem depois dela
		// se comporta do mesmo jeito.
		expect( maiusculo ).toMatch( /^<\?PHP/ );
		expect( maiusculo.slice( 5 ) ).toBe( minusculo.slice( 5 ) );
		expect( maiusculo ).not.toMatch( /'exec'/ );
		expect( maiusculo ).toMatch( /^exec\(\);$/m );
	} );

	it( 'preserva comprimento e quebras de linha com HTML fora do PHP', () => {
		const src =
			'<div class="<?php echo esc_attr( $c ); // c\n?>">\n' +
			'<?php if ( $x ) : ?>\n<p>a</p>\n<?php endif; ?>\n';
		for ( const fn of [ stripPhpComments, stripPhpNoise ] ) {
			const out = fn( src );
			expect( out ).toHaveLength( src.length );
			expect( out.split( '\n' ) ).toHaveLength(
				src.split( '\n' ).length
			);
		}
	} );

	it( 'preserva comprimento e número de linhas em todo o corpus real de .php', () => {
		const arquivos = trackedFiles( REPO_ROOT ).filter( ( f ) =>
			f.endsWith( '.php' )
		);
		expect( arquivos.length ).toBeGreaterThan( 0 );
		const ctx = createContext( { root: REPO_ROOT, files: arquivos } );
		for ( const file of arquivos ) {
			const src = ctx.read( file );
			for ( const fn of [ stripPhpComments, stripPhpNoise ] ) {
				const out = fn( src );
				expect( { file, length: out.length } ).toEqual( {
					file,
					length: src.length,
				} );
				expect( {
					file,
					lines: out.split( '\n' ).length,
				} ).toEqual( { file, lines: src.split( '\n' ).length } );
			}
		}
	} );

	it( 'stripPhpNoise no arquivo real preserva as 7 chamadas de gettext', () => {
		const src = fs.readFileSync(
			path.join(
				REPO_ROOT,
				'features/narration/php/class-frontend-render.php'
			),
			'utf8'
		);
		const out = stripPhpNoise( src );
		const chamadas = out.match( /(?:esc_attr_e|esc_html_e|__)\s*\(/g );
		expect( chamadas ).toHaveLength( 7 );
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
