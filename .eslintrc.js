module.exports = {
	extends: [ 'plugin:@wordpress/eslint-plugin/recommended' ],
	parserOptions: {
		project: './tsconfig.json',
	},
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
