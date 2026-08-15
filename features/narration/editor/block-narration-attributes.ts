import { InspectorControls } from '@wordpress/block-editor';
import { PanelBody, SelectControl, ToggleControl } from '@wordpress/components';
import { createHigherOrderComponent } from '@wordpress/compose';
import { addFilter } from '@wordpress/hooks';
import { __, sprintf } from '@wordpress/i18n';
import {
	createElement,
	Fragment,
	useEffect,
	useState,
} from '@wordpress/element';
import { cachedBundles } from './bundle-cache-status';
import { isEligibleBlockName } from './extract-segments';
import { SUPPORTED_LANGUAGES } from './model-source';
import { languageLabel } from './language-labels';
import { formatBytes, LANGUAGE_BUNDLE_BYTES } from './storage-check';

interface BlockSettings {
	name?: string;
	attributes?: Record< string, unknown >;
}

/**
 * Add the two attributes to every narratable block type.
 *
 * Attributes rather than post meta: they live in `post_content`, so Gutenberg
 * saves, undoes and revisions them for free, and copying a block carries its
 * marking along.
 *
 * @param settings Block type settings.
 * @param name     Block name.
 */
function addAttributes( settings: BlockSettings, name: string ): BlockSettings {
	if ( ! isEligibleBlockName( name ) ) {
		return settings;
	}
	return {
		...settings,
		attributes: {
			...settings.attributes,
			pvNarrate: { type: 'boolean', default: true },
			pvLanguage: { type: 'string', default: '' },
		},
	};
}

const withNarrationControls = createHigherOrderComponent(
	( BlockEdit ) => ( props: any ) => {
		const [ cached, setCached ] = useState< Set< string > >( new Set() );
		const isEligible = isEligibleBlockName( props.name );

		useEffect( () => {
			if ( ! isEligible ) {
				return;
			}
			let cancelled = false;
			cachedBundles( [ ...SUPPORTED_LANGUAGES ] ).then( ( result ) => {
				if ( ! cancelled ) {
					setCached( result );
				}
			} );
			return () => {
				cancelled = true;
			};
		}, [ isEligible ] );

		if ( ! isEligible ) {
			return createElement( BlockEdit, props );
		}

		const { pvNarrate = true, pvLanguage = '' } = props.attributes;

		const options = [
			{
				label: __( 'Post default', 'post-voice' ),
				value: '',
			},
			...SUPPORTED_LANGUAGES.map( ( language ) => ( {
				value: language,
				label: cached.has( language )
					? sprintf(
							/* translators: %s: language name. */
							__( '%s — already downloaded', 'post-voice' ),
							languageLabel( language )
					  )
					: sprintf(
							/* translators: 1: language name, 2: download size, e.g. "199 MB". */
							__( '%1$s — +%2$s to download', 'post-voice' ),
							languageLabel( language ),
							formatBytes( LANGUAGE_BUNDLE_BYTES )
					  ),
			} ) ),
		];

		return createElement(
			Fragment,
			null,
			createElement( BlockEdit, props ),
			createElement(
				InspectorControls,
				null,
				createElement(
					PanelBody,
					{ title: __( 'Narration', 'post-voice' ) },
					createElement( ToggleControl, {
						label: __( 'Include in the narration', 'post-voice' ),
						help: __(
							'Turned off, this block is left out of the audio and out of the up-to-date check.',
							'post-voice'
						),
						checked: pvNarrate,
						onChange: ( value: boolean ) =>
							props.setAttributes( { pvNarrate: value } ),
					} ),
					createElement( SelectControl, {
						label: __( 'Language for this block', 'post-voice' ),
						value: pvLanguage,
						options,
						onChange: ( value: string ) =>
							props.setAttributes( { pvLanguage: value } ),
					} )
				)
			)
		);
	},
	'withNarrationControls'
);

/**
 * Install both filters. Called once, from the panel's entry point.
 */
export function registerBlockNarrationControls(): void {
	addFilter(
		'blocks.registerBlockType',
		'post-voice/narration-attributes',
		addAttributes
	);
	addFilter(
		'editor.BlockEdit',
		'post-voice/narration-controls',
		withNarrationControls
	);
}
