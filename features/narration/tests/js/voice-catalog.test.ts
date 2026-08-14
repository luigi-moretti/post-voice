import {
	VOICES,
	DEFAULT_VOICE,
	SAMPLE_TEXTS,
	sampleTextFor,
	isVoice,
} from '../../editor/voice-catalog';
import { SUPPORTED_LANGUAGES } from '../../editor/model-source';

describe( 'VOICES', () => {
	it( 'contains the default voice', () => {
		expect( VOICES ).toContain( DEFAULT_VOICE );
	} );

	it( 'has no duplicates', () => {
		expect( new Set( VOICES ).size ).toBe( VOICES.length );
	} );
} );

describe( 'SAMPLE_TEXTS', () => {
	// A missing entry would silently fall back to English, so an author picking
	// that language would hear the wrong language read by the right voice — the
	// exact bug this map exists to prevent.
	it.each( SUPPORTED_LANGUAGES )(
		'has a sample phrase for %s',
		( language ) => {
			expect( SAMPLE_TEXTS[ language ] ).toBeTruthy();
		}
	);

	// Sample latency is text length times the device's RTF. Past ~60 characters
	// the "quick sample" promise stops holding on a slow machine, which is the
	// whole reason the sample is a fixed phrase and not the author's own text.
	it.each( SUPPORTED_LANGUAGES )(
		'keeps the %s phrase short enough to stay a sample',
		( language ) => {
			expect( SAMPLE_TEXTS[ language ].length ).toBeLessThanOrEqual( 60 );
		}
	);
} );

describe( 'sampleTextFor', () => {
	it( 'returns the phrase for a known bundle', () => {
		expect( sampleTextFor( 'portuguese' ) ).toBe( SAMPLE_TEXTS.portuguese );
	} );

	it( 'falls back rather than returning undefined for an unknown bundle', () => {
		expect( sampleTextFor( 'klingon' ) ).toBeTruthy();
	} );
} );

describe( 'isVoice', () => {
	it( 'accepts a catalogued voice', () => {
		expect( isVoice( 'alba' ) ).toBe( true );
	} );

	it( 'rejects anything else, including values read back from post meta', () => {
		expect( isVoice( 'gandalf' ) ).toBe( false );
		expect( isVoice( undefined ) ).toBe( false );
		expect( isVoice( 42 ) ).toBe( false );
	} );
} );
