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
		// Test-only: exposes the segment pipeline on `window` for the
		// `segment-pipeline-perf` E2E scenario. Nothing in the plugin's own PHP
		// enqueues this handle — only `e2e/mu-plugins/segment-pipeline-harness.php`
		// does, and that file is mapped into wp-env solely by `.wp-env.json`. A
		// production install of the plugin never loads or executes it.
		'segment-pipeline-harness': path.resolve(
			__dirname,
			'e2e/fixtures/segment-pipeline-harness.ts'
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
