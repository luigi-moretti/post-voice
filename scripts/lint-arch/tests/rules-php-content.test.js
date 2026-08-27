const { createContext } = require( '../context' );
const tts = require( '../rules/no-server-side-tts' );
const narration = require( '../rules/no-narration-logic-in-php' );
const audio = require( '../rules/no-server-side-audio-processing' );

const ctxCom = ( file, src ) =>
	createContext( { files: [ file ], read: () => src } );

const PROD = 'features/narration/php/class-x.php';
const TESTE = 'features/narration/tests/php/test-x.php';

describe( 'no-server-side-tts', () => {
	it( 'declara a ADR-0002', () => {
		expect( tts.adr ).toBe( '0002' );
		expect( tts.id ).toBe( 'no-server-side-tts' );
	} );

	it.each( [
		[ 'shell_exec( $cmd );', /processo/ ],
		[ 'proc_open( $cmd, $d, $p );', /processo/ ],
		[ "$m = '/models/voice.onnx';", /ONNX/ ],
		[ "require 'onnxruntime.php';", /ONNX/ ],
	] )( 'acusa %s', ( linha, motivo ) => {
		const achados = tts.check( ctxCom( PROD, `<?php\n${ linha }\n` ) );
		expect( achados ).toHaveLength( 1 );
		expect( achados[ 0 ].line ).toBe( 2 );
		expect( achados[ 0 ].message ).toMatch( motivo );
		expect( achados[ 0 ].key.startsWith( `${ PROD } → ` ) ).toBe( true );
	} );

	it( 'ignora o que está em comentário', () => {
		expect(
			tts.check( ctxCom( PROD, '<?php\n// shell_exec( $x );\n' ) )
		).toEqual( [] );
		expect(
			tts.check( ctxCom( PROD, '<?php\n/* voice.onnx */\n' ) )
		).toEqual( [] );
	} );

	it( 'ignora arquivos de teste', () => {
		expect(
			tts.check( ctxCom( TESTE, "<?php\nshell_exec( 'x' );\n" ) )
		).toEqual( [] );
	} );

	it( 'não acusa PHP inocente', () => {
		expect(
			tts.check( ctxCom( PROD, '<?php\nadd_action( "init", "x" );\n' ) )
		).toEqual( [] );
	} );
} );

describe( 'no-narration-logic-in-php', () => {
	it( 'declara a ADR-0008', () => {
		expect( narration.adr ).toBe( '0008' );
	} );

	it.each( [
		'md5( $c );',
		'sha1( $c );',
		'hash( "sha256", $c );',
		'hash_hmac( "sha256", $c, $k );',
		'parse_blocks( $c );',
	] )( 'acusa %s', ( linha ) => {
		expect(
			narration.check( ctxCom( PROD, `<?php\n${ linha }\n` ) )
		).toHaveLength( 1 );
	} );

	it( 'não confunde uma variável chamada $hash com a função', () => {
		expect(
			narration.check( ctxCom( PROD, '<?php\n$hash = $meta;\n' ) )
		).toEqual( [] );
	} );

	it( 'não acusa chamada de método nem estática do próprio código', () => {
		expect(
			narration.check(
				ctxCom( PROD, '<?php\n$this->hash( $x );\nself::md5( $y );\n' )
			)
		).toEqual( [] );
		expect(
			narration.check(
				ctxCom(
					PROD,
					'<?php\npassword_hash( $p, PASSWORD_DEFAULT );\n'
				)
			)
		).toEqual( [] );
	} );

	it( 'ainda pega chamada nua colada em `:` ou `>`', () => {
		// O lookbehind bloqueia `->` e `::`, não os caracteres soltos: sem isso,
		// `case 1:md5(` e `$a>md5(` escapariam, e são violações de verdade.
		expect(
			narration.check( ctxCom( PROD, '<?php\ncase 1:md5( $c );\n' ) )
		).toHaveLength( 1 );
		expect(
			narration.check( ctxCom( PROD, '<?php\n$a>md5( $c );\n' ) )
		).toHaveLength( 1 );
	} );

	it( 'dá chaves distintas a violações diferentes no mesmo arquivo', () => {
		const achados = narration.check(
			ctxCom( PROD, '<?php\nmd5( $a );\nsha1( $b );\n' )
		);
		expect( achados ).toHaveLength( 2 );
		expect( new Set( achados.map( ( f ) => f.key ) ).size ).toBe( 2 );
	} );
} );

describe( 'no-server-side-audio-processing', () => {
	it( 'declara a ADR-0009', () => {
		expect( audio.adr ).toBe( '0009' );
	} );

	it.each( [ "exec( 'ffmpeg -i' );", "$b = 'lame';", 'new getID3();' ] )(
		'acusa %s',
		( linha ) => {
			expect(
				audio.check( ctxCom( PROD, `<?php\n${ linha }\n` ) )
			).toHaveLength( 1 );
		}
	);

	it( 'não acusa a API de anexo do core', () => {
		expect(
			audio.check(
				ctxCom(
					PROD,
					'<?php\nwp_generate_attachment_metadata( $id, $file );\n'
				)
			)
		).toEqual( [] );
	} );
} );

describe( 'o repo de hoje', () => {
	it.each( [ tts, narration, audio ] )( '$id não acusa nada', ( regra ) => {
		expect( regra.check( createContext() ) ).toEqual( [] );
	} );
} );
