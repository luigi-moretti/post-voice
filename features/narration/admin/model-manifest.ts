import { MODEL_BASE_URL } from '../editor/model-source';

/**
 * The fields of `bundle.json` this admin screen actually reads. The real
 * file has many more (sample rate, state manifests, ...) — irrelevant here,
 * since this screen never runs inference, only downloads and caches.
 */
export interface BundleManifest {
	tokenizer_file: string;
	bos_before_voice_file?: string;
}

export interface BundleFile {
	filename: string;
	url: string;
}

/**
 * The five ONNX sessions plus the predefined-voice records, under the exact
 * names every bundle ships them as. Duplicated from `MODEL_STEMS` in
 * `pocket-tts.worker.js` rather than imported — importing the worker file
 * would couple this admin screen to a vendored file (ADR-0011), the same
 * reason `bundle-cache-status.ts` duplicates `CACHE_NAME` instead of
 * importing `engine/model-cache.ts`.
 */
export const STATIC_BUNDLE_FILES: readonly string[] = [
	'mimi_encoder_int8.onnx',
	'text_conditioner_int8.onnx',
	'flow_lm_main_int8.onnx',
	'flow_lm_flow_int8.onnx',
	'mimi_decoder_int8.onnx',
	'voices.bin',
];

/**
 * URL of one file inside a language's bundle folder.
 *
 * @param language Bundle identifier, e.g. `portuguese`.
 * @param filename File name inside that folder.
 */
export function bundleUrl( language: string, filename: string ): string {
	return `${ MODEL_BASE_URL }${ language }/${ filename }`;
}

/**
 * URL of a language's `bundle.json` — the one file whose name is not itself
 * inside the manifest, since it *is* the manifest.
 *
 * @param language Bundle identifier.
 */
export function bundleJsonUrl( language: string ): string {
	return bundleUrl( language, 'bundle.json' );
}

/**
 * Every file a bundle consists of: `bundle.json` itself, the six statically
 * named files, the always-present tokenizer, and — only when the manifest
 * names one — the BOS-before-voice file.
 *
 * @param language Bundle identifier.
 * @param manifest Already-parsed `bundle.json` for that language.
 */
export function resolveBundleFiles(
	language: string,
	manifest: BundleManifest
): BundleFile[] {
	const filenames = [
		'bundle.json',
		...STATIC_BUNDLE_FILES,
		manifest.tokenizer_file,
	];
	if ( manifest.bos_before_voice_file ) {
		filenames.push( manifest.bos_before_voice_file );
	}
	return filenames.map( ( filename ) => ( {
		filename,
		url: bundleUrl( language, filename ),
	} ) );
}
