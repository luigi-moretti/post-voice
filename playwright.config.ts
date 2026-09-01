/**
 * Playwright configuration for the E2E suite.
 *
 * Extends the `@wordpress/scripts` base config, which already wires up the
 * admin storage state, artifact paths, and the `@wordpress/e2e-test-utils-playwright`
 * fixtures. Two things are overridden:
 *
 * - `testDir`, because the base config looks in `./specs` and this project keeps
 *   its E2E suite in `./e2e` (matching the plan's file structure).
 * - `timeout`, because the narration happy path downloads a ~190MB voice bundle
 *   plus the ONNX Runtime and then runs real inference in the browser. The base
 *   config's 100s ceiling would fail those tests on the model download alone,
 *   before any assertion had a chance to run.
 *
 * `WP_BASE_URL` defaults to wp-env's tests site on :8889 — the same site the
 * PHPUnit suite deliberately avoids by using a separate table prefix.
 *
 * A third override adds the `json` reporter alongside the base config's `list`.
 * ADR-0012's review trigger is "the E2E suite going past 15 minutes", and
 * nothing on disk recorded how long a run took — so the trigger could not be
 * evaluated by reading the report, and `TESTING.md` and the ADR drifted apart
 * without anyone noticing. `npm run doctor` reads the duration from this file.
 * The output lands in the already-git-ignored artifacts directory.
 */
import baseConfig from '@wordpress/scripts/config/playwright.config.js';
import { defineConfig } from '@playwright/test';
import type { ReporterDescription } from '@playwright/test';

// O reporter do config base é tipado como `string | ReporterDescription[]`, e
// um `string` solto não é atribuível a `ReporterDescription`. Normalizar aqui
// mantém o que a base decidir (hoje `list`) sem fixar essa escolha por cópia.
const reporterBase: ReporterDescription[] = (
	Array.isArray( baseConfig.reporter )
		? baseConfig.reporter
		: [ baseConfig.reporter || 'list' ]
).map( ( r ) =>
	typeof r === 'string' ? ( [ r ] as ReporterDescription ) : r
);

export default defineConfig( {
	...baseConfig,
	testDir: './e2e',
	reporter: [
		...reporterBase,
		[ 'json', { outputFile: 'artifacts/test-results/report.json' } ],
	],
	timeout: parseInt( process.env.TIMEOUT || '', 10 ) || 300_000,
} );
