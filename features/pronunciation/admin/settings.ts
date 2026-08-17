import { __ } from '@wordpress/i18n';

/**
 * Build one dictionary row: term, replacement, language and a remove button.
 *
 * Vanilla TS, not React: this screen is a plain WordPress settings form posted
 * to `options.php`, and pulling the editor's React runtime into `wp-admin` for
 * two buttons would be a large dependency for a small job.
 *
 * @param option    The option name the row's inputs post under.
 * @param index     This row's position, used in each input's array name.
 * @param languages The bundle names to offer in the language select.
 */
function optionRow(
	option: string,
	index: number,
	languages: string[]
): HTMLTableRowElement {
	const row = document.createElement( 'tr' );

	const cell = ( child: HTMLElement ): HTMLTableCellElement => {
		const td = document.createElement( 'td' );
		td.appendChild( child );
		return td;
	};

	const text = ( field: string, label: string, maxLength: number ) => {
		const input = document.createElement( 'input' );
		input.type = 'text';
		input.name = `${ option }[${ index }][${ field }]`;
		input.maxLength = maxLength;
		input.setAttribute( 'aria-label', label );
		return input;
	};

	const select = document.createElement( 'select' );
	select.name = `${ option }[${ index }][language]`;
	select.setAttribute( 'aria-label', __( 'Language', 'post-voice' ) );
	for ( const language of languages ) {
		const optionEl = document.createElement( 'option' );
		optionEl.value = language;
		optionEl.textContent = language;
		select.appendChild( optionEl );
	}

	const remove = document.createElement( 'button' );
	remove.type = 'button';
	remove.className = 'button-link post-voice-remove-row';
	remove.textContent = __( 'Remove', 'post-voice' );

	row.appendChild( cell( text( 'term', __( 'Term', 'post-voice' ), 100 ) ) );
	row.appendChild(
		cell( text( 'replacement', __( 'Read as', 'post-voice' ), 200 ) )
	);
	row.appendChild( cell( select ) );
	row.appendChild( cell( remove ) );
	return row;
}

function init(): void {
	const table = document.getElementById( 'post-voice-dictionary' );
	const addButton = document.getElementById( 'post-voice-add-row' );
	if ( ! table || ! addButton ) {
		return;
	}
	const body = table.querySelector( 'tbody' );
	if ( ! body ) {
		return;
	}

	const option = addButton.dataset.option ?? '';
	const languages: string[] = JSON.parse(
		addButton.dataset.languages ?? '[]'
	);
	let nextIndex = Number.parseInt( addButton.dataset.nextIndex ?? '0', 10 );

	addButton.addEventListener( 'click', () => {
		const row = optionRow( option, nextIndex, languages );
		nextIndex += 1;
		body.appendChild( row );
		row.querySelector< HTMLInputElement >( 'input' )?.focus();
	} );

	// Delegated: rows added after load need it too, and re-binding per row would
	// leave the newest row dead until the next page load.
	body.addEventListener( 'click', ( event ) => {
		const target = event.target as HTMLElement;
		if ( ! target.classList.contains( 'post-voice-remove-row' ) ) {
			return;
		}
		target.closest( 'tr' )?.remove();
	} );
}

document.addEventListener( 'DOMContentLoaded', init );
