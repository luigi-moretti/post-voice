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
// Duas regras entram aqui de propósito, e só no describe de heredoc: as duas
// "bocas" que o suporte a heredoc fecha eram defeitos observáveis no ACHADO de
// uma regra (um falso negativo e um falso positivo), não só na saída do
// stripper. Uma asserção sobre a saída passaria a descrever a implementação;
// a asserção sobre o achado descreve o defeito que existia.
const tts = require( '../rules/no-server-side-tts' );
const i18n = require( '../rules/i18n-text-domain' );

const REPO_ROOT = path.join( __dirname, '..', '..', '..' );
const ARQUIVO_PROD = 'features/narration/php/class-x.php';
const ctxCom = ( src ) =>
	createContext( { files: [ ARQUIVO_PROD ], read: () => src } );

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
		// Com o `<?php`, como as oito irmãs: sem ele o fragmento inteiro é
		// texto literal copiado ao pé da letra, e a asserção de comprimento
		// passaria até para uma implementação `x => x` — não exercitaria nem
		// o apagamento do comentário nem o do corpo da string.
		const src = "<?php\n// c\n$a = 'x';\n";
		expect( stripPhpNoise( src ) ).toHaveLength( src.length );
		expect( stripPhpNoise( src ) ).not.toMatch( /c/ );
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

	it( '`<?php` exige espaço em branco (ou EOF) depois — `<?phpecho` não abre', () => {
		// O lexer do PHP só reconhece a tag seguida de espaço, tab ou quebra
		// de linha; `<?phpecho 1;` é texto literal de saída. Reconhecê-la ali
		// punha o stripper em modo código onde o PHP não está, e ele apagaria
		// como comentário/string algo que é saída literal.
		const src = "<?phpecho 'x'; // isto é HTML\n";
		for ( const fn of [ stripPhpComments, stripPhpNoise ] ) {
			expect( fn( src ) ).toBe( src );
		}
		// E a forma válida continua abrindo, inclusive com tab.
		expect( stripPhpNoise( "<?php\t$a = 'exec';\n" ) ).not.toMatch(
			/'exec'/
		);
		// `<?php` no fim do arquivo, sem nada depois, também é válido.
		expect( stripPhpComments( '<?php' ) ).toBe( '<?php' );
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

// Um heredoc/nowdoc é um literal de string cujo corpo é opaco: aspas, `//`,
// `#`, `/* */` e `?>` lá dentro são bytes do corpo, não sintaxe. Antes de
// `lerHeredoc`, `strip()` não conhecia a construção e lia o corpo como código
// — daí as duas "bocas" no fim deste bloco. O contrato é o mesmo dos literais
// comuns: `stripPhpComments` (strings=false) preserva o corpo, `stripPhpNoise`
// (strings=true) o apaga, e a sintaxe — cabeçalho, indentação e rótulo de
// fechamento — fica sempre visível nas duas.
describe( 'heredoc / nowdoc', () => {
	it( 'apaga o corpo de um `<<<EOT` e mantém cabeçalho e rótulo', () => {
		const src = '<?php\n$a = <<<EOT\nexec( 1 );\nEOT;\nb();\n';
		const comentarios = stripPhpComments( src );
		const ruido = stripPhpNoise( src );
		// strings=false: o corpo é preservado, como o de qualquer literal.
		expect( comentarios ).toBe( src );
		// strings=true: o corpo some, a sintaxe fica.
		expect( ruido ).not.toMatch( /exec/ );
		expect( ruido ).toMatch( /^\$a = <<<EOT$/m );
		expect( ruido ).toMatch( /^EOT;$/m );
		expect( ruido ).toMatch( /^b\(\);$/m );
	} );

	it( "reconhece o nowdoc `<<<'EOT'`", () => {
		const src = "<?php\n$a = <<<'EOT'\nexec( 1 );\nEOT;\nb();\n";
		const ruido = stripPhpNoise( src );
		expect( stripPhpComments( src ) ).toBe( src );
		expect( ruido ).not.toMatch( /exec/ );
		expect( ruido ).toMatch( /^\$a = <<<'EOT'$/m );
		expect( ruido ).toMatch( /^b\(\);$/m );
	} );

	it( 'reconhece o heredoc com rótulo entre aspas duplas `<<<"EOT"`', () => {
		const src = '<?php\n$a = <<<"EOT"\nexec( 1 );\nEOT;\nb();\n';
		const ruido = stripPhpNoise( src );
		expect( stripPhpComments( src ) ).toBe( src );
		expect( ruido ).not.toMatch( /exec/ );
		expect( ruido ).toMatch( /^\$a = <<<"EOT"$/m );
		expect( ruido ).toMatch( /^b\(\);$/m );
	} );

	it( 'aceita rótulo de fechamento indentado (PHP 7.3+)', () => {
		const src = '<?php\n$a = <<<EOT\n    exec( 1 );\n    EOT;\nb();\n';
		const ruido = stripPhpNoise( src );
		expect( ruido ).not.toMatch( /exec/ );
		// A indentação é sintaxe do fechamento: fica visível.
		expect( ruido ).toMatch( /^ {4}EOT;$/m );
		expect( ruido ).toMatch( /^b\(\);$/m );
	} );

	it( 'o rótulo no meio de uma linha do corpo não termina o heredoc', () => {
		const src = '<?php\n$a = <<<EOT\nnão EOT ainda\nEOT;\nexec();\n';
		const ruido = stripPhpNoise( src );
		// Se "EOT" no meio da linha 3 tivesse fechado, "ainda" seria lido como
		// código e sobreviveria.
		expect( ruido ).not.toMatch( /ainda/ );
		expect( ruido ).toMatch( /^EOT;$/m );
		expect( ruido ).toMatch( /^exec\(\);$/m );
	} );

	it( 'o rótulo como prefixo de um identificador maior não termina', () => {
		const src = '<?php\n$a = <<<EOT\nEOTX\nEOT;\nexec();\n';
		const ruido = stripPhpNoise( src );
		expect( ruido ).not.toMatch( /EOTX/ );
		expect( ruido ).toMatch( /^EOT;$/m );
		expect( ruido ).toMatch( /^exec\(\);$/m );
	} );

	it( 'heredoc sem terminador consome até o fim do arquivo', () => {
		const src = '<?php\n$a = <<<EOT\nexec( 1 );\n';
		for ( const fn of [ stripPhpComments, stripPhpNoise ] ) {
			const out = fn( src );
			expect( out ).toHaveLength( src.length );
			expect( out.split( '\n' ) ).toHaveLength(
				src.split( '\n' ).length
			);
		}
		// Igual a uma string ou a um `/* */` sem fechamento: tudo até EOF é
		// corpo, e com strings=true tudo isso some.
		expect( stripPhpNoise( src ) ).not.toMatch( /exec/ );
		expect( stripPhpComments( src ) ).toBe( src );
	} );

	it( '`1 <<< 2` não é heredoc — nada é consumido', () => {
		// `<<<` só abre heredoc quando o que vem depois é um rótulo e mais
		// nada até a quebra de linha. Sem essa exigência, um `<<<` qualquer
		// engoliria o resto do arquivo.
		const src = '<?php\n$a = 1 <<< 2;\nexec();\n';
		for ( const fn of [ stripPhpComments, stripPhpNoise ] ) {
			expect( fn( src ) ).toBe( src );
		}
		// E também não abre com sobra na linha do cabeçalho.
		const comSobra = '<?php\n$a = <<<EOT sobra\nexec();\n';
		expect( stripPhpNoise( comSobra ) ).toMatch( /^exec\(\);$/m );
	} );

	it( 'preserva comprimento e quebras de linha em todas as formas', () => {
		const src =
			'<?php\n' +
			"$a = <<<'EOT'\ncorpo 1\nEOT;\n" +
			'$b = <<<"EOT"\ncorpo 2\n  EOT;\n' +
			'$c = <<<EOT\ncorpo 3\nEOT;\n';
		for ( const fn of [ stripPhpComments, stripPhpNoise ] ) {
			const out = fn( src );
			expect( out ).toHaveLength( src.length );
			expect( out.split( '\n' ) ).toHaveLength(
				src.split( '\n' ).length
			);
		}
	} );

	it( 'espaço à direita do rótulo não abre heredoc; espaço à esquerda abre', () => {
		// PHP aceita `<<< EOT` (espaço ANTES do rótulo) e rejeita `<<<EOT `
		// (espaço DEPOIS) — `php -l` confirma. As duas metades são a regra do
		// lexer do PHP, e cada uma tem sua asserção aqui.
		const minima = '<?=<<<T#\n(';
		// O `(` sobrevive: `<<<T#` não é cabeçalho nenhum, não há heredoc.
		expect( stripPhpNoise( minima ) ).toMatch( /\($/ );

		// Espaço ANTES do rótulo continua sendo heredoc de verdade.
		const legal = '<?php\n$a = <<< EOT\nexec( 1 );\nEOT;\nb();\n';
		expect( stripPhpNoise( legal ) ).not.toMatch( /exec/ );
		expect( stripPhpNoise( legal ) ).toMatch( /^b\(\);$/m );

		// E espaço à direita não abre nada: o corpo "falso" segue sendo código.
		const invalido = '<?php\n$a = <<<EOT \nexec();\n';
		expect( stripPhpNoise( invalido ) ).toMatch( /^exec\(\);$/m );
	} );

	it( 'os dois strippers NÃO compõem, e nenhuma regra pode depender disso', () => {
		// Registro executável de uma propriedade que o linter já afirmou ter e
		// nunca teve. `stripPhpComments` apaga comentário PARA ESPAÇO, e
		// `<<< EOT` (espaço à esquerda do rótulo) é PHP legal, então a primeira
		// passada SINTETIZA um cabeçalho que o original não tinha e o corpo
		// sintético engole o resto do arquivo. Não dá para consertar apertando
		// `HEREDOC_CABECALHO_RE`: na segunda passada esse espaço é
		// indistinguível do espaço legítimo, e apertar reprovaria heredoc
		// legal — falso positivo no lugar de falso negativo.
		const vetor = '<?php\n$a = <<</*x*/EOT\nexec();\n';
		expect( stripPhpNoise( stripPhpComments( vetor ) ) ).not.toBe(
			stripPhpNoise( vetor )
		);
		// A rota que as regras usam — o stripper direto sobre o CRU — enxerga
		// `exec()`. A composta não: some.
		expect( stripPhpNoise( vetor ) ).toMatch( /^exec\(\);$/m );
		expect( stripPhpNoise( stripPhpComments( vetor ) ) ).not.toMatch(
			/exec/
		);
	} );

	it( 'nenhuma regra compõe os dois strippers', () => {
		// A garantia estrutural que substitui a composição: cada regra roda os
		// dois strippers sobre o arquivo CRU, em passadas independentes. Uma
		// composição em qualquer regra reabre a classe inteira de falso
		// negativo do teste acima, e é barata demais de escrever por engano
		// para ficar só documentada em prosa.
		const dir = path.join( __dirname, '..', 'rules' );
		for ( const nome of fs.readdirSync( dir ).sort() ) {
			if ( ! nome.endsWith( '.js' ) ) {
				continue;
			}
			const fonte = fs
				.readFileSync( path.join( dir, nome ), 'utf8' )
				// Só o código: um comentário PODE citar a composição, e este
				// arquivo depende disso para explicar por que ela é proibida.
				.replace( /\/\*[\s\S]*?\*\//g, ' ' )
				.replace( /^[ \t]*\/\/.*$/gm, ' ' )
				.replace( /\s+/g, '' );
			expect( {
				nome,
				compoe: fonte.includes( 'stripPhpNoise(stripPhpComments(' ),
			} ).toEqual( { nome, compoe: false } );
		}
	} );

	it( 'comprimento e quebras de linha preservados em todo o corpus real de .php', () => {
		// O invariante de verdade, o que substitui a composição: os dois
		// strippers apagam PARA ESPAÇO, então um offset achado num deles
		// aponta para o mesmo byte no outro. É disso que o padrão de duas
		// fontes das regras depende.
		const arquivos = trackedFiles( REPO_ROOT ).filter( ( f ) =>
			f.endsWith( '.php' )
		);
		expect( arquivos.length ).toBeGreaterThan( 0 );
		const ctx = createContext( { root: REPO_ROOT, files: arquivos } );
		for ( const file of arquivos ) {
			const src = ctx.read( file );
			const linhas = src.split( '\n' ).length;
			for ( const fn of [ stripPhpComments, stripPhpNoise ] ) {
				const out = fn( src );
				expect( {
					file,
					bytes: out.length,
					linhas: out.split( '\n' ).length,
				} ).toEqual( { file, bytes: src.length, linhas } );
			}
		}
	} );

	// As duas bocas, escritas como o defeito que elas eram.

	it( 'apóstrofo no corpo não engole a chamada seguinte (era falso negativo)', () => {
		// Sem conhecer heredoc, `strip()` via o apóstrofo de "d'água" como
		// abertura de string e apagava tudo até a próxima aspa simples — que
		// é a do argumento seguinte. A chamada `__( ... )` sumia de `codigo`,
		// `CALL_RE` não a encontrava, e a violação passava despercebida.
		const src = "<?php\n$a = <<<EOT\nd'água\nEOT;\n__( 'Olá', 'outro' );\n";
		const achados = i18n.check( ctxCom( src ) );
		expect( achados ).toHaveLength( 1 );
		expect( achados[ 0 ].line ).toBe( 5 );
		expect( achados[ 0 ].key ).toBe(
			`${ ARQUIVO_PROD } → __-dominio-errado`
		);
	} );

	it( '`?>` no corpo não joga o comentário seguinte para fora do PHP (era falso positivo)', () => {
		// Sem conhecer heredoc, o `?>` dentro do corpo fechava a tag; a linha
		// seguinte virava texto literal (HTML), o comentário `//` não era
		// apagado, e a regra acusava um `shell_exec` que só existe comentado.
		const src =
			'<?php\n$a = <<<EOT\ntag ?> no corpo\nEOT;\n// shell_exec( $cmd );\n';
		expect( tts.check( ctxCom( src ) ) ).toEqual( [] );
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
