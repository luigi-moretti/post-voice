import { applyState, wireActions } from '../../admin/models-table';

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

	it( 'downloading: shows a percentage and a Cancel button', () => {
		applyState( 'portuguese', {
			status: 'downloading',
			receivedBytes: 50,
			totalBytes: 200,
		} );

		const row = document.querySelector( 'tr[data-language="portuguese"]' )!;
		expect(
			row.querySelector( '.post-voice-model-status' )?.textContent
		).toContain( '25' );
		const button = row.querySelector< HTMLButtonElement >(
			'.post-voice-model-action'
		);
		expect( button?.dataset.action ).toBe( 'cancel' );
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

	it( 'error: shows the classified reason and a Retry button', () => {
		applyState( 'portuguese', { status: 'error', reason: 'network' } );

		const row = document.querySelector( 'tr[data-language="portuguese"]' )!;
		const button = row.querySelector< HTMLButtonElement >(
			'.post-voice-model-action'
		);
		expect( button?.dataset.action ).toBe( 'retry' );
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

	it( 'ignores clicks outside an action button', () => {
		const onAction = jest.fn();
		wireActions( onAction );

		document
			.querySelector( 'td' )
			?.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );

		expect( onAction ).not.toHaveBeenCalled();
	} );
} );
