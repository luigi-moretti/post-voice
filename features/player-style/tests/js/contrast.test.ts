import { contrastRatio, relativeLuminance } from '../../admin/contrast';

describe( 'relativeLuminance', () => {
	it( 'anchors at the two ends of the scale', () => {
		expect( relativeLuminance( '#ffffff' ) ).toBeCloseTo( 1, 5 );
		expect( relativeLuminance( '#000000' ) ).toBeCloseTo( 0, 5 );
	} );

	it( 'reads the short form the same as the long one', () => {
		expect( relativeLuminance( '#fff' ) ).toBeCloseTo(
			relativeLuminance( '#ffffff' ),
			5
		);
	} );
} );

describe( 'contrastRatio', () => {
	it( 'gives 21:1 for black on white, either way round', () => {
		expect( contrastRatio( '#ffffff', '#000000' ) ).toBeCloseTo( 21, 2 );
		expect( contrastRatio( '#000000', '#ffffff' ) ).toBeCloseTo( 21, 2 );
	} );

	it( 'passes the shipped text pair comfortably', () => {
		expect( contrastRatio( '#ffffff', '#1e1e1e' ) ).toBeGreaterThan( 4.5 );
	} );

	it( 'puts the shipped accent between the UI and the text thresholds', () => {
		// 3.26:1 — this is why the accent-against-surface pair is judged at 3:1,
		// the WCAG threshold for a UI component. A blanket 4.5 would warn against
		// the plugin's own default the first time the screen is opened.
		const ratio = contrastRatio( '#2b62f0', '#1e1e1e' );
		expect( ratio ).toBeGreaterThan( 3 );
		expect( ratio ).toBeLessThan( 4.5 );
	} );

	it( 'fails a genuinely unreadable pair', () => {
		expect( contrastRatio( '#ffffff', '#f0f0f0' ) ).toBeLessThan( 1.5 );
	} );
} );
