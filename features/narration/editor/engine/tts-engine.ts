import { computeRtf } from '../rtf-calibration';
import { sampleTextFor } from '../voice-catalog';
import { groupByLanguage, reassemble } from '../group-segments';
import type { ResolvedSegment } from '../segment';

/** Silence inserted between consecutive segments, in seconds. */
export const SEGMENT_GAP_SECONDS = 0.12;

export interface GenerateOptions {
	/**
	 * Predefined voice name. Omit to use whatever voice the loaded bundle
	 * reports as its default. Do NOT pass a made-up name like 'default' —
	 * the worker throws `Unknown built-in voice` for anything not in the
	 * bundle's `predefined_voices` list (which is: alba, azelma, cosette,
	 * eponine, fantine, javert, jean, marius).
	 */
	voice?: string;
	signal?: AbortSignal;
}

export interface GenerateSegmentsOptions extends GenerateOptions {
	/** Called after each segment finishes, for the panel's progress bar. */
	onProgress?: ( done: number, total: number ) => void;
	/**
	 * Called once per language, right after its bundle is warmed up.
	 *
	 * The RTF of a bundle cannot be known before it is loaded, so the panel's
	 * first ETA covers the second language with the first one's number. This is
	 * how it replaces that guess with a measurement, mid-generation.
	 */
	onLanguageCalibrated?: ( language: string, rtf: number ) => void;
}

export interface CalibrationResult {
	rtf: number;
	/** The warm-up audio itself — the bundle's sample phrase, ready to play. */
	audio: Float32Array;
}

/**
 * Constructs the narration Worker from a `blob:` URL instead of pointing
 * straight at its own script, and as a classic (non-module) script — both
 * load-bearing, confirmed empirically, see
 * docs/superpowers/specs/2026-08-21-narration-worker-cross-origin-isolation-design.md:
 *
 * - `blob:`: the post editor sends COOP/COEP (`Post_Voice_Editor_Headers`),
 *   which makes this document `crossOriginIsolated`. A cross-origin-isolated
 *   document requires a Worker's own script response to also carry a COEP
 *   header for `new Worker()` to succeed — and this script is served by
 *   Apache as a plain static file, which never runs through WordPress/PHP
 *   and therefore never gets one. Fetching the same file ourselves and
 *   constructing the Worker from a same-origin `blob:` of its contents
 *   sidesteps that requirement without touching the server at all — it is
 *   the exact same bytes the browser would have loaded directly.
 * - Classic, not module: `onnxruntime-web`'s threaded WASM backend calls
 *   `importScripts()` during initialisation, an API module-type workers do
 *   not support at all, in any version (confirmed against 1.20.0, the
 *   version pinned in this worker, and the latest release at investigation
 *   time). This worker's own code only needed `{ type: 'module' }` for its
 *   own static `import`s, which webpack bundles into a plain classic script
 *   just as well when the option is omitted.
 *
 * The object URL is revoked immediately after construction — confirmed
 * empirically that this does not break anything (the browser has already
 * captured the Blob's contents by the time `new Worker()` returns); without
 * it, every call (and every retry) leaks one Blob reference for the rest of
 * the page's life.
 */
// eslint-disable-next-line camelcase, no-undef
declare const __webpack_public_path__: string;

async function createNarrationWorker(): Promise< Worker > {
	// eslint-disable-next-line camelcase
	const scriptUrl = __webpack_public_path__ + 'pocket-tts-worker.js';
	const code = await ( await fetch( scriptUrl ) ).text();
	const blobUrl = URL.createObjectURL(
		new Blob( [ code ], { type: 'text/javascript' } )
	);
	const worker = new Worker( blobUrl );
	URL.revokeObjectURL( blobUrl );
	return worker;
}

export class PocketTtsEngine {
	private worker: Worker | null = null;
	private ready = false;
	private defaultVoice: string | null = null;
	// Remembered so calibration can speak the loaded bundle's own language. It
	// used to warm up on a hardcoded Portuguese sentence regardless of bundle,
	// which was invisible while the warm-up audio was thrown away — and became
	// audible the moment the same audio started doubling as the voice sample.
	private language: string = 'english_2026-04';
	// Every RTF this engine has actually measured, keyed by the bundle and the
	// voice it was measured with. A warm-up is a full synthesis of the sample
	// phrase — seconds of dead time — and both the panel and `generateSegments`
	// want the number for the same bundle in the same generation. Without this
	// the common single-language post paid for two, one of them entirely
	// redundant, on every click of Generate.
	//
	// Keyed by voice as well as language because the author can change the voice
	// between two generations on a live engine, and the measurement is only
	// honestly reusable for the pair it was taken from.
	private readonly rtfByLanguage = new Map< string, number >();
	public sampleRate = 24000;
	// Set by `load()`'s retry (see below) when the first, multi-thread
	// attempt failed and the second, single-threaded one succeeded — so the
	// caller can tell the author generation is running slower than the
	// device would otherwise support.
	public usedSingleThreadFallback = false;

	async load( language: string ): Promise< void > {
		this.language = language;
		try {
			await this.loadWorkerAndLanguage( language, false );
		} catch ( err ) {
			// A multi-thread attempt can fail for a browser-specific reason
			// unrelated to whether crossOriginIsolated is on at all — that case
			// already runs single-thread from the start, inside loadOrt(). An
			// untested browser's own WASM-threading bug is exactly the case
			// this retries for. Retrying when isolation was never on would just
			// repeat the same single-threaded attempt, so it isn't worth doing.
			// Retries on ANY failure (network, parse, threading), not just ones
			// that look threading-related — matching on error messages reliably
			// is not possible across onnxruntime-web versions, and the cost of
			// one unnecessary retry (a few seconds) is cheap. See
			// docs/superpowers/specs/2026-08-21-narration-worker-cross-origin-isolation-design.md,
			// "Achado 4" — deliberately scoped to this first load only, not a
			// later, independent `setLanguage()` call (see that section for why).
			if ( ! self.crossOriginIsolated ) {
				throw err;
			}
			this.worker?.terminate();
			this.worker = null;
			await this.loadWorkerAndLanguage( language, true );
			this.usedSingleThreadFallback = true;
		}
	}

	/**
	 * Constructs the Worker, waits for the default bundle to finish loading,
	 * then switches to `language` if it isn't the default — the whole
	 * first-load sequence `load()`'s retry redoes as one unit.
	 *
	 * @param language          Model bundle identifier.
	 * @param forceSingleThread Skip the worker's own crossOriginIsolated
	 *                          check and run single-threaded regardless — set
	 *                          only by `load()`'s retry, on the second attempt.
	 */
	private async loadWorkerAndLanguage(
		language: string,
		forceSingleThread: boolean
	): Promise< void > {
		this.worker = await createNarrationWorker();

		await new Promise< void >( ( resolve, reject ) => {
			if ( ! this.worker ) {
				return reject( new Error( 'Worker not created' ) );
			}
			const cleanup = () => {
				this.worker?.removeEventListener( 'message', onMessage );
				this.worker?.removeEventListener( 'error', onError );
			};
			const onMessage = ( e: MessageEvent ) => {
				const { type, sampleRate, error, defaultVoice } = e.data;
				if ( type === 'voices_loaded' ) {
					// The worker picks the bundle's default voice itself; remember it so
					// callers never have to name one.
					this.defaultVoice = defaultVoice ?? null;
				} else if ( type === 'bundle_loaded' ) {
					// `sampleRate` rides on `bundle_loaded`, never on `loaded` — reading it
					// off the wrong message leaves the hardcoded default in place forever,
					// which would silently mis-scale RTF and produce wrong-pitch MP3s if a
					// bundle ever shipped at something other than 24kHz.
					if ( sampleRate ) {
						this.sampleRate = sampleRate;
					}
				} else if ( type === 'loaded' ) {
					this.ready = true;
					cleanup();
					resolve();
				} else if ( type === 'error' ) {
					cleanup();
					reject( new Error( error ) );
				}
			};
			// Without this, a Worker that fails after construction (a corrupt
			// fetch, a future regression reintroducing the classic-vs-module
			// incompatibility this file works around) never posts any message
			// at all — this Promise hung forever and "Preparing…" never became
			// a visible error. See the spec's "Achado 1" for how this was found.
			const onError = ( event: ErrorEvent ) => {
				cleanup();
				reject(
					new Error( event.message || 'Worker failed to start' )
				);
			};
			this.worker.addEventListener( 'message', onMessage );
			this.worker.addEventListener( 'error', onError );
			this.worker.postMessage( {
				type: 'load',
				data: { forceSingleThread },
			} );
		} );

		if ( language !== 'english_2026-04' ) {
			await this.setLanguage( language );
		}
	}

	/**
	 * Switch the loaded bundle, or do nothing if it is already the one loaded.
	 *
	 * Callers must run this before every generation. The engine instance
	 * outlives any single generation — it is kept alive precisely so the model
	 * is not re-fetched — so an author who changes the Language selector between
	 * two generations would otherwise get the second one synthesised by the
	 * first one's bundle, with no error anywhere.
	 *
	 * @param language Model bundle identifier.
	 */
	async ensureLanguage( language: string ): Promise< void > {
		if ( language === this.language ) {
			return;
		}
		await this.setLanguage( language );
		this.language = language;
	}

	private setLanguage( language: string ): Promise< void > {
		return new Promise( ( resolve, reject ) => {
			if ( ! this.worker ) {
				return reject( new Error( 'Engine not loaded' ) );
			}
			const cleanup = () => {
				this.worker?.removeEventListener( 'message', onMessage );
				this.worker?.removeEventListener( 'error', onError );
			};
			const onMessage = ( e: MessageEvent ) => {
				if ( e.data.type === 'voices_loaded' ) {
					this.defaultVoice =
						e.data.defaultVoice ?? this.defaultVoice;
				} else if ( e.data.type === 'bundle_loaded' ) {
					if ( e.data.sampleRate ) {
						this.sampleRate = e.data.sampleRate;
					}
					cleanup();
					resolve();
				} else if ( e.data.type === 'error' ) {
					cleanup();
					reject( new Error( e.data.error ) );
				}
			};
			const onError = ( event: ErrorEvent ) => {
				cleanup();
				reject(
					new Error( event.message || 'Worker failed to start' )
				);
			};
			this.worker.addEventListener( 'message', onMessage );
			this.worker.addEventListener( 'error', onError );
			this.worker.postMessage( {
				type: 'set_language',
				data: { language },
			} );
		} );
	}

	/**
	 * Synthesise the bundle's sample phrase in a given voice.
	 *
	 * Short, fixed text — see `SAMPLE_TEXTS` for why it is per-bundle and not
	 * translated — so the caller can play it back as a preview of the voice
	 * without generating the whole post.
	 *
	 * @param voice Predefined voice name; omitted means the bundle's default.
	 */
	speakSample( voice?: string ): Promise< Float32Array > {
		return this.generate( sampleTextFor( this.language ), { voice } );
	}

	/**
	 * Measure this device's real-time factor by synthesising the sample phrase.
	 *
	 * Returns the audio as well as the RTF: it is the same phrase the sample
	 * button plays, in the same voice, so the caller can hand it to the author
	 * instead of throwing away a perfectly good few seconds of speech.
	 *
	 * @param voice Voice to warm up with — pass the one that will be generated.
	 */
	async calibrate( voice?: string ): Promise< CalibrationResult > {
		const start = performance.now();
		const audio = await this.speakSample( voice );
		const elapsedMs = performance.now() - start;
		// Measure the audio we actually produced rather than guessing its length
		// from character count — the samples are right here, and a guess would bias
		// every ETA derived from this RTF.
		const audioDurationSec = audio.length / this.sampleRate;
		const rtf = computeRtf( audioDurationSec, elapsedMs );
		// Only a real measurement is remembered. `computeRtf` answers 0 for a
		// warm-up that produced nothing measurable, and memoizing that would make
		// every later caller skip the warm-up and read back "unmeasured" forever.
		if ( rtf > 0 ) {
			this.rtfByLanguage.set( rtfKey( this.language, voice ), rtf );
		}
		return { rtf, audio };
	}

	generate(
		text: string,
		options: GenerateOptions
	): Promise< Float32Array > {
		return new Promise( ( resolve, reject ) => {
			if ( ! this.worker || ! this.ready ) {
				return reject( new Error( 'Engine not loaded' ) );
			}

			const chunks: Float32Array[] = [];

			const cleanup = () => {
				this.worker?.removeEventListener( 'message', onMessage );
				this.worker?.removeEventListener( 'error', onError );
				options.signal?.removeEventListener( 'abort', onAbort );
			};

			const onAbort = () => {
				this.worker?.postMessage( { type: 'stop' } );
				cleanup();
				reject(
					new DOMException( 'Generation cancelled', 'AbortError' )
				);
			};
			options.signal?.addEventListener( 'abort', onAbort, {
				once: true,
			} );

			const onMessage = ( e: MessageEvent ) => {
				const { type, data, error } = e.data;
				if ( type === 'audio_chunk' ) {
					chunks.push( new Float32Array( data ) );
				} else if ( type === 'stream_ended' ) {
					cleanup();
					resolve( concatFloat32( chunks ) );
				} else if ( type === 'error' ) {
					cleanup();
					reject( new Error( error ) );
				}
			};
			const onError = ( event: ErrorEvent ) => {
				cleanup();
				reject(
					new Error(
						event.message || 'Worker crashed during generation'
					)
				);
			};

			this.worker.addEventListener( 'message', onMessage );
			this.worker.addEventListener( 'error', onError );
			this.worker.postMessage( {
				type: 'generate',
				data: { text, voice: options.voice ?? this.defaultVoice },
			} );
		} );
	}

	/**
	 * Synthesise a multi-language narration as a single buffer.
	 *
	 * Loads one bundle per language rather than one per segment: `ensureLanguage`
	 * tears down and rebuilds the ONNX sessions, which costs seconds, and a post
	 * that alternates languages ten times would pay that ten times.
	 *
	 * @param segments Resolved segments in document order.
	 * @param options  Voice, abort signal and progress callback.
	 */
	async generateSegments(
		segments: ResolvedSegment[],
		options: GenerateSegmentsOptions
	): Promise< Float32Array > {
		if ( segments.length === 0 ) {
			throw new Error( 'No segments to narrate' );
		}

		const groups = groupByLanguage( segments );
		const parts: Array< { index: number; audio: Float32Array } > = [];
		let done = 0;

		for ( const group of groups ) {
			// Abort between groups as well as inside generate(): loading a bundle is
			// the longest uninterruptible step, and starting one the author already
			// cancelled would hold the editor for seconds with nothing to show.
			if ( options.signal?.aborted ) {
				throw new DOMException( 'Generation cancelled', 'AbortError' );
			}
			await this.ensureLanguage( group.language );

			if ( options.onLanguageCalibrated ) {
				// One short sample per language, not per segment: the warm-up costs a
				// couple of seconds and buys a real RTF for this bundle on this
				// device, which is what the ETA for the rest of the group is built
				// from. The audio is discarded here — the sample button's cache is
				// the panel's business, and it already holds the first bundle's.
				//
				// And one warm-up per language *in total*, not one per generation:
				// the panel calibrates the first bundle itself before calling this
				// (it wants that audio for the sample cache), so warming the same
				// bundle up again here spent several seconds re-measuring a number
				// this engine already had — on every single-language post, which is
				// the common case. `calibrate` records what it measures; this reads
				// it back and only synthesises when there is nothing to read.
				const known = this.rtfByLanguage.get(
					rtfKey( group.language, options.voice )
				);
				const rtf =
					known ?? ( await this.calibrate( options.voice ) ).rtf;
				options.onLanguageCalibrated( group.language, rtf );
			}

			for ( const item of group.items ) {
				const audio = await this.generate( item.text, {
					voice: options.voice,
					signal: options.signal,
				} );
				parts.push( { index: item.index, audio } );
				done += 1;
				options.onProgress?.( done, segments.length );
			}
		}

		return reassemble(
			parts,
			Math.round( SEGMENT_GAP_SECONDS * this.sampleRate )
		);
	}

	dispose(): void {
		this.worker?.terminate();
		this.worker = null;
		this.ready = false;
		// The measurements described a warm worker that no longer exists. Nothing
		// reuses a disposed engine today — the panel drops the instance — but a
		// memo that outlived what it measured would be a quiet lie if anything
		// ever did.
		this.rtfByLanguage.clear();
	}
}

/**
 * Memo key for a warm-up measurement.
 *
 * `voice` is part of it because `undefined` means "the bundle's default", which
 * is not necessarily the voice a later caller names even when it resolves to the
 * same one — treating them as one key would report a measurement taken under a
 * different request.
 *
 * @param language Bundle the warm-up ran on.
 * @param voice    Voice it was measured with, if the caller named one.
 */
function rtfKey( language: string, voice?: string ): string {
	return `${ language } ${ voice ?? '' }`;
}

function concatFloat32( chunks: Float32Array[] ): Float32Array {
	const total = chunks.reduce( ( sum, c ) => sum + c.length, 0 );
	const out = new Float32Array( total );
	let offset = 0;
	for ( const chunk of chunks ) {
		out.set( chunk, offset );
		offset += chunk.length;
	}
	return out;
}
