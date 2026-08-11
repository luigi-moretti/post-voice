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

if ( ! globalScope.TextEncoder ) {
  globalScope.TextEncoder = TextEncoder;
}
if ( ! globalScope.TextDecoder ) {
  globalScope.TextDecoder = TextDecoder;
}
