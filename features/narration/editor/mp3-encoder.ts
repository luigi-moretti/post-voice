// `@breezystack/lamejs`, not `lamejs`. The original package's published modular
// build (`lamejs@1.2.1`, the npm `main`) is broken: `src/js/Lame.js` reads
// `MPEGMode` as a free global that nothing ever requires, so constructing an
// `Mp3Encoder` throws `ReferenceError: MPEGMode is not defined`. The only way to
// use it is deep-importing package internals and assigning them onto
// `globalThis`. This fork ships the same LGPL-3.0 encoder as a proper ESM bundle
// with TypeScript types, so no globals leak into the WordPress admin page.
import { Mp3Encoder } from '@breezystack/lamejs';

const MP3_BITRATE_KBPS = 64; // spec: "Formato de áudio salvo" — fixed, not configurable in Fase 1
const SAMPLES_PER_FRAME = 1152;

export function floatTo16BitPCM( float32: Float32Array ): Int16Array {
	const out = new Int16Array( float32.length );
	for ( let i = 0; i < float32.length; i++ ) {
		const s = Math.max( -1, Math.min( 1, float32[ i ] ) );
		out[ i ] = s < 0 ? s * 0x8000 : s * 0x7fff;
	}
	return out;
}

export function encodeMp3( float32Audio: Float32Array, sampleRate: number ): Blob {
	const pcm = floatTo16BitPCM( float32Audio );
	const encoder = new Mp3Encoder( 1, sampleRate, MP3_BITRATE_KBPS );
	const chunks: Uint8Array[] = [];

	for ( let i = 0; i < pcm.length; i += SAMPLES_PER_FRAME ) {
		const chunk = pcm.subarray( i, i + SAMPLES_PER_FRAME );
		const encoded = encoder.encodeBuffer( chunk );
		if ( encoded.length > 0 ) chunks.push( encoded );
	}
	const finalChunk = encoder.flush();
	if ( finalChunk.length > 0 ) chunks.push( finalChunk );

	// Flatten into a single buffer rather than handing the array of views straight
	// to `Blob`. The encoder's return type is an unparameterised `Uint8Array`,
	// which TypeScript 5.7+ widens to `ArrayBufferLike` and therefore refuses as a
	// `BlobPart` (it could be `SharedArrayBuffer`-backed). Copying once is cheaper
	// than a cast that asserts something the type system cannot check — and at
	// 64kbps the whole narration is a few hundred KB.
	const totalBytes = chunks.reduce( ( sum, chunk ) => sum + chunk.length, 0 );
	const mp3 = new Uint8Array( totalBytes );
	let offset = 0;
	for ( const chunk of chunks ) {
		mp3.set( chunk, offset );
		offset += chunk.length;
	}

	return new Blob( [ mp3 ], { type: 'audio/mpeg' } );
}
