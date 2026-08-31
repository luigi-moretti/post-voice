const fs = require( 'node:fs' );
const os = require( 'node:os' );
const path = require( 'node:path' );
const { parseAdr, loadAdrs, STATUSES } = require( '../adr' );

const VALIDO = `---
id: 0005
titulo: Topologia de dependência entre features
status: aceita-com-desvio
data: 2026-08-27
origem: superpowers/specs/2026-08-08-wp-narration-plugin-mvp-design.md#arquitetura
enforced_by: [ feature-deps ]    # lista, sempre
revisar_quando: uma quarta feature entrar
desvios:
  - features/narration/php/class-assets.php → Post_Voice_Dictionary_Store
  - features/narration/editor/index.tsx → pronunciation/editor/dictionary-entry
---

## Contexto

Texto.
`;

describe( 'parseAdr', () => {
	it( 'lê os campos escalares', () => {
		const adr = parseAdr( VALIDO, 'docs/adr/0005-x.md' );
		expect( adr.id ).toBe( '0005' );
		expect( adr.titulo ).toBe( 'Topologia de dependência entre features' );
		expect( adr.status ).toBe( 'aceita-com-desvio' );
		expect( adr.data ).toBe( '2026-08-27' );
		expect( adr.origem ).toBe(
			'superpowers/specs/2026-08-08-wp-narration-plugin-mvp-design.md#arquitetura'
		);
		expect( adr.revisarQuando ).toBe( 'uma quarta feature entrar' );
		expect( adr.file ).toBe( 'docs/adr/0005-x.md' );
	} );

	it( 'lê enforced_by como lista, descartando o comentário à direita', () => {
		expect( parseAdr( VALIDO, 'f.md' ).enforcedBy ).toEqual( [
			'feature-deps',
		] );
	} );

	it( 'preserva o "#" de uma âncora em origem', () => {
		expect( parseAdr( VALIDO, 'f.md' ).origem ).toContain( '#arquitetura' );
	} );

	it( 'lê desvios como lista em bloco', () => {
		expect( parseAdr( VALIDO, 'f.md' ).desvios ).toEqual( [
			'features/narration/php/class-assets.php → Post_Voice_Dictionary_Store',
			'features/narration/editor/index.tsx → pronunciation/editor/dictionary-entry',
		] );
	} );

	it( 'conta as linhas do arquivo', () => {
		expect( parseAdr( VALIDO, 'f.md' ).linhas ).toBe(
			VALIDO.split( '\n' ).length
		);
	} );

	it( 'aceita desvios: [] e enforced_by com vários itens', () => {
		const adr = parseAdr(
			VALIDO.replace(
				'[ feature-deps ]',
				'[ feature-layout, shared-two-consumers ]'
			)
				.replace( 'aceita-com-desvio', 'aceita' )
				.replace( /desvios:\n( +- .*\n)+/, 'desvios: []\n' ),
			'f.md'
		);
		expect( adr.enforcedBy ).toEqual( [
			'feature-layout',
			'shared-two-consumers',
		] );
		expect( adr.desvios ).toEqual( [] );
	} );

	it( 'aceita superada-por-NNNN como status', () => {
		const adr = parseAdr(
			VALIDO.replace( 'aceita-com-desvio', 'superada-por-0042' ),
			'f.md'
		);
		expect( adr.status ).toBe( 'superada-por-0042' );
	} );

	it( 'recusa arquivo sem front-matter', () => {
		expect( () => parseAdr( '# Só um título\n', 'f.md' ) ).toThrow(
			/front-matter/
		);
	} );

	it( 'recusa campo obrigatório ausente', () => {
		expect( () =>
			parseAdr( VALIDO.replace( /^origem: .*$/m, '' ), 'f.md' )
		).toThrow( /origem/ );
	} );

	it( 'recusa status desconhecido', () => {
		expect( () =>
			parseAdr( VALIDO.replace( 'aceita-com-desvio', 'talvez' ), 'f.md' )
		).toThrow( /status/ );
	} );

	it( 'recusa enforced_by escalar — tem de ser lista', () => {
		expect( () =>
			parseAdr(
				VALIDO.replace( '[ feature-deps ]', 'feature-deps' ),
				'f.md'
			)
		).toThrow( /enforced_by/ );
	} );

	it( 'recusa aceita-com-desvio sem desvios listados', () => {
		expect( () =>
			parseAdr(
				VALIDO.replace( /desvios:\n( +- .*\n)+/, 'desvios: []\n' ),
				'f.md'
			)
		).toThrow( /aceita-com-desvio/ );
	} );

	it( 'recusa status aceita com desvios listados', () => {
		expect( () =>
			parseAdr( VALIDO.replace( 'aceita-com-desvio', 'aceita' ), 'f.md' )
		).toThrow( /aceita/ );
	} );

	it( 'recusa enforced_by como lista vazia, nas três formas', () => {
		// A guarda que impede uma ADR de sair silenciosamente de toda
		// aplicação: sem `enforced_by`, nada confere a decisão, e o campo
		// vazio é a forma mais fácil de chegar lá sem parecer que se chegou.
		for ( const vazio of [ '[]', '[ ]', '' ] ) {
			expect( () =>
				parseAdr( VALIDO.replace( '[ feature-deps ]', vazio ), 'f.md' )
			).toThrow( /enforced_by/ );
		}
	} );

	// Achado M6 da re-review, reproduzido por acidente pelo próprio revisor ao
	// testar o caminho de congelamento: aspas em volta do item são YAML
	// legítimo, e o passo 1 da skill manda "copie esse texto entre aspas".
	// Sem desaspar, as aspas viravam parte da chave, a entrada não casava com
	// nada, a violação seguia reprovando e o aviso saía com aspas duplicadas.
	it( 'desaspa entradas de desvios escritas entre aspas', () => {
		const comAspas = VALIDO.replace(
			/desvios:\n( +- .*\n)+/,
			'desvios:\n  - "features/a.php → X"\n  - \'features/b.tsx → y\'\n'
		);
		expect( parseAdr( comAspas, 'f.md' ).desvios ).toEqual( [
			'features/a.php → X',
			'features/b.tsx → y',
		] );
	} );

	// Achado MM1: o desaspar tinha ficado só na lista em bloco. A forma inline
	// é a que `enforced_by` usa, e há chave de desvio sem ` → ` que passa pelo
	// caminho inline sem ser recusada.
	it( 'desaspa também na lista inline', () => {
		const inline = VALIDO.replace(
			'enforced_by: [ feature-deps ]    # lista, sempre',
			'enforced_by: [ \'feature-deps\', "feature-layout" ]'
		);
		expect( parseAdr( inline, 'f.md' ).enforcedBy ).toEqual( [
			'feature-deps',
			'feature-layout',
		] );
	} );

	it( 'não come aspas que fazem parte da chave', () => {
		const interna = VALIDO.replace(
			/desvios:\n( +- .*\n)+/,
			'desvios:\n  - features/a.php → usa "wp/v2"\n'
		);
		expect( parseAdr( interna, 'f.md' ).desvios ).toEqual( [
			'features/a.php → usa "wp/v2"',
		] );
	} );

	it( 'recusa desvios em lista inline com " → "', () => {
		// A chave real da ADR-0004 tem quatro vírgulas, e o split as
		// estilhaça: a violação segue reprovando e cada fragmento vira um
		// aviso de dívida quitada. A seta é a assinatura do caso.
		expect( () =>
			parseAdr(
				VALIDO.replace(
					/desvios:\n( +- .*\n)+/,
					'desvios: [ features/narration/format-time.ts → fora de features/<f>/{php,editor,frontend,admin,tests}/ ]\n'
				),
				'f.md'
			)
		).toThrow( /forma de bloco/ );
	} );

	it( 'expõe o vocabulário de status', () => {
		expect( STATUSES ).toContain( 'aceita-com-desvio' );
	} );
} );

describe( 'loadAdrs', () => {
	let dir;

	beforeEach( () => {
		dir = fs.mkdtempSync( path.join( os.tmpdir(), 'lint-arch-adr-' ) );
	} );

	afterEach( () => {
		fs.rmSync( dir, { recursive: true, force: true } );
	} );

	it( 'recusa id que não bate com o nome do arquivo', () => {
		// A guarda que mantém a numeração honesta. Sem ela, `0016-x.md` com
		// `id: 0099` dentro passa, e toda referência cruzada — o índice, o
		// `superada-por-NNNN`, a citação no código — aponta para o nada.
		fs.writeFileSync(
			path.join( dir, '0016-x.md' ),
			VALIDO.replace( 'id: 0005', 'id: 0099' )
		);
		expect( () => loadAdrs( dir ) ).toThrow( /não bate com o nome/ );
	} );

	it( 'aceita quando o id bate', () => {
		fs.writeFileSync( path.join( dir, '0005-x.md' ), VALIDO );
		expect( loadAdrs( dir ).map( ( a ) => a.id ) ).toEqual( [ '0005' ] );
	} );
} );
