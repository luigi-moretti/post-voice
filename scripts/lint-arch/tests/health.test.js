const {
	checkClaudeMdSize,
	checkAdrCitations,
	checkRulePaths,
	checkIndex,
	checkIndexTable,
	checkAdrHygiene,
	globToRegExp,
	parseRulePaths,
	reviewTriggerCounts,
	filesAboveP95,
	e2eScenarioCount,
	DOCTOR_CHECKS,
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
		// A contagem é a do `wc -l` e a do editor de quem lê o relatório: o
		// `\n` final termina a última linha, não abre uma nova. Antes o
		// `split` devolvia um a mais, e o relatório dizia 97 sobre um arquivo
		// que o editor mostrava com 96 — um número que não bate com a
		// ferramenta do leitor gasta a confiança dele nos outros números.
		expect( checkClaudeMdSize( 'a\n'.repeat( 95 ) ) ).toEqual( [] );
		expect( checkClaudeMdSize( 'a\n'.repeat( 94 ) + 'a' ) ).toEqual( [] );
		const acima = checkClaudeMdSize( 'a\n'.repeat( 96 ) );
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

describe( 'checkAdrCitations junta as linhas de continuação do bullet', () => {
	const ids = new Set( [ '0004' ] );

	it( 'a citação vale mesmo quebrada para a linha de baixo', () => {
		// O checker olhava linha a linha, então um bullet quebrado com a
		// citação na segunda linha era "sem citação". O efeito não era citar
		// melhor: era escrever linhas de 400 caracteres para não ser
		// reprovado — e foi o que aconteceu, em `.claude/rules/php.md` e na
		// primeira versão do CLAUDE.md reescrito.
		const linha =
			'- Uma convenção comprida que\n  continua na linha de baixo (ADR-0004).';
		expect( checkAdrCitations( linha, [], ids ) ).toEqual( [] );
	} );

	it( 'mas um bullet quebrado que não cita nada continua sendo pego', () => {
		const linha =
			'- Uma convenção comprida que\n  continua e não cita ADR nenhuma.';
		expect( checkAdrCitations( linha, [], ids ) ).toHaveLength( 1 );
	} );

	it( 'parágrafo depois de linha em branco não é continuação de bullet', () => {
		const src = '- cita (ADR-0004).\n\nParágrafo solto.';
		expect( checkAdrCitations( src, [], ids ) ).toEqual( [] );
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

// Achado ALTO da revisão final da branch: a ADR-0012 afirmava que "o `doctor`
// reporta a contagem de cenários E2E e o tempo da última execução", e o doctor
// não tinha nenhuma das duas linhas. O contador abaixo foi validado contra o
// oráculo real: o Playwright reporta 37 cenários na árvore de hoje, e
// `e2eScenarioCount` devolve 37 para a mesma árvore.
describe( 'e2eScenarioCount', () => {
	const ctxCom = ( mapa ) => ( {
		root: '/repo',
		files: Object.keys( mapa ),
		read: ( f ) => mapa[ f ],
	} );

	it( 'conta `test(` por arquivo de spec', () => {
		expect(
			e2eScenarioCount(
				ctxCom( {
					'e2e/a.spec.ts':
						"test( 'um', async () => {} );\ntest( 'dois', async () => {} );\n",
					'e2e/b.spec.ts': "test( 'três', async () => {} );\n",
				} )
			)
		).toBe( 3 );
	} );

	it( 'não conta `test.describe(`, que é agrupador e não cenário', () => {
		expect(
			e2eScenarioCount(
				ctxCom( {
					'e2e/a.spec.ts':
						"test.describe( 'grupo', () => {\n\ttest( 'um', async () => {} );\n} );\n",
				} )
			)
		).toBe( 1 );
	} );

	it( 'ignora arquivos fora de e2e/', () => {
		expect(
			e2eScenarioCount(
				ctxCom( {
					'features/x/tests/a.test.ts': "test( 'um', () => {} );\n",
				} )
			)
		).toBe( 0 );
	} );
} );

describe( 'DOCTOR_CHECKS', () => {
	it( 'é o espelho declarado das ADRs que pedem enforced_by: doctor', () => {
		// O conteúdo exato é conferido pelo `lint:arch`, nas duas direções.
		// Aqui só se fixa que o registro existe e é indexado por id de ADR.
		expect( Object.keys( DOCTOR_CHECKS ).sort() ).toEqual( [
			'0001',
			'0012',
		] );
	} );
} );

// Achado da revisão final da branch: a tabela do README duplica `status` e
// `enforced_by` das 15 ADRs, e `checkIndex` só conferia que o NOME DO ARQUIVO
// aparecia no texto. Medido: trocar o status da ADR-0011 no front-matter
// deixava a tabela mentindo com `lint:arch` em 0 e o doctor em "nada a
// relatar". Duplicação sem checagem é exatamente a deriva que este mecanismo
// existe para impedir.
describe( 'checkIndexTable', () => {
	const adr = ( over = {} ) => ( {
		id: '0011',
		status: 'aceita-com-desvio',
		enforcedBy: [ 'no-untyped-editor-code' ],
		file: 'docs/adr/0011-editor-em-typescript.md',
		...over,
	} );
	const linha = ( status, defendida ) =>
		`| [0011](0011-editor-em-typescript.md) | Editor em TypeScript | ${ status } | ${ defendida } |\n`;

	it( 'aceita a linha que bate com o front-matter', () => {
		expect(
			checkIndexTable(
				[ adr() ],
				linha( 'aceita-com-desvio', '`no-untyped-editor-code`' )
			)
		).toEqual( [] );
	} );

	it( 'acusa status divergente', () => {
		const p = checkIndexTable(
			[ adr() ],
			linha( 'aceita', '`no-untyped-editor-code`' )
		);
		expect( p ).toHaveLength( 1 );
		expect( p[ 0 ].message ).toMatch( /status/ );
	} );

	it( 'acusa enforced_by divergente', () => {
		const p = checkIndexTable(
			[ adr() ],
			linha( 'aceita-com-desvio', '`outra-regra`' )
		);
		expect( p ).toHaveLength( 1 );
		expect( p[ 0 ].message ).toMatch( /defendida por|enforced_by/i );
	} );

	it( 'confere a lista inteira, não só a primeira regra', () => {
		const p = checkIndexTable(
			[
				adr( {
					enforcedBy: [ 'feature-layout', 'shared-two-consumers' ],
				} ),
			],
			linha( 'aceita-com-desvio', '`feature-layout`' )
		);
		expect( p ).toHaveLength( 1 );
	} );

	it( 'ignora ADR ausente da tabela: quem cobra ausência é checkIndex', () => {
		expect( checkIndexTable( [ adr() ], '| # | Título |\n' ) ).toEqual(
			[]
		);
	} );
} );
