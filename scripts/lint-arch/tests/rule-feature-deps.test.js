'use strict';
const { createContext } = require( '../context' );
const regra = require( '../rules/feature-deps' );
const { loadAdrs } = require( '../adr' );

const PHP_BASE = {
	'features/narration/php/class-post-meta.php':
		'<?php\nclass Post_Voice_Post_Meta {}\n',
	'features/pronunciation/php/class-dictionary-store.php':
		'<?php\nclass Post_Voice_Dictionary_Store {}\n',
	'shared/php/class-settings-page.php':
		'<?php\nclass Post_Voice_Settings_Page {}\n',
};

const ctxPhp = ( extra ) => {
	const files = { ...PHP_BASE, ...extra };
	return createContext( {
		files: Object.keys( files ),
		read: ( f ) => files[ f ],
	} );
};

describe( 'feature-deps — PHP', () => {
	it( 'declara a ADR-0005', () => {
		expect( regra.adr ).toBe( '0005' );
		expect( regra.id ).toBe( 'feature-deps' );
	} );

	it( 'aceita referência à própria feature', () => {
		expect(
			regra.check(
				ctxPhp( {
					'features/narration/php/class-assets.php':
						'<?php\nPost_Voice_Post_Meta::get( 1 );\n',
				} )
			)
		).toEqual( [] );
	} );

	it( 'aceita referência a shared/', () => {
		expect(
			regra.check(
				ctxPhp( {
					'features/narration/php/class-assets.php':
						'<?php\nPost_Voice_Settings_Page::MENU_SLUG;\n',
				} )
			)
		).toEqual( [] );
	} );

	it( 'acusa referência a outra feature, com a chave sem número de linha', () => {
		const a = regra.check(
			ctxPhp( {
				'features/narration/php/class-assets.php':
					'<?php\n\nPost_Voice_Dictionary_Store::get_global();\n',
			} )
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].key ).toBe(
			'features/narration/php/class-assets.php → Post_Voice_Dictionary_Store'
		);
		expect( a[ 0 ].line ).toBe( 3 );
	} );

	it( 'pega callable em string — a aresta 6 do inventário', () => {
		const a = regra.check(
			ctxPhp( {
				'features/narration/php/class-assets.php':
					"<?php\narray( 'Post_Voice_Dictionary_Store', 'x' );\n",
			} )
		);
		expect( a ).toHaveLength( 1 );
	} );

	it( 'ignora menção em comentário', () => {
		expect(
			regra.check(
				ctxPhp( {
					'features/narration/php/class-assets.php':
						'<?php\n// ver Post_Voice_Dictionary_Store\n',
				} )
			)
		).toEqual( [] );
	} );

	it( 'ignora arquivos de teste', () => {
		expect(
			regra.check(
				ctxPhp( {
					'features/narration/tests/php/test-assets.php':
						'<?php\nPost_Voice_Dictionary_Store::get_global();\n',
				} )
			)
		).toEqual( [] );
	} );

	it( 'colapsa duas ocorrências da mesma classe no mesmo arquivo em uma chave', () => {
		const a = regra.check(
			ctxPhp( {
				'features/narration/php/class-assets.php':
					'<?php\nPost_Voice_Dictionary_Store::a();\nPost_Voice_Dictionary_Store::b();\n',
			} )
		);
		expect( a ).toHaveLength( 1 );
	} );
} );

describe( 'feature-deps — TypeScript', () => {
	const ctxTs = ( file, src ) =>
		createContext( { files: [ file ], read: () => src } );

	it( 'aceita import dentro da própria feature', () => {
		expect(
			regra.check(
				ctxTs(
					'features/narration/editor/a.ts',
					"import { x } from './b';\n"
				)
			)
		).toEqual( [] );
	} );

	it( 'aceita um ../../ que sobe e desce dentro da MESMA feature — trap 1', () => {
		expect(
			regra.check(
				ctxTs(
					'features/narration/tests/js/x.test.ts',
					"import { segment } from '../../editor/segment';\n"
				)
			)
		).toEqual( [] );
	} );

	it( 'ignora specifier de pacote npm, sem ponto inicial', () => {
		expect(
			regra.check(
				ctxTs(
					'features/narration/editor/a.ts',
					"import { createElement } from '@wordpress/element';\n"
				)
			)
		).toEqual( [] );
	} );

	it( 'acusa import de outra feature', () => {
		const a = regra.check(
			ctxTs(
				'features/narration/editor/index.tsx',
				"import { DictionaryPanel } from '../../pronunciation/editor/dictionary-panel';\n"
			)
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].key ).toBe(
			'features/narration/editor/index.tsx → pronunciation/editor/dictionary-panel'
		);
	} );

	it( 'acusa import type também — o tipo acopla igual', () => {
		expect(
			regra.check(
				ctxTs(
					'features/narration/editor/index.tsx',
					"import type { DictionaryEntry } from '../../pronunciation/editor/dictionary-entry';\n"
				)
			)
		).toHaveLength( 1 );
	} );

	it( 'colapsa duas linhas que importam do mesmo módulo em uma chave, reportando a primeira linha', () => {
		const a = regra.check(
			ctxTs(
				'features/narration/editor/index.tsx',
				"import type { A } from '../../pronunciation/editor/dictionary-entry';\n" +
					"import { b } from '../../pronunciation/editor/dictionary-entry';\n"
			)
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].line ).toBe( 1 );
	} );

	it( 'duas features diferentes referenciadas no mesmo arquivo não colidem numa única chave', () => {
		const a = regra.check(
			ctxTs(
				'features/narration/editor/index.tsx',
				"import { A } from '../../pronunciation/editor/dictionary-panel';\n" +
					"import { B } from '../../player-style/editor/style-panel';\n"
			)
		);
		expect( a ).toHaveLength( 2 );
		expect( new Set( a.map( ( f ) => f.key ) ).size ).toBe( 2 );
	} );

	it( 'ignora arquivo de teste em TypeScript', () => {
		expect(
			regra.check(
				ctxTs(
					'features/narration/tests/js/index.test.tsx',
					"import { DictionaryPanel } from '../../../pronunciation/editor/dictionary-panel';\n"
				)
			)
		).toEqual( [] );
	} );
} );

describe( 'buracos que a review mediu', () => {
	const ctxTs = ( file, src ) =>
		createContext( { files: [ file ], read: () => src } );

	it.each( [
		[
			'import dinâmico',
			"const m = await import( '../../pronunciation/editor/x' );\n",
		],
		[
			'import dinâmico sem espaço',
			"import('../../pronunciation/editor/x');\n",
		],
	] )( 'acusa %s que atravessa feature', ( _forma, src ) => {
		// `import\s+` exige espaço em branco e `(` não é espaço: sem um ramo
		// próprio para a forma de chamada, o import dinâmico não casava nada.
		// Não havia nenhum sob `features/`, então o buraco não aparecia em
		// medição nenhuma — nem como falso positivo, nem como falso negativo.
		const a = regra.check( ctxTs( 'features/narration/editor/a.ts', src ) );
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].key ).toBe(
			'features/narration/editor/a.ts → pronunciation/editor/x'
		);
	} );

	it( 'o corpo das strings é preservado de propósito, e isso tem preço', () => {
		// A detecção em PHP lê o nome da classe com o corpo das strings
		// intacto, porque é assim que uma referência dinâmica aparece —
		// `[ 'Post_Voice_Dictionary_Store', 'metodo' ]` como callable é
		// dependência de verdade. O preço é que uma string que só MENCIONA a
		// classe também é acusada. É troca declarada, não descuido: erra
		// acusando, que é a direção que esta branch escolheu em toda regra.
		const ctx = ctxPhp( {
			'features/narration/php/class-x.php':
				"<?php\nclass Post_Voice_X {\n\tconst AVISO = 'veja Post_Voice_Dictionary_Store';\n}\n",
		} );
		const a = regra.check( ctx );
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].key ).toBe(
			'features/narration/php/class-x.php → Post_Voice_Dictionary_Store'
		);
	} );
} );

describe( 'o repo de hoje', () => {
	it( 'acha exatamente as onze arestas', () => {
		expect( regra.check( createContext() ) ).toHaveLength( 11 );
	} );

	it( 'as onze chaves batem, uma a uma, com desvios: da ADR-0005', () => {
		const achadas = regra
			.check( createContext() )
			.map( ( f ) => f.key )
			.sort();
		const listadas = loadAdrs( 'docs/adr' )
			.find( ( a ) => a.id === '0005' )
			.desvios.sort();
		expect( achadas ).toEqual( listadas );
	} );
} );
