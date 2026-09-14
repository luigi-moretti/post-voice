import {
	bundleJsonUrl,
	bundleUrl,
	resolveBundleFiles,
	STATIC_BUNDLE_FILES,
} from '../../admin/model-manifest';
import { MODEL_BASE_URL } from '../../editor/model-source';

describe( 'bundleUrl / bundleJsonUrl', () => {
	it( 'builds a URL under the language folder', () => {
		expect( bundleUrl( 'portuguese', 'voices.bin' ) ).toBe(
			`${ MODEL_BASE_URL }portuguese/voices.bin`
		);
		expect( bundleJsonUrl( 'portuguese' ) ).toBe(
			`${ MODEL_BASE_URL }portuguese/bundle.json`
		);
	} );
} );

describe( 'resolveBundleFiles', () => {
	it( 'includes bundle.json, the six static files and the tokenizer, without bos_before_voice_file', () => {
		const files = resolveBundleFiles( 'italian', {
			tokenizer_file: 'tokenizer.json',
		} );

		expect( files ).toHaveLength( 8 );
		expect( files.map( ( f ) => f.filename ) ).toEqual( [
			'bundle.json',
			...STATIC_BUNDLE_FILES,
			'tokenizer.json',
		] );
		expect(
			files.find( ( f ) => f.filename === 'tokenizer.json' )?.url
		).toBe( `${ MODEL_BASE_URL }italian/tokenizer.json` );
	} );

	it( 'includes bos_before_voice_file when the manifest has one', () => {
		const files = resolveBundleFiles( 'german', {
			tokenizer_file: 'tokenizer.json',
			bos_before_voice_file: 'bos_before_voice.bin',
		} );

		expect( files ).toHaveLength( 9 );
		expect( files.map( ( f ) => f.filename ) ).toContain(
			'bos_before_voice.bin'
		);
	} );
} );
