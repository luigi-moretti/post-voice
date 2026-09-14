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
 * Make sure `actions` holds exactly one button for `action`, reusing the
 * existing one when it already matches instead of tearing it down.
 *
 * A real download fires `onProgress` — and so `applyState()` — far more
 * than once; a 76MB file in ~64KB chunks is well over a thousand calls
 * while the state stays `'downloading'` throughout. Rebuilding the button
 * on every single one of those made it disappear and reappear at that
 * same frequency: a real mouse click landing mid-teardown has a real
 * chance of never reaching the delegated handler, because the element the
 * browser dispatched `mousedown` against may already be gone by
 * `mouseup`. Only actually replacing the button when the action itself
 * changes closes that window.
 *
 * @param actions The row's `.post-voice-model-actions` cell.
 * @param action  Action code this state calls for, or `null` for none.
 * @param label   Button label, used only when a new button is created.
 */
function ensureActionButton(
	actions: HTMLElement,
	action: string | null,
	label: string
): void {
	const existing = actions.querySelector< HTMLButtonElement >(
		'.post-voice-model-action'
	);
	if ( action === null ) {
		if ( existing ) {
			actions.replaceChildren();
		}
		return;
	}
	if ( existing?.dataset.action === action ) {
		return;
	}
	actions.replaceChildren( actionButton( action, label ) );
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

	switch ( state.status ) {
		case 'not-downloaded':
			ensureActionButton(
				actions,
				'download',
				__( 'Download', 'post-voice' )
			);
			status.textContent = __( 'Not downloaded', 'post-voice' );
			size.textContent = sprintf(
				/* translators: %s: approximate download size, e.g. "199 MB". */
				__( '~%s', 'post-voice' ),
				formatBytes( LANGUAGE_BUNDLE_BYTES )
			);
			break;
		case 'queued':
			ensureActionButton(
				actions,
				'cancel',
				__( 'Cancel', 'post-voice' )
			);
			status.textContent = __( 'Queued', 'post-voice' );
			break;
		case 'downloading': {
			ensureActionButton(
				actions,
				'cancel',
				__( 'Cancel', 'post-voice' )
			);
			const percent =
				state.totalBytes > 0
					? Math.round(
							( state.receivedBytes / state.totalBytes ) * 100
					  )
					: 0;
			const percentText = sprintf(
				/* translators: %d: percent complete. */
				__( 'Downloading… %d%%', 'post-voice' ),
				percent
			);
			// Same reuse-don't-rebuild reasoning as `ensureActionButton()`
			// above, and for the same reason: this runs on every
			// `onProgress` tick.
			let progress = status.querySelector< HTMLProgressElement >(
				'.post-voice-model-progress'
			);
			let text = status.firstChild;
			if ( ! progress || ! text || text.nodeType !== Node.TEXT_NODE ) {
				progress = document.createElement( 'progress' );
				progress.className = 'post-voice-model-progress';
				text = document.createTextNode( '' );
				status.replaceChildren( text, progress );
			}
			text.textContent = percentText;
			progress.value = state.receivedBytes;
			progress.max = state.totalBytes || LANGUAGE_BUNDLE_BYTES;
			size.textContent = sprintf(
				/* translators: 1: bytes received so far, 2: total expected. */
				__( '%1$s of ~%2$s', 'post-voice' ),
				formatBytes( state.receivedBytes ),
				formatBytes( state.totalBytes || LANGUAGE_BUNDLE_BYTES )
			);
			break;
		}
		case 'downloaded':
			ensureActionButton(
				actions,
				'remove',
				__( 'Remove', 'post-voice' )
			);
			status.textContent = __( 'Downloaded', 'post-voice' );
			size.textContent = formatBytes( state.bytes );
			break;
		case 'error':
			ensureActionButton( actions, 'retry', __( 'Retry', 'post-voice' ) );
			status.textContent = errorMessage( state.reason );
			size.textContent = '—';
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
