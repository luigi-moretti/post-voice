import {
	computeRtf,
	estimateAudioDurationSeconds,
	estimateEtaSeconds,
	requiresLongTextConfirmation,
	shouldWarnSlowDevice,
} from '../../editor/rtf-calibration';

describe( 'computeRtf', () => {
	it( 'returns 1 when processing time equals audio duration (real-time)', () => {
		expect( computeRtf( 2, 2000 ) ).toBe( 1 );
	} );
	it( 'returns 0 for non-positive elapsed time', () => {
		expect( computeRtf( 2, 0 ) ).toBe( 0 );
	} );
	it( 'returns 0 for a zero-length warm-up instead of Infinity', () => {
		// Infinity here would collapse to NaN downstream and silently disable the
		// long-text confirmation prompt.
		expect( computeRtf( 0, 1000 ) ).toBe( 0 );
	} );
} );

describe( 'degenerate inputs never defeat the confirmation gate', () => {
	it( 'a failed warm-up plus an empty post does not produce NaN', () => {
		const rtf = computeRtf( 0, 1000 );
		const eta = estimateEtaSeconds(
			rtf,
			estimateAudioDurationSeconds( 0 )
		);
		expect( Number.isNaN( eta ) ).toBe( false );
		expect( requiresLongTextConfirmation( eta ) ).toBe( false );
	} );

	it( 'returns zero duration for empty text and zero ETA for a zero rtf', () => {
		expect( estimateAudioDurationSeconds( 0 ) ).toBe( 0 );
		expect( estimateEtaSeconds( 0, 100 ) ).toBe( 0 );
	} );
} );

describe( 'estimateAudioDurationSeconds', () => {
	it( 'scales with text length at roughly a 150 wpm narration pace', () => {
		expect( estimateAudioDurationSeconds( 125 ) ).toBe( 10 );
	} );
} );

describe( 'estimateEtaSeconds', () => {
	it( 'multiplies rtf by estimated audio duration', () => {
		expect( estimateEtaSeconds( 2, 30 ) ).toBe( 60 );
	} );
} );

describe( 'shouldWarnSlowDevice', () => {
	it( 'warns only above 3x real-time', () => {
		expect( shouldWarnSlowDevice( 3.1 ) ).toBe( true );
		expect( shouldWarnSlowDevice( 3 ) ).toBe( false );
	} );
} );

describe( 'requiresLongTextConfirmation', () => {
	it( 'requires confirmation only above 2 minutes ETA', () => {
		expect( requiresLongTextConfirmation( 121 ) ).toBe( true );
		expect( requiresLongTextConfirmation( 120 ) ).toBe( false );
	} );
} );
