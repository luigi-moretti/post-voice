module.exports = {
	extends: [ 'plugin:@wordpress/eslint-plugin/recommended' ],
	parserOptions: {
		project: './tsconfig.json',
	},
	overrides: [
		{
			// Tooling that runs in Node, not in a browser or a bundle. Without an
			// explicit env, the shared config leaves modern globals like
			// `globalThis` undeclared and `no-undef` fires on correct code.
			files: [ 'test/**/*.js', 'scripts/**/*.mjs', '*.config.js' ],
			env: { node: true, es2022: true },
		},
	],
	ignorePatterns: [
		'build/',
		'node_modules/',
		'vendor/',
		'coverage/',
		// Vendored from the pocket-tts reference repo (pocket-tts.worker.js now
		// carries first-party modifications on top of that base — see CREDITS.md),
		// so our style rules still don't apply. sentencepiece.js is a 3.9MB
		// Emscripten bundle; linting it makes a full run take minutes.
		'features/narration/editor/engine/sentencepiece.js',
		'features/narration/editor/engine/pocket-tts.worker.js',
	],
};
