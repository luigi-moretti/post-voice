import { nextRowId } from '../../editor/row-ids';

describe( 'nextRowId', () => {
	it( 'never repeats an id', () => {
		const ids = Array.from( { length: 500 }, () => nextRowId() );
		expect( new Set( ids ).size ).toBe( ids.length );
	} );

	it( 'works where crypto is unavailable, as on a plain-HTTP editor', () => {
		// `crypto.randomUUID` is secure-context-only, and this plugin supports a
		// plain-HTTP editor on purpose — it explains the limitation rather than
		// crashing. Row ids are React keys and nothing more, so they must not be
		// the reason a panel cannot render there. Removing `crypto` outright is
		// stricter than the real environment (which keeps `crypto` and drops only
		// `randomUUID`), which is the point: nothing here may touch it at all.
		const descriptor = Object.getOwnPropertyDescriptor(
			globalThis,
			'crypto'
		);
		Object.defineProperty( globalThis, 'crypto', {
			configurable: true,
			value: undefined,
		} );
		try {
			expect( () => nextRowId() ).not.toThrow();
			expect( nextRowId() ).toEqual( expect.any( String ) );
		} finally {
			if ( descriptor ) {
				Object.defineProperty( globalThis, 'crypto', descriptor );
			}
		}
	} );
} );
