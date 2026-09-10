import {
	BlockControls,
	store as blockEditorStore,
} from '@wordpress/block-editor';
import { ToolbarDropdownMenu, ToolbarGroup } from '@wordpress/components';
import { useSelect } from '@wordpress/data';
import { createElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import {
	applyFormat,
	registerFormatType,
	removeFormat,
} from '@wordpress/rich-text';
import type { RichTextValue } from '@wordpress/rich-text';
import {
	INLINE_LANGUAGE_ATTRIBUTE,
	isEligibleBlockName,
} from './extract-segments';
import { LANGUAGE_LABELS } from './language-labels';
import { SUPPORTED_LANGUAGES } from './model-source';

const FORMAT_NAME = 'post-voice/language';

interface FormatProps {
	isActive: boolean;
	value: RichTextValue;
	onChange: ( value: RichTextValue ) => void;
	activeAttributes: Record< string, string >;
}

function Edit( { value, onChange, activeAttributes }: FormatProps ) {
	// `registerFormatType` has no per-block restriction — it takes one `tagName`,
	// not a list, and every rich text field in the editor gets every registered
	// format. The gate is here: read the selected block and render nothing when it
	// is not one the extractor narrates, so the author is never offered a marking
	// on an image caption that will never become audio.
	const selectedBlockName = useSelect(
		( select ) =>
			( select( blockEditorStore ) as any ).getBlockName(
				( select( blockEditorStore ) as any ).getSelectedBlockClientId()
			),
		[]
	);

	const current = activeAttributes.language ?? '';
	const currentLabel = current ? LANGUAGE_LABELS[ current ] ?? current : '';

	if ( ! selectedBlockName || ! isEligibleBlockName( selectedBlockName ) ) {
		return null;
	}

	const controls = SUPPORTED_LANGUAGES.map( ( language ) => ( {
		title: LANGUAGE_LABELS[ language ] ?? language,
		isActive: current === language,
		onClick: () => {
			if ( current === language ) {
				// Re-applying the language the run already carries is how the author
				// clears it — there is no separate "none" entry to hunt for.
				onChange( removeFormat( value, FORMAT_NAME ) );
				return;
			}
			onChange(
				applyFormat( value, {
					type: FORMAT_NAME,
					attributes: { language },
				} )
			);
		},
	} ) );

	return createElement(
		BlockControls,
		{ group: 'inline' },
		createElement(
			ToolbarGroup,
			null,
			createElement( ToolbarDropdownMenu, {
				icon: 'translation',
				label: currentLabel
					? sprintf(
							/* translators: %s: currently selected narration language, e.g. "English". */
							__(
								'Narrate in another language (currently %s)',
								'post-voice'
							),
							currentLabel
					  )
					: __( 'Narrate in another language', 'post-voice' ),
				text: currentLabel || undefined,
				controls,
			} )
		)
	);
}

/**
 * Register the inline format. Called once, from the panel's entry point.
 */
export function registerInlineLanguageFormat(): void {
	registerFormatType( FORMAT_NAME, {
		title: __( 'Narration language', 'post-voice' ),
		tagName: 'span',
		className: 'post-voice-lang',
		attributes: {
			language: INLINE_LANGUAGE_ATTRIBUTE,
		},
		interactive: false,
		edit: Edit,
	} );
}
