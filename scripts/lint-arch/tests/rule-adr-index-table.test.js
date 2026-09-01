const { createContext } = require( '../context' );
const regra = require( '../rules/adr-index-table' );
const registro = require( '../rules' );

const INDICE = 'docs/adr/README.md';

const adr = ( over = {} ) => ( {
	id: '0004',
	titulo: 'Layout por feature',
	status: 'aceita',
	file: 'docs/adr/0004-layout-por-feature.md',
	enforcedBy: [ 'feature-layout' ],
	desvios: [],
	...over,
} );

const linha = ( status, defendida ) =>
	`| id | Título | Status | Defendida por |\n| --- | --- | --- | --- |\n| [0004](0004-layout-por-feature.md) | Layout por feature | ${ status } | ${ defendida } |\n`;

const ctxCom = ( readme, adrs ) =>
	createContext( { files: [ INDICE ], read: () => readme, adrs } );

describe( 'adr-index-table', () => {
	it( 'declara a ADR-0001 e está no registro', () => {
		expect( regra.adr ).toBe( '0001' );
		expect( regra.id ).toBe( 'adr-index-table' );
		// A regra existir sem estar no registro a tornaria invisível para o
		// espelho — que é o defeito que esta regra nasceu para fechar.
		expect( registro[ 'adr-index-table' ] ).toBe( regra );
	} );

	it( 'aceita a tabela que bate com o front-matter', () => {
		expect(
			regra.check(
				ctxCom( linha( 'aceita', '`feature-layout`' ), [ adr() ] )
			)
		).toEqual( [] );
	} );

	it( 'acusa status divergente, com chave estável e linha', () => {
		const a = regra.check(
			ctxCom( linha( 'revogada', '`feature-layout`' ), [ adr() ] )
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].key ).toBe( `${ INDICE } → 0004-status` );
		expect( a[ 0 ].file ).toBe( INDICE );
		expect( a[ 0 ].line ).toBe( 3 );
	} );

	it( 'acusa enforced_by divergente sob chave PRÓPRIA', () => {
		// Status e enforced_by são dois defeitos: uma chave só deixaria uma
		// linha de `desvios:` absolver os dois.
		const a = regra.check(
			ctxCom( linha( 'revogada', '`outra-regra`' ), [ adr() ] )
		);
		expect( a ).toHaveLength( 2 );
		expect( new Set( a.map( ( f ) => f.key ) ) ).toEqual(
			new Set( [
				`${ INDICE } → 0004-status`,
				`${ INDICE } → 0004-enforced_by`,
			] )
		);
	} );

	it( 'a chave não carrega os valores observados, que mudam a cada edição', () => {
		const umaCoisa = regra.check(
			ctxCom( linha( 'revogada', '`feature-layout`' ), [ adr() ] )
		);
		const outraCoisa = regra.check(
			ctxCom( linha( 'proposta', '`feature-layout`' ), [ adr() ] )
		);
		expect( umaCoisa[ 0 ].key ).toBe( outraCoisa[ 0 ].key );
		expect( umaCoisa[ 0 ].message ).not.toBe( outraCoisa[ 0 ].message );
	} );

	// Este teste já congelou o silêncio duas vezes nesta branch, com dois
	// alvos diferentes. Índice ausente apaga a tabela INTEIRA, e quem cobra a
	// ausência é o `checkIndex` do doctor, que não bloqueia — então calar aqui
	// é a mesma lacuna que o `doctor.mjs` ausente tinha no outro espelho.
	it( 'ACUSA quando o índice não está na árvore', () => {
		const a = regra.check(
			createContext( { files: [], read: () => '', adrs: [ adr() ] } )
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].key ).toBe( `${ INDICE } → indice-ausente` );
	} );

	it( 'ACUSA quando o índice está rastreado mas ilegível, sem estourar', () => {
		const a = regra.check(
			createContext( {
				files: [ INDICE ],
				read: () => {
					throw Object.assign( new Error( 'ENOENT' ), {
						code: 'ENOENT',
					} );
				},
				adrs: [ adr() ],
			} )
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].key ).toBe( `${ INDICE } → indice-ausente` );
	} );

	// Este teste já existiu ao contrário, congelando o silêncio como
	// comportamento desejado. Medido: tirar `adrs` da chamada de
	// `createContext` no CLI desligava o gate inteiro — exit 0, zero saída,
	// regra não órfã, 531 testes verdes. Índice presente sem ADRs é fiação
	// quebrada, e um gate que não consegue conferir tem de dizer isso.
	it( 'ACUSA com o índice presente e nenhuma ADR: é fiação quebrada', () => {
		const a = regra.check( ctxCom( linha( 'revogada', '`x`' ), [] ) );
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].key ).toBe( `${ INDICE } → sem-adrs-no-contexto` );
	} );

	it( 'com índice ausente E sem ADRs, reporta a ausência do índice', () => {
		// A ausência do índice é o defeito mais externo: sem ele não há tabela
		// para conferir, com ADRs ou sem.
		const a = regra.check(
			createContext( { files: [], read: () => '', adrs: [] } )
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].key ).toBe( `${ INDICE } → indice-ausente` );
	} );
} );
