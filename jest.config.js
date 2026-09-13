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
		'features/narration/editor/generation-time-hint.ts',
		'features/narration/editor/segment-hash.ts',
		'features/narration/editor/storage-check.ts',
		'features/narration/editor/mp3-encoder.ts',
		'features/narration/editor/model-source.ts',
		'features/narration/editor/site-language.ts',
		'features/narration/editor/language-labels.ts',
		'features/narration/editor/segment.ts',
		'features/narration/editor/voice-catalog.ts',
		'features/narration/editor/bundle-cache-status.ts',
		'features/narration/admin/model-manifest.ts',
		'features/narration/admin/bundle-status.ts',
		'features/narration/admin/bundle-size.ts',
		'features/narration/editor/group-segments.ts',
		'features/narration/editor/engine/tokenizer-sanitize.ts',
		'features/narration/frontend/player-state.ts',
		'features/narration/format-time.ts',
		'features/pronunciation/editor/dictionary-entry.ts',
		'features/pronunciation/editor/apply-dictionary.ts',
		'features/pronunciation/editor/row-ids.ts',
		'features/narration/editor/dictionary-extension.ts',
		'features/pronunciation/editor/register-narration-extension.ts',
		'features/player-style/admin/contrast.ts',
		'features/player-style/admin/hex-field.ts',
		'scripts/lint-arch/**/*.js',
		'!scripts/lint-arch/tests/**',
		// `tools/` é ferramenta de investigação de quem mexe nas regras (hoje
		// `covers-oracle-diff.js`, o harness diferencial contra o PHP): não
		// roda no `lint:arch`, não roda na CI e teste nenhum depende dela —
		// medir cobertura dela mediria o que ninguém executa em CI. O limiar
		// de 80% não muda; o que muda é o denominador não incluir ferramenta
		// que, por desenho, não tem suíte.
		'!scripts/lint-arch/tools/**',
	],
	// O default do Jest (`json`, `text`, `lcov`, `clover`) não escreve
	// `coverage-summary.json`, que é do reporter `json-summary` — e é esse o
	// arquivo que o `npm run doctor` lê para relatar a cobertura. Sem ele o
	// doctor dizia "sem relatório recente no disco" e mandava rodar justamente
	// o comando que acabara de rodar. Os quatro default seguem listados porque
	// declarar a chave substitui a lista inteira, e `text` é a tabela impressa
	// no terminal.
	coverageReporters: [ 'json', 'text', 'lcov', 'clover', 'json-summary' ],
	coverageThreshold: {
		global: { lines: 80 },
	},
};
