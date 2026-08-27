const { createContext } = require( '../context' );
const naming = require( '../rules/php-class-naming' );
const rest = require( '../rules/rest-namespace' );

const ctxCom = ( file, src ) =>
	createContext( { files: [ file ], read: () => src } );

describe( 'php-class-naming', () => {
	it( 'declara a ADR-0006', () => {
		expect( naming.adr ).toBe( '0006' );
	} );

	it( 'aceita classe bem nomeada no arquivo certo', () => {
		expect(
			naming.check(
				ctxCom(
					'features/x/php/class-rest-api.php',
					'<?php\nclass Post_Voice_Rest_Api {}\n'
				)
			)
		).toEqual( [] );
	} );

	it( 'acusa nome de arquivo que não deriva da classe', () => {
		const a = naming.check(
			ctxCom(
				'features/x/php/class-api.php',
				'<?php\nclass Post_Voice_Rest_Api {}\n'
			)
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /class-rest-api\.php/ );
	} );

	it( 'acusa classe sem o prefixo', () => {
		const a = naming.check(
			ctxCom( 'features/x/php/class-api.php', '<?php\nclass Api {}\n' )
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /Post_Voice_/ );
	} );

	it( 'acusa duas classes no mesmo arquivo', () => {
		const a = naming.check(
			ctxCom(
				'features/x/php/class-a.php',
				'<?php\nclass Post_Voice_A {}\nclass Post_Voice_B {}\n'
			)
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /uma classe/ );
	} );

	it( 'ignora a palavra class dentro de comentário ou string', () => {
		expect(
			naming.check(
				ctxCom(
					'features/x/php/class-a.php',
					"<?php\n// class Post_Voice_Z {}\n$s = 'class Post_Voice_W';\nclass Post_Voice_A {}\n"
				)
			)
		).toEqual( [] );
	} );

	it( 'expõe o mapa classe → feature', () => {
		const mapa = naming.phpClassOwners(
			createContext( {
				files: [
					'features/narration/php/class-post-meta.php',
					'shared/php/class-settings-page.php',
				],
				read: ( f ) =>
					f.includes( 'post-meta' )
						? '<?php\nclass Post_Voice_Post_Meta {}\n'
						: '<?php\nclass Post_Voice_Settings_Page {}\n',
			} )
		);
		expect( mapa.get( 'Post_Voice_Post_Meta' ).feature ).toBe(
			'narration'
		);
		expect( mapa.get( 'Post_Voice_Settings_Page' ).feature ).toBe(
			'shared'
		);
	} );
} );

describe( 'rest-namespace', () => {
	it( 'declara a ADR-0007', () => {
		expect( rest.adr ).toBe( '0007' );
	} );

	it( 'aceita namespace literal correto', () => {
		expect(
			rest.check(
				ctxCom(
					'features/x/php/class-rest-api.php',
					"<?php\nregister_rest_route( 'post-voice/v1', '/a', [] );\n"
				)
			)
		).toEqual( [] );
	} );

	it( 'resolve constante de classe do mesmo arquivo', () => {
		expect(
			rest.check(
				ctxCom(
					'features/x/php/class-rest-api.php',
					"<?php\nclass A {\nprivate const NS = 'post-voice/v1';\nfunction r() { register_rest_route( self::NS, '/a', [] ); }\n}\n"
				)
			)
		).toEqual( [] );
	} );

	it( 'acusa namespace errado', () => {
		const a = rest.check(
			ctxCom(
				'features/x/php/class-rest-api.php',
				"<?php\nregister_rest_route( 'wp/v2', '/a', [] );\n"
			)
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /post-voice\/v1/ );
	} );

	it( 'acusa constante que resolve para o namespace errado', () => {
		const a = rest.check(
			ctxCom(
				'features/x/php/class-rest-api.php',
				"<?php\nprivate const NS = 'outro/v1';\nregister_rest_route( self::NS, '/a', [] );\n"
			)
		);
		expect( a ).toHaveLength( 1 );
	} );

	it( 'acusa primeiro argumento que não resolve estaticamente', () => {
		const a = rest.check(
			ctxCom(
				'features/x/php/class-rest-api.php',
				'<?php\nregister_rest_route( $ns, "/a", [] );\n'
			)
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /não resolve/ );
	} );
} );

describe( 'o repo de hoje', () => {
	it( 'php-class-naming não acusa nada nas 10 classes', () => {
		expect( naming.check( createContext() ) ).toEqual( [] );
	} );

	it( 'rest-namespace não acusa nada', () => {
		expect( rest.check( createContext() ) ).toEqual( [] );
	} );

	it( 'mapeia as 10 classes do repo', () => {
		expect( naming.phpClassOwners( createContext() ).size ).toBe( 10 );
	} );
} );
