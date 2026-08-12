import { encodeMp3, floatTo16BitPCM } from '../../editor/mp3-encoder';

describe( 'floatTo16BitPCM', () => {
	it( 'scales and clamps float samples to the int16 range', () => {
		const input = new Float32Array( [ 0, 1, -1, 2, -2 ] );
		const output = floatTo16BitPCM( input );
		expect( output[ 0 ] ).toBe( 0 );
		expect( output[ 1 ] ).toBe( 0x7fff );
		expect( output[ 2 ] ).toBe( -0x8000 );
		expect( output[ 3 ] ).toBe( 0x7fff ); // clamped
		expect( output[ 4 ] ).toBe( -0x8000 ); // clamped
	} );
} );

describe( 'encodeMp3', () => {
	it( 'produces a non-empty MP3 blob with a valid frame sync word', async () => {
		const sampleRate = 24000;
		const samples = new Float32Array( sampleRate * 0.5 );
		for ( let i = 0; i < samples.length; i++ ) {
			samples[ i ] = Math.sin( ( 2 * Math.PI * 440 * i ) / sampleRate ) * 0.5;
		}

		const blob = encodeMp3( samples, sampleRate );
		expect( blob.size ).toBeGreaterThan( 0 );
		expect( blob.type ).toBe( 'audio/mpeg' );

		const bytes = new Uint8Array( await blob.arrayBuffer() );
		expect( bytes[ 0 ] ).toBe( 0xff );
		expect( bytes[ 1 ] & 0xe0 ).toBe( 0xe0 ); // MP3 frame sync word
	} );
} );
