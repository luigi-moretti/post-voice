const { webcrypto } = require( 'node:crypto' );
const { TextEncoder, TextDecoder } = require( 'node:util' );

// In jsdom environments, we need to set these on window. Otherwise, use globalThis.
const globalScope = typeof window !== 'undefined' ? window : globalThis;

// Ensure crypto.subtle is available (jsdom might not have it fully implemented)
if ( ! globalScope.crypto ) {
	globalScope.crypto = webcrypto;
} else if ( ! globalScope.crypto.subtle ) {
	globalScope.crypto.subtle = webcrypto.subtle;
}

// jsdom's Blob predates `Blob.prototype.arrayBuffer()`, which every browser has
// had since 2019. Without it, any test that inspects encoded bytes (the MP3
// encoder's frame header, for one) fails on the environment rather than on the
// code under test. Read the bytes back through FileReader, which jsdom does
// implement.
if ( globalScope.Blob && ! globalScope.Blob.prototype.arrayBuffer ) {
	globalScope.Blob.prototype.arrayBuffer = function arrayBuffer() {
		return new Promise( ( resolve, reject ) => {
			const reader = new globalScope.FileReader();
			reader.onload = () => resolve( reader.result );
			reader.onerror = () => reject( reader.error );
			reader.readAsArrayBuffer( this );
		} );
	};
}

if ( ! globalScope.TextEncoder ) {
	globalScope.TextEncoder = TextEncoder;
}
if ( ! globalScope.TextDecoder ) {
	globalScope.TextDecoder = TextDecoder;
}
