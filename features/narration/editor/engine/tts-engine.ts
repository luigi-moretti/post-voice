import { computeRtf } from '../rtf-calibration';

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

export interface CalibrationResult {
  rtf: number;
}

const CALIBRATION_TEXT = 'Isto é um teste rápido de calibração de desempenho.';

export class PocketTtsEngine {
  private worker: Worker | null = null;
  private ready = false;
  private defaultVoice: string | null = null;
  public sampleRate = 24000;

  async load( language: string ): Promise<void> {
    this.worker = new Worker(
      new URL( './pocket-tts.worker.js', import.meta.url ),
      { type: 'module' }
    );

    await new Promise<void>( ( resolve, reject ) => {
      if ( ! this.worker ) return reject( new Error( 'Worker not created' ) );
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
          if ( sampleRate ) this.sampleRate = sampleRate;
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

  private setLanguage( language: string ): Promise<void> {
    return new Promise( ( resolve, reject ) => {
      if ( ! this.worker ) return reject( new Error( 'Engine not loaded' ) );
      const onMessage = ( e: MessageEvent ) => {
        if ( e.data.type === 'voices_loaded' ) {
          this.defaultVoice = e.data.defaultVoice ?? this.defaultVoice;
        } else if ( e.data.type === 'bundle_loaded' ) {
          if ( e.data.sampleRate ) this.sampleRate = e.data.sampleRate;
          this.worker?.removeEventListener( 'message', onMessage );
          resolve();
        } else if ( e.data.type === 'error' ) {
          this.worker?.removeEventListener( 'message', onMessage );
          reject( new Error( e.data.error ) );
        }
      };
      this.worker.addEventListener( 'message', onMessage );
      this.worker.postMessage( { type: 'set_language', data: { language } } );
    } );
  }

  async calibrate(): Promise<CalibrationResult> {
    const start = performance.now();
    const audio = await this.generate( CALIBRATION_TEXT, {} );
    const elapsedMs = performance.now() - start;
    // Measure the audio we actually produced rather than guessing its length
    // from character count — the samples are right here, and a guess would bias
    // every ETA derived from this RTF.
    const audioDurationSec = audio.length / this.sampleRate;
    return { rtf: computeRtf( audioDurationSec, elapsedMs ) };
  }

  generate( text: string, options: GenerateOptions ): Promise<Float32Array> {
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
        reject( new DOMException( 'Generation cancelled', 'AbortError' ) );
      };
      options.signal?.addEventListener( 'abort', onAbort, { once: true } );

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
      this.worker.postMessage( { type: 'generate', data: { text, voice: options.voice ?? this.defaultVoice } } );
    } );
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
  }
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
