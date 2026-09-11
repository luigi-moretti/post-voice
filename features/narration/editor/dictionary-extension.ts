import type { ComponentType } from 'react';

/**
 * O contrato mínimo que narration exige de uma entrada de dicionário —
 * declarado aqui, não importado de pronunciation. `DictionaryEntry` (em
 * pronunciation/editor/dictionary-entry.ts) tem a mesma forma; TypeScript
 * trata os dois como equivalentes por tipagem estrutural, sem precisar de
 * um import cross-feature aqui.
 */
export interface DictionaryEntryShape {
	term: string;
	replacement: string;
	language: string;
}

export interface DictionaryPanelSlotProps {
	entries: DictionaryEntryShape[];
	defaultLanguage: string;
	onChange: ( next: DictionaryEntryShape[] ) => void;
	settingsUrl: string | null;
}

/**
 * A porta que narration publica. pronunciation preenche via
 * `registerDictionaryExtension` — ver
 * features/pronunciation/editor/register-narration-extension.ts.
 */
export interface DictionaryExtension {
	Panel: ComponentType< DictionaryPanelSlotProps >;
	mergeDictionaries: (
		global: DictionaryEntryShape[],
		post: DictionaryEntryShape[]
	) => DictionaryEntryShape[];
	applyDictionary: (
		text: string,
		language: string,
		entries: DictionaryEntryShape[]
	) => string;
}

let extension: DictionaryExtension | null = null;

/**
 * Chamado uma vez pelo adaptador (pronunciation), como efeito colateral do
 * import. Ver docs/superpowers/specs/2026-09-11-topologia-nucleo-extensoes-design.md,
 * "Mecanismo 4".
 *
 * @param ext A implementação real, fornecida por pronunciation.
 */
export function registerDictionaryExtension( ext: DictionaryExtension ): void {
	extension = ext;
}

/**
 * Acessor de narration. Lança em vez de degradar em silêncio — a mesma
 * escolha de falha alta feita para o wiring PHP em Post_Voice_Assets
 * (Task 1 deste plano).
 */
export function getDictionaryExtension(): DictionaryExtension {
	if ( ! extension ) {
		throw new Error(
			'post-voice: no DictionaryExtension registered — is ' +
				"'pronunciation/editor/register-narration-extension' imported before this runs?"
		);
	}
	return extension;
}
