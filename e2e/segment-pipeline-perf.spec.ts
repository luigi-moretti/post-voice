import { test, expect } from '@wordpress/e2e-test-utils-playwright';

/**
 * The editor runs the segment pipeline (`extractSegments` -> dictionary ->
 * `resolveSegments`/`mergeAdjacent` -> `computeSegmentHash`) on a debounced
 * keystroke, and the ceiling below exists to catch the kind of regression that
 * puts a 200-term regex compile back on that path.
 *
 * This used to run under Jest (`features/narration/tests/js/segment-pipeline-perf.test.ts`,
 * deleted by the same change that added this file). It passed at ~36ms — but
 * ~31ms of that was `extractSegments` alone, because jsdom's `DOMParser` is a
 * pure-JS implementation, orders of magnitude slower than a browser's native
 * one. Most of that test's budget measured the test environment rather than
 * the plugin, and its real headroom (1.4x) was narrow enough to flake on a
 * loaded runner. This scenario times the same pipeline, built by the same
 * bundler, running in a real Chromium `DOMParser` instead.
 *
 * The pipeline never touches ONNX, the worker or the model host — it is pure
 * text — so this loads a plain front-end page (no editor, no bundle download)
 * and calls straight into `window.__postVoiceSegmentPipeline`, which
 * `e2e/mu-plugins/segment-pipeline-harness.php` enqueues only in this wp-env
 * environment. See that file and `e2e/fixtures/segment-pipeline-harness.ts`
 * for why a production install never loads it.
 *
 * Run several times rather than once: a single sample cannot distinguish "the
 * pipeline is fast" from "this particular run got lucky", and the whole point
 * of moving this off jsdom was to stop trusting one number.
 *
 * Measured across several 30-run sessions on the development machine: min
 * ~1.2ms, median ~1.9ms, p95 ~5ms, occasional single-sample tails up to
 * ~13ms (GC/scheduling noise, not the pipeline — see the 2026-08-15 amendment
 * to the Fase 2 spec for the full distribution and the recalibration
 * reasoning). Against that, one ceiling would have to serve two purposes at
 * once, so this asserts two instead:
 *
 * - `MEDIAN_CEILING_MS` is the regression net. The median is robust to the
 *   occasional GC/scheduling tail, so it measures the pipeline itself — a real
 *   regression (e.g. the 200-term dictionary regex recompiling on every call)
 *   moves it, noise does not.
 * - `SAMPLE_CEILING_MS` is the original 50ms from the design spec, kept as an
 *   absolute cap on every single sample. It exists to catch a catastrophic
 *   outlier a median would smooth over, not to describe steady-state speed.
 */
const MEDIAN_CEILING_MS = 5;
const SAMPLE_CEILING_MS = 50;
const RUNS = 30;

test.describe( 'segment pipeline performance', () => {
	test( `processes a 64KB post in a real browser: median under ${ MEDIAN_CEILING_MS }ms, every sample under ${ SAMPLE_CEILING_MS }ms (${ RUNS } runs)`, async ( {
		page,
	} ) => {
		// Any plain front-end page will do — the harness script is enqueued
		// unconditionally on `wp_enqueue_scripts`, and this pipeline needs neither
		// the block editor nor a logged-in session.
		await page.goto( '/' );

		const { samples, segmentCount } = await page.evaluate(
			async ( { runs } ) => {
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

				// Rebuilt fresh on every run, not reused across the loop: `applyDictionary`
				// caches its compiled regex per dictionary-array identity (see the
				// comment in `apply-dictionary.ts`), and a stable reference across runs
				// would let every run after the first skip the 200-term compile the
				// ceiling exists to catch. A freshly typed dictionary is the case that
				// recompiles every time, which is the one an author's keystroke actually
				// produces whenever the dictionary state object is itself re-created.
				const buildBlocks = () =>
					Array.from( { length: 120 }, ( _, i ) => paragraph( i ) );
				const buildDictionary = () =>
					Array.from( { length: 200 }, ( _, i ) => ( {
						term: `termo${ i }`,
						replacement: `valor${ i }`,
						language: 'portuguese',
					} ) );

				const elapsed: number[] = [];
				let lastSegmentCount = 0;
				for ( let i = 0; i < runs; i++ ) {
					const result = await window.__postVoiceSegmentPipeline.run(
						buildBlocks(),
						buildDictionary(),
						'portuguese'
					);
					elapsed.push( result.elapsedMs );
					lastSegmentCount = result.segmentCount;
				}
				return { samples: elapsed, segmentCount: lastSegmentCount };
			},
			{ runs: RUNS }
		);

		const sorted = [ ...samples ].sort( ( a, b ) => a - b );
		const min = sorted[ 0 ];
		const max = sorted[ sorted.length - 1 ];
		const median = sorted[ Math.floor( sorted.length / 2 ) ];
		const mean = samples.reduce( ( a, b ) => a + b, 0 ) / samples.length;

		// The full distribution, not just the two figures asserted on below. A
		// future recalibration is a human decision (see the Fase 2 spec), and
		// this line is the evidence for it — keep it even though only the
		// median and the per-sample max currently gate the test.
		// eslint-disable-next-line no-console
		console.log(
			`segment-pipeline-perf: min=${ min.toFixed( 2 ) }ms ` +
				`median=${ median.toFixed( 2 ) }ms mean=${ mean.toFixed(
					2
				) }ms ` +
				`max=${ max.toFixed( 2 ) }ms samples=[${ sorted
					.map( ( n ) => n.toFixed( 2 ) )
					.join( ', ' ) }]`
		);

		expect( segmentCount ).toBeGreaterThan( 0 );
		expect( median ).toBeLessThan( MEDIAN_CEILING_MS );
		for ( const sample of samples ) {
			expect( sample ).toBeLessThan( SAMPLE_CEILING_MS );
		}
	} );
} );
