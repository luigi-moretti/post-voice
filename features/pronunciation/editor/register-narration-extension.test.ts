// `dictionary-panel.tsx` pulls in the real `@wordpress/components`, whose
// current published build resolves — under this project's jest/jsdom/Babel
// combo — through its unbuilt `src/` tree and on into `@wordpress/ui`'s
// nested, ESM-only `@wordpress/theme` (`.mjs`, no CJS build), which Jest's
// default transform can't parse. That chain is unrelated to what this test
// verifies (identity of the exported `DictionaryPanel` reference), so it's
// stubbed out here rather than chasing every ESM-only package transitively
// bundled by `@wordpress/components` through a global Jest config change.
jest.mock( '@wordpress/components', () => ( {
	Button: () => null,
	PanelBody: () => null,
	SelectControl: () => null,
	TextControl: () => null,
} ) );

import { getDictionaryExtension } from '../../narration/editor/dictionary-extension';
import { DictionaryPanel } from './dictionary-panel';
import { mergeDictionaries } from './dictionary-entry';
import { applyDictionary } from './apply-dictionary';
import './register-narration-extension';

describe( 'register-narration-extension', () => {
	it( 'registra o Panel e as funções reais de pronunciation na porta de narration', () => {
		const ext = getDictionaryExtension();
		expect( ext.Panel ).toBe( DictionaryPanel );
		expect( ext.mergeDictionaries ).toBe( mergeDictionaries );
		expect( ext.applyDictionary ).toBe( applyDictionary );
	} );
} );
