'use strict';
// Verificações heurísticas do `doctor`. Puras, para serem testáveis; o
// doctor.mjs é só a casca que lê o disco e imprime. Nada aqui bloqueia.

const CITACAO_RE = /\(ADR-(\d{4})\)/g;
const LIMITE_ABRANGENCIA = 0.6;

function secoes( source ) {
	const out = new Map();
	let atual = null;
	for ( const line of source.split( '\n' ) ) {
		const h = line.match( /^##\s+(.*)$/ );
		if ( h ) {
			atual = h[ 1 ].trim();
			out.set( atual, [] );
		} else if ( atual ) {
			out.get( atual ).push( line );
		}
	}
	return out;
}

function checkClaudeMdSize( source, teto = 95 ) {
	const linhas = source.split( '\n' ).length;
	if ( linhas <= teto ) {
		return [];
	}
	const maior = [ ...secoes( source ).entries() ].sort(
		( a, b ) => b[ 1 ].length - a[ 1 ].length
	)[ 0 ];
	const alvo = maior
		? `A maior seção é "## ${ maior[ 0 ] }", com ${ maior[ 1 ].length } linhas.`
		: '';
	return [
		{
			message: `CLAUDE.md tem ${ linhas } linhas, acima do teto de ${ teto }. ${ alvo } Convenção com escopo de caminho vai para .claude/rules/ (ADR-0001).`,
		},
	];
}

/**
 * @param {string}   source
 * @param {string[]} nomes  seções a verificar; lista vazia = arquivo inteiro
 * @param {Set}      adrIds ids existentes
 * @return {Object[]} problemas
 */
function checkAdrCitations( source, nomes, adrIds ) {
	// Sem lista de seções, o alvo é o arquivo inteiro — mas sem o front-matter:
	// cada item de `paths:` começa com "- " e seria lido como bullet de convenção.
	const corpo = source.replace( /^---\r?\n[\s\S]*?\r?\n---\r?\n/, '' );
	const blocos = nomes.length
		? nomes.map( ( n ) => ( secoes( source ).get( n ) || [] ).join( '\n' ) )
		: [ corpo ];
	const problemas = [];
	for ( const bloco of blocos ) {
		for ( const line of bloco.split( '\n' ) ) {
			if ( ! /^\s*-\s+\S/.test( line ) ) {
				continue;
			}
			CITACAO_RE.lastIndex = 0;
			const citadas = [ ...line.matchAll( CITACAO_RE ) ].map(
				( m ) => m[ 1 ]
			);
			if ( ! citadas.length ) {
				problemas.push( {
					message: `linha de convenção sem citação de ADR: "${ line.trim() }". O formato é (ADR-NNNN).`,
				} );
				continue;
			}
			for ( const id of citadas ) {
				if ( ! adrIds.has( id ) ) {
					problemas.push( {
						message: `cita ADR-${ id }, que não existe em docs/adr/: "${ line.trim() }"`,
					} );
				}
			}
		}
	}
	return problemas;
}

/**
 * Glob → RegExp. Subconjunto: `**`, `*`, `?` e `{a,b}`.
 *
 * @param {string} glob
 * @return {RegExp} âncorada
 */
function globToRegExp( glob ) {
	let out = '';
	for ( let i = 0; i < glob.length; i += 1 ) {
		const c = glob[ i ];
		if ( c === '*' ) {
			if ( glob[ i + 1 ] === '*' ) {
				// `**/` casa com zero ou mais segmentos; `**` sozinho casa com tudo.
				if ( glob[ i + 2 ] === '/' ) {
					out += '(?:[^/]+/)*';
					i += 2;
				} else {
					out += '.*';
					i += 1;
				}
			} else {
				out += '[^/]*';
			}
		} else if ( c === '?' ) {
			out += '[^/]';
		} else if ( c === '{' ) {
			const fim = glob.indexOf( '}', i );
			out +=
				'(?:' +
				glob
					.slice( i + 1, fim )
					.split( ',' )
					.map( ( s ) => s.replace( /[.+^${}()|[\]\\]/g, '\\$&' ) )
					.join( '|' ) +
				')';
			i = fim;
		} else {
			out += c.replace( /[.+^${}()|[\]\\]/g, '\\$&' );
		}
	}
	return new RegExp( `^${ out }$` );
}

function parseRulePaths( source ) {
	const fm = source.match( /^---\r?\n([\s\S]*?)\r?\n---/ );
	if ( ! fm ) {
		return [];
	}
	const bloco = fm[ 1 ].match( /paths:\s*\n((?:\s+-\s+.*\n?)+)/ );
	if ( ! bloco ) {
		return [];
	}
	return bloco[ 1 ]
		.split( '\n' )
		.map( ( l ) => ( l.match( /^\s+-\s+["']?(.+?)["']?\s*$/ ) || [] )[ 1 ] )
		.filter( Boolean );
}

/**
 * Glob morto nunca carrega; glob largo demais é CLAUDE.md com passos extras.
 *
 * @param {Object[]} rules { file, paths }
 * @param {string[]} files arquivos versionados
 * @return {Object[]} problemas
 */
function checkRulePaths( rules, files ) {
	const problemas = [];
	for ( const { file, paths } of rules ) {
		if ( ! paths.length ) {
			problemas.push( {
				message: `${ file } não declara paths:. Rule sem paths carrega em toda sessão, com o mesmo custo do CLAUDE.md.`,
			} );
			continue;
		}
		const res = paths.map( globToRegExp );
		const casados = files.filter( ( f ) =>
			res.some( ( re ) => re.test( f ) )
		).length;
		if ( casados === 0 ) {
			problemas.push( {
				message: `${ file }: paths: não casa com nenhum arquivo versionado. Glob morto — a rule nunca carrega.`,
			} );
		} else if ( casados / files.length > LIMITE_ABRANGENCIA ) {
			const pct = Math.round( ( casados / files.length ) * 100 );
			problemas.push( {
				message: `${ file }: paths: casa com ${ pct }% dos arquivos, acima de 60%. Uma rule que sempre carrega é CLAUDE.md com passos extras.`,
			} );
		}
	}
	return problemas;
}

function checkIndex( adrs, readme ) {
	return adrs
		.filter( ( a ) => ! readme.includes( a.file.split( '/' ).pop() ) )
		.map( ( a ) => ( {
			message: `ADR-${ a.id } não aparece no índice docs/adr/README.md.`,
		} ) );
}

function checkAdrHygiene( adrs, files ) {
	const problemas = [];
	for ( const adr of adrs ) {
		if ( adr.linhas > 120 ) {
			problemas.push( {
				message: `ADR-${ adr.id } tem ${ adr.linhas } linhas, acima do teto de 120. Virou spec disfarçada?`,
			} );
		}
		// `origem` é um caminho relativo a docs/, então a checagem é de existência
		// exata. Casar por sufixo aceitaria qualquer `.../specs/x.md` — frouxo
		// demais para a única verificação que a ADR-0001 declara sobre si mesma.
		const alvo = 'docs/' + adr.origem.split( '#' )[ 0 ];
		if ( ! files.includes( alvo ) ) {
			problemas.push( {
				message: `ADR-${ adr.id }: origem "${ adr.origem }" não aponta para nenhum arquivo existente.`,
			} );
		}
	}
	return problemas;
}

module.exports = {
	checkClaudeMdSize,
	checkAdrCitations,
	checkRulePaths,
	checkIndex,
	checkAdrHygiene,
	globToRegExp,
	parseRulePaths,
};
