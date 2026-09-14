const defaultConfig = require( '@wordpress/scripts/config/webpack.config' );
const path = require( 'path' );

module.exports = {
	...defaultConfig,
	entry: {
		'narration-editor': path.resolve(
			__dirname,
			'features/narration/editor/index.tsx'
		),
		'narration-player': path.resolve(
			__dirname,
			'features/narration/frontend/player.ts'
		),
		'dictionary-admin': path.resolve(
			__dirname,
			'features/pronunciation/admin/settings.ts'
		),
		'player-style-admin': path.resolve(
			__dirname,
			'features/player-style/admin/index.ts'
		),
		'models-admin': path.resolve(
			__dirname,
			'features/narration/admin/index.ts'
		),
		// Test-only: exposes the segment pipeline on `window` for the
		// `segment-pipeline-perf` E2E scenario. Nothing in the plugin's own PHP
		// enqueues this handle — only `e2e/mu-plugins/segment-pipeline-harness.php`
		// does, and that file is mapped into wp-env solely by `.wp-env.json`. A
		// production install of the plugin never loads or executes it.
		'segment-pipeline-harness': path.resolve(
			__dirname,
			'e2e/fixtures/segment-pipeline-harness.ts'
		),
		// Real webpack entry, not a Worker-detection side channel: `blob:`
		// construction needs an actual bundle to fetch (see tts-engine.ts's
		// `createNarrationWorker()` docblock and the 2026-08-21 Worker
		// cross-origin-isolation spec's Achado 5). The static tokenizer
		// import (Achado 3 in that same spec) is load-bearing here too — the
		// worker's `publicPath` under `blob:` resolves to the site root, so
		// any *dynamic* `import()` this file's dependency graph reintroduces
		// would 404 with no explanation. `sentencepiece.js` used to be one;
		// keep it static.
		'pocket-tts-worker': path.resolve(
			__dirname,
			'features/narration/editor/engine/pocket-tts.worker.js'
		),
	},
	output: {
		...defaultConfig.output,
		path: path.resolve( __dirname, 'build' ),
	},
	resolve: {
		...defaultConfig.resolve,
		fallback: {
			...( defaultConfig.resolve?.fallback || {} ),
			// The vendored sentencepiece.js is an Emscripten build that carries its
			// Node branch alongside its browser one, including `await import('module')`
			// to build a `require`. That branch is unreachable in a worker, but webpack
			// still resolves the specifier at build time and fails. `false` compiles it
			// to an empty module instead of pulling in a Node polyfill.
			module: false,
		},
	},
};
