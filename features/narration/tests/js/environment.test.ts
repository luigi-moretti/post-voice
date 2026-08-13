import { isWasmSupported } from '../../editor/environment';

type MutableGlobal = Record< string, unknown >;

describe( 'isWasmSupported', () => {
	const original = ( globalThis as MutableGlobal ).WebAssembly;

	afterEach( () => {
		( globalThis as MutableGlobal ).WebAssembly = original;
	} );

	it( 'is true in an environment that can compile a module', () => {
		expect( isWasmSupported() ).toBe( true );
	} );

	it( 'is false when the browser has no WebAssembly at all', () => {
		delete ( globalThis as MutableGlobal ).WebAssembly;

		expect( isWasmSupported() ).toBe( false );
	} );

	it( 'is false when WebAssembly exists but cannot compile', () => {
		// What a Content-Security-Policy without `wasm-unsafe-eval` produces: the
		// object is right there, and compiling throws. Sniffing for the global
		// alone would call this browser supported and fail 190MB later.
		( globalThis as MutableGlobal ).WebAssembly = {
			Module: function Module() {
				throw new Error( 'CompileError: wasm blocked by CSP' );
			},
		};

		expect( isWasmSupported() ).toBe( false );
	} );

	it( 'is false when WebAssembly is present but has no Module constructor', () => {
		( globalThis as MutableGlobal ).WebAssembly = {};

		expect( isWasmSupported() ).toBe( false );
	} );
} );
