module.exports = {
	// Sem isto, ESLint sobe o diretório acima deste worktree (que vive dentro
	// do checkout principal, em `.worktrees/`) e encontra o `.eslintrc.js` de
	// lá também — cada um resolvendo seu próprio `@typescript-eslint` a partir
	// de um `node_modules` diferente, o que ESLint reporta como "couldn't
	// determine the plugin uniquely" e derruba tanto `lint:js` quanto o hook
	// de pre-commit. `root: true` para a busca aqui.
	root: true,
	extends: [ 'plugin:@wordpress/eslint-plugin/recommended' ],
	parserOptions: {
		project: './tsconfig.json',
	},
	overrides: [
		{
			// Tooling that runs in Node, not in a browser or a bundle. Without an
			// explicit env, the shared config leaves modern globals like
			// `globalThis` undeclared and `no-undef` fires on correct code.
			files: [ 'test/**/*.js', 'scripts/**/*.{js,mjs}', '*.config.js' ],
			env: { node: true, es2022: true },
		},
		{
			// Jest globals for the lint-arch suites. Scoped to that directory:
			// `test/jest.setup.js` is plain Node setup and declares none of them.
			files: [ 'scripts/**/tests/**/*.js' ],
			env: { jest: true },
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
