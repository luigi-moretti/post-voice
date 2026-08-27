'use strict';
const { phpSources, stripPhpComments } = require( '../context' );

const DOMINIO = "'post-voice'";

// Guarda de fronteira em três partes, igual a `rest-namespace.js` e
// `php-class-naming.js`: `\b` não separa `_` do resto do nome — `_` é
// caractere de palavra — então `\b__\(` não distingue `__(` de `my_helper__(`,
// e `esc_html__` termina exatamente nos mesmos dois caracteres que `__`. As
// alternativas de nome mais longo vêm primeiro: o motor tenta a alternação na
// ordem dada, e mesmo sem isso o `\s*\(` que segue forçaria o backtracking a
// achar a alternativa certa, mas a ordem deixa a intenção explícita.
const CALL_RE =
	/(?<!\w)(?<!->)(?<!::)(esc_html__|esc_attr__|esc_html_e|esc_attr_e|_nx|_ex|__|_e|_x|_n)\s*\(/g;

// Aridade mínima de cada função — o domínio é sempre o ÚLTIMO argumento.
// Usado para separar "domínio ausente" (menos argumentos do que a função
// exige) de "domínio errado" (o último argumento existe e não é
// 'post-voice'): dois defeitos diferentes, precisam de chaves diferentes.
const ARIDADE = {
	__: 2,
	_e: 2,
	esc_html__: 2,
	esc_attr__: 2,
	esc_html_e: 2,
	esc_attr_e: 2,
	_x: 3,
	_ex: 3,
	_n: 4,
	_nx: 5,
};

/**
 * Todas as chamadas gettext do arquivo, com os argumentos crus.
 *
 * Não usa `stripPhpNoise`: esta regra precisa **ler** o literal
 * `'post-voice'` dentro da chamada, então não dá para apagar o corpo das
 * strings como `rest-namespace.js` e `php-class-naming.js` fazem para achar
 * a CHAMADA. Isso não é uma omissão do padrão de duas fontes daquelas
 * regras — foi tentado e descartado deliberadamente: o `strip()` de
 * `context.js` não entende a transição `?> ... <?php` do PHP misturado com
 * HTML, então um atributo HTML como `aria-label="<?php esc_attr_e( 'x',
 * 'post-voice' ); ?>"` faz o rastreador de aspas achar que as aspas duplas
 * do atributo abrem uma string PHP que só fecha na aspa dupla do lado de
 * fora do `?>` — e `stripPhpNoise` apagaria a chamada inteira que está
 * "dentro" dela. Rodar o reconhecimento da chamada sobre esse texto
 * apagado faz `features/narration/php/class-frontend-render.php` perder 7
 * das suas 7 chamadas (todas vivem em atributo HTML desse jeito): o total
 * do repo cai de 48 para 38, um falso negativo silencioso, exatamente o
 * tipo de bug que essa regra existe para pegar. O risco que o padrão de
 * duas fontes evita — uma STRING cujo conteúdo parece uma chamada — foi
 * conferido contra as 48 chamadas reais e não ocorre aqui; caso um dia
 * ocorra, é um falso positivo isolado (uma linha a mais em `desvios:`),
 * não a maioria das chamadas do plugin desaparecendo da varredura.
 *
 * Percorre os parênteses contando profundidade em vez de casar com
 * expressão regular: `__( sprintf( '%s (x)', $a ), 'post-voice' )` derruba
 * qualquer regex de `\(([^)]*)\)`. Um parêntese dentro do CORPO de uma
 * string do argumento (`'%s (x)'`) ainda é contado aqui — mas como todo
 * parêntese de string bem formada é balanceado, a profundidade volta a
 * zero no lugar certo de qualquer forma.
 *
 * @param {string} source arquivo já sem comentários (stripPhpComments)
 * @return {Object[]} um item por chamada: { fn, args, index }
 */
function gettextCalls( source ) {
	const out = [];
	CALL_RE.lastIndex = 0;
	let m;
	while ( ( m = CALL_RE.exec( source ) ) !== null ) {
		const abre = m.index + m[ 0 ].length - 1;
		let profundidade = 0;
		let fecha = abre;
		for ( let j = abre; j < source.length; j += 1 ) {
			if ( source[ j ] === '(' ) {
				profundidade += 1;
			} else if ( source[ j ] === ')' ) {
				profundidade -= 1;
				if ( profundidade === 0 ) {
					fecha = j;
					break;
				}
			}
		}
		out.push( {
			fn: m[ 1 ],
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
	if ( corpo.trim() !== '' || partes.length > 0 ) {
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
			mensagem: `${ fn }() está sem o argumento de text domain; o esperado é ${ DOMINIO } (ADR-0010)`,
		};
	}
	const ultimo = partes[ partes.length - 1 ];
	if ( ultimo === DOMINIO ) {
		return null;
	}
	return {
		tipo: 'errado',
		mensagem: `${ fn }() não usa o text domain ${ DOMINIO } (ADR-0010)`,
	};
}

function check( ctx ) {
	const achados = [];
	for ( const file of phpSources( ctx ) ) {
		const source = stripPhpComments( ctx.read( file ) );
		for ( const { fn, args, index } of gettextCalls( source ) ) {
			const problema = avaliarDominio( fn, args );
			if ( problema === null ) {
				continue;
			}
			achados.push( {
				key: `${ file } → ${ fn }-dominio-${ problema.tipo }`,
				file,
				line: source.slice( 0, index ).split( '\n' ).length,
				message: problema.mensagem,
			} );
		}
	}
	return achados;
}

const contarChamadas = ( ctx ) =>
	phpSources( ctx ).reduce(
		( total, file ) =>
			total + gettextCalls( stripPhpComments( ctx.read( file ) ) ).length,
		0
	);

module.exports = {
	id: 'i18n-text-domain',
	adr: '0010',
	check,
	gettextCalls,
	contarChamadas,
};
