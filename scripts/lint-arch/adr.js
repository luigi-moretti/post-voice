'use strict';
// Parser do front-matter das ADRs. Subconjunto deliberado de YAML: `chave: valor`,
// lista inline `[ a, b ]` e lista em bloco com `- `. Dependência nova está proibida
// (o lockfile é a superfície de auditoria), e o subconjunto cabe em trinta linhas.
const fs = require( 'node:fs' );
const path = require( 'node:path' );

const STATUSES = [ 'proposta', 'aceita', 'aceita-com-desvio', 'revogada' ];
const SUPERSEDED_RE = /^superada-por-\d{4}$/;
const OBRIGATORIOS = [
	'id',
	'titulo',
	'status',
	'data',
	'origem',
	'enforced_by',
];

/**
 * Corta o comentário à direita.
 *
 * O gatilho é " #", com espaço antes, e não "#" sozinho: `origem` costuma
 * terminar numa âncora (`...design.md#arquitetura`) que não é comentário.
 *
 * @param {string} line
 * @return {string} a linha sem o comentário
 */
function stripComment( line ) {
	const i = line.indexOf( ' #' );
	return i === -1 ? line : line.slice( 0, i );
}

/**
 * Lê a lista inline `[ a, b ]`.
 *
 * O split é por vírgula, sem aspas nem escape — e uma chave de desvio pode
 * conter vírgulas (`... → fora de features/<f>/{php,editor,frontend,admin,tests}/`
 * tem quatro). Estilhaçada, ela não bate mais com a chave que o linter produz:
 * a violação segue reprovando E cada fragmento vira um aviso de "dívida
 * quitada". Barulhento, mas silencioso quanto à causa.
 *
 * Toda chave de desvio tem ` → `, e nenhum outro campo de lista tem. Então a
 * seta na forma inline é a assinatura exata do caso perigoso, e é recusada com
 * a instrução de usar a forma de bloco — que não tem separador para estilhaçar.
 *
 * @param {string} raw  o valor entre colchetes, já trimado
 * @param {string} key  o nome do campo, para a mensagem de erro
 * @param {string} file caminho relativo, para a mensagem de erro
 * @return {string[]} os itens
 */
function parseInlineList( raw, key, file ) {
	if ( raw.includes( '→' ) ) {
		throw new Error(
			`${ file }: ${ key } em lista inline contém " → ", e chaves com vírgula se estilhaçam no split; use a forma de bloco (uma linha "  - " por item)`
		);
	}
	return raw
		.replace( /^\[/, '' )
		.replace( /\]$/, '' )
		.split( ',' )
		.map( ( item ) => desaspar( item.trim() ) )
		.filter( Boolean );
}

/**
 * Tira as aspas que envolvem o item inteiro.
 *
 * `desvios:` guarda a `key` que a regra emitiu, casada caractere a caractere.
 * Aspas em volta são forma legítima de YAML, e o passo 1 da skill manda "copie
 * esse texto entre aspas" — que se lê das duas maneiras. Sem desaspar, as
 * aspas viravam parte da chave, a entrada não casava com nada, a violação
 * seguia reprovando e o aviso saía com aspas duplicadas. Custou um ciclo de
 * review para alguém descobrir.
 *
 * @param {string} item
 * @return {string} o item sem as aspas externas
 */
function desaspar( item ) {
	const m = item.match( /^"(.*)"$/s ) || item.match( /^'(.*)'$/s );
	return m ? m[ 1 ] : item;
}

function parseFrontMatter( source, file ) {
	const match = source.match( /^---\r?\n([\s\S]*?)\r?\n---\r?\n/ );
	if ( ! match ) {
		throw new Error(
			`${ file }: sem front-matter YAML delimitado por ---`
		);
	}
	const fields = {};
	let chaveCorrente = null;
	for ( const rawLine of match[ 1 ].split( /\r?\n/ ) ) {
		const line = stripComment( rawLine );
		if ( ! line.trim() ) {
			continue;
		}
		const item = line.match( /^\s+-\s+(.*)$/ );
		if ( item ) {
			if (
				! chaveCorrente ||
				! Array.isArray( fields[ chaveCorrente ] )
			) {
				throw new Error(
					`${ file }: item de lista sem chave: ${ rawLine }`
				);
			}
			fields[ chaveCorrente ].push( desaspar( item[ 1 ].trim() ) );
			continue;
		}
		const pair = line.match( /^([a-z_]+):\s*(.*)$/ );
		if ( ! pair ) {
			throw new Error(
				`${ file }: linha de front-matter ilegível: ${ rawLine }`
			);
		}
		const [ , key, rawValue ] = pair;
		const value = rawValue.trim();
		chaveCorrente = key;
		if ( value.startsWith( '[' ) ) {
			fields[ key ] = parseInlineList( value, key, file );
		} else if ( value === '' ) {
			// Chave sem valor na mesma linha abre uma lista em bloco. Se nenhum
			// item vier, fica [] — que é o que `desvios:` vazio significa.
			fields[ key ] = [];
		} else {
			fields[ key ] = value;
		}
	}
	return fields;
}

/**
 * @param {string} source conteúdo do arquivo
 * @param {string} file   caminho relativo, usado nas mensagens de erro
 * @return {Object} a ADR normalizada
 */
function parseAdr( source, file ) {
	const fields = parseFrontMatter( source, file );

	for ( const key of OBRIGATORIOS ) {
		if ( fields[ key ] === undefined ) {
			throw new Error( `${ file }: campo obrigatório ausente: ${ key }` );
		}
	}
	if ( ! /^\d{4}$/.test( fields.id ) ) {
		throw new Error(
			`${ file }: id tem de ter quatro dígitos, recebeu "${ fields.id }"`
		);
	}
	if ( ! /^\d{4}-\d{2}-\d{2}$/.test( fields.data ) ) {
		throw new Error(
			`${ file }: data tem de ser AAAA-MM-DD, recebeu "${ fields.data }"`
		);
	}
	if (
		! STATUSES.includes( fields.status ) &&
		! SUPERSEDED_RE.test( fields.status )
	) {
		throw new Error(
			`${ file }: status "${
				fields.status
			}" desconhecido; use ${ STATUSES.join(
				' | '
			) } | superada-por-NNNN`
		);
	}
	if (
		! Array.isArray( fields.enforced_by ) ||
		fields.enforced_by.length === 0
	) {
		throw new Error(
			`${ file }: enforced_by tem de ser uma lista não vazia, mesmo com um item só`
		);
	}
	const desvios = fields.desvios === undefined ? [] : fields.desvios;
	if ( ! Array.isArray( desvios ) ) {
		throw new Error( `${ file }: desvios tem de ser uma lista` );
	}
	if ( fields.status === 'aceita-com-desvio' && desvios.length === 0 ) {
		throw new Error(
			`${ file }: status aceita-com-desvio exige pelo menos um desvio listado`
		);
	}
	if ( fields.status === 'aceita' && desvios.length > 0 ) {
		throw new Error(
			`${ file }: status aceita não admite desvios; use aceita-com-desvio`
		);
	}

	return {
		id: fields.id,
		titulo: fields.titulo,
		status: fields.status,
		data: fields.data,
		origem: fields.origem,
		enforcedBy: fields.enforced_by,
		revisarQuando: Array.isArray( fields.revisar_quando )
			? ''
			: fields.revisar_quando || '',
		desvios,
		file,
		linhas: source.split( '\n' ).length,
	};
}

/**
 * @param {string} dir diretório com as ADRs
 * @return {Object[]} ADRs ordenadas por id
 */
function loadAdrs( dir ) {
	const adrs = [];
	const vistos = new Set();
	for ( const name of fs.readdirSync( dir ).sort() ) {
		if ( ! /^\d{4}-.*\.md$/.test( name ) ) {
			continue;
		}
		const rel = path.posix.join( 'docs/adr', name );
		const adr = parseAdr(
			fs.readFileSync( path.join( dir, name ), 'utf8' ),
			rel
		);
		if ( adr.id !== name.slice( 0, 4 ) ) {
			throw new Error(
				`${ rel }: id "${ adr.id }" não bate com o nome do arquivo`
			);
		}
		if ( vistos.has( adr.id ) ) {
			throw new Error( `${ rel }: id ${ adr.id } duplicado` );
		}
		vistos.add( adr.id );
		adrs.push( adr );
	}
	return adrs;
}

module.exports = { parseAdr, loadAdrs, STATUSES, SUPERSEDED_RE };
