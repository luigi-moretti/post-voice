'use strict';
const { createContext } = require( '../context' );
const pins = require( '../rules/contract-pins' );
const npmci = require( '../rules/no-npm-install' );

const MIRROR_SHA = 'b18a05128c4f727ead5b23a643b65b93eaf8ee5d';
const MIRROR_URL = `https://huggingface.co/luigi-moretti/pocket-tts-onnx-mirror/resolve/${ MIRROR_SHA }/`;

const REPO = {
	'post-voice.php': ' * Requires at least: 6.6\n * Requires PHP: 8.2\n',
	'readme.txt': 'Requires at least: 6.6\nRequires PHP: 8.2\n',
	'composer.json': '{ "require": { "php": ">=8.2" } }',
	'phpcs.xml.dist': '<config name="testVersion" value="8.2-"/>',
	'.wp-env.json': '{ "core": "WordPress/WordPress#6.6" }',
	'features/narration/editor/model-source.ts': `export const MODEL_BASE_URL =\n\t'${ MIRROR_URL }';\n`,
};

const com = ( over = {} ) => {
	const files = { ...REPO, ...over };
	return createContext( {
		files: Object.keys( files ),
		read: ( f ) => files[ f ],
	} );
};

// Achado CRÍTICO da revisão das correções: `source.indexOf( 'MODEL_BASE_URL' )`
// ancorava na primeira ocorrência TEXTUAL, e `source` é cru. Um comentário
// acima da declaração que nomeasse a constante, citasse a URL fixada entre
// aspas e terminasse em `;` fazia a varredura parar dentro do comentário — a
// declaração real, apontando para outro host, nunca era olhada. Medido: 0
// achados. O pin protege de onde o navegador do autor baixa ~190 MB de modelo.
describe( 'contract-pins: o pin é lido do CÓDIGO, não do texto', () => {
	const BOM = MIRROR_URL;
	const MAU = 'https://cdn.evil.example.com/pocket-tts/';
	const ARQ = 'features/narration/editor/model-source.ts';

	const comFonte = ( src ) =>
		pins
			.check( com( { [ ARQ ]: src } ) )
			.filter( ( f ) => f.key.includes( 'model-base-url' ) );

	it.each( [
		[
			'comentário de linha citando o nome, o pin e ";"',
			`// MODEL_BASE_URL = '${ BOM }';\nexport const MODEL_BASE_URL = '${ MAU }';\n`,
		],
		[
			'bloco /** */ citando o nome, o pin e ";"',
			`/**\n * MODEL_BASE_URL = '${ BOM }';\n */\nexport const MODEL_BASE_URL = '${ MAU }';\n`,
		],
		[
			'nome dentro de string antes da declaração',
			`const doc = "MODEL_BASE_URL = '${ BOM }';";\nexport const MODEL_BASE_URL = '${ MAU }';\n`,
		],
		[
			'comentário com ";" DENTRO da declaração',
			`export const MODEL_BASE_URL =\n\t/* nota; aqui */ '${ MAU }';\n`,
		],
	] )( 'acusa o host errado apesar de %s', ( _, src ) => {
		expect( comFonte( src ) ).toHaveLength( 1 );
	} );

	it( 'acusa quando o nome só existe em comentário: não dá para provar o pin', () => {
		expect(
			comFonte(
				'// MODEL_BASE_URL mora noutro módulo\nexport const X = 1;\n'
			)
		).toHaveLength( 1 );
	} );

	it( 'não confunde MY_MODEL_BASE_URL com o pin', () => {
		expect(
			comFonte(
				`export const MY_MODEL_BASE_URL = '${ MAU }';\nexport const MODEL_BASE_URL = '${ BOM }';\n`
			)
		).toEqual( [] );
	} );

	// Arquivo truncado no meio de uma string ou de um comentário não pode
	// derrubar o lint nem passar em silêncio: a varredura chega ao fim do
	// arquivo e o chamador acusa por não conseguir provar o pin.
	it.each( [
		[ 'string sem fechar', "export const MODEL_BASE_URL = 'https://x/" ],
		[
			'comentário de bloco sem fechar',
			'/* MODEL_BASE_URL\nexport const X = 1;',
		],
		[ 'comentário de linha sem quebra final', '// MODEL_BASE_URL' ],
	] )( 'não estoura com %s', ( _, src ) => {
		expect( () => comFonte( src ) ).not.toThrow();
		expect( comFonte( src ).length ).toBeGreaterThan( 0 );
	} );

	it( 'a barra invertida não deixa a string escapar da varredura', () => {
		// `'...\\'` termina em barra escapada, não em aspa aberta: sem tratar
		// o escape, a varredura engoliria a declaração seguinte.
		expect(
			comFonte(
				`const nota = 'caminho\\\\';\nexport const MODEL_BASE_URL = '${ MAU }';\n`
			)
		).toHaveLength( 1 );
	} );

	// Achados I1 e I2 da re-review. A varredura não conhece literal de regex:
	// num `/'/` a aspa de dentro abre uma pseudo-string, e daí em diante um
	// trecho de comentário passa a ser lido como código. Medido: a declaração
	// de verdade era engolida, a isca do comentário era lida como código, e a
	// regra devolvia ZERO com o pin apontando para outro host. O JSDoc afirmava
	// que dessincronizar "erra achando menos" — não erra; quem faz isso valer é
	// a âncora de declaração.
	it( 'regex com aspa mais comentário-isca não absolve o pin errado', () => {
		const a = comFonte(
			`const RE = /'/;\nexport const MODEL_BASE_URL = "${ MAU }";\n/* era ' antes; MODEL_BASE_URL = '${ BOM }' */\n`
		);
		expect( a ).toHaveLength( 1 );
	} );

	// I2: regressão introduzida pela própria correção do #1. Qualquer segunda
	// menção ao identificador virava "declaração", e a regra lia o literal ao
	// lado como se fosse o pin — reprovando código correto.
	// Achado II1 da segunda re-review: a âncora de declaração era conferida
	// contra uma fatia CRUA, então o `const` de um trecho de código comentado
	// a satisfazia. Três vetores devolviam zero achado com o pin apontando
	// para outro host. A âncora passa a ler a mesma cópia branqueada em que a
	// ocorrência é achada, e `'`/`"` deixam de atravessar quebra de linha —
	// que é o que fazia o literal de regex engolir a declaração.
	it.each( [
		[
			'isca de bloco com const',
			`const RE = /'/;\nexport const MODEL_BASE_URL = "${ MAU }";\n/* era ' antes; const MODEL_BASE_URL = '${ BOM }' */\n`,
		],
		[
			'isca de linha com const',
			`const RE = /'/;\nexport const MODEL_BASE_URL = "${ MAU }";\n// nao e' mais: const MODEL_BASE_URL = '${ BOM }';\n`,
		],
		[
			'regex de validação realista',
			`const RE = /[^\\s']+/;\nexport const MODEL_BASE_URL = "${ MAU }";\n// antigo (nao e' mais): const MODEL_BASE_URL = '${ BOM }';\n`,
		],
		[
			'const no comentário sem dessincronizar',
			`// TODO trocar por const\nMODEL_BASE_URL = '${ BOM }';\n`,
		],
	] )( 'não é absolvido por %s', ( _, src ) => {
		expect( comFonte( src ) ).toHaveLength( 1 );
	} );

	it( 'uma segunda referência à constante não é uma declaração', () => {
		expect(
			comFonte(
				`export const MODEL_BASE_URL = '${ BOM }';\nexport const VOICES_URL = MODEL_BASE_URL + 'voices.json';\n`
			)
		).toEqual( [] );
	} );

	it( 'a declaração conta com let, var e sem export', () => {
		for ( const forma of [
			`const MODEL_BASE_URL = '${ MAU }';`,
			`let MODEL_BASE_URL = '${ MAU }';`,
			`var MODEL_BASE_URL = '${ MAU }';`,
			`export const MODEL_BASE_URL = '${ MAU }';`,
		] ) {
			expect( {
				forma,
				achados: comFonte( forma + '\n' ).length,
			} ).toEqual( { forma, achados: 1 } );
		}
	} );

	it( 'a chave não carrega quebra de linha, senão a violação é incongelável', () => {
		const a = comFonte(
			'export const MODEL_BASE_URL =\n\t"https://cdn.evil.example.com/" +\n\t"pocket-tts/";\n'
		);
		expect( a.length ).toBeGreaterThan( 0 );
		a.forEach( ( f ) => expect( f.key ).not.toMatch( /\n/ ) );
	} );
} );

describe( 'contract-pins', () => {
	it( 'declara a ADR-0014', () => {
		expect( pins.adr ).toBe( '0014' );
	} );

	it( 'aceita os cinco arquivos concordando', () => {
		expect( pins.check( com() ) ).toEqual( [] );
	} );

	it( 'acusa mínimo de WordPress divergente', () => {
		const a = pins.check(
			com( {
				'readme.txt': 'Requires at least: 6.7\nRequires PHP: 8.2\n',
			} )
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /WordPress/ );
		expect( a[ 0 ].message ).toMatch( /6\.7/ );
	} );

	it( 'acusa mínimo de PHP divergente', () => {
		const a = pins.check(
			com( { 'composer.json': '{ "require": { "php": ">=8.3" } }' } )
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /PHP/ );
	} );

	it( 'acusa MODEL_BASE_URL apontando para uma ref móvel', () => {
		const a = pins.check(
			com( {
				'features/narration/editor/model-source.ts':
					"export const MODEL_BASE_URL =\n\t'https://huggingface.co/luigi-moretti/pocket-tts-onnx-mirror/resolve/main/';\n",
			} )
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /SHA/ );
	} );

	// BLOQUEANTE 1 (rodada 1 de correção): a ADR-0014 exige DUAS coisas do
	// pin — um SHA de commit, E que ele viva no mirror próprio do plugin,
	// "nunca ... para o repositório upstream". Antes deste fixture, a regra
	// só conferia a forma do SHA; uma URL para o upstream real com um SHA de
	// forma válida passava com zero achados.
	it( 'acusa MODEL_BASE_URL apontando para o repositório upstream, mesmo com SHA de forma válida', () => {
		const a = pins.check(
			com( {
				'features/narration/editor/model-source.ts': `export const MODEL_BASE_URL =\n\t'https://huggingface.co/KevinAHM/pocket-tts-onnx/resolve/${ MIRROR_SHA }/';\n`,
			} )
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /mirror/ );
	} );

	it( 'acusa MODEL_BASE_URL apontando para um host qualquer, mesmo com SHA de forma válida', () => {
		const a = pins.check(
			com( {
				'features/narration/editor/model-source.ts': `export const MODEL_BASE_URL =\n\t'https://exemplo.invalido/x/y/resolve/${ MIRROR_SHA }/';\n`,
			} )
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].message ).toMatch( /mirror/ );
	} );

	// Achado ALTO da revisão final da branch. O regex antigo era
	// `MODEL_BASE_URL\s*=\s*[\s\S]*?'([^']+)'`, e o `*?` preguiçoso casa a
	// PRIMEIRA string entre aspas depois do `=`. Num ternário cujo primeiro
	// ramo é o mirror fixado, a regra lia só esse ramo e devolvia zero
	// achados — o segundo ramo podia apontar para qualquer host. Pin de
	// contrato violado com o gate verde, que é o pior resultado possível
	// para a ADR-0014.
	it( 'acusa o ramo ruim de um ternário cujo primeiro ramo é o mirror fixado', () => {
		const a = pins.check(
			com( {
				'features/narration/editor/model-source.ts': `export const MODEL_BASE_URL = navigator.onLine\n\t? '${ MIRROR_URL }'\n\t: 'https://cdn.exemplo.invalido/pocket-tts/latest/';\n`,
			} )
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].key ).toContain( 'cdn.exemplo.invalido' );
	} );

	it( 'acusa TODAS as strings da declaração, e com chaves distintas', () => {
		const a = pins.check(
			com( {
				'features/narration/editor/model-source.ts':
					"export const MODEL_BASE_URL = f\n\t? 'https://a.invalido/x/'\n\t: 'https://b.invalido/y/';\n",
			} )
		);
		expect( a ).toHaveLength( 2 );
		expect( new Set( a.map( ( x ) => x.key ) ).size ).toBe( 2 );
	} );

	it( 'acusa aspas duplas, que o regex antigo não olhava', () => {
		const a = pins.check(
			com( {
				'features/narration/editor/model-source.ts':
					'export const MODEL_BASE_URL = "https://c.invalido/z/";\n',
			} )
		);
		expect( a ).toHaveLength( 1 );
	} );

	// Um template literal com interpolação não é provável por leitura: a regra
	// não pode afirmar que o pin está certo, então acusa em vez de silenciar.
	// Mesma postura que `rest-namespace` toma com namespace dinâmico.
	it( 'acusa template literal interpolado em vez de silenciar', () => {
		const a = pins.check(
			com( {
				'features/narration/editor/model-source.ts':
					'export const MODEL_BASE_URL = `https://huggingface.co/${ dono }/resolve/${ sha }/`;\n',
			} )
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].key ).toMatch( /interpolad/ );
	} );

	// Guarda de regressão do caso legítimo: a declaração real do repositório,
	// que tem `;` só no fim e uma única string.
	it( 'aceita a declaração legítima de uma linha só', () => {
		expect( pins.check( com( {} ) ) ).toEqual( [] );
	} );

	it( 'não fixa o SHA em si: qualquer SHA de 40 hexadígitos no mirror certo passa', () => {
		expect(
			pins.check(
				com( {
					'features/narration/editor/model-source.ts':
						"export const MODEL_BASE_URL =\n\t'https://huggingface.co/luigi-moretti/pocket-tts-onnx-mirror/resolve/0000000000000000000000000000000000000000/';\n",
				} )
			)
		).toEqual( [] );
	} );

	it( 'não fixa o valor: 6.7 em todos os cinco passa', () => {
		expect(
			pins.check(
				com( {
					'post-voice.php':
						' * Requires at least: 6.7\n * Requires PHP: 8.2\n',
					'readme.txt': 'Requires at least: 6.7\nRequires PHP: 8.2\n',
					'.wp-env.json': '{ "core": "WordPress/WordPress#6.7" }',
				} )
			)
		).toEqual( [] );
	} );

	it( 'composer.json não declarar WordPress não é lido como divergência — só PHP tem fonte lá', () => {
		// Se a regra varresse composer.json em busca do mínimo de WordPress,
		// este fixture (que não muda WordPress em lugar nenhum) continuaria
		// batendo, porque composer.json não tem "Requires at least" para casar
		// — e "formato desconhecido" e "divergente" são achados distintos. O
		// teste real desta decisão é a ausência de qualquer achado aqui,
		// junto da lista FONTES_WP não incluir composer.json.
		expect( pins.check( com() ) ).toEqual( [] );
	} );

	it( '.wp-env.json não declarar PHP não é lido como divergência — só WordPress tem fonte lá', () => {
		expect( pins.check( com() ) ).toEqual( [] );
	} );

	it( 'um arquivo ausente do repo (deletado) é ignorado, não conta como divergência', () => {
		const files = { ...REPO };
		delete files[ '.wp-env.json' ];
		const ctx = createContext( {
			files: Object.keys( files ),
			read: ( f ) => files[ f ],
		} );
		expect( pins.check( ctx ) ).toEqual( [] );
	} );

	it( 'um arquivo presente mas num formato que a regra não reconhece não é "divergente"', () => {
		// phpcs.xml.dist só é fonte de PHP (não de WordPress) — quebrar só o
		// seu padrão produz exatamente um achado, não um em cada dimensão.
		const a = pins.check(
			com( { 'phpcs.xml.dist': '<config name="outraCoisa" value="x"/>' } )
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].key ).toBe(
			'phpcs.xml.dist → PHP-formato-desconhecido'
		);
		expect( a[ 0 ].message ).toMatch( /não reconheço o formato/ );
		// Palavra deliberadamente evitada: um formato válido mas incomum
		// (caret range, range do phpcs) não é um arquivo corrompido, e a
		// mensagem não deve sugerir isso.
		expect( a[ 0 ].message ).not.toMatch( /não foi possível ler/ );
	} );

	it( 'sem MODEL_BASE_URL no arquivo, também acusa (não silencia por ausência de match)', () => {
		const a = pins.check(
			com( {
				'features/narration/editor/model-source.ts':
					'export const OUTRA_COISA = 1;\n',
			} )
		);
		expect( a ).toHaveLength( 1 );
		expect( a[ 0 ].key ).toBe(
			'features/narration/editor/model-source.ts → model-base-url'
		);
	} );

	it( 'model-source.ts ausente do repo não é varrido (regra não inventa o arquivo)', () => {
		const files = { ...REPO };
		delete files[ 'features/narration/editor/model-source.ts' ];
		const ctx = createContext( {
			files: Object.keys( files ),
			read: ( f ) => files[ f ],
		} );
		expect( pins.check( ctx ) ).toEqual( [] );
	} );

	// BLOQUEANTE 2 (rodada 1 de correção): duas divergências DIFERENTES —
	// aqui, "readme.txt é o dissidente" e "wp-env.json é o dissidente" — não
	// podem produzir a mesma `key`, porque uma linha de `desvios:` que
	// absolvesse uma absolveria a outra em silêncio. `file` também tem de
	// apontar para um arquivo que de fato participa da divergência.
	describe( 'chave e file de uma divergência identificam QUAL divergência, não só a dimensão', () => {
		const divergenciaReadme = () =>
			pins.check(
				com( {
					'readme.txt': 'Requires at least: 6.7\nRequires PHP: 8.2\n',
				} )
			);
		const divergenciaWpEnv = () =>
			pins.check(
				com( {
					'.wp-env.json': '{ "core": "WordPress/WordPress#6.7" }',
				} )
			);

		it( 'produzem chaves diferentes', () => {
			const a = divergenciaReadme();
			const b = divergenciaWpEnv();
			expect( a ).toHaveLength( 1 );
			expect( b ).toHaveLength( 1 );
			expect( a[ 0 ].key ).not.toBe( b[ 0 ].key );
		} );

		it( '`file` aponta para o arquivo que de fato diverge, não sempre para post-voice.php', () => {
			expect( divergenciaReadme()[ 0 ].file ).toBe( 'readme.txt' );
			expect( divergenciaWpEnv()[ 0 ].file ).toBe( '.wp-env.json' );
		} );

		it( 'a mesma divergência produz sempre a mesma chave (determinístico)', () => {
			const primeira = divergenciaReadme()[ 0 ].key;
			const segunda = divergenciaReadme()[ 0 ].key;
			expect( primeira ).toBe( segunda );
		} );
	} );

	it( 'o repo de hoje concorda', () => {
		expect( pins.check( createContext() ) ).toEqual( [] );
	} );
} );

describe( 'no-npm-install', () => {
	it( 'declara a ADR-0015', () => {
		expect( npmci.adr ).toBe( '0015' );
	} );

	it( 'acusa npm install em workflow', () => {
		const a = npmci.check(
			createContext( {
				files: [ '.github/workflows/ci.yml' ],
				read: () => '      - run: npm install\n',
			} )
		);
		expect( a ).toHaveLength( 1 );
	} );

	// SHOULD-FIX 3 (rodada 1 de correção): `package.json` é um dos três
	// lugares que a ADR-0015, em "## Como verificar", nomeia — e não tinha
	// fixture nenhum. Sem ele, tirar `package.json` do escopo deixava a
	// suíte inteira verde.
	it( 'acusa npm install em package.json', () => {
		const a = npmci.check(
			createContext( {
				files: [ 'package.json' ],
				read: () => '{ "scripts": { "postinstall": "npm install" } }',
			} )
		);
		expect( a ).toHaveLength( 1 );
	} );

	it( 'acusa npm i abreviado', () => {
		expect(
			npmci.check(
				createContext( {
					files: [ 'scripts/x.sh' ],
					read: () => 'npm i --save-dev x\n',
				} )
			)
		).toHaveLength( 1 );
	} );

	it( 'acusa npm add, a mesma decisão por outra porta', () => {
		expect(
			npmci.check(
				createContext( {
					files: [ 'scripts/x.sh' ],
					read: () => 'npm add --save-dev left-pad\n',
				} )
			)
		).toHaveLength( 1 );
	} );

	it( 'aceita npm ci', () => {
		expect(
			npmci.check(
				createContext( {
					files: [ '.github/workflows/ci.yml' ],
					read: () => '      - run: npm ci\n',
				} )
			)
		).toEqual( [] );
	} );

	// Achado da revisão final da branch (ALTO/MÉDIO): `npm install`, `npm i` e
	// `npm add` são três violações DIFERENTES, e colapsavam numa chave só
	// (`<file> → npm-install`). Uma única linha de `desvios:` absolvia as três,
	// e as duas não descritas passavam despercebidas. É o defeito exato que o
	// R19 já tinha corrigido em `forbidden-php.js`, onde a chave carrega o
	// termo casado — este arquivo só não tinha recebido o mesmo tratamento.
	it( 'dá chave DISTINTA para cada forma do comando no mesmo arquivo', () => {
		const a = npmci.check(
			createContext( {
				files: [ 'scripts/setup.sh' ],
				read: () => 'npm install foo\nnpm add bar\nnpm i baz\n',
			} )
		);
		expect( a ).toHaveLength( 3 );
		expect( new Set( a.map( ( x ) => x.key ) ).size ).toBe( 3 );
		expect( a.map( ( x ) => x.key ).sort() ).toEqual( [
			'scripts/setup.sh → npm add',
			'scripts/setup.sh → npm i',
			'scripts/setup.sh → npm install',
		] );
	} );

	// A chave não pode depender de espaçamento: `npm  install` e `npm install`
	// são a mesma violação, e duas chaves para ela fariam a dívida congelada
	// deixar de casar ao reformatar o arquivo.
	it( 'normaliza espaços em branco na chave', () => {
		const a = npmci.check(
			createContext( {
				files: [ 'scripts/setup.sh' ],
				read: () => 'npm   install foo\n',
			} )
		);
		expect( a[ 0 ].key ).toBe( 'scripts/setup.sh → npm install' );
	} );

	it( 'não acusa `npx playwright install --with-deps` — a agulha é "npm install", não "install"', () => {
		expect(
			npmci.check(
				createContext( {
					files: [ '.github/workflows/ci.yml' ],
					read: () =>
						'      - run: npx playwright install --with-deps\n',
				} )
			)
		).toEqual( [] );
	} );

	it( 'não acusa `composer install` — não é npm', () => {
		expect(
			npmci.check(
				createContext( {
					files: [ '.github/workflows/ci.yml' ],
					read: () => '      - run: composer install\n',
				} )
			)
		).toEqual( [] );
	} );

	it( 'não varre a documentação, que fala sobre o comando', () => {
		expect(
			npmci.check(
				createContext( {
					files: [ 'CLAUDE.md' ],
					read: () => 'never `npm install`\n',
				} )
			)
		).toEqual( [] );
	} );

	it( 'não varre docs/adr/README.md, que também nomeia a proibição', () => {
		expect(
			npmci.check(
				createContext( {
					files: [ 'docs/adr/README.md' ],
					read: () =>
						'`npm install` nunca | aceita | `no-npm-install`\n',
				} )
			)
		).toEqual( [] );
	} );

	// SHOULD-FIX 4 (rodada 1 de correção): nem "## Decisão" nem "## Como
	// verificar" da ADR-0015 mencionam git hooks. `.husky/` saiu do escopo —
	// o comentário do escopo não pode afirmar paridade com a ADR e incluir
	// um quarto padrão que ela não nomeia.
	it( 'não varre .husky/, fora do escopo que a ADR-0015 nomeia', () => {
		expect(
			npmci.check(
				createContext( {
					files: [ '.husky/pre-commit' ],
					read: () => 'npm install\n',
				} )
			)
		).toEqual( [] );
	} );

	it( 'HAZARD A: não acusa a si mesma — o arquivo da regra fica fora do escopo mesmo casando a extensão', () => {
		// scripts/lint-arch/rules/no-npm-install.js "casaria" o padrão de
		// escopo (scripts/.../*.js) se não fosse excluído explicitamente, e o
		// próprio arquivo contém a string "npm install" na mensagem que
		// explica a violação. Sem a exclusão por caminho, este teste falharia
		// junto com `lint:arch` no commit que introduz a regra.
		const a = npmci.check(
			createContext( {
				files: [ 'scripts/lint-arch/rules/no-npm-install.js' ],
				read: () =>
					"message: 'use `npm ci`: `npm install` reescreve o lockfile'\n",
			} )
		);
		expect( a ).toEqual( [] );
	} );

	it( 'HAZARD A: também exclui o próprio arquivo de teste que fixa a string em fixture', () => {
		const a = npmci.check(
			createContext( {
				files: [ 'scripts/lint-arch/tests/rules-pins.test.js' ],
				read: () => "read: () => '      - run: npm install\\n'\n",
			} )
		);
		expect( a ).toEqual( [] );
	} );

	// SHOULD-FIX 6 (rodada 1 de correção): a exclusão de auto-referência era
	// o diretório inteiro (`scripts/lint-arch/`), o que também tirava
	// `context.js`, `adr.js` e as OUTRAS regras da varredura sem nenhum
	// motivo — só os dois arquivos acima citam a string literal de propósito.
	// Este fixture prova que o resto do diretório continua policiado.
	it( 'HAZARD A não é larga demais: um outro arquivo sob scripts/lint-arch/ continua policiado', () => {
		const a = npmci.check(
			createContext( {
				files: [ 'scripts/lint-arch/context.js' ],
				read: () => 'npm install\n',
			} )
		);
		expect( a ).toHaveLength( 1 );
	} );

	it( 'fora de scripts/lint-arch/, um outro arquivo sob scripts/ continua sendo varrido', () => {
		const a = npmci.check(
			createContext( {
				files: [ 'scripts/build-plugin-zip.sh' ],
				read: () => 'npm install\n',
			} )
		);
		expect( a ).toHaveLength( 1 );
	} );

	it( 'um .ts/.tsx sob scripts/ fora do escopo declarado (só sh/mjs/js) não é varrido', () => {
		expect(
			npmci.check(
				createContext( {
					files: [ 'scripts/x.ts' ],
					read: () => 'npm install\n',
				} )
			)
		).toEqual( [] );
	} );

	it( 'reporta o número de linha correto quando a ocorrência não está na primeira', () => {
		const a = npmci.check(
			createContext( {
				files: [ 'scripts/x.sh' ],
				read: () => '#!/bin/sh\necho oi\nnpm install\n',
			} )
		);
		expect( a[ 0 ].line ).toBe( 3 );
	} );

	it( 'o repo de hoje não acusa nada', () => {
		expect( npmci.check( createContext() ) ).toEqual( [] );
	} );
} );

describe( 'a chave de divergência não depende da ordem de ctx.files', () => {
	// A chave carrega o conjunto observado inteiro, e é isso que faz duas
	// divergências diferentes não colidirem. Só que uma chave só serve de
	// `desvios:` se for DETERMINÍSTICA: a mesma divergência tem de produzir a
	// mesma string sempre, senão nenhuma linha congelada jamais bate.
	//
	// A ordem vem do array fixo `FONTES_*` da regra, não de `ctx.files`. Trocar
	// a iteração para `ctx.files` passava despercebido, porque em todo fixture
	// as duas ordens coincidiam. Aqui elas são deliberadamente opostas.
	const divergente = {
		'.wp-env.json': '{ "core": "WordPress/WordPress#6.7" }',
	};

	const chaveCom = ( ordem ) => {
		const arquivos = { ...REPO, ...divergente };
		return pins.check(
			createContext( {
				files: ordem,
				read: ( f ) => arquivos[ f ],
			} )
		)[ 0 ].key;
	};

	it( 'a mesma divergência dá a mesma chave nas duas ordens', () => {
		const naturais = Object.keys( { ...REPO, ...divergente } );
		const invertidas = naturais.slice().reverse();
		expect( chaveCom( invertidas ) ).toBe( chaveCom( naturais ) );
	} );

	it( 'e a ordem dentro da chave é a das FONTES, não a de ctx.files', () => {
		const invertidas = Object.keys( { ...REPO, ...divergente } ).reverse();
		expect( chaveCom( invertidas ) ).toBe(
			'pins → WordPress-divergente:post-voice.php=6.6, readme.txt=6.6, .wp-env.json=6.7'
		);
	} );
} );
