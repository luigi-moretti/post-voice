/**
 * Live preview for the player styling section.
 *
 * The server already rendered the preview with the saved values, so everything
 * here is enhancement: if this file fails to load, the screen still shows the
 * right colours and still saves.
 */

import { __, sprintf } from '@wordpress/i18n';
import { contrastRatio } from './contrast';
import { expandHex, isValidHex, normalizeHex } from './hex-field';

const PROPERTY: Record< string, string > = {
	surface: '--pv-surface',
	accent: '--pv-accent',
	text: '--pv-text',
};

const DEFAULTS: Record< string, string > = {
	surface: '#1e1e1e',
	accent: '#2b62f0',
	text: '#ffffff',
	radius: 'pill',
};

/**
 * The three pairs worth checking, and the threshold WCAG gives each one.
 *
 * Text keeps 4.5:1. The accent against the background is a UI component — the
 * play button and the progress bar — which WCAG 2.2 judges at 3:1; holding it
 * to 4.5 would warn against the plugin's own default pairing, which measures
 * 3.26:1.
 */
const PAIRS: Array< { a: string; b: string; minimum: number; label: string } > =
	[
		{
			a: 'text',
			b: 'surface',
			minimum: 4.5,
			label: __( 'Text and icons against the background', 'post-voice' ),
		},
		{
			a: 'text',
			b: 'accent',
			minimum: 4.5,
			label: __( 'The play icon against the accent', 'post-voice' ),
		},
		{
			a: 'accent',
			b: 'surface',
			minimum: 3,
			label: __( 'The accent against the background', 'post-voice' ),
		},
	];

/**
 * Read the current colour of every hex field.
 *
 * An invalid or half-typed hex field falls back to its paired picker's
 * current value — the picker only ever gets `expandHex()` of a normalized
 * value, so it always holds the last valid colour for that key. `DEFAULTS` is
 * only a last resort for a field with no matching picker, which should not
 * happen given how the server renders them.
 *
 * @param fields  The hex text inputs.
 * @param pickers The colour pickers paired with the hex inputs.
 */
function readColours(
	fields: HTMLInputElement[],
	pickers: HTMLInputElement[]
): Record< string, string > {
	const colours = { ...DEFAULTS };
	for ( const field of fields ) {
		const key = field.dataset.key ?? '';
		if ( ! key ) {
			continue;
		}
		const value = normalizeHex( field.value );
		if ( value ) {
			colours[ key ] = value;
			continue;
		}
		const picker = pickers.find(
			( candidate ) => candidate.dataset.key === key
		);
		if ( picker ) {
			colours[ key ] = picker.value;
		}
	}
	return colours;
}

/**
 * Write the colours and the corner length onto the preview wrapper.
 *
 * @param wrapper The preview container.
 * @param colours Current colour per key.
 * @param radius  Current corner length, e.g. `12px`.
 */
function applyStyle(
	wrapper: HTMLElement,
	colours: Record< string, string >,
	radius: string
): void {
	for ( const [ key, property ] of Object.entries( PROPERTY ) ) {
		wrapper.style.setProperty( property, colours[ key ] );
	}
	wrapper.style.setProperty( '--pv-radius', radius );
}

/**
 * Say which pairs fall below their threshold, or nothing when all pass.
 *
 * A warning, never a block: the choice stays the author's, informed.
 *
 * @param message The status paragraph.
 * @param colours Current colour per key.
 */
function reportContrast(
	message: HTMLElement,
	colours: Record< string, string >
): void {
	const failing = PAIRS.filter(
		( pair ) =>
			contrastRatio( colours[ pair.a ], colours[ pair.b ] ) < pair.minimum
	).map( ( pair ) => pair.label );

	message.textContent =
		failing.length === 0
			? ''
			: sprintf(
					/* translators: %s: comma-separated list of colour pairs with low contrast. */
					__(
						'Low contrast, which can make the player hard to read: %s. You can still save.',
						'post-voice'
					),
					failing.join( '; ' )
			  );
}

/**
 * Wire the fields, the preview and the restore link together.
 *
 * @param root Where to look for the screen's elements.
 */
export function initPreview( root: ParentNode = document ): void {
	const wrapper = root.querySelector< HTMLElement >( '.post-voice-preview' );
	const message = root.querySelector< HTMLElement >(
		'.post-voice-contrast-warning'
	);
	const radiusField = root.querySelector< HTMLSelectElement >(
		'.post-voice-style-radius'
	);
	const hexFields = Array.from(
		root.querySelectorAll< HTMLInputElement >( '.post-voice-style-hex' )
	);
	if ( ! wrapper || ! message || ! radiusField || hexFields.length === 0 ) {
		return;
	}

	const pickers = Array.from(
		root.querySelectorAll< HTMLInputElement >( '.post-voice-style-picker' )
	);

	const currentRadius = (): string =>
		radiusField.selectedOptions[ 0 ]?.dataset.length ?? '999px';

	const refresh = (): void => {
		const colours = readColours( hexFields, pickers );
		applyStyle( wrapper, colours, currentRadius() );
		reportContrast( message, colours );
	};

	for ( const field of hexFields ) {
		field.addEventListener( 'input', () => {
			const value = normalizeHex( field.value );
			if ( ! value ) {
				// Leave the preview showing the last good value rather than
				// flashing black while a hex is half-typed.
				return;
			}
			const picker = pickers.find(
				( candidate ) => candidate.dataset.key === field.dataset.key
			);
			if ( picker ) {
				picker.value = expandHex( value );
			}
			refresh();
		} );

		// Never submit something the server would silently discard.
		field.addEventListener( 'blur', () => {
			if ( isValidHex( field.value ) ) {
				field.value = normalizeHex( field.value ) ?? field.value;
				return;
			}
			const picker = pickers.find(
				( candidate ) => candidate.dataset.key === field.dataset.key
			);
			field.value =
				picker?.value ?? DEFAULTS[ field.dataset.key ?? '' ] ?? '';
			refresh();
		} );
	}

	for ( const picker of pickers ) {
		picker.addEventListener( 'input', () => {
			const field = hexFields.find(
				( candidate ) => candidate.dataset.key === picker.dataset.key
			);
			if ( field ) {
				field.value = picker.value.toLowerCase();
			}
			refresh();
		} );
	}

	radiusField.addEventListener( 'change', refresh );

	// Client-side only: the Save button remains the one thing that writes. A
	// link that saved on click would let one stray click discard a site's
	// customisation with no confirmation.
	const restore = document.createElement( 'button' );
	restore.type = 'button';
	restore.className = 'button-link';
	restore.id = 'post-voice-style-restore';
	restore.textContent = __( 'Restore defaults', 'post-voice' );
	restore.addEventListener( 'click', () => {
		for ( const field of hexFields ) {
			const key = field.dataset.key ?? '';
			field.value = DEFAULTS[ key ] ?? field.value;
		}
		for ( const picker of pickers ) {
			const key = picker.dataset.key ?? '';
			picker.value = expandHex( DEFAULTS[ key ] ?? picker.value );
		}
		radiusField.value = DEFAULTS.radius;
		refresh();
	} );
	message.insertAdjacentElement( 'afterend', restore );

	refresh();
}
