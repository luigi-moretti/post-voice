const { createContext } = require( '../context' );
const regra = require( '../rules/covers-annotation' );

const ARQ = 'features/narration/tests/php/test-assets.php';
const ctxCom = ( src ) => createContext( { files: [ ARQ ], read: () => src } );

describe( 'covers-annotation', () => {
	it( 'declara a ADR-0013', () => {
		expect( regra.adr ).toBe( '0013' );
	} );

	it( 'aceita classe de teste com @covers', () => {
		expect(
			regra.check(
				ctxCom(
					'<?php\n/**\n * @covers Post_Voice_Assets\n */\nclass X extends A {}\n'
				)
			)
		).toEqual( [] );
	} );

	it( 'aceita @coversDefaultClass', () => {
		expect(
			regra.check(
				ctxCom(
					'<?php\n/**\n * @coversDefaultClass Post_Voice_Assets\n */\nclass X {}\n'
				)
			)
		).toEqual( [] );
	} );

	it( 'acusa classe de teste sem @covers', () => {
		const a = regra.check( ctxCom( '<?php\nclass X extends A {}\n' ) );
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].file ).toBe( ARQ );
		expect( a[ 0 ].message ).toMatch( /@covers/ );
	} );

	it( 'ignora arquivo que não é test-*.php', () => {
		expect(
			regra.check(
				createContext( {
					files: [
						'features/narration/tests/php/trait-with-asset-file.php',
					],
					read: () => '<?php\ntrait T {}\n',
				} )
			)
		).toEqual( [] );
	} );

	it( 'ignora o bootstrap e a config do root', () => {
		expect(
			regra.check(
				createContext( {
					files: [
						'tests/php/bootstrap.php',
						'tests/php/wp-tests-config.php',
					],
					read: () => '<?php\n',
				} )
			)
		).toEqual( [] );
	} );

	it( 'o repo de hoje tem 10 classes de teste, todas cobertas', () => {
		const ctx = createContext();
		expect( regra.check( ctx ) ).toEqual( [] );
		expect( regra.classesDeTeste( ctx ) ).toHaveLength( 10 );
	} );

	it( 'os dois traits e o bootstrap do repo de hoje não entram na lista', () => {
		const ctx = createContext();
		const lista = regra.classesDeTeste( ctx );
		expect( lista ).not.toContain( 'tests/php/bootstrap.php' );
		expect( lista ).not.toContain( 'tests/php/wp-tests-config.php' );
		expect( lista ).not.toContain( 'tests/php/trait-fires-admin-init.php' );
		expect( lista ).not.toContain( 'tests/php/trait-with-asset-file.php' );
	} );
} );
