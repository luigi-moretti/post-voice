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
 */
import baseConfig from '@wordpress/scripts/config/playwright.config.js';
import { defineConfig } from '@playwright/test';

export default defineConfig( {
	...baseConfig,
	testDir: './e2e',
	timeout: parseInt( process.env.TIMEOUT || '', 10 ) || 300_000,
} );
