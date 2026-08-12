import { registerPlugin } from '@wordpress/plugins';
import { PluginSidebar, PluginSidebarMoreMenuItem } from '@wordpress/editor';
import { useSelect, useDispatch } from '@wordpress/data';
import { useState, useRef, useEffect, useCallback } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { dateI18n } from '@wordpress/date';
import { store as noticesStore } from '@wordpress/notices';

import { PocketTtsEngine } from './engine/tts-engine';
import { SUPPORTED_LANGUAGES } from './model-source';
import { extractNarratableText } from './extract-narratable-text';
import type { EditorBlock } from './extract-narratable-text';
import { computeSourceHash } from './source-hash';
import {
	estimateAudioDurationSeconds,
	estimateEtaSeconds,
	requiresLongTextConfirmation,
	shouldWarnSlowDevice,
} from './rtf-calibration';
import { hasEnoughStorage, formatBytes, LANGUAGE_BUNDLE_BYTES } from './storage-check';
import { encodeMp3 } from './mp3-encoder';
import { saveNarration } from './narration-api';

import './style.scss';

type PanelState = 'idle' | 'calibrating' | 'confirming-long-text' | 'generating' | 'saving' | 'error';

interface ExistingNarration {
	url: string;
	generatedAt: string;
}

function NarrationPanel() {
	const [ state, setState ] = useState< PanelState >( 'idle' );
	const [ language, setLanguage ] = useState< string >( 'portuguese' );
	const [ etaSeconds, setEtaSeconds ] = useState< number | null >( null );
	const [ previewUrl, setPreviewUrl ] = useState< string | null >( null );
	const [ error, setError ] = useState< string | null >( null );
	const [ existing, setExisting ] = useState< ExistingNarration | null >( null );
	const [ isStale, setIsStale ] = useState( false );

	const previewBlobRef = useRef< Blob | null >( null );
	const abortRef = useRef< AbortController | null >( null );
	const engineRef = useRef< PocketTtsEngine | null >( null );

	const { postId, blocks, postStatus, meta } = useSelect( ( select ) => {
		const editor = select( 'core/editor' ) as any;
		return {
			postId: editor.getCurrentPostId() as number,
			blocks: ( select( 'core/block-editor' ) as any ).getBlocks() as EditorBlock[],
			postStatus: editor.getEditedPostAttribute( 'status' ) as string,
			meta: ( editor.getEditedPostAttribute( 'meta' ) || {} ) as Record< string, unknown >,
		};
	}, [] );

	const { createErrorNotice } = useDispatch( noticesStore );

	const attachmentId = meta._narration_attachment_id as number | undefined;
	const savedHash = meta._narration_source_hash as string | undefined;

	// Load the existing attachment's URL and date so the panel can show a real
	// inline player instead of just claiming audio exists.
	useEffect( () => {
		let cancelled = false;
		if ( ! attachmentId ) {
			setExisting( null );
			return;
		}
		apiFetch< { source_url: string; date_gmt: string } >( {
			path: `/wp/v2/media/${ attachmentId }`,
		} )
			.then( ( media ) => {
				if ( ! cancelled ) {
					setExisting( { url: media.source_url, generatedAt: media.date_gmt } );
				}
			} )
			.catch( () => {
				// Attachment vanished (deleted straight from the Media Library). The
				// delete_attachment hook clears the meta server-side; nothing to show here.
				if ( ! cancelled ) setExisting( null );
			} );
		return () => {
			cancelled = true;
		};
	}, [ attachmentId ] );

	// Recompute the current text hash and compare against what was saved.
	useEffect( () => {
		let cancelled = false;
		if ( ! savedHash ) {
			setIsStale( false );
			return;
		}
		computeSourceHash( extractNarratableText( blocks ) ).then( ( currentHash ) => {
			if ( ! cancelled ) setIsStale( currentHash !== savedHash );
		} );
		return () => {
			cancelled = true;
		};
	}, [ blocks, savedHash ] );

	const setPreview = useCallback( ( blob: Blob | null ) => {
		setPreviewUrl( ( previous ) => {
			if ( previous ) URL.revokeObjectURL( previous );
			return blob ? URL.createObjectURL( blob ) : null;
		} );
		previewBlobRef.current = blob;
	}, [] );

	const runGeneration = useCallback(
		async ( text: string ) => {
			setState( 'generating' );
			abortRef.current = new AbortController();
			const audio = await engineRef.current!.generate( text, {
				signal: abortRef.current.signal,
			} );
			setPreview( encodeMp3( audio, engineRef.current!.sampleRate ) );
			setState( 'idle' );
		},
		[ setPreview ]
	);

	const startGeneration = useCallback( async () => {
		setError( null );
		setState( 'calibrating' );
		try {
			const text = extractNarratableText( blocks );
			if ( ! text ) {
				throw new Error( __( 'No readable text found in this post.', 'post-voice' ) );
			}

			// `crypto.subtle` only exists in a secure context. On a plain-HTTP site it
			// is undefined, so hashing throws and staleness detection breaks. Check up
			// front rather than failing mid-generation after the model has downloaded.
			// The same requirement gates AudioWorklet and cross-origin isolation, so
			// this one check covers the whole feature.
			if ( ! window.isSecureContext || ! window.crypto?.subtle ) {
				throw new Error(
					__(
						'Narration needs a secure connection. Load the editor over HTTPS (or localhost) and try again.',
						'post-voice'
					)
				);
			}

			// Check storage BEFORE downloading ~190MB of model, not after.
			if ( ! engineRef.current && navigator.storage?.estimate ) {
				const estimate = await navigator.storage.estimate();
				if ( ! hasEnoughStorage( estimate ) ) {
					throw new Error(
						sprintf(
							/* translators: %s: required free storage, e.g. "285 MB". */
							__(
								'Not enough free storage to download the voice model. About %s of free space is needed.',
								'post-voice'
							),
							formatBytes( LANGUAGE_BUNDLE_BYTES * 1.5 )
						)
					);
				}
			}

			if ( ! engineRef.current ) {
				engineRef.current = new PocketTtsEngine();
				await engineRef.current.load( language );
			}

			const { rtf } = await engineRef.current.calibrate();
			// rtf === 0 means the warm-up produced no measurable audio. Treat that as
			// "unmeasured", not "instant" — otherwise a broken calibration looks like a
			// blazing-fast device and every guard below silently stops firing.
			const eta =
				rtf > 0 ? estimateEtaSeconds( rtf, estimateAudioDurationSeconds( text.length ) ) : null;
			setEtaSeconds( eta );

			if ( eta !== null && requiresLongTextConfirmation( eta ) ) {
				setState( 'confirming-long-text' );
				return;
			}

			if ( rtf > 0 && shouldWarnSlowDevice( rtf ) ) {
				createErrorNotice(
					__( 'This device is slower than usual for narration — it may take a while.', 'post-voice' ),
					{ type: 'snackbar' }
				);
			}

			await runGeneration( text );
		} catch ( err ) {
			if ( ( err as Error ).name === 'AbortError' ) {
				setState( 'idle' );
				return;
			}
			setState( 'error' );
			setError( ( err as Error ).message );
		}
	}, [ blocks, language, runGeneration, createErrorNotice ] );

	const cancelGeneration = useCallback( () => {
		abortRef.current?.abort();
		// Tear the worker down rather than reusing it. The worker cancels
		// cooperatively via a single `isGenerating` flag: posting `stop` clears it,
		// but the in-flight pipeline only notices at its next loop check. A new
		// `generate` arriving inside that window sets the flag back to true, the old
		// pipeline never breaks, and both pipelines stream `audio_chunk` messages
		// into the same listener — producing spliced garbage audio. Disposing is the
		// only fix available without modifying the vendored worker. Cost is an ONNX
		// session re-init on the next generation; the model files themselves come
		// from the HTTP cache (pinned, immutable URLs), so there is no re-download.
		engineRef.current?.dispose();
		engineRef.current = null;
		setState( 'idle' );
	}, [] );

	const confirmSave = useCallback( async () => {
		const blob = previewBlobRef.current;
		if ( ! blob ) return;
		setState( 'saving' );
		try {
			const sourceHash = await computeSourceHash( extractNarratableText( blocks ) );
			const saved = await saveNarration( postId, blob, language, sourceHash );
			setPreview( null );
			setExisting( { url: saved.url, generatedAt: saved.generated_at } );
			setIsStale( false );
			setState( 'idle' );
		} catch ( err ) {
			setState( 'error' );
			setError( ( err as Error ).message );
		}
	}, [ blocks, language, postId, setPreview ] );

	const isAutoDraft = postStatus === 'auto-draft';
	const isBusy = state !== 'idle' && state !== 'error';

	return (
		<>
			<PluginSidebarMoreMenuItem target="post-voice-panel">
				{ __( 'Narration', 'post-voice' ) }
			</PluginSidebarMoreMenuItem>
			<PluginSidebar name="post-voice-panel" title={ __( 'Narration', 'post-voice' ) }>
				<div className="post-voice-panel">
					{ error && <p role="alert">{ error }</p> }

					{ isAutoDraft && (
						<p>{ __( 'Save the post first to generate narration.', 'post-voice' ) }</p>
					) }

					{ existing && ! previewUrl && (
						<div className="post-voice-panel__status">
							<p>
								{ sprintf(
									/* translators: %s: date the narration audio was generated. */
									__( 'Generated on %s', 'post-voice' ),
									dateI18n( 'F j, Y', existing.generatedAt )
								) }
							</p>
							<p className="post-voice-panel__badge">
								{ isStale
									? __(
											'May be out of date — the post text changed since this was generated.',
											'post-voice'
									  )
									: __( 'Up to date', 'post-voice' ) }
							</p>
							<audio controls src={ existing.url } />
						</div>
					) }

					{ ! existing && ! previewUrl && ! isAutoDraft && (
						<p>{ __( 'No audio generated yet.', 'post-voice' ) }</p>
					) }

					<select
						value={ language }
						onChange={ ( e ) => setLanguage( e.target.value ) }
						disabled={ isBusy }
						aria-label={ __( 'Narration language', 'post-voice' ) }
					>
						{ SUPPORTED_LANGUAGES.map( ( lang ) => (
							<option key={ lang } value={ lang }>
								{ lang }
							</option>
						) ) }
					</select>

					{ state === 'confirming-long-text' && (
						<div>
							<p>
								{ sprintf(
									/* translators: %d: estimated generation time in seconds. */
									__( 'This text is long — estimated time: %d seconds.', 'post-voice' ),
									Math.round( etaSeconds ?? 0 )
								) }
							</p>
							<button onClick={ () => runGeneration( extractNarratableText( blocks ) ) }>
								{ __( 'Generate anyway', 'post-voice' ) }
							</button>
							<button onClick={ () => setState( 'idle' ) }>
								{ __( 'Cancel', 'post-voice' ) }
							</button>
						</div>
					) }

					{ ( state === 'generating' || state === 'calibrating' ) && (
						<div>
							<p>{ __( 'Generating…', 'post-voice' ) }</p>
							<button onClick={ cancelGeneration }>{ __( 'Cancel', 'post-voice' ) }</button>
						</div>
					) }

					{ previewUrl && ! isBusy && (
						<div>
							<audio controls src={ previewUrl } />
							<button onClick={ confirmSave }>
								{ __( 'Save narration', 'post-voice' ) }
							</button>
						</div>
					) }

					{ ! previewUrl && ! isBusy && (
						<button onClick={ startGeneration } disabled={ isAutoDraft }>
							{ existing
								? __( 'Generate again', 'post-voice' )
								: __( 'Generate audio', 'post-voice' ) }
						</button>
					) }
				</div>
			</PluginSidebar>
		</>
	);
}

registerPlugin( 'post-voice', { render: NarrationPanel, icon: 'microphone' } );
