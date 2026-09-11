import {
	registerDictionaryExtension,
	getDictionaryExtension,
} from './dictionary-extension';

describe( 'dictionary-extension', () => {
	// A ordem destes dois testes importa: o módulo guarda um único registro
	// em escopo de módulo, e o primeiro teste depende de nada ter
	// registrado ainda neste processo Jest.
	it( 'lança quando nada foi registrado ainda', () => {
		expect( () => getDictionaryExtension() ).toThrow(
			/no DictionaryExtension registered/
		);
	} );

	it( 'devolve exatamente o que foi registrado', () => {
		const Panel = () => null;
		// `any[]` — não `DictionaryEntryShape[]` — de propósito: este teste
		// verifica que o módulo devolve exatamente o que foi registrado,
		// não a forma dos itens do dicionário.
		const mergeDictionaries = ( global: any[], post: any[] ) => [
			...global,
			...post,
		];
		const applyDictionary = ( text: string ) => text;

		registerDictionaryExtension( {
			Panel,
			mergeDictionaries,
			applyDictionary,
		} );

		expect( getDictionaryExtension() ).toEqual( {
			Panel,
			mergeDictionaries,
			applyDictionary,
		} );
	} );
} );
