/**
 * The eight bytes of a valid, empty WebAssembly module: the `\0asm` magic
 * number followed by version 1. Compiling it is the cheapest possible proof
 * that this environment can actually turn wasm bytes into a module.
 */
const EMPTY_WASM_MODULE = Uint8Array.of(
	0x00,
	0x61,
	0x73,
	0x6d,
	0x01,
	0x00,
	0x00,
	0x00
);

interface WasmGlobal {
	WebAssembly?: {
		Module?: new ( bytes: Uint8Array ) => object;
	};
}

/**
 * Whether this browser can run the narration engine at all.
 *
 * Presence of the `WebAssembly` object is not the interesting question — every
 * browser this plugin supports has had it for years. What does happen in the
 * field is a Content-Security-Policy without `wasm-unsafe-eval`, or an
 * enterprise policy, leaving the object in place while compilation throws. So
 * this compiles an empty module rather than sniffing for the global: it is the
 * same operation the engine needs, costs microseconds, and answers the question
 * that matters before the author spends ~190MB of bandwidth finding out.
 */
export function isWasmSupported(): boolean {
	const wasm = ( globalThis as WasmGlobal ).WebAssembly;

	if ( typeof wasm !== 'object' || wasm === null ) {
		return false;
	}

	const Module = wasm.Module;
	if ( typeof Module !== 'function' ) {
		return false;
	}

	try {
		return new Module( EMPTY_WASM_MODULE ) instanceof Module;
	} catch {
		return false;
	}
}
