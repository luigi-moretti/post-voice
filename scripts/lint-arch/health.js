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

function checkClaudeMdSize( source, teto = CLAUDE_MD_LINE_CEILING ) {
	// Arquivo ausente ou vazio chega aqui como '' e caberia folgado no teto —
	// o relatório diria "nada a relatar" sobre o arquivo que ancora metade
	// destas checagens. Silêncio que se lê como saúde é o pior resultado
	// possível para um relatório.
	if ( ! source.trim() ) {
		return [
			{
				message:
					'CLAUDE.md não foi encontrado ou está vazio. Metade das checagens desta seção depende dele.',
			},
		];
	}
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

// A fiação que os rulings R5 e R6 decidiram mora AQUI, não no ponto de chamada,
// porque aqui é medido por teste e o `doctor.mjs` não é. Antes, um comentário
// era tudo que impedia alguém de voltar o teto para 80 ou de reintroduzir
// `## Never` na checagem de citação.
const CLAUDE_MD_LINE_CEILING = 95;

// Só `## Conventions`. `## Never` fica de fora de propósito: "não commite em
// master" é processo, não decisão de arquitetura, e não há ADR por trás para
// citar — exigir citação ali produz achado que ninguém consegue fechar.
const CITED_SECTIONS = [ 'Conventions' ];

/**
 * Os dois números que alimentam o `revisar_quando` das ADR-0004 e 0005.
 *
 * Vive aqui, e não no `doctor.mjs`, porque tem lógica de verdade e alimenta um
 * julgamento humano — "já é hora de reabrir aquela decisão?". O `doctor.mjs`
 * está fora do `collectCoverageFrom`, então lógica lá dentro não é medida por
 * nada.
 *
 * @param {Object} ctx
 * @return {{ features: string[], sharedModules: number }} nomes das features,
 *   ordenados, e a contagem de módulos de produção em shared/
 */
function reviewTriggerCounts( ctx ) {
	const features = [
		...new Set(
			ctx.files
				.filter( ( f ) => f.startsWith( 'features/' ) )
				.map( ( f ) => f.split( '/' )[ 1 ] )
		),
	].sort();
	const sharedModules = ctx.files.filter( ( f ) =>
		/^shared\/php\/class-.*\.php$/.test( f )
	).length;
	return { features, sharedModules };
}

/**
 * Arquivos acima do percentil 95 de tamanho — sinal RELATIVO de "faz coisa
 * demais", sem limiar arbitrário que envelhece.
 *
 * O bundle vendorizado sob `editor/engine/` fica fora: ele é grande por não ser
 * nosso, e mantê-lo dentro empurraria o p95 para cima e esconderia os nossos.
 *
 * @param {Object}   ctx
 * @param {Function} read `( file ) => string`
 * @return {{ p95: number, files: { file: string, lines: number }[] }} o corte e
 *   os arquivos acima dele, do menor para o maior
 */
function filesAboveP95( ctx, read ) {
	const tamanhos = ctx.files
		.filter(
			( f ) =>
				/\.(?:php|ts|tsx|js)$/.test( f ) &&
				! f.startsWith( 'features/narration/editor/engine/' )
		)
		.map( ( f ) => ( { file: f, lines: read( f ).split( '\n' ).length } ) )
		.sort( ( a, b ) => a.lines - b.lines );
	const p95 = tamanhos.length
		? tamanhos[ Math.floor( tamanhos.length * 0.95 ) ].lines
		: 0;
	return { p95, files: tamanhos.filter( ( t ) => t.lines > p95 ) };
}

module.exports = {
	checkClaudeMdSize,
	checkAdrCitations,
	checkRulePaths,
	checkIndex,
	checkAdrHygiene,
	globToRegExp,
	parseRulePaths,
	reviewTriggerCounts,
	filesAboveP95,
	CLAUDE_MD_LINE_CEILING,
	CITED_SECTIONS,
};
