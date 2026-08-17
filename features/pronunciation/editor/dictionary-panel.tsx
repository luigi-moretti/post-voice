import {
	Button,
	PanelBody,
	SelectControl,
	TextControl,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import { SUPPORTED_LANGUAGES } from '../../narration/editor/model-source';
import {
	MAX_ENTRIES,
	MAX_REPLACEMENT_LENGTH,
	MAX_TERM_LENGTH,
	type DictionaryEntry,
} from './dictionary-entry';
import { nextRowId } from './row-ids';

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
	// Identities for the rows, kept in state so they survive a re-render — that
	// is what stops React reusing the wrong input when a row is removed, which
	// used to steal focus from whatever the author was typing in. They are React
	// keys only: nothing writes them into the entries this panel saves.
	//
	// `nextRowId` rather than `crypto.randomUUID` — see `row-ids.ts`. The latter
	// is secure-context-only, so on a plain-HTTP editor (a state this plugin
	// supports and explains) this initialiser threw during render for any post
	// that already had one entry, and took the whole sidebar with it.
	const [ ids, setIds ] = useState< string[] >( () => {
		return entries.map( () => nextRowId() );
	} );

	// Keep IDs in sync with entries when the parent re-renders with a different
	// entries array. If lengths disagree, generate or remove IDs as needed.
	useEffect( () => {
		setIds( ( prevIds ) => {
			if ( prevIds.length === entries.length ) {
				return prevIds;
			}
			if ( prevIds.length < entries.length ) {
				// Entries grew; generate new IDs for new entries
				const newIds = [ ...prevIds ];
				for ( let i = prevIds.length; i < entries.length; i++ ) {
					newIds.push( nextRowId() );
				}
				return newIds;
			}
			// Entries shrank; truncate IDs to match
			return prevIds.slice( 0, entries.length );
		} );
	}, [ entries.length ] );

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
				<div className="post-voice-dictionary-row" key={ ids[ index ] }>
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
						onClick={ () => {
							setIds( ( prevIds ) =>
								prevIds.filter( ( _, i ) => i !== index )
							);
							onChange(
								entries.filter( ( _, i ) => i !== index )
							);
						} }
					>
						{ __( 'Remove', 'post-voice' ) }
					</Button>
				</div>
			) ) }
			<Button
				variant="secondary"
				disabled={ entries.length >= MAX_ENTRIES }
				onClick={ () => {
					setIds( ( prevIds ) => [ ...prevIds, nextRowId() ] );
					onChange( [
						...entries,
						{
							term: '',
							replacement: '',
							language: defaultLanguage,
						},
					] );
				} }
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
