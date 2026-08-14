import {
	Button,
	PanelBody,
	SelectControl,
	TextControl,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { SUPPORTED_LANGUAGES } from '../../narration/editor/model-source';
import {
	MAX_ENTRIES,
	MAX_REPLACEMENT_LENGTH,
	MAX_TERM_LENGTH,
	type DictionaryEntry,
} from './dictionary-entry';

interface DictionaryPanelProps {
	entries: DictionaryEntry[];
	defaultLanguage: string;
	onChange: ( next: DictionaryEntry[] ) => void;
	settingsUrl: string | null;
}

/**
 * The post's own pronunciation entries.
 *
 * Site-wide entries are not editable here: they belong to another capability
 * (`manage_options`) and changing one from a post screen would silently rewrite
 * every other post's narration.
 *
 * @param props                 Component props.
 * @param props.entries         This post's pronunciation entries.
 * @param props.defaultLanguage Language pre-filled on a newly added row.
 * @param props.onChange        Called with the full next list on any edit.
 * @param props.settingsUrl     Link to the site-wide dictionary, or `null`
 *                              when the current user cannot manage it.
 */
export function DictionaryPanel( {
	entries,
	defaultLanguage,
	onChange,
	settingsUrl,
}: DictionaryPanelProps ) {
	const update = ( index: number, patch: Partial< DictionaryEntry > ) => {
		onChange(
			entries.map( ( entry, i ) =>
				i === index ? { ...entry, ...patch } : entry
			)
		);
	};

	return (
		<PanelBody
			title={ __( 'Pronunciation for this post', 'post-voice' ) }
			initialOpen={ false }
		>
			{ entries.length === 0 && (
				<p>
					{ __(
						'Nothing here yet. Add a term when the narration mispronounces a name or an acronym.',
						'post-voice'
					) }
				</p>
			) }
			{ entries.map( ( entry, index ) => (
				<div
					className="post-voice-dictionary-row"
					key={ `${ index }-${ entry.language }` }
				>
					<TextControl
						label={ __( 'Term', 'post-voice' ) }
						value={ entry.term }
						maxLength={ MAX_TERM_LENGTH }
						onChange={ ( term ) => update( index, { term } ) }
					/>
					<TextControl
						label={ __( 'Read as', 'post-voice' ) }
						value={ entry.replacement }
						maxLength={ MAX_REPLACEMENT_LENGTH }
						onChange={ ( replacement ) =>
							update( index, { replacement } )
						}
					/>
					<SelectControl
						label={ __( 'Language', 'post-voice' ) }
						value={ entry.language }
						options={ SUPPORTED_LANGUAGES.map( ( language ) => ( {
							label: language,
							value: language as string,
						} ) ) }
						onChange={ ( language ) =>
							update( index, { language } )
						}
					/>
					<Button
						variant="link"
						isDestructive
						onClick={ () =>
							onChange(
								entries.filter( ( _, i ) => i !== index )
							)
						}
					>
						{ __( 'Remove', 'post-voice' ) }
					</Button>
				</div>
			) ) }
			<Button
				variant="secondary"
				disabled={ entries.length >= MAX_ENTRIES }
				onClick={ () =>
					onChange( [
						...entries,
						{
							term: '',
							replacement: '',
							language: defaultLanguage,
						},
					] )
				}
			>
				{ __( 'Add term', 'post-voice' ) }
			</Button>
			{ settingsUrl && (
				<p>
					<a href={ settingsUrl }>
						{ __( 'Edit the site-wide dictionary', 'post-voice' ) }
					</a>
				</p>
			) }
		</PanelBody>
	);
}
