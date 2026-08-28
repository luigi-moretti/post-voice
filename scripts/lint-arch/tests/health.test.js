const {
	checkClaudeMdSize,
	checkAdrCitations,
	checkRulePaths,
	checkIndex,
	checkAdrHygiene,
	globToRegExp,
	parseRulePaths,
	reviewTriggerCounts,
	filesAboveP95,
	CLAUDE_MD_LINE_CEILING,
	CITED_SECTIONS,
} = require( '../health' );

describe( 'checkClaudeMdSize', () => {
	it( 'aceita arquivo dentro do teto', () => {
		expect( checkClaudeMdSize( 'a\n'.repeat( 60 ), 80 ) ).toEqual( [] );
	} );

	it( 'o teto padrão é 95, e é decisão registrada, não estimativa', () => {
		// A estimativa original do plano era 80, feita antes de o CLAUDE.md
		// existir. A redação real dá ~94, e chegar a 80 exigiria cortar os
		// Gotchas — que não são path-scopáveis, então não têm para onde ir.
		// Com o teto vindo por parâmetro em todos os outros casos, o padrão
		// nunca era exercido: trocar 80 por 95 não deixava nada vermelho.
		// `split( '\n' )` conta a linha vazia depois do último `\n`, então
		// `repeat( n )` vale n+1 linhas — 94 repetições são as 95 do teto.
		expect( checkClaudeMdSize( 'a\n'.repeat( 94 ) ) ).toEqual( [] );
		const acima = checkClaudeMdSize( 'a\n'.repeat( 95 ) );
		expect( acima ).toHaveLength( 1 );
		expect( acima[ 0 ].message ).toMatch(
			/96 linhas, acima do teto de 95/
		);
	} );

	it( 'acusa acima do teto e nomeia a maior seção', () => {
		const src = '## Conventions\n' + 'x\n'.repeat( 90 ) + '## Never\n- a\n';
		const a = checkClaudeMdSize( src, 80 );
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /## Conventions/ );
		expect( a[ 0 ].message ).toMatch( /80/ );
	} );
} );

describe( 'checkAdrCitations aceita as duas grafias de citação', () => {
	const ids = new Set( [ '0004', '0005' ] );

	it.each( [
		[ 'uma ADR', '- convenção (ADR-0004)' ],
		[ 'duas em parênteses separados', '- convenção (ADR-0004) (ADR-0005)' ],
		[ 'duas na mesma citação', '- convenção (ADR-0004, ADR-0005)' ],
		[ 'duas sem espaço', '- convenção (ADR-0004,ADR-0005)' ],
	] )( 'aceita %s', ( _forma, linha ) => {
		// A forma com vírgula é a que se escreve sem pensar quando um bullet
		// responde a duas decisões. Um checker que a recusa não ensina a citar
		// melhor — ensina a lutar com o checker, e foi o que aconteceu: a
		// primeira versão destas rules teve de escrever `(A) (B)` para passar.
		expect( checkAdrCitations( linha, [], ids ) ).toEqual( [] );
	} );

	it( 'um id inexistente DENTRO de uma citação múltipla ainda é pego', () => {
		// O afrouxamento não pode custar a checagem: a lista de ids é extraída
		// de dentro do grupo, então cada um é validado separadamente.
		const a = checkAdrCitations( '- x (ADR-0004, ADR-9999)', [], ids );
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /ADR-9999, que não existe/ );
	} );
} );

describe( 'checkAdrCitations', () => {
	const ids = new Set( [ '0004', '0005' ] );

	it( 'aceita bullet que cita ADR existente', () => {
		expect(
			checkAdrCitations(
				'## Conventions\n- Layout is feature-based (ADR-0004).\n',
				[ 'Conventions' ],
				ids
			)
		).toEqual( [] );
	} );

	it( 'acusa bullet sem citação', () => {
		expect(
			checkAdrCitations(
				'## Conventions\n- Layout is feature-based.\n',
				[ 'Conventions' ],
				ids
			)
		).toHaveLength( 1 );
	} );

	it( 'acusa citação de ADR inexistente', () => {
		const a = checkAdrCitations(
			'## Conventions\n- x (ADR-0099).\n',
			[ 'Conventions' ],
			ids
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /0099/ );
	} );

	it( 'ignora seções que não são de decisão', () => {
		expect(
			checkAdrCitations(
				'## Gotchas\n- opcache serves a stale copy.\n',
				[ 'Conventions', 'Never' ],
				ids
			)
		).toEqual( [] );
	} );

	it( 'com lista de seções vazia, verifica o arquivo inteiro — é o caso das rules', () => {
		expect(
			checkAdrCitations( '- Prefixo Post_Voice_.\n', [], ids )
		).toHaveLength( 1 );
	} );

	it( 'não lê os itens de paths: do front-matter como bullets de convenção', () => {
		const rule =
			'---\npaths:\n  - "features/**/php/**/*.php"\n---\n\n- Prefixo (ADR-0004).\n';
		expect( checkAdrCitations( rule, [], ids ) ).toEqual( [] );
	} );
} );

describe( 'globToRegExp', () => {
	it.each( [
		[
			'features/**/php/**/*.php',
			'features/narration/php/class-a.php',
			true,
		],
		[ 'features/**/php/**/*.php', 'features/narration/editor/a.ts', false ],
		[
			'**/class-rest-api.php',
			'features/narration/php/class-rest-api.php',
			true,
		],
		[
			'features/**/editor/**/*.{ts,tsx}',
			'features/narration/editor/index.tsx',
			true,
		],
		[
			'features/**/editor/**/*.{ts,tsx}',
			'features/narration/editor/a.js',
			false,
		],
		[ 'docs/adr/**/*.md', 'docs/adr/0001-x.md', true ],
	] )( '%s ~ %s → %s', ( glob, file, esperado ) => {
		expect( globToRegExp( glob ).test( file ) ).toBe( esperado );
	} );
} );

describe( 'checkRulePaths', () => {
	const files = [ 'features/a/php/x.php', 'docs/adr/0001-x.md', 'README.md' ];

	it( 'aceita glob que casa com parte do repo', () => {
		expect(
			checkRulePaths(
				[
					{
						file: '.claude/rules/php.md',
						paths: [ 'features/**/php/**/*.php' ],
					},
				],
				files
			)
		).toEqual( [] );
	} );

	it( 'acusa glob morto', () => {
		const a = checkRulePaths(
			[ { file: '.claude/rules/x.md', paths: [ 'src/**/*.rb' ] } ],
			files
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /nenhum arquivo/ );
	} );

	it( 'acusa glob que casa com mais de 60% do repo', () => {
		const a = checkRulePaths(
			[ { file: '.claude/rules/x.md', paths: [ '**/*' ] } ],
			files
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /60%/ );
	} );

	it( 'acusa rule sem paths', () => {
		const a = checkRulePaths(
			[ { file: '.claude/rules/x.md', paths: [] } ],
			files
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /sem paths/ );
	} );
} );

describe( 'parseRulePaths', () => {
	it( 'lê o front-matter de uma rule', () => {
		expect(
			parseRulePaths(
				'---\npaths:\n  - "features/**/*.php"\n  - "shared/**/*.php"\n---\n\n- x\n'
			)
		).toEqual( [ 'features/**/*.php', 'shared/**/*.php' ] );
	} );

	it( 'devolve [] quando não há front-matter', () => {
		expect( parseRulePaths( '- x\n' ) ).toEqual( [] );
	} );
} );

describe( 'checkIndex', () => {
	it( 'acusa ADR ausente do índice', () => {
		const a = checkIndex(
			[
				{ id: '0001', file: 'docs/adr/0001-a.md' },
				{ id: '0002', file: 'docs/adr/0002-b.md' },
			],
			'| [0001](0001-a.md) | ... |\n'
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /0002/ );
	} );
} );

describe( 'checkAdrHygiene', () => {
	it( 'acusa ADR acima de 120 linhas', () => {
		const a = checkAdrHygiene(
			[
				{
					id: '0001',
					file: 'docs/adr/0001-a.md',
					linhas: 140,
					origem: 'superpowers/specs/x.md',
				},
			],
			[ 'docs/superpowers/specs/x.md' ]
		);
		expect( a.some( ( p ) => /120/.test( p.message ) ) ).toBe( true );
	} );

	it( 'acusa origem que não existe', () => {
		const a = checkAdrHygiene(
			[
				{
					id: '0001',
					file: 'docs/adr/0001-a.md',
					linhas: 50,
					origem: 'superpowers/specs/sumiu.md#x',
				},
			],
			[ 'docs/superpowers/specs/outro.md' ]
		);
		expect( a.some( ( p ) => /origem/.test( p.message ) ) ).toBe( true );
	} );
} );

describe( 'a fiação dos rulings mora aqui, não no ponto de chamada', () => {
	// Antes, o teto e a lista de seções eram argumentos literais no
	// `doctor.mjs`, que está fora do `collectCoverageFrom` — um comentário era
	// tudo que impedia alguém de voltar para 80 ou de reintroduzir `## Never`.
	it( 'o teto do CLAUDE.md é 95 (R5)', () => {
		expect( CLAUDE_MD_LINE_CEILING ).toBe( 95 );
	} );

	it( 'a citação de ADR cobre Conventions e não Never (R6)', () => {
		// "não commite em master" é processo, não decisão de arquitetura: não
		// há ADR por trás, e exigir citação ali produz achado impossível de
		// fechar sem inventar uma.
		expect( CITED_SECTIONS ).toEqual( [ 'Conventions' ] );
	} );
} );

describe( 'checkClaudeMdSize com o arquivo ausente', () => {
	it( 'diz que não achou, em vez de "nada a relatar"', () => {
		// Arquivo ausente chega como '' e caberia folgado no teto. Silêncio
		// que se lê como saúde é o pior resultado possível num relatório.
		for ( const vazio of [ '', '   \n\n' ] ) {
			const a = checkClaudeMdSize( vazio );
			expect( a ).toHaveLength( 1 );
			expect( a[ 0 ].message ).toMatch(
				/não foi encontrado ou está vazio/
			);
		}
	} );
} );

describe( 'reviewTriggerCounts', () => {
	const com = ( files ) => ( { files } );

	it( 'conta features distintas e devolve os nomes ordenados', () => {
		const r = reviewTriggerCounts(
			com( [
				'features/zebra/php/a.php',
				'features/alfa/editor/b.ts',
				'features/alfa/tests/js/c.test.ts',
				'shared/php/class-x.php',
				'scripts/doctor.mjs',
			] )
		);
		expect( r.features ).toEqual( [ 'alfa', 'zebra' ] );
	} );

	it( 'só conta como módulo de shared/ o que é class-*.php em shared/php/', () => {
		// O gatilho da ADR-0004 é "shared/ passar de três MÓDULOS". Teste e
		// arquivo de outro tipo não são módulo, e contá-los dispararia a
		// revisão de uma decisão cedo demais.
		const r = reviewTriggerCounts(
			com( [
				'shared/php/class-settings-page.php',
				'shared/php/class-outra.php',
				'shared/tests/php/test-settings-page.php',
				'shared/php/helpers.php',
				'shared/editor/x.ts',
			] )
		);
		expect( r.sharedModules ).toBe( 2 );
	} );

	it( 'repo vazio dá zero e lista vazia, sem estourar', () => {
		expect( reviewTriggerCounts( com( [] ) ) ).toEqual( {
			features: [],
			sharedModules: 0,
		} );
	} );
} );

describe( 'filesAboveP95', () => {
	const linhas = ( n ) => 'x\n'.repeat( n - 1 );

	it( 'reporta só o que passa do corte, do menor para o maior', () => {
		// Vinte pequenos, um médio e um gigante: `floor( 22 * 0.95 )` é 20, o
		// corte é o vigésimo primeiro menor, e sobram os dois maiores.
		const files = [
			...Array.from( { length: 20 }, ( _, i ) => `p${ i }.ts` ),
			'medio.ts',
			'gigante.ts',
		];
		const tamanho = ( f ) => {
			if ( f === 'gigante.ts' ) {
				return 4000;
			}
			return f === 'medio.ts' ? 300 : 10;
		};
		const r = filesAboveP95( { files }, ( f ) => linhas( tamanho( f ) ) );
		expect( r.files.map( ( x ) => x.lines ) ).toEqual( [ 4000 ] );
		expect( r.files.map( ( x ) => x.file ) ).toEqual( [ 'gigante.ts' ] );
	} );

	it( 'em conjunto pequeno o corte cai no maior, e nada é reportado', () => {
		// Não é defeito: com quatro arquivos, `floor( 4 * 0.95 )` é 3, o índice
		// do maior. Percentil sobre punhado de arquivos não tem o que dizer, e
		// a alternativa — inventar um limiar fixo — é justamente o que este
		// sinal relativo existe para evitar.
		const tamanhos = { 'a.ts': 10, 'b.ts': 20, 'c.ts': 30, 'd.ts': 4000 };
		const r = filesAboveP95( { files: Object.keys( tamanhos ) }, ( f ) =>
			linhas( tamanhos[ f ] )
		);
		expect( r.p95 ).toBe( 4000 );
		expect( r.files ).toEqual( [] );
	} );

	it( 'ignora extensão que não é código', () => {
		const r = filesAboveP95(
			{ files: [ 'a.ts', 'b.md', 'c.scss', 'd.json' ] },
			( f ) => ( f === 'a.ts' ? linhas( 5 ) : linhas( 9000 ) )
		);
		expect( r.files ).toEqual( [] );
	} );

	it( 'ignora o bundle vendorizado, que é grande por não ser nosso', () => {
		// Mantê-lo dentro empurraria o p95 para cima e esconderia os nossos.
		const grande = 'features/narration/editor/engine/sentencepiece.js';
		const r = filesAboveP95(
			{ files: [ grande, 'a.ts', 'b.ts' ] },
			( f ) => ( f === grande ? linhas( 90000 ) : linhas( 10 ) )
		);
		expect( r.files.map( ( x ) => x.file ) ).not.toContain( grande );
	} );

	it( 'lista vazia não estoura no cálculo do percentil', () => {
		expect( filesAboveP95( { files: [] }, () => '' ) ).toEqual( {
			p95: 0,
			files: [],
		} );
	} );
} );
