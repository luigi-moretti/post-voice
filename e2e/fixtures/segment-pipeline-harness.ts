import { applyDictionary } from '../../features/pronunciation/editor/apply-dictionary';
import type { DictionaryEntry } from '../../features/pronunciation/editor/dictionary-entry';
import { extractSegments } from '../../features/narration/editor/extract-segments';
import type { EditorBlock } from '../../features/narration/editor/segment';
import { computeSegmentHash } from '../../features/narration/editor/segment-hash';
import {
	mergeAdjacent,
	resolveSegments,
} from '../../features/narration/editor/segment';

/**
 * Test-only entry exposing the segment pipeline on `window`, for the
 * `segment-pipeline-perf` Playwright scenario.
 *
 * The pipeline (`extractSegments` -> dictionary -> `resolveSegments` /
 * `mergeAdjacent` -> `computeSegmentHash`) is pure text — it never touches
 * ONNX, the worker or the model host. It used to be timed under Jest, but
 * jsdom's `DOMParser` is a pure-JS implementation far slower than a browser's
 * native one, which put most of that test's 50ms budget on the test
 * environment rather than on the code it meant to guard. This harness lets a
 * real browser time the real bundled modules instead.
 *
 * Built by its own webpack entry (see `webpack.config.js`) and loaded only by
 * `e2e/mu-plugins/segment-pipeline-harness.php`, which nothing in the plugin's
 * own `post-voice.php` chain requires — a production install never enqueues
 * it.
 */
window.__postVoiceSegmentPipeline = {
	async run(
		blocks: EditorBlock[],
		dictionary: DictionaryEntry[],
		defaultLanguage: string
	) {
		const start = performance.now();
		const segments = mergeAdjacent(
			resolveSegments( extractSegments( blocks ), defaultLanguage )
		).map( ( segment ) => ( {
			...segment,
			text: applyDictionary( segment.text, segment.language, dictionary ),
		} ) );
		await computeSegmentHash( segments );
		const elapsedMs = performance.now() - start;
		return { segmentCount: segments.length, elapsedMs };
	},
};

declare global {
	interface Window {
		__postVoiceSegmentPipeline: {
			run: (
				blocks: EditorBlock[],
				dictionary: DictionaryEntry[],
				defaultLanguage: string
			) => Promise< { segmentCount: number; elapsedMs: number } >;
		};
	}
}
