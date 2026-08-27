'use strict';
const { phpSources, stripPhpComments, stripPhpNoise } = require( '../context' );

const DOMINIO = 'post-voice';
// Como o domínio aparece nas mensagens de violação: o literal PHP canônico,
// entre aspas simples. A comparação não usa esta forma — ver `textoDoLiteral`.
const DOMINIO_LITERAL = `'${ DOMINIO }'`;

// A lista completa das funções gettext do WordPress que recebem um text
// domain. Conferida contra `wp-includes/l10n.php` do WordPress 6.6 (o mínimo
// suportado) e contra o mapa `$i18n_functions` do sniff `WordPress.WP.I18n` do
// WPCS em `vendor/`, que traz exatamente estes dezesseis nomes. Uma lista
// parcial não é uma cobertura parcial: é um falso negativo silencioso, porque
// a chamada simplesmente não é vista.
//
// `translate_nooped_plural( $nooped, $count, $domain )` fica de fora de
// propósito — recebe um domínio, mas o WPCS não a trata como função de
// tradução (o texto já foi registrado por `_n_noop`/`_nx_noop`), e incluí-la
// divergiria da lista de referência sem cobrir nenhum texto novo.
//
// Guarda de fronteira, igual a `rest-namespace.js` e `php-class-naming.js` nas
// três primeiras partes: `\b` não separa `_` do resto do nome — `_` é
// caractere de palavra — então `\b__\(` não distingue `__(` de `my_helper__(`,
// e `esc_html__` termina exatamente nos mesmos dois caracteres que `__`.
// `(?<!->)` e `(?<!::)` tiram o método próprio, `$o->translate(` e
// `Foo::translate(`.
//
// As três partes seguintes são o que separa CHAMADA de DECLARAÇÃO e de
// INSTANCIAÇÃO, que `nome\s*\(` sozinho não distingue. Todas são PHP legal e
// correto, e nenhuma é uma chamada gettext:
//
//     new Translate( $a, $b );                 → instanciação de classe
//     function translate( $text, $domain ) {}  → declaração (ou um polyfill
//     public function translate( $text ) {}      sob function_exists())
//     $translate( 'a', 'b' );                  → chamada por variável, cujo
//                                                alvo não dá para saber daqui
//
// O buraco é anterior à lista completa — `function __( $a, $b )` já acusava —
// mas `translate` é uma palavra inglesa comum, e a lista completa a
// transformou em gatilho. A guarda vale para os dezesseis nomes: `new _x(`
// também deixa de casar.
//
// Os lookbehinds de `new` e `function` são de comprimento variável (V8 aceita)
// porque `new  Translate(` com dois espaços e `function\ntranslate(` com quebra
// de linha são igualmente legais. O `(?<![\w$])` aninhado dentro de cada um é a
// diferença entre "a palavra new" e "qualquer coisa terminada em new": sem ele,
// `renew translate(` — que é uma chamada de verdade — seria absolvida.
//
// Entre a palavra-chave e o nome ainda cabem duas coisas que a primeira versão
// da guarda não previu, ambas PHP legal (`php -l` 8.2) e ambas acusadas como se
// fossem chamada — falso positivo, que reprova CI em código correto:
//
//     new \Translate( $a );          → nome qualificado a partir da raiz
//     new Foo\Bar\Translate( $a );   → nome qualificado por namespace
//     function &translate( $t ) {}   → retorno por referência
//
// Daí `\\?(?:[A-Za-z_][A-Za-z0-9_]*\\)*` depois de `new\s+` (o qualificador
// inteiro, que pode ser vazio) e a alternativa `\s*&\s*` depois de `function`
// (`function&translate(` sem espaço nenhum também é legal).
//
// O `$` dentro de `(?<![\w$])` é o que impede a alternativa do `&` de virar
// falso negativo: `$function & translate( 'x', 'outro' )` é um E bit a bit
// sobre o retorno de uma chamada DE VERDADE — PHP legal, confirmado com
// `php -l` — e sem excluir o `$` a guarda de `function` absolveria a chamada.
// Falso negativo é a direção pior, e cada lookbehind novo é uma chance a mais
// dele; por isso os dois lados vão para os testes, e não só o que motivou a
// mudança.
//
// As alternativas de nome mais longo vêm primeiro: o motor tenta a alternação
// na ordem dada, e mesmo sem isso o `\s*\(` que segue forçaria o backtracking a
// achar a alternativa certa, mas a ordem deixa a intenção explícita. Aqui isso
// importa em quatro pares: `_n` é prefixo de `_nx`, `_n_noop` e `_nx_noop`, e
// `translate` é prefixo de `translate_with_gettext_context`.
//
// A flag `i` porque nome de função em PHP não diferencia caixa: `_X( 'a' )` e
// `__( 'a' )` chamam as mesmas funções que `_x(` e `__(`. Nenhum lookbehind é
// afetado por ela: `->`, `::` e `$` não têm letra, e `new`/`function` são
// palavras-chave que o PHP também aceita em qualquer caixa.
const CALL_RE =
	/(?<!\w)(?<!->)(?<!::)(?<!(?<![\w$])new\s+\\?(?:[A-Za-z_][A-Za-z0-9_]*\\)*)(?<!(?<![\w$])function(?:\s+|\s*&\s*))(?<!\$)(translate_with_gettext_context|esc_attr__|esc_attr_e|esc_attr_x|esc_html__|esc_html_e|esc_html_x|translate|_nx_noop|_n_noop|_nx|_ex|__|_e|_n|_x)\s*\(/gi;

// Aridade mínima de cada função — o domínio é sempre o ÚLTIMO argumento.
// Usado para separar "domínio ausente" (menos argumentos do que a função
// exige) de "domínio errado" (o último argumento existe e não é
// 'post-voice'): dois defeitos diferentes, precisam de chaves diferentes.
// Cada número é a contagem de parâmetros da assinatura real em l10n.php.
const ARIDADE = {
	// ( $text, $domain )
	__: 2,
	_e: 2,
	esc_attr__: 2,
	esc_attr_e: 2,
	esc_html__: 2,
	esc_html_e: 2,
	translate: 2,
	// ( $text, $context, $domain )
	_x: 3,
	_ex: 3,
	esc_attr_x: 3,
	esc_html_x: 3,
	translate_with_gettext_context: 3,
	// ( $singular, $plural, $domain )
	_n_noop: 3,
	// ( $singular, $plural, $context, $domain )
	_nx_noop: 4,
	// ( $single, $plural, $number, $domain )
	_n: 4,
	// ( $single, $plural, $number, $context, $domain )
	_nx: 5,
};

// Um literal de string PHP e nada mais — aspas simples ou duplas. `"post-voice"`
// é PHP tão legal quanto `'post-voice'`, e comparar contra a forma com aspas
// simples reprovava a outra. Estrito de propósito: uma barra invertida em
// qualquer das duas famílias, ou um `$` dentro de aspas duplas, derruba o
// reconhecimento — `"post-$voice"` interpola e `'post' . '-voice'` concatena, e
// nenhum dos dois é um literal cujo valor dê para ler daqui. Isso não perde
// nada: o domínio procurado não contém `\`, `$` nem aspas, então nenhum literal
// que precise de escape poderia ser igual a ele de todo modo.
const LITERAL_ASPAS_SIMPLES_RE = /^'([^'\\]*)'$/;
const LITERAL_ASPAS_DUPLAS_RE = /^"([^"\\$]*)"$/;

/**
 * O texto de um literal de string PHP simples.
 *
 * @param {string} arg um argumento já trimado
 * @return {string|null} o conteúdo, ou null se `arg` não for um literal simples
 */
function textoDoLiteral( arg ) {
	const m =
		LITERAL_ASPAS_SIMPLES_RE.exec( arg ) ||
		LITERAL_ASPAS_DUPLAS_RE.exec( arg );
	return m === null ? null : m[ 1 ];
}

/**
 * Todas as chamadas gettext do arquivo, com os argumentos crus.
 *
 * Padrão de duas fontes, idêntico ao de `rest-namespace.js` e
 * `php-class-naming.js`: DUAS passadas INDEPENDENTES sobre o arquivo CRU.
 * `codigo` (`stripPhpNoise`) é onde a CHAMADA é reconhecida, porque uma
 * string cujo *conteúdo* parece uma chamada (`"chame __( 'x', 'outro' )"`)
 * não pode casar como se fosse código de verdade. `source`
 * (`stripPhpComments`, com os literais de string intactos) é de onde vem o
 * argumento de verdade, já que é ali que o literal `'post-voice'`
 * sobrevive. Os dois strippers apagam PARA ESPAÇO, então preservam
 * comprimento em bytes e número de linhas: um offset em um vale no outro.
 *
 * As duas passadas são independentes DE PROPÓSITO. Esta função já
 * compôs — `stripPhpNoise( stripPhpComments( x ) )` — sob a alegação de
 * que compor "é seguro, os comentários já viraram espaços". A alegação é
 * FALSA, e foi falsificada duas vezes: `stripPhpComments` apaga comentário
 * PARA ESPAÇO, e o cabeçalho de heredoc aceita espaço entre `<<<` e o
 * rótulo (`<<< EOT` é PHP legal), então a primeira passada SINTETIZA um
 * cabeçalho que não existia no original — `$a = <<</*x*\/EOT\n` vira
 * `$a = <<<     EOT\n` — e o corpo sintético engole o resto do arquivo.
 * Toda chamada gettext depois dele desaparece: falso negativo silencioso.
 * Apertar `HEREDOC_CABECALHO_RE` não resolve, porque na segunda passada o
 * espaço legítimo de `<<< EOT` e o comentário apagado são textualmente o
 * mesmo texto — trocaria este falso negativo por um falso positivo em
 * heredoc legal. Rodar as duas passadas sobre o cru mata a classe inteira:
 * nenhum stripper vê a saída do outro, então nenhum pode sintetizar
 * sintaxe para o outro. Não volte a compor.
 *
 * Uma versão anterior desta função tentou o mesmo padrão contra um
 * `strip()` que ainda não distinguia `<?php ... ?>` de HTML puro: um
 * atributo como `aria-label="<?php esc_attr_e( 'x', 'post-voice' ); ?>"`
 * fazia a aspa dupla do HTML abrir um rastreamento de string que só fechava
 * do lado de fora do `?>`, e `stripPhpNoise` apagava a chamada inteira
 * junto — derrubando o total real do repo de 48 para 38, um falso negativo
 * silencioso. Isso foi corrigido em `context.js` (`strip` agora rastreia
 * dentro/fora de `<?php ... ?>`), então o padrão de duas fontes volta a
 * valer aqui como nas outras regras.
 *
 * Percorre os parênteses contando profundidade em `codigo`, não em regex,
 * porque `__( sprintf( '%s (x)', $a ), 'post-voice' )` derruba qualquer
 * padrão `\(([^)]*)\)` — e por já estar em `codigo`, o parêntese dentro do
 * literal `'%s (x)'` já está em branco, então nem chega a contar.
 *
 * @param {string} raw o conteúdo CRU do arquivo, sem nenhum stripper aplicado
 * @return {Object[]} um item por chamada: { fn, args, index }
 */
function gettextCalls( raw ) {
	const codigo = stripPhpNoise( raw );
	const source = stripPhpComments( raw );
	const out = [];
	CALL_RE.lastIndex = 0;
	let m;
	while ( ( m = CALL_RE.exec( codigo ) ) !== null ) {
		const abre = m.index + m[ 0 ].length - 1;
		let profundidade = 0;
		let fecha = abre;
		for ( let j = abre; j < codigo.length; j += 1 ) {
			if ( codigo[ j ] === '(' ) {
				profundidade += 1;
			} else if ( codigo[ j ] === ')' ) {
				profundidade -= 1;
				if ( profundidade === 0 ) {
					fecha = j;
					break;
				}
			}
		}
		out.push( {
			// Nome canônico, em minúsculas: PHP não diferencia caixa em nome
			// de função, então `_X(` e `_x(` são a MESMA função e o mesmo
			// defeito. Sem normalizar aqui, as duas grafias virariam duas
			// chaves de desvio diferentes para um defeito só — e `ARIDADE`,
			// indexada pelo nome canônico, não acharia `_X`.
			fn: m[ 1 ].toLowerCase(),
			args: source.slice( abre, fecha + 1 ),
			index: m.index,
		} );
	}
	return out;
}

/**
 * Separa os argumentos de nível superior de uma chamada, respeitando aspas
 * e parênteses/colchetes aninhados — uma vírgula dentro de `sprintf( ... )`
 * ou dentro de uma string não é um separador de argumento.
 *
 * @param {string} args a chamada inteira, com os parênteses externos: "( a, b )"
 * @return {string[]} um item por argumento de nível superior, trimado
 */
function dividirArgumentos( args ) {
	const corpo = args.slice( 1, -1 );
	const partes = [];
	let atual = '';
	let profundidade = 0;
	let aspas = null;
	for ( let i = 0; i < corpo.length; i += 1 ) {
		const c = corpo[ i ];
		if ( aspas ) {
			atual += c;
			if ( c === '\\' ) {
				i += 1;
				atual += corpo[ i ] || '';
				continue;
			}
			if ( c === aspas ) {
				aspas = null;
			}
			continue;
		}
		if ( c === "'" || c === '"' ) {
			aspas = c;
			atual += c;
			continue;
		}
		if ( c === '(' || c === '[' ) {
			profundidade += 1;
			atual += c;
			continue;
		}
		if ( c === ')' || c === ']' ) {
			profundidade -= 1;
			atual += c;
			continue;
		}
		if ( c === ',' && profundidade === 0 ) {
			partes.push( atual );
			atual = '';
			continue;
		}
		atual += c;
	}
	// A parte que sobra depois do último separador só é um argumento se tiver
	// conteúdo. Uma vírgula à direita — `__( 'x', 'post-voice', )`, legal desde
	// o PHP 8.0 — deixa ali uma parte vazia que não é argumento nenhum, e
	// empurrá-la fazia a checagem ler o domínio como "" e reprovar PHP correto.
	// Descartá-la é também o que mantém `__( 'x', )` contando UM argumento, ou
	// seja, domínio AUSENTE, e não um domínio vazio "errado": os dois são
	// defeitos diferentes e não podem colidir na mesma chave.
	if ( atual.trim() !== '' ) {
		partes.push( atual );
	}
	return partes.map( ( p ) => p.trim() );
}

/**
 * Confere o domínio de uma chamada já resolvida em `{ fn, args }`.
 *
 * @param {string} fn   o nome da função gettext
 * @param {string} args a chamada inteira, com os parênteses externos
 * @return {{ tipo: 'ausente'|'errado', mensagem: string }|null} null quando ok
 */
function avaliarDominio( fn, args ) {
	const partes = dividirArgumentos( args );
	const minimo = ARIDADE[ fn ];
	if ( partes.length < minimo ) {
		return {
			tipo: 'ausente',
			mensagem: `${ fn }() está sem o argumento de text domain; o esperado é ${ DOMINIO_LITERAL } (ADR-0010)`,
		};
	}
	const ultimo = partes[ partes.length - 1 ];
	if ( textoDoLiteral( ultimo ) === DOMINIO ) {
		return null;
	}
	return {
		tipo: 'errado',
		mensagem: `${ fn }() não usa o text domain ${ DOMINIO_LITERAL } (ADR-0010)`,
	};
}

function check( ctx ) {
	const achados = [];
	for ( const file of phpSources( ctx ) ) {
		// O CRU: `gettextCalls` faz as duas passadas por conta própria, e
		// entregar a ela um texto já strippado é exatamente o defeito que o
		// JSDoc dela descreve. A linha sai do cru pelo mesmo motivo que o
		// offset serve nas duas fontes — os strippers preservam as quebras.
		const raw = ctx.read( file );
		for ( const { fn, args, index } of gettextCalls( raw ) ) {
			const problema = avaliarDominio( fn, args );
			if ( problema === null ) {
				continue;
			}
			achados.push( {
				key: `${ file } → ${ fn }-dominio-${ problema.tipo }`,
				file,
				line: raw.slice( 0, index ).split( '\n' ).length,
				message: problema.mensagem,
			} );
		}
	}
	return achados;
}

const contarChamadas = ( ctx ) =>
	phpSources( ctx ).reduce(
		( total, file ) => total + gettextCalls( ctx.read( file ) ).length,
		0
	);

module.exports = {
	id: 'i18n-text-domain',
	adr: '0010',
	check,
	gettextCalls,
	contarChamadas,
};
