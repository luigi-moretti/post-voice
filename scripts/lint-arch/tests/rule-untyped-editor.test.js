const { createContext } = require( '../context' );
const regra = require( '../rules/no-untyped-editor-code' );
const { loadAdrs } = require( '../adr' );

const com = ( files ) => createContext( { files, read: () => '' } );

describe( 'no-untyped-editor-code', () => {
	it( 'declara a ADR-0011', () => {
		expect( regra.adr ).toBe( '0011' );
	} );

	it.each( [
		'features/narration/editor/engine/pocket-tts.worker.js',
		'features/player-style/admin/index.js',
		'features/narration/frontend/player.js',
	] )( 'acusa %s', ( file ) => {
		const a = regra.check( com( [ file ] ) );
		expect( a ).toHaveLength( 1 );
		// Chave sem seta: é o caminho puro do arquivo, não uma relação entre
		// dois lugares — ao contrário de feature-layout e feature-deps.
		expect( a[ 0 ].key ).toBe( file );
		expect( a[ 0 ].file ).toBe( file );
		expect( a[ 0 ].line ).toBe( 1 );
	} );

	it.each( [
		// Fora de editor/admin/frontend: php/ é PHP, tests/ tem sua própria regra.
		'features/narration/php/class-assets.php',
		'features/narration/tests/js/segment.test.ts',
		// Fora de features/ inteiramente.
		'scripts/lint-arch/index.js',
		'jest.config.js',
		// TypeScript, que é exatamente o que a ADR pede.
		'features/narration/editor/index.tsx',
		'features/narration/editor/engine/tts-engine.ts',
	] )( 'aceita %s', ( file ) => {
		expect( regra.check( com( [ file ] ) ) ).toEqual( [] );
	} );

	it( 'não conta subdiretório de PHP dentro da feature como alvo', () => {
		// Pina o recorte de diretórios: se `ALVO_RE` deixasse de restringir a
		// editor|admin|frontend, um .js sob php/ também seria acusado.
		expect(
			regra.check( com( [ 'features/narration/php/legacy.js' ] ) )
		).toEqual( [] );
	} );

	it( 'ignora .js de teste aninhado dentro de editor/', () => {
		// Pina o guard de isTestPath: sem ele, um .js sob um diretório de teste
		// aninhado em editor/ seria acusado como se fosse código de produção.
		expect(
			regra.check(
				com( [ 'features/narration/editor/tests/fixture.js' ] )
			)
		).toEqual( [] );
	} );

	it( 'acusa .jsx sob editor/ — a Decisão da ADR não se limita a .js', () => {
		// Decisão pinada: a `## Decisão` da ADR-0011 fala em "todo código de
		// produção" ser TypeScript, sem restringir a extensão; é só a seção
		// `## Como verificar` que menciona apenas ".js". Escolhemos a leitura
		// mais fiel à Decisão — que é a parte vinculante — e por isso .jsx
		// também é acusado, mesmo hoje não havendo nenhum no repo.
		const a = regra.check(
			com( [ 'features/x/editor/legacy-component.jsx' ] )
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].key ).toBe( 'features/x/editor/legacy-component.jsx' );
	} );

	it( 'acusa .mjs sob admin/ pelo mesmo motivo', () => {
		const a = regra.check( com( [ 'features/x/admin/legacy.mjs' ] ) );
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].key ).toBe( 'features/x/admin/legacy.mjs' );
	} );

	it( 'acusa .cjs sob frontend/ pelo mesmo motivo', () => {
		const a = regra.check( com( [ 'features/x/frontend/legacy.cjs' ] ) );
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].key ).toBe( 'features/x/frontend/legacy.cjs' );
	} );

	it.each( [
		'shared/editor/x.js',
		'scripts/editor/x.js',
		'e2e/frontend/x.js',
		'editor/x.js',
	] )( 'a âncora `features/` importa: %s fica de fora', ( file ) => {
		// Sem o `^features/` a expressão casaria qualquer `editor/`, `admin/`
		// ou `frontend/` do repo — inclusive fora de `features/`, onde a
		// ADR-0011 não manda nada. Falso positivo, e num diretório que a ADR
		// nem menciona.
		expect( regra.check( com( [ file ] ) ) ).toEqual( [] );
	} );

	it( 'um .js na raiz da feature fica de fora: a ADR fala dos três diretórios', () => {
		// `features/<f>/x.js` é assunto da ADR-0004 (layout), não da 0011.
		// Cada regra acusa o seu, senão duas ADRs disputam o mesmo achado.
		expect( regra.check( com( [ 'features/x/legacy.js' ] ) ) ).toEqual(
			[]
		);
	} );

	it( 'o repo de hoje acusa os dois vendorizados, e eles batem com a ADR-0011', () => {
		const achadas = regra
			.check( createContext() )
			.map( ( f ) => f.key )
			.sort();
		expect( achadas ).toHaveLength( 2 );
		expect( achadas ).toEqual(
			loadAdrs( 'docs/adr' )
				.find( ( a ) => a.id === '0011' )
				.desvios.slice()
				.sort()
		);
	} );
} );
