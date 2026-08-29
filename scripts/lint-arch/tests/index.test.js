const { run, format } = require( '../index' );

const adr = ( over = {} ) => ( {
	id: '0005',
	titulo: 'Topologia de dependência entre features',
	status: 'aceita',
	data: '2026-08-27',
	origem: 'superpowers/specs/x.md',
	enforcedBy: [ 'feature-deps' ],
	revisarQuando: '',
	desvios: [],
	file: 'docs/adr/0005-topologia.md',
	linhas: 60,
	...over,
} );

const regra = ( id, adrId, findings = [] ) => ( {
	id,
	adr: adrId,
	check: () => findings,
} );

const acharam = ( key ) => ( {
	key,
	file: key.split( ' → ' )[ 0 ],
	line: 7,
	message: 'referencia outra feature',
} );

const ctx = { root: '/repo', files: [], read: () => '' };

describe( 'run', () => {
	it( 'não acusa nada quando as regras não acham nada', () => {
		const out = run( {
			adrs: [ adr() ],
			registry: { 'feature-deps': regra( 'feature-deps', '0005' ) },
			ctx,
		} );
		expect( out.problems ).toEqual( [] );
		expect( out.warnings ).toEqual( [] );
	} );

	it( 'acusa ADR que declara regra inexistente', () => {
		const out = run( { adrs: [ adr() ], registry: {}, ctx } );
		expect( out.problems ).toHaveLength( 1 );
		expect( out.problems[ 0 ].message ).toMatch( /não existe/ );
		expect( out.problems[ 0 ].message ).toMatch( /feature-deps/ );
	} );

	it( 'acusa regra órfã', () => {
		const out = run( {
			adrs: [ adr( { enforcedBy: [ 'review-manual' ] } ) ],
			registry: { 'feature-deps': regra( 'feature-deps', '0005' ) },
			ctx,
		} );
		expect( out.problems ).toHaveLength( 1 );
		expect( out.problems[ 0 ].message ).toMatch( /órfã/ );
	} );

	it( 'aceita o literal review-manual sem procurar regra', () => {
		const out = run( {
			adrs: [ adr( { enforcedBy: [ 'review-manual' ] } ) ],
			registry: {},
			ctx,
		} );
		expect( out.problems ).toEqual( [] );
	} );

	// Achado ALTO da revisão final da branch. `doctor` era literal cego: a
	// ADR-0012 afirmava que "o doctor reporta a contagem de cenários E2E e o
	// tempo da última execução", o doctor não tinha nenhuma das duas linhas, e
	// como o runner PULAVA os literais, nada no mecanismo conseguia detectar
	// que aquele `enforced_by` não enforçava coisa alguma. Uma ADR podia
	// afirmar qualquer coisa sobre o relatório.
	// `doctor` passa a exigir entrada num registro de seções, espelhado nas
	// duas direções, exatamente como já vale para as regras. `review-manual`
	// segue literal de verdade: quem enforça é gente.
	describe( 'doctor como enforced_by verificável', () => {
		it( 'acusa ADR que declara doctor sem seção declarada', () => {
			const out = run( {
				adrs: [ adr( { enforcedBy: [ 'doctor' ] } ) ],
				registry: {},
				ctx,
				doctorChecks: {},
			} );
			expect( out.problems ).toHaveLength( 1 );
			expect( out.problems[ 0 ].message ).toMatch( /doctor/ );
		} );

		it( 'aceita quando a seção está declarada', () => {
			const out = run( {
				adrs: [ adr( { enforcedBy: [ 'doctor' ] } ) ],
				registry: {},
				ctx,
				doctorChecks: { '0005': 'contagem de X' },
			} );
			expect( out.problems ).toEqual( [] );
		} );

		it( 'acusa seção órfã: declarada e nenhuma ADR a pede', () => {
			const out = run( {
				adrs: [ adr( { enforcedBy: [ 'review-manual' ] } ) ],
				registry: {},
				ctx,
				doctorChecks: { '0099': 'seção de ninguém' },
			} );
			expect( out.problems ).toHaveLength( 1 );
			expect( out.problems[ 0 ].message ).toMatch( /órfã|órfão/ );
		} );
	} );

	it( 'acusa violação não listada, citando a ADR', () => {
		const out = run( {
			adrs: [ adr() ],
			registry: {
				'feature-deps': regra( 'feature-deps', '0005', [
					acharam( 'a.php → B' ),
				] ),
			},
			ctx,
		} );
		expect( out.problems ).toHaveLength( 1 );
		expect( out.problems[ 0 ].message ).toMatch( /ADR-0005/ );
		expect( out.problems[ 0 ].message ).toMatch(
			/docs\/adr\/0005-topologia\.md/
		);
		expect( out.problems[ 0 ].line ).toBe( 7 );
	} );

	it( 'deixa passar violação listada em desvios', () => {
		const out = run( {
			adrs: [
				adr( {
					status: 'aceita-com-desvio',
					desvios: [ 'a.php → B' ],
				} ),
			],
			registry: {
				'feature-deps': regra( 'feature-deps', '0005', [
					acharam( 'a.php → B' ),
				] ),
			},
			ctx,
		} );
		expect( out.problems ).toEqual( [] );
		expect( out.warnings ).toEqual( [] );
	} );

	it( 'não afirma dívida quitada quando uma regra da ADR não existe', () => {
		// Sem regra, não há achado — mas isso é informação indisponível, não
		// prova de que o desvio deixou de existir.
		const out = run( {
			adrs: [
				adr( {
					enforcedBy: [ 'feature-deps', 'regra-que-nao-existe' ],
					status: 'aceita-com-desvio',
					desvios: [ 'a.php → B' ],
				} ),
			],
			registry: { 'feature-deps': regra( 'feature-deps', '0005', [] ) },
			ctx,
		} );
		expect( out.warnings ).toEqual( [] );
		expect( out.problems ).toHaveLength( 1 );
		expect( out.problems[ 0 ].message ).toMatch( /não existe/ );
	} );

	it( 'avisa quando um desvio listado não viola mais', () => {
		const out = run( {
			adrs: [
				adr( {
					status: 'aceita-com-desvio',
					desvios: [ 'a.php → B' ],
				} ),
			],
			registry: { 'feature-deps': regra( 'feature-deps', '0005', [] ) },
			ctx,
		} );
		expect( out.problems ).toEqual( [] );
		expect( out.warnings ).toHaveLength( 1 );
		expect( out.warnings[ 0 ].message ).toMatch( /dívida quitada/ );
	} );

	it( 'compara desvios por ADR, não por regra', () => {
		// ADR-0004 tem duas regras e uma só lista de desvios. O desvio pertence à
		// primeira; a segunda não pode acusá-lo de dívida quitada.
		const out = run( {
			adrs: [
				adr( {
					id: '0004',
					enforcedBy: [ 'feature-layout', 'shared-two-consumers' ],
					status: 'aceita-com-desvio',
					desvios: [ 'x.ts → raiz' ],
				} ),
			],
			registry: {
				'feature-layout': regra( 'feature-layout', '0004', [
					acharam( 'x.ts → raiz' ),
				] ),
				'shared-two-consumers': regra(
					'shared-two-consumers',
					'0004',
					[]
				),
			},
			ctx,
		} );
		expect( out.problems ).toEqual( [] );
		expect( out.warnings ).toEqual( [] );
	} );

	it( 'acusa regra cujo campo adr não bate com a ADR que a declara', () => {
		const out = run( {
			adrs: [ adr() ],
			registry: { 'feature-deps': regra( 'feature-deps', '0099' ) },
			ctx,
		} );
		expect( out.problems ).toHaveLength( 1 );
		expect( out.problems[ 0 ].message ).toMatch( /declara adr: 0099/ );
	} );

	it( 'roda a mesma regra uma vez só, mesmo declarada por duas ADRs', () => {
		let chamadas = 0;
		const registry = {
			'feature-deps': {
				id: 'feature-deps',
				adr: '0005',
				check: () => {
					chamadas += 1;
					return [];
				},
			},
		};
		run( {
			adrs: [ adr(), adr( { id: '0006', file: 'docs/adr/0006-y.md' } ) ],
			registry,
			ctx,
		} );
		expect( chamadas ).toBe( 1 );
	} );
} );

describe( 'format', () => {
	it( 'lista problemas e avisos separadamente', () => {
		const texto = format( {
			problems: [ { message: 'quebrou' } ],
			warnings: [ { message: 'dívida quitada: x' } ],
		} );
		expect( texto ).toMatch( /quebrou/ );
		expect( texto ).toMatch( /dívida quitada: x/ );
	} );

	it( 'diz que está tudo certo quando não há nada', () => {
		expect( format( { problems: [], warnings: [] } ) ).toMatch(
			/nenhuma violação/
		);
	} );
} );
