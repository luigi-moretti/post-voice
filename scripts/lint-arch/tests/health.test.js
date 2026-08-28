const {
	checkClaudeMdSize,
	checkAdrCitations,
	checkRulePaths,
	checkIndex,
	checkAdrHygiene,
	globToRegExp,
	parseRulePaths,
} = require( '../health' );

describe( 'checkClaudeMdSize', () => {
	it( 'aceita arquivo dentro do teto', () => {
		expect( checkClaudeMdSize( 'a\n'.repeat( 60 ), 80 ) ).toEqual( [] );
	} );

	it( 'acusa acima do teto e nomeia a maior seção', () => {
		const src = '## Conventions\n' + 'x\n'.repeat( 90 ) + '## Never\n- a\n';
		const a = checkClaudeMdSize( src, 80 );
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /## Conventions/ );
		expect( a[ 0 ].message ).toMatch( /80/ );
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
