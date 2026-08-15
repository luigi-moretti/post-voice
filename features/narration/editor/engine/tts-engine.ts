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

	async load( language: string ): Promise< void > {
		this.language = language;
		this.worker = new Worker(
			new URL( './pocket-tts.worker.js', import.meta.url ),
			{ type: 'module' }
		);

		await new Promise< void >( ( resolve, reject ) => {
			if ( ! this.worker ) {
				return reject( new Error( 'Worker not created' ) );
			}
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
					this.worker?.removeEventListener( 'message', onMessage );
					resolve();
				} else if ( type === 'error' ) {
					this.worker?.removeEventListener( 'message', onMessage );
					reject( new Error( error ) );
				}
			};
			this.worker.addEventListener( 'message', onMessage );
			this.worker.postMessage( { type: 'load' } );
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
			const onMessage = ( e: MessageEvent ) => {
				if ( e.data.type === 'voices_loaded' ) {
					this.defaultVoice =
						e.data.defaultVoice ?? this.defaultVoice;
				} else if ( e.data.type === 'bundle_loaded' ) {
					if ( e.data.sampleRate ) {
						this.sampleRate = e.data.sampleRate;
					}
					this.worker?.removeEventListener( 'message', onMessage );
					resolve();
				} else if ( e.data.type === 'error' ) {
					this.worker?.removeEventListener( 'message', onMessage );
					reject( new Error( e.data.error ) );
				}
			};
			this.worker.addEventListener( 'message', onMessage );
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

			this.worker.addEventListener( 'message', onMessage );
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
