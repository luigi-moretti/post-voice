import { registerDictionaryExtension } from '../../narration/editor/dictionary-extension';
import { DictionaryPanel } from './dictionary-panel';
import { mergeDictionaries } from './dictionary-entry';
import { applyDictionary } from './apply-dictionary';

// Efeito colateral do import: preenche a porta que narration publica.
// Único arquivo de pronunciation que narration precisa importar — ver
// Step 8 abaixo. Antes eram três imports nomeados de três módulos
// diferentes (arestas 7, 8 e 9 do inventário da ADR-0005); agora é este
// um import só.
//
// Este módulo é importado por `narration/editor/index.tsx` só pelo efeito
// colateral (nenhum símbolo daqui é usado) — nunca pode ser tree-shaken. Se
// `package.json` algum dia ganhar `"sideEffects": false`, este arquivo (e
// qualquer outro módulo de registro só-efeito-colateral) precisa entrar numa
// allowlist `sideEffects` explícita, ou o bundler o descarta em silêncio.
registerDictionaryExtension( {
	Panel: DictionaryPanel,
	mergeDictionaries,
	applyDictionary,
} );
