import { shouldRetrySingleThreaded } from '../../editor/engine/thread-mode';

describe( 'shouldRetrySingleThreaded', () => {
	it( 'retries when an isolated document failed its multi-threaded load', () => {
		// The case the retry exists for: a browser whose own WASM threading
		// is broken, which cannot be told apart from any other load failure
		// by its error message.
		expect( shouldRetrySingleThreaded( false, true ) ).toBe( true );
	} );

	it( 'does not retry when the document was never isolated', () => {
		// Without isolation the first attempt already ran single-threaded, so
		// the retry would repeat it verbatim and cost the author seconds for
		// nothing.
		expect( shouldRetrySingleThreaded( false, false ) ).toBe( false );
	} );

	it( 'does not retry when the site asked for single-threaded generation', () => {
		// Same reasoning as the unisolated case, for the diagnostic filter:
		// the first attempt was already single-threaded by request.
		expect( shouldRetrySingleThreaded( true, true ) ).toBe( false );
	} );

	it( 'does not retry when single thread was forced and isolation is off', () => {
		expect( shouldRetrySingleThreaded( true, false ) ).toBe( false );
	} );
} );
