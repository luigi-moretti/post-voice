import { __, sprintf } from '@wordpress/i18n';
import { formatBytes, LANGUAGE_BUNDLE_BYTES } from '../editor/storage-check';
import { DownloadErrorReason, ModelState } from './download-queue';

const TABLE_ID = 'post-voice-models';

function row( language: string ): HTMLTableRowElement | null {
	return document.querySelector< HTMLTableRowElement >(
		`#${ TABLE_ID } tbody tr[data-language="${ language }"]`
	);
}

function actionButton( action: string, label: string ): HTMLButtonElement {
	const button = document.createElement( 'button' );
	button.type = 'button';
	button.className = 'button post-voice-model-action';
	button.dataset.action = action;
	button.textContent = label;
	return button;
}

function errorMessage( reason: DownloadErrorReason ): string {
	switch ( reason ) {
		case 'storage':
			return __( 'Not enough free storage', 'post-voice' );
		case 'network':
			return __( 'Network error', 'post-voice' );
		default:
			return __( 'Download failed', 'post-voice' );
	}
}

/**
 * Render one row's Status, Size and Actions cells for its current state.
 * Safe to call for a language whose row is not on the page (a no-op) —
 * `index.ts` only ever calls this for rows it found, but the guard keeps
 * this function usable on its own without that precondition.
 *
 * @param language Bundle identifier.
 * @param state    Current state, from `createDownloadQueue()` or the
 *                 initial completeness check.
 */
export function applyState( language: string, state: ModelState ): void {
	const tr = row( language );
	if ( ! tr ) {
		return;
	}
	const status = tr.querySelector< HTMLElement >(
		'.post-voice-model-status'
	);
	const size = tr.querySelector< HTMLElement >( '.post-voice-model-size' );
	const actions = tr.querySelector< HTMLElement >(
		'.post-voice-model-actions'
	);
	if ( ! status || ! size || ! actions ) {
		return;
	}
	actions.replaceChildren();

	switch ( state.status ) {
		case 'not-downloaded':
			status.textContent = __( 'Not downloaded', 'post-voice' );
			size.textContent = sprintf(
				/* translators: %s: approximate download size, e.g. "199 MB". */
				__( '~%s', 'post-voice' ),
				formatBytes( LANGUAGE_BUNDLE_BYTES )
			);
			actions.appendChild(
				actionButton( 'download', __( 'Download', 'post-voice' ) )
			);
			break;
		case 'queued':
			status.textContent = __( 'Queued', 'post-voice' );
			actions.appendChild(
				actionButton( 'cancel', __( 'Cancel', 'post-voice' ) )
			);
			break;
		case 'downloading': {
			const percent =
				state.totalBytes > 0
					? Math.round(
							( state.receivedBytes / state.totalBytes ) * 100
					  )
					: 0;
			status.textContent = sprintf(
				/* translators: %d: percent complete. */
				__( 'Downloading… %d%%', 'post-voice' ),
				percent
			);
			size.textContent = sprintf(
				/* translators: 1: bytes received so far, 2: total expected. */
				__( '%1$s of ~%2$s', 'post-voice' ),
				formatBytes( state.receivedBytes ),
				formatBytes( state.totalBytes || LANGUAGE_BUNDLE_BYTES )
			);
			actions.appendChild(
				actionButton( 'cancel', __( 'Cancel', 'post-voice' ) )
			);
			break;
		}
		case 'downloaded':
			status.textContent = __( 'Downloaded', 'post-voice' );
			size.textContent = formatBytes( state.bytes );
			actions.appendChild(
				actionButton( 'remove', __( 'Remove', 'post-voice' ) )
			);
			break;
		case 'error':
			status.textContent = errorMessage( state.reason );
			size.textContent = '—';
			actions.appendChild(
				actionButton( 'retry', __( 'Retry', 'post-voice' ) )
			);
			break;
	}
}

/**
 * Wire the table's one delegated click handler. `onAction` receives the
 * clicked button's `data-action` (`'download' | 'cancel' | 'remove' |
 * 'retry'`, as set by `applyState()` above) and the language of the row it
 * was clicked in.
 *
 * @param onAction Called on every action-button click.
 */
export function wireActions(
	onAction: ( action: string, language: string ) => void
): void {
	const table = document.getElementById( TABLE_ID );
	if ( ! table ) {
		return;
	}
	table.addEventListener( 'click', ( event ) => {
		const button = (
			event.target as HTMLElement
		 ).closest< HTMLButtonElement >( '.post-voice-model-action' );
		if ( ! button ) {
			return;
		}
		const tr = button.closest< HTMLTableRowElement >( 'tr[data-language]' );
		const language = tr?.dataset.language;
		const action = button.dataset.action;
		if ( ! language || ! action ) {
			return;
		}
		onAction( action, language );
	} );
}
