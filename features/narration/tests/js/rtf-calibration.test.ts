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
} );

describe( 'estimateAudioDurationSeconds', () => {
  it( 'scales with text length', () => {
    expect( estimateAudioDurationSeconds( 150 ) ).toBe( 10 );
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
