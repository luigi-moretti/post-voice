const defaultConfig = require( '@wordpress/scripts/config/jest-unit.config' );

module.exports = {
	...defaultConfig,
	setupFiles: [
		...( defaultConfig.setupFiles || [] ),
		'<rootDir>/test/jest.setup.js',
	],
	// The default @wordpress/jest-preset-default testMatch includes `**/test/*.[jt]s?(x)`,
	// which would otherwise pick up test/jest.setup.js itself as a test suite (and fail
	// with "Your test suite must contain at least one test"). Excluded explicitly here.
	testPathIgnorePatterns: [
		'/node_modules/',
		'<rootDir>/vendor/',
		'<rootDir>/test/jest.setup.js',
	],
	// `@breezystack/lamejs` resolves its `require` condition to an IIFE bundle that
	// assigns to a global instead of `module.exports`, so a plain CommonJS require
	// under Jest yields `{}`. Point Jest at the ESM bundle webpack already picks for
	// the browser build, and let Babel transpile it — otherwise the two environments
	// would be testing different code.
	moduleNameMapper: {
		...( defaultConfig.moduleNameMapper || {} ),
		'^@breezystack/lamejs$':
			'<rootDir>/node_modules/@breezystack/lamejs/dist/lamejs.js',
	},
	transformIgnorePatterns: [ '/node_modules/(?!@breezystack/lamejs)' ],
	collectCoverageFrom: [
		'features/narration/editor/environment.ts',
		'features/narration/editor/extract-segments.ts',
		'features/narration/editor/rtf-calibration.ts',
		'features/narration/editor/segment-hash.ts',
		'features/narration/editor/storage-check.ts',
		'features/narration/editor/mp3-encoder.ts',
		'features/narration/editor/model-source.ts',
		'features/narration/editor/site-language.ts',
		'features/narration/editor/language-labels.ts',
		'features/narration/editor/segment.ts',
		'features/narration/editor/voice-catalog.ts',
		'features/narration/editor/bundle-cache-status.ts',
		'features/narration/editor/group-segments.ts',
		'features/narration/editor/engine/tokenizer-sanitize.ts',
		'features/narration/frontend/player-state.ts',
		'features/narration/format-time.ts',
		'features/pronunciation/editor/dictionary-entry.ts',
		'features/pronunciation/editor/apply-dictionary.ts',
		'features/pronunciation/editor/row-ids.ts',
		'features/player-style/admin/contrast.ts',
		'features/player-style/admin/hex-field.ts',
		'scripts/lint-arch/**/*.js',
		'!scripts/lint-arch/tests/**',
	],
	coverageThreshold: {
		global: { lines: 80 },
	},
};
