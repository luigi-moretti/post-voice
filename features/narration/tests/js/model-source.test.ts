import { MODEL_BASE_URL, SUPPORTED_LANGUAGES } from '../../editor/model-source';

describe( 'model-source', () => {
	it( 'points at a pinned commit on our own mirror, not upstream or `resolve/main`', () => {
		expect( MODEL_BASE_URL ).toMatch(
			/^https:\/\/huggingface\.co\/luigi-moretti\/pocket-tts-onnx-mirror\/resolve\/[0-9a-f]{7,40}\/$/
		);
		expect( MODEL_BASE_URL ).not.toContain( 'KevinAHM' );
		expect( MODEL_BASE_URL ).not.toContain( '/resolve/main' );
	} );

	it( 'lists exactly the 5 supported languages', () => {
		expect( SUPPORTED_LANGUAGES ).toEqual( [
			'english_2026-04',
			'german',
			'italian',
			'portuguese',
			'spanish',
		] );
	} );
} );
