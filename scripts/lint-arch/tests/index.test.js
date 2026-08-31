const { run, format } = require( '../index' );
const { createContext } = require( '../context' );

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
	// Achado da revisão final da branch: `status` nunca era lido, então
	// `proposta`, `aceita`, `revogada` e `superada-por-0016` bloqueavam
	// identicamente. Medido: marcar a ADR-0011 como revogada e zerar os
	// desvios dela deixava 2 problemas de pé — a decisão estava formalmente
	// aposentada e o gate não tomava conhecimento. A única saída era apagar o
	// `enforced_by` ou a regra, e as duas apagam o rastro histórico que a
	// ADR-0001 existe para preservar.
	describe( 'status decide se a ADR enforça', () => {
		const comRegra = ( status ) => ( {
			adrs: [ adr( { status } ) ],
			registry: {
				'feature-deps': regra( 'feature-deps', '0005', [
					acharam( 'features/a/x.ts → b/y' ),
				] ),
			},
			ctx,
		} );

		it( 'aceita bloqueia', () => {
			const out = run( comRegra( 'aceita' ) );
			expect( out.problems ).toHaveLength( 1 );
		} );

		it( 'aceita-com-desvio bloqueia', () => {
			const out = run( comRegra( 'aceita-com-desvio' ) );
			expect( out.problems ).toHaveLength( 1 );
		} );

		it( 'proposta não bloqueia: a decisão ainda está em discussão', () => {
			const out = run( comRegra( 'proposta' ) );
			expect( out.problems ).toEqual( [] );
		} );

		// Achado da revisão das correções: `proposta` não bloqueava E não
		// deixava rastro. `revogada` e `superada-por-NNNN` ao menos deixam a
		// regra órfã, que reprova alto. Medido: baixar uma ADR aceita para
		// proposta, ajustar a tabela do índice e esvaziar `desvios:` — tudo o
		// que o mecanismo exige para ficar consistente — dava lint:arch em 0
		// com a regra ainda achando violação real. Desligar um gate é decisão
		// legítima; desligá-lo sem rastro é como esta branch começou.
		it( 'proposta não bloqueia, mas DIZ quantas violações não estão reprovando', () => {
			const out = run( comRegra( 'proposta' ) );
			expect( out.problems ).toEqual( [] );
			const aviso = out.warnings.find( ( w ) =>
				/não reprova — mas acha 1 violação/.test( w.message )
			);
			expect( aviso ).toBeDefined();
			expect( aviso.rule ).toBe( 'feature-deps' );
		} );

		it( 'proposta sem violação nenhuma não gera aviso de violação', () => {
			const out = run( {
				adrs: [ adr( { status: 'proposta' } ) ],
				registry: {
					'feature-deps': {
						id: 'feature-deps',
						adr: '0005',
						check: () => [],
					},
				},
				ctx,
			} );
			expect(
				out.warnings.filter( ( w ) =>
					/não reprova — mas acha/.test( w.message )
				)
			).toEqual( [] );
		} );

		// A violação achada pela regra não é reportada. A regra em si vira
		// órfã, que é outro problema e tem teste próprio logo abaixo — por
		// isso a asserção filtra em vez de exigir zero.
		const violacoes = ( out ) =>
			out.problems.filter( ( p ) => ! /órfã/.test( p.message ) );

		it( 'revogada não bloqueia', () => {
			expect( violacoes( run( comRegra( 'revogada' ) ) ) ).toEqual( [] );
		} );

		it( 'superada-por-NNNN não bloqueia', () => {
			expect(
				violacoes( run( comRegra( 'superada-por-0016' ) ) )
			).toEqual( [] );
		} );

		// Uma `proposta` pode ser escrita antes da regra existir. Isso é aviso,
		// não reprovação: reprovar forçaria a decisão pela porta dos fundos.
		it( 'proposta que nomeia regra inexistente avisa, não reprova', () => {
			const out = run( {
				adrs: [ adr( { status: 'proposta' } ) ],
				registry: {},
				ctx,
			} );
			expect( out.problems ).toEqual( [] );
			expect( out.warnings.length ).toBeGreaterThan( 0 );
		} );

		// A regra de uma proposta em voo não é órfã: ela existe porque a ADR
		// que está sendo escrita a pede.
		it( 'a regra de uma proposta não é órfã', () => {
			const out = run( {
				adrs: [ adr( { status: 'proposta' } ) ],
				registry: { 'feature-deps': regra( 'feature-deps', '0005' ) },
				ctx,
			} );
			expect( out.problems ).toEqual( [] );
		} );

		// Já a de uma revogada é: ninguém a executa mais, e mantê-la é código
		// morto. Apagar a regra é o passo seguinte da supersessão; o porquê
		// histórico fica no texto da ADR, que não se reescreve.
		it( 'a regra de uma revogada aparece como órfã, para ser apagada', () => {
			const out = run( {
				adrs: [ adr( { status: 'revogada' } ) ],
				registry: { 'feature-deps': regra( 'feature-deps', '0005' ) },
				ctx,
			} );
			expect( out.problems ).toHaveLength( 1 );
			expect( out.problems[ 0 ].message ).toMatch( /órfã/ );
		} );

		// Uma revogada pode ter a regra já apagada: exigir que exista forçaria
		// a manter código morto para sempre.
		it( 'revogada não exige que a regra ainda exista', () => {
			const out = run( {
				adrs: [ adr( { status: 'revogada' } ) ],
				registry: {},
				ctx,
			} );
			expect( out.problems ).toEqual( [] );
		} );

		it( 'desvios numa ADR que não enforça são inertes, e o aviso diz isso', () => {
			const out = run( {
				adrs: [
					adr( {
						status: 'revogada',
						desvios: [ 'features/a/x.ts → b/y' ],
					} ),
				],
				registry: {},
				ctx,
			} );
			expect( out.problems ).toEqual( [] );
			expect(
				out.warnings.some( ( w ) => /inerte/.test( w.message ) )
			).toBe( true );
		} );
	} );

	describe( 'doctor como enforced_by verificável', () => {
		// Estes dois passam um ctx que TEM o `doctor.mjs`: a ausência do arquivo
		// é ela própria um achado (ver o teste do arquivo fora da árvore
		// abaixo), e sem isto os dois casos abaixo mediriam essa outra coisa.
		const comDoctorMjs = ( fonte ) =>
			createContext( {
				files: [ 'scripts/doctor.mjs' ],
				read: () => fonte,
			} );

		it( 'acusa ADR que declara doctor sem seção declarada', () => {
			const out = run( {
				adrs: [ adr( { enforcedBy: [ 'doctor' ] } ) ],
				registry: {},
				ctx: comDoctorMjs( '' ),
				doctorChecks: {},
			} );
			expect( out.problems ).toHaveLength( 1 );
			expect( out.problems[ 0 ].message ).toMatch( /doctor/ );
		} );

		it( 'aceita quando a seção está declarada', () => {
			const out = run( {
				adrs: [ adr( { enforcedBy: [ 'doctor' ] } ) ],
				registry: {},
				ctx: comDoctorMjs( '' ),
				doctorChecks: { '0005': 'contagem de X' },
			} );
			expect( out.problems ).toEqual( [] );
		} );

		// Achado II2 da segunda re-review: a checagem pulava quando o
		// `doctor.mjs` não estava na árvore — o mesmo defeito que o
		// `adr-index-table` fechara um commit antes. Medido: `git rm` no
		// arquivo dava exit 0 e zero saída, e `doctor` não roda no `ci.yml`.
		it( 'acusa quando o doctor.mjs não está na árvore', () => {
			const out = run( {
				adrs: [ adr( { enforcedBy: [ 'doctor' ] } ) ],
				registry: {},
				ctx: { root: '/repo', files: [], read: () => '' },
				doctorChecks: { '0005': 'seção "x": contagem' },
			} );
			expect( out.problems ).toHaveLength( 1 );
			expect( out.problems[ 0 ].message ).toMatch(
				/não existe na árvore/
			);
		} );

		// Achado II3, fechado em duas etapas. Primeiro apagar reprovava e
		// comentar não; depois a âncora de linha pegou o `//`, mas `/* */`,
		// template e string ainda passavam. A busca virou o padrão de duas
		// fontes: a CHAMADA é reconhecida na cópia branqueada, o TÍTULO é lido
		// do cru no mesmo offset.
		it.each( [
			[ 'comentada com //', "// secao( 'fronteira Jest/E2E', l );\n" ],
			[
				'dentro de /* */',
				"/*\nsecao( 'fronteira Jest/E2E', l );\n*/\n",
			],
			[
				'dentro de template',
				"const x = `\nsecao( 'fronteira Jest/E2E', l );\n`;\n",
			],
			[
				'dentro de string',
				'const x = "secao( \'fronteira Jest/E2E\', l );";\n',
			],
			[ 'ausente de vez', "secao( 'outra', l );\n" ],
		] )( 'não aceita a seção %s', ( _, fonte ) => {
			const out = run( {
				adrs: [ adr( { enforcedBy: [ 'doctor' ] } ) ],
				registry: {},
				ctx: comDoctorMjs( fonte ),
				doctorChecks: {
					'0005': 'seção "fronteira Jest/E2E": contagem',
				},
			} );
			expect( out.problems ).toHaveLength( 1 );
			expect( out.problems[ 0 ].message ).toMatch( /não a imprime/ );
		} );

		it( 'aceita o título com contagem, pelo prefixo antes do parêntese', () => {
			const out = run( {
				adrs: [ adr( { enforcedBy: [ 'doctor' ] } ) ],
				registry: {},
				ctx: comDoctorMjs( 'secao( `ADRs (${ n })`, l );\n' ),
				doctorChecks: { '0005': 'seção "ADRs": contagem' },
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
