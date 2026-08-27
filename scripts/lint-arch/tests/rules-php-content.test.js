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
		expect( achados[ 0 ].key ).toBe(
			`${ PROD } → ${ achados[ 0 ].key.split( ' → ' )[ 1 ] }`
		);
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
