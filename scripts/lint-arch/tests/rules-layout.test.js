const { createContext } = require( '../context' );
const layout = require( '../rules/feature-layout' );
const shared = require( '../rules/shared-two-consumers' );

const comArquivos = ( files, read = () => '' ) =>
	createContext( { files, read } );

describe( 'feature-layout', () => {
	it( 'declara a ADR-0004', () => {
		expect( layout.adr ).toBe( '0004' );
	} );

	it.each( [
		'features/narration/php/class-assets.php',
		'features/narration/editor/index.tsx',
		'features/narration/editor/engine/tts-engine.ts',
		'features/player-style/admin/contrast.ts',
		'features/narration/tests/js/segment.test.ts',
		'shared/php/class-settings-page.php',
		'scripts/lint-arch/index.js',
		'e2e/narration.spec.ts',
		'types/post-voice-data.d.ts',
		'test/jest.setup.js',
		'tests/phpstan-bootstrap.php',
		'post-voice.php',
		'jest.config.js',
	] )( 'aceita %s', ( file ) => {
		expect( layout.check( comArquivos( [ file ] ) ) ).toEqual( [] );
	} );

	it( 'acusa arquivo na raiz da feature', () => {
		const a = layout.check(
			comArquivos( [ 'features/narration/format-time.ts' ] )
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].key ).toBe(
			'features/narration/format-time.ts → fora de features/<f>/{php,editor,frontend,admin,tests}/'
		);
	} );

	it( 'acusa subdiretório de feature não previsto', () => {
		expect(
			layout.check( comArquivos( [ 'features/narration/utils/x.ts' ] ) )
		).toHaveLength( 1 );
	} );

	it( 'ignora arquivo que não é código', () => {
		expect(
			layout.check( comArquivos( [ 'features/narration/README.md' ] ) )
		).toEqual( [] );
	} );

	it( 'o repo de hoje acusa só o format-time.ts', () => {
		const a = layout.check( createContext() );
		expect( a.map( ( f ) => f.file ) ).toEqual( [
			'features/narration/format-time.ts',
		] );
	} );
} );

describe( 'shared-two-consumers', () => {
	it( 'declara a ADR-0004', () => {
		expect( shared.adr ).toBe( '0004' );
	} );

	it( 'aceita módulo com duas features consumidoras', () => {
		const ctx = comArquivos(
			[
				'shared/php/class-settings-page.php',
				'features/a/php/class-a.php',
				'features/b/php/class-b.php',
			],
			( f ) =>
				f.startsWith( 'shared/' )
					? '<?php\nclass Post_Voice_Settings_Page {}\n'
					: '<?php\nPost_Voice_Settings_Page::MENU_SLUG;\n'
		);
		expect( shared.check( ctx ) ).toEqual( [] );
	} );

	it( 'acusa módulo com um consumidor só', () => {
		const ctx = comArquivos(
			[
				'shared/php/class-settings-page.php',
				'features/a/php/class-a.php',
			],
			( f ) =>
				f.startsWith( 'shared/' )
					? '<?php\nclass Post_Voice_Settings_Page {}\n'
					: '<?php\nPost_Voice_Settings_Page::MENU_SLUG;\n'
		);
		const a = shared.check( ctx );
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /1 feature/ );
	} );

	// Achado da revisão final da branch: trocar `features.add(
	// file.split( '/' )[ 1 ] )` por `features.add( file )` sobrevivia aos 496
	// testes — nenhum deles decidia se "dois consumidores" conta ARQUIVOS ou
	// FEATURES. Quem decide é a ADR-0004: "compartilhar código entre
	// features". Dois arquivos da mesma feature não justificam shared/, porque
	// o código pertence àquela feature; contá-los como dois deixaria qualquer
	// utilitário de uso local migrar para shared/ sem nunca ter tido um
	// segundo consumidor de verdade.
	it( 'dois arquivos da MESMA feature contam como um consumidor', () => {
		const ctx = comArquivos(
			[
				'shared/php/class-settings-page.php',
				'features/a/php/class-um.php',
				'features/a/php/class-dois.php',
			],
			( f ) =>
				f.startsWith( 'shared/' )
					? '<?php\nclass Post_Voice_Settings_Page {}\n'
					: '<?php\nPost_Voice_Settings_Page::MENU_SLUG;\n'
		);
		const a = shared.check( ctx );
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /1 feature/ );
	} );

	it( 'não conta post-voice.php como feature consumidora', () => {
		// A raiz carrega e registra tudo; contá-la faria qualquer módulo de
		// shared/ parecer ter um consumidor a mais do que tem.
		const ctx = comArquivos(
			[
				'shared/php/class-settings-page.php',
				'post-voice.php',
				'features/a/php/class-a.php',
			],
			( f ) =>
				f.startsWith( 'shared/' )
					? '<?php\nclass Post_Voice_Settings_Page {}\n'
					: '<?php\nPost_Voice_Settings_Page::register();\n'
		);
		expect( shared.check( ctx ) ).toHaveLength( 1 );
	} );

	it( 'teste não conta como consumidor: duas features, mas só em tests/', () => {
		// Um teste consome por definição — é para isso que ele existe. Contar
		// arquivo de teste faria qualquer módulo de shared/ atingir o limiar de
		// dois sem que feature nenhuma dependesse dele de verdade, que é
		// exatamente o que a ADR-0004 quer impedir: abstrair a partir de um
		// consumidor só.
		//
		// Aqui as DUAS features referenciam a classe, mas ambas apenas de
		// dentro de `tests/`. Sem a guarda `isTestPath` o achado desaparece:
		// falso negativo.
		const ctx = comArquivos(
			[
				'shared/php/class-settings-page.php',
				'features/a/php/class-a.php',
				'features/a/tests/php/test-a.php',
				'features/b/tests/php/test-b.php',
			],
			( f ) => {
				if ( f.startsWith( 'shared/' ) ) {
					return '<?php\nclass Post_Voice_Settings_Page {}\n';
				}
				// A classe de produção da feature não cita a compartilhada;
				// quem cita são só os dois arquivos de teste.
				return f.includes( '/tests/' )
					? '<?php\nPost_Voice_Settings_Page::MENU_SLUG;\n'
					: '<?php\nclass Post_Voice_A {}\n';
			}
		);
		const a = shared.check( ctx );
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /0 feature/ );
	} );

	it( 'o repo de hoje não acusa nada', () => {
		expect( shared.check( createContext() ) ).toEqual( [] );
	} );
} );
