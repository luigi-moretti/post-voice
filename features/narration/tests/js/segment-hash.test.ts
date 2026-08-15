import {
	computeSegmentHash,
	serializeSegments,
} from '../../editor/segment-hash';

describe( 'serializeSegments', () => {
	it( 'writes fields in a fixed order', () => {
		expect(
			serializeSegments( [ { text: 'olá', language: 'portuguese' } ] )
		).toBe( '[["olá","portuguese"]]' );
	} );

	it( 'distinguishes the same text in two languages', () => {
		expect(
			serializeSegments( [ { text: 'no', language: 'portuguese' } ] )
		).not.toBe(
			serializeSegments( [ { text: 'no', language: 'english_2026-04' } ] )
		);
	} );
} );

describe( 'computeSegmentHash', () => {
	it( 'returns a 64-character hex digest', async () => {
		const hash = await computeSegmentHash( [
			{ text: 'olá', language: 'portuguese' },
		] );
		expect( hash ).toMatch( /^[a-f0-9]{64}$/ );
	} );

	it( 'is stable across calls for the same segments', async () => {
		const segments = [ { text: 'olá', language: 'portuguese' } ];
		expect( await computeSegmentHash( segments ) ).toBe(
			await computeSegmentHash( segments )
		);
	} );

	it( 'changes when a segment language changes', async () => {
		expect(
			await computeSegmentHash( [
				{ text: 'olá', language: 'portuguese' },
			] )
		).not.toBe(
			await computeSegmentHash( [ { text: 'olá', language: 'spanish' } ] )
		);
	} );

	it( 'changes when the text changes — including a dictionary substitution', async () => {
		expect(
			await computeSegmentHash( [
				{ text: 'a BYD', language: 'portuguese' },
			] )
		).not.toBe(
			await computeSegmentHash( [
				{ text: 'a Bi Iou Di', language: 'portuguese' },
			] )
		);
	} );

	it( 'changes when segment boundaries move but the joined text does not', async () => {
		expect(
			await computeSegmentHash( [
				{ text: 'um dois', language: 'portuguese' },
			] )
		).not.toBe(
			await computeSegmentHash( [
				{ text: 'um', language: 'portuguese' },
				{ text: 'dois', language: 'portuguese' },
			] )
		);
	} );
} );
