import { applyState, wireActions } from '../../admin/models-table';
import { LANGUAGE_BUNDLE_BYTES } from '../../editor/storage-check';

function renderTable(): void {
	document.body.innerHTML = `
		<table id="post-voice-models">
			<tbody>
				<tr data-language="portuguese">
					<td>Kyutai Pocket TTS</td>
					<td>Portuguese</td>
					<td>8 voices</td>
					<td class="post-voice-model-status" role="status">Checking…</td>
					<td class="post-voice-model-size">—</td>
					<td class="post-voice-model-actions"></td>
				</tr>
				<tr data-language="german">
					<td>Kyutai Pocket TTS</td>
					<td>German</td>
					<td>8 voices</td>
					<td class="post-voice-model-status" role="status">Checking…</td>
					<td class="post-voice-model-size">—</td>
					<td class="post-voice-model-actions"></td>
				</tr>
			</tbody>
		</table>
	`;
}

describe( 'applyState', () => {
	beforeEach( renderTable );

	it( 'not-downloaded: shows the estimated size and a Download button', () => {
		applyState( 'portuguese', { status: 'not-downloaded' } );

		const row = document.querySelector( 'tr[data-language="portuguese"]' )!;
		expect(
			row.querySelector( '.post-voice-model-status' )?.textContent
		).toBe( 'Not downloaded' );
		expect(
			row.querySelector( '.post-voice-model-size' )?.textContent
		).toContain( '~' );
		const button = row.querySelector< HTMLButtonElement >(
			'.post-voice-model-action'
		);
		expect( button?.dataset.action ).toBe( 'download' );
	} );

	it( 'queued: shows status and a Cancel button', () => {
		applyState( 'portuguese', { status: 'queued' } );

		const row = document.querySelector( 'tr[data-language="portuguese"]' )!;
		expect(
			row.querySelector( '.post-voice-model-status' )?.textContent
		).toBe( 'Queued' );
		const button = row.querySelector< HTMLButtonElement >(
			'.post-voice-model-action'
		);
		expect( button?.dataset.action ).toBe( 'cancel' );
	} );

	it( 'downloading: shows a percentage, a progress bar and a Cancel button', () => {
		applyState( 'portuguese', {
			status: 'downloading',
			receivedBytes: 50,
			totalBytes: 200,
		} );

		const row = document.querySelector( 'tr[data-language="portuguese"]' )!;
		expect(
			row.querySelector( '.post-voice-model-status' )?.textContent
		).toContain( '25' );
		const progress = row.querySelector< HTMLProgressElement >(
			'.post-voice-model-progress'
		);
		expect( progress ).not.toBeNull();
		expect( progress?.value ).toBe( 50 );
		expect( progress?.max ).toBe( 200 );
		const button = row.querySelector< HTMLButtonElement >(
			'.post-voice-model-action'
		);
		expect( button?.dataset.action ).toBe( 'cancel' );
	} );

	it( 'downloading: falls back the progress bar max to the estimated bundle size before totalBytes is known', () => {
		applyState( 'portuguese', {
			status: 'downloading',
			receivedBytes: 0,
			totalBytes: 0,
		} );

		const row = document.querySelector( 'tr[data-language="portuguese"]' )!;
		const progress = row.querySelector< HTMLProgressElement >(
			'.post-voice-model-progress'
		);
		expect( progress?.value ).toBe( 0 );
		expect( progress?.max ).toBe( LANGUAGE_BUNDLE_BYTES );
	} );

	it( 'downloaded: shows the measured size and a Remove button', () => {
		applyState( 'portuguese', {
			status: 'downloaded',
			bytes: 100 * 1024 * 1024,
		} );

		const row = document.querySelector( 'tr[data-language="portuguese"]' )!;
		expect(
			row.querySelector( '.post-voice-model-status' )?.textContent
		).toBe( 'Downloaded' );
		expect(
			row.querySelector( '.post-voice-model-size' )?.textContent
		).toBe( '100 MB' );
		const button = row.querySelector< HTMLButtonElement >(
			'.post-voice-model-action'
		);
		expect( button?.dataset.action ).toBe( 'remove' );
	} );

	it( 'error with network reason: shows error message and a Retry button', () => {
		applyState( 'portuguese', { status: 'error', reason: 'network' } );

		const row = document.querySelector( 'tr[data-language="portuguese"]' )!;
		expect(
			row.querySelector( '.post-voice-model-status' )?.textContent
		).toBe( 'Network error' );
		const button = row.querySelector< HTMLButtonElement >(
			'.post-voice-model-action'
		);
		expect( button?.dataset.action ).toBe( 'retry' );
	} );

	it( 'error with storage reason: shows storage message and a Retry button', () => {
		applyState( 'portuguese', { status: 'error', reason: 'storage' } );

		const row = document.querySelector( 'tr[data-language="portuguese"]' )!;
		expect(
			row.querySelector( '.post-voice-model-status' )?.textContent
		).toBe( 'Not enough free storage' );
		const button = row.querySelector< HTMLButtonElement >(
			'.post-voice-model-action'
		);
		expect( button?.dataset.action ).toBe( 'retry' );
	} );

	it( 'replaces old action button when state changes on same row', () => {
		// Apply initial state
		applyState( 'portuguese', { status: 'not-downloaded' } );

		const row = document.querySelector( 'tr[data-language="portuguese"]' )!;
		const actions = row.querySelector< HTMLElement >(
			'.post-voice-model-actions'
		);

		// Should have exactly one button after first applyState
		let buttons = actions?.querySelectorAll< HTMLElement >(
			'.post-voice-model-action'
		);
		expect( buttons ).toHaveLength( 1 );
		expect( buttons?.[ 0 ].dataset.action ).toBe( 'download' );

		// Apply a different state to the same row
		applyState( 'portuguese', {
			status: 'downloading',
			receivedBytes: 0,
			totalBytes: 100,
		} );

		// Should have exactly one button (the old one replaced, not added to)
		buttons = actions?.querySelectorAll< HTMLElement >(
			'.post-voice-model-action'
		);
		expect( buttons ).toHaveLength( 1 );
		expect( buttons?.[ 0 ].dataset.action ).toBe( 'cancel' );
	} );

	it( 'keeps the SAME Cancel button element across repeated downloading updates, only updating its numbers', () => {
		// A real download fires onProgress far more than once — a 76MB file
		// in ~64KB chunks is well over a thousand calls. If applyState tore
		// the action button down and rebuilt it on every single one (as it
		// used to), a real mouse click landing mid-teardown has a very real
		// chance of never reaching the delegated handler at all: the
		// element the browser dispatched mousedown against may no longer
		// be in the DOM by mouseup. This is the actual mechanism behind
		// "Cancel does nothing on one click, but repeated clicking
		// eventually works" reported from manual testing — jsdom's
		// synthetic .click() can't reproduce that race directly, but
		// asserting the button's *identity* survives repeated updates
		// proves the fix that closes it.
		applyState( 'portuguese', {
			status: 'downloading',
			receivedBytes: 0,
			totalBytes: 200,
		} );
		const row = document.querySelector( 'tr[data-language="portuguese"]' )!;
		const buttonBefore = row.querySelector< HTMLButtonElement >(
			'.post-voice-model-action'
		);
		const progressBefore = row.querySelector< HTMLProgressElement >(
			'.post-voice-model-progress'
		);

		for ( let received = 20; received <= 200; received += 20 ) {
			applyState( 'portuguese', {
				status: 'downloading',
				receivedBytes: received,
				totalBytes: 200,
			} );
		}

		const buttonAfter = row.querySelector< HTMLButtonElement >(
			'.post-voice-model-action'
		);
		const progressAfter = row.querySelector< HTMLProgressElement >(
			'.post-voice-model-progress'
		);
		expect( buttonAfter ).toBe( buttonBefore );
		expect( progressAfter ).toBe( progressBefore );
		// The numbers still genuinely update on the reused elements — this
		// isn't just "never touch anything again".
		expect( progressAfter?.value ).toBe( 200 );
		expect(
			row.querySelector( '.post-voice-model-status' )?.textContent
		).toContain( '100' );
	} );

	it( 'does nothing when the row is missing (defensive, no throw)', () => {
		expect( () =>
			applyState( 'klingon', { status: 'not-downloaded' } )
		).not.toThrow();
	} );
} );

describe( 'wireActions', () => {
	beforeEach( renderTable );

	it( "reports the clicked button's action and its row's language", () => {
		applyState( 'portuguese', { status: 'not-downloaded' } );
		const onAction = jest.fn();
		wireActions( onAction );

		document
			.querySelector< HTMLButtonElement >( '.post-voice-model-action' )
			?.click();

		expect( onAction ).toHaveBeenCalledWith( 'download', 'portuguese' );
	} );

	it( 'reports the correct language when clicking a button in a different row', () => {
		applyState( 'portuguese', { status: 'not-downloaded' } );
		applyState( 'german', { status: 'not-downloaded' } );
		const onAction = jest.fn();
		wireActions( onAction );

		// Click the german row's button
		const germanRow = document.querySelector(
			'tr[data-language="german"]'
		);
		germanRow
			?.querySelector< HTMLButtonElement >( '.post-voice-model-action' )
			?.click();

		expect( onAction ).toHaveBeenCalledWith( 'download', 'german' );
	} );

	it( 'ignores clicks outside an action button', () => {
		const onAction = jest.fn();
		wireActions( onAction );

		document
			.querySelector( 'td' )
			?.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );

		expect( onAction ).not.toHaveBeenCalled();
	} );
} );
