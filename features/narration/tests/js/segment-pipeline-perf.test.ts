import { applyDictionary } from '../../../pronunciation/editor/apply-dictionary';
import type { DictionaryEntry } from '../../../pronunciation/editor/dictionary-entry';
import { extractSegments } from '../../editor/extract-segments';
import { computeSegmentHash } from '../../editor/segment-hash';
import { mergeAdjacent, resolveSegments } from '../../editor/segment';

/**
 * The editor runs this whole path on a debounced keystroke, and the 50ms ceiling
 * exists to catch the kind of regression that puts a 200-term regex compile back
 * on that path.
 *
 * Measured at ~36ms on the development machine when this test was written, not
 * the ~18ms the plan predicted, and the split is worth knowing before anyone
 * reads a future failure as a regression in this plugin: `extractSegments` is
 * ~31ms of it, merge ~0.2ms, `applyDictionary` over 200 terms ~1.7ms and
 * `computeSegmentHash` ~3ms. `extractSegments` parses with `DOMParser`, which
 * under jsdom is far slower than the browser parser the editor actually uses, so
 * most of the budget here is the test environment rather than the code under
 * test. The headroom to the ceiling is consequently narrower than the plan
 * assumed; see the 15/08/2026 execution-findings section of the Fase 2 spec.
 */
const CEILING_MS = 50;

const paragraph = ( index: number ) => ( {
	name: 'core/paragraph',
	attributes: {
		content:
			'A BYD terminou o trimestre à frente de todas as concorrentes no mercado brasileiro e a diferença não veio de um único modelo. '.repeat(
				4
			) +
			( index % 7 === 0
				? '<span data-pv-lang="english_2026-04">This is the part read in English.</span>'
				: '' ),
	},
	innerBlocks: [],
} );

describe( 'segment pipeline performance', () => {
	it( `processes a 64KB post in under ${ CEILING_MS }ms`, async () => {
		const blocks = Array.from( { length: 120 }, ( _, i ) =>
			paragraph( i )
		);
		const dictionary: DictionaryEntry[] = Array.from(
			{ length: 200 },
			( _, i ) => ( {
				term: `termo${ i }`,
				replacement: `valor${ i }`,
				language: 'portuguese',
			} )
		);

		const start = performance.now();
		const segments = mergeAdjacent(
			resolveSegments( extractSegments( blocks ), 'portuguese' )
		).map( ( segment ) => ( {
			...segment,
			text: applyDictionary( segment.text, segment.language, dictionary ),
		} ) );
		await computeSegmentHash( segments );
		const elapsed = performance.now() - start;

		expect( segments.length ).toBeGreaterThan( 0 );
		expect( elapsed ).toBeLessThan( CEILING_MS );
	} );
} );
