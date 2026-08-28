'use strict';
const { createContext } = require( '../context' );
const pins = require( '../rules/contract-pins' );
const npmci = require( '../rules/no-npm-install' );

const REPO = {
	'post-voice.php': ' * Requires at least: 6.6\n * Requires PHP: 8.2\n',
	'readme.txt': 'Requires at least: 6.6\nRequires PHP: 8.2\n',
	'composer.json': '{ "require": { "php": ">=8.2" } }',
	'phpcs.xml.dist': '<config name="testVersion" value="8.2-"/>',
	'.wp-env.json': '{ "core": "WordPress/WordPress#6.6" }',
	'features/narration/editor/model-source.ts':
		"export const MODEL_BASE_URL =\n\t'https://huggingface.co/x/y/resolve/b18a05128c4f727ead5b23a643b65b93eaf8ee5d/';\n",
};

const com = ( over = {} ) => {
	const files = { ...REPO, ...over };
	return createContext( {
		files: Object.keys( files ),
		read: ( f ) => files[ f ],
	} );
};

describe( 'contract-pins', () => {
	it( 'declara a ADR-0014', () => {
		expect( pins.adr ).toBe( '0014' );
	} );

	it( 'aceita os cinco arquivos concordando', () => {
		expect( pins.check( com() ) ).toEqual( [] );
	} );

	it( 'acusa mínimo de WordPress divergente', () => {
		const a = pins.check(
			com( {
				'readme.txt': 'Requires at least: 6.7\nRequires PHP: 8.2\n',
			} )
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /WordPress/ );
		expect( a[ 0 ].message ).toMatch( /6\.7/ );
	} );

	it( 'acusa mínimo de PHP divergente', () => {
		const a = pins.check(
			com( { 'composer.json': '{ "require": { "php": ">=8.3" } }' } )
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /PHP/ );
	} );

	it( 'acusa MODEL_BASE_URL apontando para uma ref móvel', () => {
		const a = pins.check(
			com( {
				'features/narration/editor/model-source.ts':
					"export const MODEL_BASE_URL =\n\t'https://huggingface.co/x/y/resolve/main/';\n",
			} )
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /SHA/ );
	} );

	it( 'não fixa o valor: 6.7 em todos os cinco passa', () => {
		expect(
			pins.check(
				com( {
					'post-voice.php':
						' * Requires at least: 6.7\n * Requires PHP: 8.2\n',
					'readme.txt': 'Requires at least: 6.7\nRequires PHP: 8.2\n',
					'.wp-env.json': '{ "core": "WordPress/WordPress#6.7" }',
				} )
			)
		).toEqual( [] );
	} );

	it( 'composer.json não declarar WordPress não é lido como divergência — só PHP tem fonte lá', () => {
		// Se a regra varresse composer.json em busca do mínimo de WordPress,
		// este fixture (que não muda WordPress em lugar nenhum) continuaria
		// batendo, porque composer.json não tem "Requires at least" para casar
		// — e "ilegível" e "divergente" são achados distintos. O teste real
		// desta decisão é a ausência de qualquer achado aqui, junto da lista
		// FONTES_WP não incluir composer.json.
		expect( pins.check( com() ) ).toEqual( [] );
	} );

	it( '.wp-env.json não declarar PHP não é lido como divergência — só WordPress tem fonte lá', () => {
		expect( pins.check( com() ) ).toEqual( [] );
	} );

	it( 'um arquivo ausente do repo (deletado) é ignorado, não conta como divergência', () => {
		const files = { ...REPO };
		delete files[ '.wp-env.json' ];
		const ctx = createContext( {
			files: Object.keys( files ),
			read: ( f ) => files[ f ],
		} );
		expect( pins.check( ctx ) ).toEqual( [] );
	} );

	it( 'um arquivo presente mas sem o padrão esperado é "ilegível", não "divergente"', () => {
		// phpcs.xml.dist só é fonte de PHP (não de WordPress) — quebrar só o
		// seu padrão produz exatamente um achado, não um em cada dimensão.
		const a = pins.check(
			com( { 'phpcs.xml.dist': '<config name="outraCoisa" value="x"/>' } )
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].key ).toBe( 'phpcs.xml.dist → PHP-ilegivel' );
		expect( a[ 0 ].message ).toMatch( /não foi possível ler/ );
	} );

	it( 'sem MODEL_BASE_URL no arquivo, também acusa (não silencia por ausência de match)', () => {
		const a = pins.check(
			com( {
				'features/narration/editor/model-source.ts':
					'export const OUTRA_COISA = 1;\n',
			} )
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].key ).toBe(
			'features/narration/editor/model-source.ts → model-base-url'
		);
	} );

	it( 'model-source.ts ausente do repo não é varrido (regra não inventa o arquivo)', () => {
		const files = { ...REPO };
		delete files[ 'features/narration/editor/model-source.ts' ];
		const ctx = createContext( {
			files: Object.keys( files ),
			read: ( f ) => files[ f ],
		} );
		expect( pins.check( ctx ) ).toEqual( [] );
	} );

	it( 'o repo de hoje concorda', () => {
		expect( pins.check( createContext() ) ).toEqual( [] );
	} );
} );

describe( 'no-npm-install', () => {
	it( 'declara a ADR-0015', () => {
		expect( npmci.adr ).toBe( '0015' );
	} );

	it( 'acusa npm install em workflow', () => {
		const a = npmci.check(
			createContext( {
				files: [ '.github/workflows/ci.yml' ],
				read: () => '      - run: npm install\n',
			} )
		);
		expect( a ).toHaveLength( 1 );
	} );

	it( 'acusa npm i abreviado', () => {
		expect(
			npmci.check(
				createContext( {
					files: [ 'scripts/x.sh' ],
					read: () => 'npm i --save-dev x\n',
				} )
			)
		).toHaveLength( 1 );
	} );

	it( 'acusa npm add, a mesma decisão por outra porta', () => {
		expect(
			npmci.check(
				createContext( {
					files: [ 'scripts/x.sh' ],
					read: () => 'npm add --save-dev left-pad\n',
				} )
			)
		).toHaveLength( 1 );
	} );

	it( 'aceita npm ci', () => {
		expect(
			npmci.check(
				createContext( {
					files: [ '.github/workflows/ci.yml' ],
					read: () => '      - run: npm ci\n',
				} )
			)
		).toEqual( [] );
	} );

	it( 'não acusa `npx playwright install --with-deps` — a agulha é "npm install", não "install"', () => {
		expect(
			npmci.check(
				createContext( {
					files: [ '.github/workflows/ci.yml' ],
					read: () =>
						'      - run: npx playwright install --with-deps\n',
				} )
			)
		).toEqual( [] );
	} );

	it( 'não acusa `composer install` — não é npm', () => {
		expect(
			npmci.check(
				createContext( {
					files: [ '.github/workflows/ci.yml' ],
					read: () => '      - run: composer install\n',
				} )
			)
		).toEqual( [] );
	} );

	it( 'não varre a documentação, que fala sobre o comando', () => {
		expect(
			npmci.check(
				createContext( {
					files: [ 'CLAUDE.md' ],
					read: () => 'never `npm install`\n',
				} )
			)
		).toEqual( [] );
	} );

	it( 'não varre docs/adr/README.md, que também nomeia a proibição', () => {
		expect(
			npmci.check(
				createContext( {
					files: [ 'docs/adr/README.md' ],
					read: () =>
						'`npm install` nunca | aceita | `no-npm-install`\n',
				} )
			)
		).toEqual( [] );
	} );

	it( 'HAZARD A: não acusa a si mesma — scripts/lint-arch/ fica fora do escopo mesmo casando a extensão', () => {
		// scripts/lint-arch/rules/no-npm-install.js "casaria" o padrão de
		// escopo (scripts/.../*.js) se não fosse excluído explicitamente, e o
		// próprio arquivo contém a string "npm install" na mensagem que
		// explica a violação. Sem a exclusão por caminho, este teste falharia
		// junto com `lint:arch` no commit que introduz a regra.
		const a = npmci.check(
			createContext( {
				files: [ 'scripts/lint-arch/rules/no-npm-install.js' ],
				read: () =>
					"message: 'use `npm ci`: `npm install` reescreve o lockfile'\n",
			} )
		);
		expect( a ).toEqual( [] );
	} );

	it( 'HAZARD A: também exclui o próprio arquivo de teste sob scripts/lint-arch/', () => {
		const a = npmci.check(
			createContext( {
				files: [ 'scripts/lint-arch/tests/rules-pins.test.js' ],
				read: () => "read: () => '      - run: npm install\\n'\n",
			} )
		);
		expect( a ).toEqual( [] );
	} );

	it( 'fora de scripts/lint-arch/, um outro arquivo sob scripts/ continua sendo varrido', () => {
		const a = npmci.check(
			createContext( {
				files: [ 'scripts/build-plugin-zip.sh' ],
				read: () => 'npm install\n',
			} )
		);
		expect( a ).toHaveLength( 1 );
	} );

	it( 'um .ts/.tsx sob scripts/ fora do escopo declarado (só sh/mjs/js) não é varrido', () => {
		expect(
			npmci.check(
				createContext( {
					files: [ 'scripts/x.ts' ],
					read: () => 'npm install\n',
				} )
			)
		).toEqual( [] );
	} );

	it( 'reporta o número de linha correto quando a ocorrência não está na primeira', () => {
		const a = npmci.check(
			createContext( {
				files: [ 'scripts/x.sh' ],
				read: () => '#!/bin/sh\necho oi\nnpm install\n',
			} )
		);
		expect( a[ 0 ].line ).toBe( 3 );
	} );

	it( 'o repo de hoje não acusa nada', () => {
		expect( npmci.check( createContext() ) ).toEqual( [] );
	} );
} );
