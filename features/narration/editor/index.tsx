import { registerPlugin } from '@wordpress/plugins';
import {
	PluginSidebar,
	PluginSidebarMoreMenuItem,
	store as editorStore,
} from '@wordpress/editor';
import { useSelect, useDispatch } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import {
	useState,
	useRef,
	useEffect,
	useCallback,
	useMemo,
} from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { dateI18n } from '@wordpress/date';
import { store as noticesStore } from '@wordpress/notices';
import { Button, Notice, SelectControl } from '@wordpress/components';

import { PocketTtsEngine } from './engine/tts-engine';
import { SUPPORTED_LANGUAGES } from './model-source';
import { LANGUAGE_LABELS, languageLabel } from './language-labels';
import { extractSegments } from './extract-segments';
import type { EditorBlock, ResolvedSegment } from './segment';
import { resolveSegments, mergeAdjacent, unknownLanguages } from './segment';
import { computeSegmentHash } from './segment-hash';
import { groupByLanguage, withPrimaryLanguage } from './group-segments';
import { bundleForLocale } from './site-language';
import { cachedBundles } from './bundle-cache-status';
import {
	estimateMultiBundleEta,
	downloadBytesPerSecond,
	requiresLongTextConfirmation,
	shouldWarnSlowDevice,
} from './rtf-calibration';
import {
	hasEnoughStorage,
	formatBytes,
	bytesForBundles,
	LANGUAGE_BUNDLE_BYTES,
	STORAGE_HEADROOM_MULTIPLIER,
} from './storage-check';
import { isWasmSupported } from './environment';
import { encodeMp3 } from './mp3-encoder';
import { deleteNarration, saveNarration } from './narration-api';
import { MiniPlayer } from './mini-player';
import { VOICES, DEFAULT_VOICE, isVoice } from './voice-catalog';
import { DictionaryPanel } from '../../pronunciation/editor/dictionary-panel';
import type { DictionaryEntry } from '../../pronunciation/editor/dictionary-entry';
import { mergeDictionaries } from '../../pronunciation/editor/dictionary-entry';
import { applyDictionary } from '../../pronunciation/editor/apply-dictionary';
import { registerBlockNarrationControls } from './block-narration-attributes';
import { registerInlineLanguageFormat } from './inline-language-format';

import './style.scss';

/**
 * Shown both as the panel's standing warning and as the error thrown if
 * anything reaches the engine anyway. A function, not a constant, so the string
 * is translated when it is rendered rather than when the bundle loads.
 */
const WASM_UNAVAILABLE_MESSAGE = () =>
	__(
		'This browser cannot run WebAssembly, which narration needs. Try another browser, or ask an administrator whether a security policy is blocking it.',
		'post-voice'
	);

type PanelState =
	| 'idle'
	| 'calibrating'
	| 'confirming-long-text'
	| 'generating'
	| 'sampling'
	| 'saving'
	| 'removing'
	| 'error';

interface ExistingNarration {
	url: string;
	generatedAt: string;
}

function NarrationPanel() {
	const [ state, setState ] = useState< PanelState >( 'idle' );
	const [ language, setLanguage ] = useState< string >( () =>
		bundleForLocale( window.postVoiceData?.siteLanguage ?? '' )
	);
	const [ voice, setVoice ] = useState< string >( DEFAULT_VOICE );
	const [ etaSeconds, setEtaSeconds ] = useState< number | null >( null );
	const [ previewUrl, setPreviewUrl ] = useState< string | null >( null );
	const [ error, setError ] = useState< string | null >( null );
	const [ existing, setExisting ] = useState< ExistingNarration | null >(
		null
	);
	const [ isStale, setIsStale ] = useState( false );
	const [ isConfirmingRemoval, setIsConfirmingRemoval ] = useState( false );
	// Lazily, once per mount: the answer cannot change while the editor is open,
	// and computing it at module scope would run in every editor session,
	// including the ones that never open this panel.
	const [ wasmSupported ] = useState( isWasmSupported );
	const [ elapsedSeconds, setElapsedSeconds ] = useState( 0 );
	// Real per-segment completion, reported by the engine once generation is
	// under way. Null before then, when the bar still runs on the elapsed/ETA
	// heuristic below because no segment has finished yet to measure from.
	const [ progress, setProgress ] = useState< number | null >( null );

	const previewBlobRef = useRef< Blob | null >( null );
	// Everything the audio in memory was actually synthesised from. Saving must
	// record *this*, never what the panel currently shows: the author is free to
	// keep typing and to move both selectors while generation runs and while the
	// preview plays, and persisting the later values describes audio that does
	// not exist. The text half of this fixed a stale "up to date" badge; voice
	// and language went the same way for the same reason.
	const generatedWithRef = useRef< {
		segments: ResolvedSegment[];
		voice: string;
		language: string;
		languages: string[];
	} | null >( null );
	// Measured RTF per bundle, filled in as each one warms up. A ref rather than
	// state: it feeds the next ETA calculation, and re-rendering on every
	// measurement would buy nothing.
	const rtfByLanguageRef = useRef< Map< string, number > >( new Map() );
	// Mirrors previewUrl so the unmount cleanup, which runs once and therefore
	// closes over the first render's state, can still revoke the current one.
	const previewUrlRef = useRef< string | null >( null );
	const abortRef = useRef< AbortController | null >( null );
	const savingRef = useRef( false );
	const removingRef = useRef( false );
	// Focused when the inline confirmation opens. Replacing the trigger with an
	// alertdialog left focus on a button that no longer existed, so it fell back
	// to <body>: a keyboard user lost their place and a screen reader announced a
	// dialog with nothing in it focused. The container takes focus rather than a
	// button inside it, which is what makes a screen reader read the dialog out.
	const confirmRef = useRef< HTMLDivElement | null >( null );
	const engineRef = useRef< PocketTtsEngine | null >( null );
	// One `<audio>` reused for every sample, so clicking a second voice stops the
	// first instead of layering two voices on top of each other.
	const sampleAudioRef = useRef< HTMLAudioElement | null >( null );
	// Samples already synthesised, keyed `language:voice`. Comparing voices means
	// going back and forth between the same few — re-synthesising each time would
	// make the second listen as slow as the first for no reason.
	const sampleCacheRef = useRef< Map< string, string > >( new Map() );

	const { postId, postType, blocks, postStatus, meta } = useSelect(
		( select ) => {
			const editor = select( 'core/editor' ) as any;
			return {
				postId: editor.getCurrentPostId() as number,
				postType: editor.getCurrentPostType() as string,
				blocks: (
					select( 'core/block-editor' ) as any
				 ).getBlocks() as EditorBlock[],
				postStatus: editor.getEditedPostAttribute( 'status' ) as string,
				meta: ( editor.getEditedPostAttribute( 'meta' ) ||
					{} ) as Record< string, unknown >,
			};
		},
		[]
	);

	const { createErrorNotice } = useDispatch( noticesStore );
	const { editPost } = useDispatch( editorStore );
	const { receiveEntityRecords } = useDispatch( coreStore );
	// The bound selectors, not a subscription: `useSelect` given a store and no
	// mapping function does not subscribe, and this is only read inside a
	// callback, where it must see current state rather than render-time state.
	const { getEntityRecord, getEntityRecordEdits } = useSelect( coreStore );

	const attachmentId = meta._narration_attachment_id as number | undefined;
	const savedHash = meta._narration_source_hash as string | undefined;
	const savedVoice = meta._narration_voice as string | undefined;
	const savedLanguage = meta._narration_language as string | undefined;
	// Not memoized, unlike `postDictionary` right below: this one is read in JSX
	// only and never reaches a hook's dependency array, so a fresh array literal
	// on the renders where the key is unset costs nothing.
	const savedLanguages = ( meta._narration_languages ?? [] ) as string[];

	// Memoized rather than a plain `?? []`: that fallback is a new array literal
	// on every render whenever the meta key is unset, which changed
	// `buildSegments`'s identity every render too — defeating the 300ms
	// staleness debounce by re-running the parser and the dictionary pass in
	// render on every keystroke, the exact cost the debounce exists to avoid.
	const postDictionary = useMemo(
		() => ( meta._narration_dictionary ?? [] ) as DictionaryEntry[],
		[ meta._narration_dictionary ]
	);

	const setPostDictionary = useCallback(
		( next: DictionaryEntry[] ) => {
			editPost( { meta: { _narration_dictionary: next } } );
		},
		[ editPost ]
	);

	/**
	 * Bring the editor's cached copy of the post in line with narration meta the
	 * plugin's own REST routes just wrote behind its back.
	 *
	 * Those routes do not go through the editor's save flow, so without this
	 * `getEditedPostAttribute( 'meta' )` keeps answering with whatever the post
	 * was *loaded* with for the rest of the session — an empty hash (which makes
	 * the staleness check below short-circuit, so the badge can never turn
	 * again), an empty language list and voice (which render as a bare
	 * "· voice"), and no attachment id (so the card disappears on the next
	 * remount, which happens on every switch to the block inspector).
	 *
	 * `receiveEntityRecords` rather than `editPost`: this updates the *persisted*
	 * record, which is what the server now holds, instead of recording an unsaved
	 * user edit. `editPost` also worked, but it marked the post dirty — the
	 * author got a spurious "Leave site?" prompt straight after a successful
	 * save. Same call core itself makes after persisting an entity record
	 * (`actions.cjs:505,534`), and deliberately with no `query`: the editor reads
	 * its post through `getEntityRecord` with no query too, which is the
	 * `default` context bucket rather than `edit`.
	 *
	 * @param updates Meta keys to overwrite.
	 */
	const syncPersistedMeta = useCallback(
		( updates: Record< string, unknown > ) => {
			const record = getEntityRecord( 'postType', postType, postId ) as
				| ( Record< string, unknown > & {
						meta?: Record< string, unknown >;
				  } )
				| undefined;
			// Absent only if the editor has not finished loading the post, which
			// cannot be the case by the time a narration has been generated from
			// it. Bailing out beats writing a record made only of our own keys.
			if ( ! record ) {
				return;
			}
			receiveEntityRecords( 'postType', postType, {
				...record,
				meta: { ...( record.meta ?? {} ), ...updates },
			} );

			// Received records alone are not enough when the author already has an
			// unsaved meta edit in flight — a half-typed dictionary entry is the
			// realistic one. `getEditedEntityRecord` is `{ ...raw, ...edits }`, a
			// *shallow* spread, and `mergedEdits: { meta: true }` means a meta edit
			// stores the whole meta object as it stood when the edit was made. That
			// snapshot shadows everything just received, so the badge would stay
			// green and the card empty exactly as before.
			//
			// Folding the same keys into that existing edit fixes it, and only when
			// one exists — so a post with nothing pending is still left clean, which
			// is the whole reason for preferring `receiveEntityRecords`. The edit
			// that survives here is the author's own, which genuinely is unsaved.
			const edits = getEntityRecordEdits(
				'postType',
				postType,
				postId
			) as { meta?: Record< string, unknown > } | undefined;
			if ( edits?.meta ) {
				editPost( { meta: updates } );
			}
		},
		[
			editPost,
			getEntityRecord,
			getEntityRecordEdits,
			postId,
			postType,
			receiveEntityRecords,
		]
	);

	const buildSegments = useCallback( () => {
		const dictionary = mergeDictionaries(
			window.postVoiceData?.dictionary ?? [],
			postDictionary
		);
		const resolved = mergeAdjacent(
			resolveSegments( extractSegments( blocks ), language )
		);
		return resolved.map( ( segment ) => ( {
			...segment,
			text: applyDictionary( segment.text, segment.language, dictionary ),
		} ) );
	}, [ blocks, language, postDictionary ] );

	// Reopen the panel on the settings the existing audio was made with, rather
	// than on the defaults. Otherwise the selectors quietly describe a narration
	// nobody generated: an English narration listed as Portuguese, in `alba`
	// whatever voice actually recorded it. Keyed on the meta, so a later manual
	// change by the author stands.
	//
	// Except when *we* are what moved the meta. Before `syncPersistedMeta`
	// existed these two effects only ever ran on mount, because nothing changed
	// the saved voice or language mid-session; now a save does. An author who
	// generates in `alba`, then moves the dropdown to `javert` to audition it
	// while the preview plays, and then hits Save, would watch the dropdown snap
	// back to `alba` under their cursor. The ref records what we wrote so these
	// can tell "the post says alba because it was loaded that way" (adopt it)
	// from "the post says alba because we just saved alba" (leave the author's
	// selection alone). A remount clears it, which is correct: reopening the
	// panel is exactly when the saved settings *should* be adopted again.
	const settingsWrittenByUsRef = useRef< {
		voice?: string;
		language?: string;
	} >( {} );

	useEffect( () => {
		if (
			isVoice( savedVoice ) &&
			savedVoice !== settingsWrittenByUsRef.current.voice
		) {
			setVoice( savedVoice );
		}
	}, [ savedVoice ] );

	useEffect( () => {
		if (
			savedLanguage &&
			savedLanguage !== settingsWrittenByUsRef.current.language &&
			( SUPPORTED_LANGUAGES as readonly string[] ).includes(
				savedLanguage
			)
		) {
			setLanguage( savedLanguage );
		}
	}, [ savedLanguage ] );

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
					setExisting( {
						url: media.source_url,
						generatedAt: media.date_gmt,
					} );
				}
			} )
			.catch( () => {
				// Attachment vanished (deleted straight from the Media Library). The
				// delete_attachment hook clears the meta server-side; nothing to show here.
				if ( ! cancelled ) {
					setExisting( null );
				}
			} );
		return () => {
			cancelled = true;
		};
	}, [ attachmentId ] );

	// Recompute the current text hash and compare against what was saved.
	//
	// Debounced, because `getBlocks()` returns a fresh array on every editor
	// change: undebounced this re-extracted the whole post and ran SHA-256 on
	// every keystroke, and the badge it feeds is a passive hint that nobody
	// reads mid-word. The catch matters as much as the delay — on a plain-HTTP
	// site `crypto.subtle` does not exist, so each keystroke also produced an
	// unhandled rejection. A failed comparison leaves the badge alone rather
	// than claiming freshness it could not verify.
	useEffect( () => {
		// 300ms: `blocks` changes on every keystroke, and this path now runs the
		// parser, the dictionary and the digest. Measured at ~18ms on a 64KB post —
		// small, but not small enough to pay per character.
		let cancelled = false;
		const timer = setTimeout( () => {
			computeSegmentHash( buildSegments() )
				.then( ( hash ) => {
					if ( ! cancelled ) {
						setIsStale(
							Boolean( savedHash ) && hash !== savedHash
						);
					}
				} )
				.catch( () => {} );
		}, 300 );
		return () => {
			cancelled = true;
			clearTimeout( timer );
		};
	}, [ buildSegments, savedHash ] );

	const setPreview = useCallback( ( blob: Blob | null ) => {
		setPreviewUrl( ( previous ) => {
			if ( previous ) {
				URL.revokeObjectURL( previous );
			}
			const next = blob ? URL.createObjectURL( blob ) : null;
			previewUrlRef.current = next;
			return next;
		} );
		previewBlobRef.current = blob;
	}, [] );

	/**
	 * Bring the engine up on the selected language, downloading the model if this
	 * is the first use.
	 *
	 * Shared by generation and by the voice sample: both need a loaded bundle,
	 * both must refuse to start on an insecure origin, and both must warn about
	 * disk space *before* spending ~190MB of bandwidth rather than after.
	 */
	const ensureEngine = useCallback( async (): Promise< PocketTtsEngine > => {
		// The buttons are already disabled without wasm, but disabled buttons are
		// UX, not a guarantee: this path is also reached from the voice sample, and
		// a re-render could land a click before the state settles. Refusing here
		// keeps the failure a sentence instead of an ONNX Runtime stack trace.
		if ( ! wasmSupported ) {
			throw new Error( WASM_UNAVAILABLE_MESSAGE() );
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
		} else {
			// The engine outlives a single generation; the selector does not have
			// to agree with it.
			await engineRef.current.ensureLanguage( language );
		}

		return engineRef.current;
	}, [ language, wasmSupported ] );

	/**
	 * Store a synthesised sample phrase as a playable URL for the current
	 * language/voice pair, and return that URL.
	 *
	 * @param audio      Raw samples from the engine.
	 * @param sampleRate Sample rate the engine reported.
	 */
	const cacheSample = useCallback(
		( audio: Float32Array, sampleRate: number ): string => {
			const key = `${ language }:${ voice }`;
			const existingUrl = sampleCacheRef.current.get( key );
			if ( existingUrl ) {
				return existingUrl;
			}
			const url = URL.createObjectURL( encodeMp3( audio, sampleRate ) );
			sampleCacheRef.current.set( key, url );
			return url;
		},
		[ language, voice ]
	);

	const playSample = useCallback( async () => {
		setError( null );
		try {
			let url = sampleCacheRef.current.get( `${ language }:${ voice }` );
			if ( ! url ) {
				setState( 'sampling' );
				const engine = await ensureEngine();
				url = cacheSample(
					await engine.speakSample( voice ),
					engine.sampleRate
				);
				setState( 'idle' );
			}
			const player = sampleAudioRef.current ?? new Audio();
			sampleAudioRef.current = player;
			player.src = url;
			player.currentTime = 0;
			await player.play();
		} catch ( err ) {
			setState( 'error' );
			setError( ( err as Error ).message );
		}
	}, [ cacheSample, ensureEngine, language, voice ] );

	// The panel is unmounted every time the author closes the sidebar, and
	// nothing it holds is reclaimed on its own. Object URLs outlive the
	// component unless revoked, and a Worker is never garbage collected — it
	// runs until `terminate()` or until the page goes away. Without this, each
	// open → generate → close cycle stranded a worker holding five loaded ONNX
	// sessions, and closing mid-generation left that synthesis running at full
	// CPU with nobody listening for its result.
	useEffect( () => {
		const cache = sampleCacheRef.current;
		return () => {
			sampleAudioRef.current?.pause();
			cache.forEach( ( url ) => URL.revokeObjectURL( url ) );
			cache.clear();
			if ( previewUrlRef.current ) {
				URL.revokeObjectURL( previewUrlRef.current );
				previewUrlRef.current = null;
			}
			abortRef.current?.abort();
			engineRef.current?.dispose();
			engineRef.current = null;
		};
	}, [] );

	const runGeneration = useCallback(
		async ( segments: ResolvedSegment[] ) => {
			setState( 'generating' );
			setProgress( null );
			abortRef.current = new AbortController();
			const audio = await engineRef.current!.generateSegments( segments, {
				voice,
				signal: abortRef.current.signal,
				onProgress: ( done, total ) =>
					setProgress( Math.round( ( done / total ) * 100 ) ),
				onLanguageCalibrated: ( calibratedLanguage, rtf ) => {
					// Replace the borrowed RTF with this bundle's own and re-estimate
					// what is left, so a second bundle that turns out slower than the
					// first stops the countdown from lying for the rest of the run.
					rtfByLanguageRef.current.set( calibratedLanguage, rtf );
					setEtaSeconds(
						estimateMultiBundleEta(
							groupByLanguage( segments ),
							rtfByLanguageRef.current,
							rtf,
							0,
							downloadBytesPerSecond()
						)
					);
				},
			} );
			generatedWithRef.current = {
				segments,
				voice,
				language,
				languages: withPrimaryLanguage(
					language,
					groupByLanguage( segments )
				),
			};
			setPreview( encodeMp3( audio, engineRef.current!.sampleRate ) );
			setState( 'idle' );
		},
		[ language, setPreview, voice ]
	);

	/**
	 * Land a failed generation somewhere the author can act from.
	 *
	 * Shared by every path that can start one, because a rejection escaping any
	 * of them leaves the panel stuck in `generating` with a progress bar still
	 * climbing and no message.
	 */
	const failGeneration = useCallback( ( err: unknown ) => {
		if ( ( err as Error ).name === 'AbortError' ) {
			setState( 'idle' );
			return;
		}
		setState( 'error' );
		setError( ( err as Error ).message );
	}, [] );

	const startGeneration = useCallback( async () => {
		setError( null );
		// Generating unmounts the card the confirmation lives in; leaving the flag
		// set brought it back, already open, when the preview was discarded.
		setIsConfirmingRemoval( false );
		setState( 'calibrating' );
		// A second "Generate again" enters `calibrating` — which counts as
		// `isGenerating` — while `progress` still holds the previous run's 100.
		// Without this the bar renders full, `aria-valuenow={100}`, before the
		// bundle download for this run has even started.
		setProgress( null );
		try {
			const segments = buildSegments();
			const groups = groupByLanguage( segments );
			const cached = await cachedBundles(
				groups.map( ( group ) => group.language )
			);
			const pending = groups.length - cached.size;
			// `navigator.storage?.estimate`, not `navigator.storage.estimate`:
			// the Storage API is optional, and `ensureEngine` below has always
			// treated it that way. Reading it unguarded here made the first
			// generation on a browser without it die with a raw `TypeError`,
			// shown verbatim to the author by `failGeneration` — a browser Fase 1
			// merely could not pre-check on, Fase 2 could not generate on at all.
			// Absent, the check is skipped: an unenforceable guard is not a
			// reason to refuse work the browser can still do.
			if ( pending > 0 && navigator.storage?.estimate ) {
				const estimate = await navigator.storage.estimate();
				if (
					! hasEnoughStorage( estimate, bytesForBundles( pending ) )
				) {
					throw new Error(
						sprintf(
							/* translators: 1: required free space, e.g. "600 MB"; 2: comma-separated language names. */
							__(
								'Not enough free space: this narration needs %1$s for the language models it still has to download (%2$s).',
								'post-voice'
							),
							formatBytes(
								bytesForBundles( pending ) *
									STORAGE_HEADROOM_MULTIPLIER
							),
							groups
								.map( ( group ) => group.language )
								.filter(
									( groupLanguage ) =>
										! cached.has( groupLanguage )
								)
								.map( languageLabel )
								.join( ', ' )
						)
					);
				}
			}

			const engine = await ensureEngine();

			const { rtf, audio } = await engine.calibrate( voice );
			// The warm-up spoke this bundle's sample phrase in the voice about to
			// be used, so it is exactly what the sample button would synthesise.
			// Keep it instead of discarding it.
			cacheSample( audio, engine.sampleRate );
			// rtf === 0 means the warm-up produced no measurable audio. Treat that as
			// "unmeasured", not "instant" — otherwise a broken calibration looks like a
			// blazing-fast device and every guard below silently stops firing.
			if ( rtf > 0 ) {
				rtfByLanguageRef.current.set( language, rtf );
			}
			// Re-checked rather than reusing `pending`: `ensureEngine()` just spent
			// however long it took to download the selected language's bundle (if it
			// was not cached already), so counting it as still-pending here would add
			// its download time to the estimate a second time — once for the seconds
			// that already elapsed inside `ensureEngine()`, and once more for a
			// download that already finished.
			const stillPending =
				pending > 0
					? groups.length -
					  (
							await cachedBundles(
								groups.map( ( group ) => group.language )
							)
					  ).size
					: 0;
			const eta =
				rtf > 0
					? estimateMultiBundleEta(
							groups,
							rtfByLanguageRef.current,
							rtf,
							stillPending,
							downloadBytesPerSecond()
					  )
					: null;
			setEtaSeconds( eta );

			if ( eta !== null && requiresLongTextConfirmation( eta ) ) {
				setState( 'confirming-long-text' );
				return;
			}

			if ( rtf > 0 && shouldWarnSlowDevice( rtf ) ) {
				createErrorNotice(
					__(
						'This device is slower than usual for narration — it may take a while.',
						'post-voice'
					),
					{ type: 'snackbar' }
				);
			}

			await runGeneration( segments );
		} catch ( err ) {
			failGeneration( err );
		}
	}, [
		buildSegments,
		cacheSample,
		createErrorNotice,
		ensureEngine,
		failGeneration,
		language,
		runGeneration,
		voice,
	] );

	/**
	 * Generate after the author accepted the long-text warning.
	 *
	 * Its own callback rather than an inline arrow, so the rejection lands in
	 * `failGeneration` like every other path. Inline, a worker error here left
	 * the panel generating forever and cancelling logged an unhandled AbortError.
	 */
	const generateAfterConfirmation = useCallback( async () => {
		setError( null );
		try {
			await runGeneration( buildSegments() );
		} catch ( err ) {
			failGeneration( err );
		}
	}, [ buildSegments, failGeneration, runGeneration ] );

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

	const discardPreview = useCallback( () => {
		// Nothing was persisted, so there is nothing to confirm away — the spec is
		// explicit that an unsaved preview is dropped silently. Clearing the blob
		// also revokes its object URL, and clearing the narrated text keeps a later
		// save from hashing audio that no longer exists.
		setPreview( null );
		generatedWithRef.current = null;
		setState( 'idle' );
	}, [ setPreview ] );

	const confirmSave = useCallback( async () => {
		const blob = previewBlobRef.current;
		// A ref, not the `saving` state: two clicks landing in the same JavaScript
		// task both run this handler before React has re-rendered and unmounted the
		// button, so `state` is still 'idle' for the second one. That uploaded the
		// same audio twice, and neither request could delete the other's
		// attachment — the post was left with two audio files. Reproduced with two
		// synchronous clicks; a fast enough double-click does the same.
		if ( ! blob || savingRef.current ) {
			return;
		}
		savingRef.current = true;
		setState( 'saving' );
		try {
			// What the audio was made from, captured in runGeneration — never what
			// the panel shows now. Both selectors stay live during preview, so an
			// author comparing voices while listening would otherwise persist
			// `javert`/`spanish` against audio recorded in `alba`/`portuguese`, and
			// the frontend trusts that meta.
			const generated = generatedWithRef.current;
			const segments = generated?.segments ?? buildSegments();
			const sourceHash = await computeSegmentHash( segments );
			const saved = await saveNarration(
				postId,
				blob,
				generated?.language ?? language,
				generated?.languages ?? [ language ],
				generated?.voice ?? voice,
				sourceHash
			);
			setPreview( null );
			setExisting( { url: saved.url, generatedAt: saved.generated_at } );
			// What the server now holds, pushed into the editor's cached copy of
			// the post so the badge, the status card and the attachment loader stop
			// describing the post as it was loaded. See `syncPersistedMeta`.
			//
			// Recorded before the write, not after: the two effects that adopt the
			// saved voice and language have to be able to tell this change from a
			// freshly loaded post, and they run as soon as the meta moves.
			settingsWrittenByUsRef.current = {
				voice: saved.voice,
				language: saved.language,
			};
			syncPersistedMeta( {
				_narration_attachment_id: saved.attachment_id,
				_narration_language: saved.language,
				_narration_languages: saved.languages,
				_narration_voice: saved.voice,
				_narration_source_hash: sourceHash,
			} );
			// Not necessarily up to date: if the author edited while generation ran,
			// the audio just saved is already behind the editor's text.
			setIsStale(
				sourceHash !== ( await computeSegmentHash( buildSegments() ) )
			);
			setState( 'idle' );
		} catch ( err ) {
			setState( 'error' );
			setError( ( err as Error ).message );
		} finally {
			savingRef.current = false;
		}
	}, [
		buildSegments,
		language,
		postId,
		setPreview,
		syncPersistedMeta,
		voice,
	] );

	const removeNarration = useCallback( async () => {
		// Same guard, same reason as saving: two clicks in one JavaScript task
		// both run this before React re-renders. The second DELETE found nothing
		// left and answered 404, so a removal that worked ended in a red error.
		if ( removingRef.current ) {
			return;
		}
		removingRef.current = true;
		setError( null );
		setState( 'removing' );
		try {
			await deleteNarration( postId );
			setIsConfirmingRemoval( false );
			// The server cleared this meta; the editor's cached copy would
			// otherwise keep naming an attachment that no longer exists, and the
			// panel would fetch it again on its next remount. Same reason as the
			// call in `confirmSave` — the DELETE never went through the editor's
			// save flow, so nothing else tells it.
			syncPersistedMeta( {
				_narration_attachment_id: 0,
				_narration_language: '',
				_narration_languages: [],
				_narration_voice: '',
				_narration_source_hash: '',
			} );
			setExisting( null );
			setIsStale( false );
			setState( 'idle' );
		} catch ( err ) {
			setIsConfirmingRemoval( false );
			setState( 'error' );
			setError( ( err as Error ).message );
		} finally {
			removingRef.current = false;
		}
	}, [ postId, syncPersistedMeta ] );

	// Escape backs out of the confirmation. It lives on the buttons rather than on
	// the alertdialog wrapper because that wrapper is a plain div — jsx-a11y is
	// right that key handlers do not belong there — and focus is on one of these
	// two the whole time the confirmation is open.
	const cancelRemovalOnEscape = useCallback( ( event: { key: string } ) => {
		if ( event.key === 'Escape' ) {
			setIsConfirmingRemoval( false );
		}
	}, [] );

	// Focus follows the confirmation, which replaced the button that opened it.
	// Without this, focus sat on an unmounted button and fell back to <body>: a
	// keyboard user loses their place, and a screen reader announces an
	// alertdialog with nothing inside it focused.
	useEffect( () => {
		if ( ! isConfirmingRemoval ) {
			return;
		}
		// One frame late, deliberately. Focusing straight from the effect loses a
		// race with the editor, which restores focus of its own accord after the
		// click that unmounted the trigger — the call runs, and focus is on <body>
		// a tick later anyway.
		const frame = window.requestAnimationFrame(
			() => confirmRef.current?.focus()
		);
		return () => window.cancelAnimationFrame( frame );
	}, [ isConfirmingRemoval ] );

	// Elapsed-time ticker for the generating state's countdown. The mockup shows a
	// determinate bar and "~Ns remaining", and the RTF calibration exists precisely
	// to make that estimate; the worker itself reports no progress.
	useEffect( () => {
		if ( state !== 'generating' ) {
			setElapsedSeconds( 0 );
			return;
		}
		const startedAt = Date.now();
		const timer = setInterval(
			() => setElapsedSeconds( ( Date.now() - startedAt ) / 1000 ),
			250
		);
		return () => clearInterval( timer );
	}, [ state ] );

	const segmentCount = useMemo(
		() => buildSegments().length,
		[ buildSegments ]
	);
	const hasNothingToNarrate = segmentCount === 0;
	const unknown = useMemo(
		() => unknownLanguages( extractSegments( blocks ) ),
		[ blocks ]
	);

	const isAutoDraft = postStatus === 'auto-draft';
	const isSampling = state === 'sampling';
	// Sampling is deliberately not "busy": it must not tear down the panel around
	// the author. The selectors stay on screen and merely go inert, so the voice
	// they just clicked is still visible while its sample is being synthesised.
	// `removing` is excluded for the same reason as sampling: tearing the card
	// off screen mid-request would take the confirmation the author just used
	// with it, leaving an empty panel and no sign that anything is happening.
	const isRemoving = state === 'removing';
	const isBusy =
		state !== 'idle' && state !== 'error' && ! isSampling && ! isRemoving;
	const isGenerating = state === 'generating' || state === 'calibrating';
	// Nothing has been downloaded yet, so the first sample pays for the model.
	const needsModelDownload = ! engineRef.current;

	// The real per-segment count, once the engine has reported one, beats the
	// elapsed/ETA guess — it is measured, not estimated. Clamp the guess short
	// of complete: finishing the bar before the audio arrives would claim the
	// work is done when it is not.
	const progressPercent =
		progress ??
		( etaSeconds && etaSeconds > 0
			? Math.min( 95, ( elapsedSeconds / etaSeconds ) * 100 )
			: null );
	const remainingSeconds =
		etaSeconds !== null ? Math.max( 0, etaSeconds - elapsedSeconds ) : null;

	return (
		<>
			<PluginSidebarMoreMenuItem target="post-voice-panel">
				{ __( 'Narration', 'post-voice' ) }
			</PluginSidebarMoreMenuItem>
			<PluginSidebar
				name="post-voice-panel"
				title={ __( 'Narration', 'post-voice' ) }
				icon="microphone"
			>
				<div className="post-voice-panel">
					{ error && (
						// role="alert" on a wrapper rather than relying on Notice:
						// the component styles the message but does not itself
						// claim a live region, and an error raised by the author's
						// own click has to be announced, not merely drawn.
						<div role="alert">
							<Notice status="error" isDismissible={ false }>
								{ error }
							</Notice>
						</div>
					) }

					{ ! wasmSupported && (
						<Notice status="warning" isDismissible={ false }>
							{ WASM_UNAVAILABLE_MESSAGE() }
						</Notice>
					) }

					{ isAutoDraft && (
						<Notice status="warning" isDismissible={ false }>
							{ __(
								'Save the post first to generate narration.',
								'post-voice'
							) }
						</Notice>
					) }

					{ unknown.length > 0 && (
						<Notice status="warning" isDismissible={ false }>
							{ sprintf(
								/* translators: %s: comma-separated list of unrecognised language codes. */
								__(
									'This post marks a language this version does not support (%s). Those parts will be narrated in the post language.',
									'post-voice'
								),
								unknown.join( ', ' )
							) }
						</Notice>
					) }

					{ isGenerating && (
						<div className="post-voice-panel__card">
							<p className="post-voice-panel__generating-label">
								{ state === 'calibrating'
									? __( 'Preparing…', 'post-voice' )
									: __(
											'Synthesising audio…',
											'post-voice'
									  ) }
							</p>
							<div
								className="post-voice-panel__progress"
								role="progressbar"
								aria-label={ __(
									'Narration generation progress',
									'post-voice'
								) }
								aria-valuemin={ 0 }
								aria-valuemax={ 100 }
								aria-valuenow={
									progressPercent === null
										? undefined
										: Math.round( progressPercent )
								}
							>
								<div
									className={
										progressPercent === null
											? 'post-voice-panel__progress-fill is-indeterminate'
											: 'post-voice-panel__progress-fill'
									}
									style={
										progressPercent === null
											? undefined
											: { width: `${ progressPercent }%` }
									}
								/>
							</div>
							{ remainingSeconds !== null && (
								<p className="post-voice-panel__hint">
									{ sprintf(
										/* translators: %d: seconds remaining until narration is ready. */
										__( '~%ds remaining', 'post-voice' ),
										Math.ceil( remainingSeconds )
									) }
								</p>
							) }
							<Button variant="link" onClick={ cancelGeneration }>
								{ __( 'Cancel', 'post-voice' ) }
							</Button>
						</div>
					) }

					{ state === 'confirming-long-text' && (
						<div className="post-voice-panel__card">
							<p>
								{ sprintf(
									/* translators: %d: estimated generation time in seconds. */
									__(
										'This text is long — estimated time: %d seconds.',
										'post-voice'
									),
									Math.round( etaSeconds ?? 0 )
								) }
							</p>
							<div className="post-voice-panel__actions">
								<Button
									variant="primary"
									onClick={ generateAfterConfirmation }
								>
									{ __( 'Generate anyway', 'post-voice' ) }
								</Button>
								<Button
									variant="tertiary"
									onClick={ () => setState( 'idle' ) }
								>
									{ __( 'Cancel', 'post-voice' ) }
								</Button>
							</div>
						</div>
					) }

					{ previewUrl && ! isBusy && (
						<div className="post-voice-panel__card">
							<p className="post-voice-panel__card-heading">
								{ __( 'Preview', 'post-voice' ) }
							</p>
							<MiniPlayer src={ previewUrl } />
							<div className="post-voice-panel__actions">
								<Button
									variant="primary"
									onClick={ confirmSave }
								>
									{ __( 'Save narration', 'post-voice' ) }
								</Button>
								<Button
									variant="tertiary"
									onClick={ discardPreview }
								>
									{ __( 'Discard', 'post-voice' ) }
								</Button>
							</div>
						</div>
					) }

					{ existing && ! previewUrl && ! isBusy && (
						<div className="post-voice-panel__card">
							<div className="post-voice-panel__status">
								<span className="post-voice-panel__generated-at">
									{ sprintf(
										/* translators: %s: date and time the narration was generated. */
										__( 'Generated on %s', 'post-voice' ),
										dateI18n(
											'j M, H:i',
											existing.generatedAt
										)
									) }
								</span>
								<span
									className={
										isStale
											? 'post-voice-panel__badge is-stale'
											: 'post-voice-panel__badge is-current'
									}
								>
									{ isStale
										? __(
												'⚠ May be out of date',
												'post-voice'
										  )
										: __( 'Up to date', 'post-voice' ) }
								</span>
							</div>
							<p className="post-voice-panel__languages">
								{ sprintf(
									/* translators: 1: languages used, e.g. "Português + English"; 2: voice name. */
									__( '%1$s · voice %2$s', 'post-voice' ),
									// `||`, not `??`: `_narration_languages` is
									// registered with a `default` of `array()`, and
									// `_narration_voice` answers `''` when unset.
									// What arrives is empty-but-present, so a
									// nullish fallback never fires and the line
									// rendered as a bare "· voice".
									( savedLanguages.length
										? savedLanguages
										: [ savedLanguage || language ]
									)
										.map( languageLabel )
										.join( ' + ' ),
									savedVoice || voice
								) }
							</p>
							<MiniPlayer src={ existing.url } />

							{ /*
							 * Inside the card, because it acts on the audio the card
							 * describes — the approved variant C. Text rather than a
							 * trash icon: the label is what makes it findable, by eye
							 * and by screen reader alike.
							 */ }
							{ ! isConfirmingRemoval && (
								<div className="post-voice-panel__card-actions">
									<Button
										variant="link"
										isDestructive
										onClick={ () =>
											setIsConfirmingRemoval( true )
										}
									>
										{ __( 'Remove', 'post-voice' ) }
									</Button>
								</div>
							) }

							{ /*
							 * Confirmed in place rather than through a modal. Unlike
							 * discarding an unsaved preview, this destroys a file and
							 * takes the player off the site for readers, so it asks —
							 * but a ConfirmDialog would dim the whole editor for an
							 * action scoped to one post.
							 */ }
							{ isConfirmingRemoval && (
								<div
									ref={ confirmRef }
									tabIndex={ -1 }
									className="post-voice-panel__confirm"
									role="alertdialog"
									aria-label={ __(
										'Remove narration?',
										'post-voice'
									) }
								>
									<p className="post-voice-panel__confirm-text">
										{ __(
											'Remove this narration? The audio file leaves the Media Library and the player disappears from the site.',
											'post-voice'
										) }
									</p>
									<div className="post-voice-panel__actions">
										<Button
											onKeyDown={ cancelRemovalOnEscape }
											variant="primary"
											isDestructive
											isBusy={ isRemoving }
											disabled={ isRemoving }
											onClick={ removeNarration }
										>
											{ __( 'Remove', 'post-voice' ) }
										</Button>
										<Button
											variant="tertiary"
											onKeyDown={ cancelRemovalOnEscape }
											disabled={ isRemoving }
											onClick={ () =>
												setIsConfirmingRemoval( false )
											}
										>
											{ __( 'Cancel', 'post-voice' ) }
										</Button>
									</div>
								</div>
							) }
						</div>
					) }

					{ ! existing &&
						! previewUrl &&
						! isBusy &&
						! isAutoDraft && (
							<p className="post-voice-panel__hint">
								{ __(
									'No audio generated yet.',
									'post-voice'
								) }
							</p>
						) }

					<DictionaryPanel
						entries={ postDictionary }
						defaultLanguage={ language }
						onChange={ setPostDictionary }
						settingsUrl={
							window.postVoiceData?.canManageOptions
								? 'options-general.php?page=post-voice'
								: null
						}
					/>

					{ ! isBusy && (
						<>
							<SelectControl
								__nextHasNoMarginBottom
								label={ __( 'Language', 'post-voice' ) }
								value={ language }
								disabled={ isSampling }
								options={ SUPPORTED_LANGUAGES.map(
									( lang ) => ( {
										label: LANGUAGE_LABELS[ lang ] ?? lang,
										value: lang as string,
									} )
								) }
								onChange={ ( next ) => setLanguage( next ) }
							/>

							<div className="post-voice-panel__voice">
								<SelectControl
									__nextHasNoMarginBottom
									label={ __( 'Voice', 'post-voice' ) }
									value={ voice }
									disabled={ isSampling }
									options={ VOICES.map( ( name ) => ( {
										label: name,
										value: name as string,
									} ) ) }
									onChange={ ( next ) => setVoice( next ) }
								/>
								<Button
									className="post-voice-panel__sample"
									icon={
										isSampling ? undefined : 'controls-play'
									}
									isBusy={ isSampling }
									disabled={ isSampling || ! wasmSupported }
									onClick={ playSample }
									label={ sprintf(
										/* translators: %s: voice name, e.g. "alba". */
										__(
											'Hear a sample of %s',
											'post-voice'
										),
										voice
									) }
									showTooltip
								/>
							</div>

							{ needsModelDownload && (
								<p className="post-voice-panel__hint">
									{ sprintf(
										/* translators: %s: model download size, e.g. "190 MB". */
										__(
											'The first sample downloads the voice model (about %s). After that, samples play in a couple of seconds.',
											'post-voice'
										),
										formatBytes( LANGUAGE_BUNDLE_BYTES )
									) }
								</p>
							) }
						</>
					) }

					{ /*
					 * Available during preview too. Regenerating before saving is an
					 * explicitly supported path — the spec has the previous blob
					 * discarded silently, since nothing was persisted — and hiding
					 * this button left "Save narration" as the only way out of the
					 * preview state.
					 */ }
					{ ! isBusy && (
						<>
							<Button
								variant={
									isStale && existing && ! previewUrl
										? 'primary'
										: 'secondary'
								}
								onClick={ startGeneration }
								disabled={
									isAutoDraft ||
									isSampling ||
									! wasmSupported ||
									hasNothingToNarrate
								}
								__next40pxDefaultSize
							>
								{ existing || previewUrl
									? __( 'Generate again', 'post-voice' )
									: __( 'Generate audio', 'post-voice' ) }
							</Button>
							{ hasNothingToNarrate && (
								<p className="post-voice-panel__hint">
									{ __(
										'Nothing to narrate yet: every block is either excluded from the narration or of a type that is never read aloud.',
										'post-voice'
									) }
								</p>
							) }
							{ isStale && existing && ! previewUrl && (
								<p className="post-voice-panel__hint">
									{ __(
										'The post text changed since the last generation.',
										'post-voice'
									) }
								</p>
							) }
						</>
					) }
				</div>
			</PluginSidebar>
		</>
	);
}

registerPlugin( 'post-voice', { render: NarrationPanel, icon: 'microphone' } );
registerBlockNarrationControls();
registerInlineLanguageFormat();
