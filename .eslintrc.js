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
		// Vendored verbatim from the pocket-tts reference repo — copied, not
		// authored, so our style rules do not apply to them. sentencepiece.js is a
		// 3.9MB Emscripten bundle; linting it makes a full run take minutes.
		'features/narration/editor/engine/sentencepiece.js',
		'features/narration/editor/engine/pocket-tts.worker.js',
	],
};
