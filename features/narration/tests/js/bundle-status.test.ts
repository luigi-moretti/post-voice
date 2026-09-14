import { isBundleComplete } from '../../admin/bundle-status';
import { MODEL_BASE_URL } from '../../editor/model-source';

function fakeCache( entries: Record< string, unknown > ) {
	return {
		match: jest.fn( async ( url: string ) => entries[ url ] ),
	};
}

describe( 'isBundleComplete', () => {
	afterEach( () => {
		// @ts-expect-error — restoring the global the test replaced.
		delete global.caches;
	} );

	it( 'is false when the Cache API is unavailable', async () => {
		expect( await isBundleComplete( 'portuguese' ) ).toBe( false );
	} );

	it( 'is false when bundle.json itself was never cached, without checking anything else', async () => {
		const cache = fakeCache( {} );
		// @ts-expect-error — minimal CacheStorage stand-in.
		global.caches = { open: async () => cache };

		expect( await isBundleComplete( 'portuguese' ) ).toBe( false );
		expect( cache.match ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'is false when bundle.json is cached but a required file is missing — an interrupted download', async () => {
		const bundleJsonUrl = `${ MODEL_BASE_URL }portuguese/bundle.json`;
		const manifest = { tokenizer_file: 'tokenizer.json' };
		const cache = fakeCache( {
			[ bundleJsonUrl ]: {
				json: async () => manifest,
			},
			// `voices.bin`, the five .onnx files and `tokenizer.json` are all
			// absent — simulates a session that stopped right after the very
			// first file, which the naive "bundle.json alone" check would
			// have reported as complete.
		} );
		// @ts-expect-error — minimal CacheStorage stand-in.
		global.caches = { open: async () => cache };

		expect( await isBundleComplete( 'portuguese' ) ).toBe( false );
	} );

	it( 'is true when every resolved file is cached', async () => {
		const language = 'portuguese';
		const manifest = { tokenizer_file: 'tokenizer.json' };
		const entries: Record< string, unknown > = {
			[ `${ MODEL_BASE_URL }${ language }/bundle.json` ]: {
				json: async () => manifest,
			},
		};
		for ( const filename of [
			'mimi_encoder_int8.onnx',
			'text_conditioner_int8.onnx',
			'flow_lm_main_int8.onnx',
			'flow_lm_flow_int8.onnx',
			'mimi_decoder_int8.onnx',
			'voices.bin',
			'tokenizer.json',
		] ) {
			entries[ `${ MODEL_BASE_URL }${ language }/${ filename }` ] = {};
		}
		const cache = fakeCache( entries );
		// @ts-expect-error — minimal CacheStorage stand-in.
		global.caches = { open: async () => cache };

		expect( await isBundleComplete( language ) ).toBe( true );
	} );

	it( 'is false, not a rejected promise, when the cached bundle.json is unparseable', async () => {
		// A corrupted or truncated cache entry (surviving a crashed session,
		// or a bug elsewhere) shouldn't turn "is this downloaded?" into an
		// unhandled rejection — same safe-default posture as every other
		// branch here (missing Cache API, missing bundle.json, missing
		// file). Previously this relied entirely on every *caller*
		// remembering to wrap the call in try/catch.
		const cache = fakeCache( {
			[ `${ MODEL_BASE_URL }portuguese/bundle.json` ]: {
				json: async () => {
					throw new SyntaxError( 'Unexpected token in JSON' );
				},
			},
		} );
		// @ts-expect-error — minimal CacheStorage stand-in.
		global.caches = { open: async () => cache };

		await expect( isBundleComplete( 'portuguese' ) ).resolves.toBe( false );
	} );

	it( 'requires bos_before_voice_file too, when the manifest names one', async () => {
		const language = 'german';
		const manifest = {
			tokenizer_file: 'tokenizer.json',
			bos_before_voice_file: 'bos_before_voice.bin',
		};
		const entries: Record< string, unknown > = {
			[ `${ MODEL_BASE_URL }${ language }/bundle.json` ]: {
				json: async () => manifest,
			},
		};
		for ( const filename of [
			'mimi_encoder_int8.onnx',
			'text_conditioner_int8.onnx',
			'flow_lm_main_int8.onnx',
			'flow_lm_flow_int8.onnx',
			'mimi_decoder_int8.onnx',
			'voices.bin',
			'tokenizer.json',
			// bos_before_voice.bin intentionally missing.
		] ) {
			entries[ `${ MODEL_BASE_URL }${ language }/${ filename }` ] = {};
		}
		const cache = fakeCache( entries );
		// @ts-expect-error — minimal CacheStorage stand-in.
		global.caches = { open: async () => cache };

		expect( await isBundleComplete( language ) ).toBe( false );
	} );
} );
