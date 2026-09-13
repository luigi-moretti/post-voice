import { __ } from '@wordpress/i18n';
import './style.scss';
import { isBundleComplete } from './bundle-status';
import { realBundleBytes } from './bundle-size';
import { applyState, wireActions } from './models-table';
import { createDownloadQueue } from './download-queue';

const TABLE_ID = 'post-voice-models';

async function init(): Promise< void > {
	const table = document.getElementById( TABLE_ID );
	if ( ! table ) {
		return;
	}
	const rows = table.querySelectorAll< HTMLTableRowElement >(
		'tbody tr[data-language]'
	);
	const languages = Array.from( rows )
		.map( ( tr ) => tr.dataset.language ?? '' )
		.filter( ( language ) => language !== '' );

	const queue = createDownloadQueue();
	queue.subscribe( ( language, state ) => applyState( language, state ) );

	wireActions( ( action, language ) => {
		switch ( action ) {
			case 'download':
			case 'retry':
				queue.requestDownload( language );
				break;
			case 'cancel':
				queue.cancelDownload( language );
				break;
			case 'remove':
				// A native confirm(), not a custom dialog: this is a settings-screen
				// destructive action with no existing inline-confirmation component
				// to reuse here (unlike the editor panel's remove-narration card).
				if (
					// eslint-disable-next-line no-alert
					window.confirm(
						__(
							'Remove this downloaded model? It will need to be downloaded again the next time you narrate in this language.',
							'post-voice'
						)
					)
				) {
					void queue.removeBundle( language );
				}
				break;
			default:
				break;
		}
	} );

	for ( const language of languages ) {
		try {
			const complete = await isBundleComplete( language );
			if ( complete ) {
				const bytes = await realBundleBytes( language );
				applyState( language, { status: 'downloaded', bytes } );
			} else {
				applyState( language, { status: 'not-downloaded' } );
			}
		} catch {
			// One language's cache entry failing to parse (e.g. corrupted
			// `bundle.json` left over from a crashed session) must not stop
			// every row after it from being stuck on "Checking…" forever —
			// fall back to the same safe default `bundle-status.ts` and
			// `bundle-size.ts` use when completeness can't be determined.
			applyState( language, { status: 'not-downloaded' } );
		}
	}
}

document.addEventListener( 'DOMContentLoaded', () => void init() );
