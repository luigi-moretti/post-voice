'use strict';
// Verificações heurísticas do `doctor`. Puras, para serem testáveis; o
// doctor.mjs é só a casca que lê o disco e imprime. Nada aqui bloqueia.

// Aceita `(ADR-0004)` e `(ADR-0004, ADR-0005)`. A segunda forma é a que se
// escreve sem pensar quando um bullet responde a duas decisões, e um checker
// que a recusa não ensina a citar melhor — ensina a lutar com o checker. O id
// é extraído de dentro do grupo, então as duas grafias dão a mesma lista.
const CITACAO_RE = /\(ADR-\d{4}(?:\s*,\s*ADR-\d{4})*\)/g;
const ID_NA_CITACAO_RE = /ADR-(\d{4})/g;
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
	// Conta como `wc -l` e como o editor de quem vai ler o relatório: o `\n`
	// final termina a última linha, não abre uma nova. `split` sozinho devolvia
	// um a mais, e um relatório que diz 97 sobre um arquivo que o editor mostra
	// com 96 gasta a confiança de quem confere.
	const linhas = source.replace( /\n$/, '' ).split( '\n' ).length;
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
/**
 * Junta cada bullet com as linhas de continuação dele.
 *
 * O checker olhava linha a linha, então um bullet quebrado em duas linhas com a
 * citação na segunda era reportado como "sem citação". O efeito prático não era
 * o autor citar melhor: era o autor escrever linhas de 400 caracteres para não
 * ser reprovado, e foi o que aconteceu — em `.claude/rules/php.md` e na primeira
 * versão do `CLAUDE.md` reescrito. Um checker que decide a largura das linhas
 * do documento está cobrando um imposto que não tem nada a ver com o que ele
 * quer verificar.
 *
 * @param {string} bloco
 * @return {string[]} um item por bullet, com as continuações concatenadas
 */
function bulletsCompletos( bloco ) {
	const saida = [];
	for ( const line of bloco.split( '\n' ) ) {
		const abreBullet = /^\s*-\s+\S/.test( line );
		const continua = saida.length && ! abreBullet && /^\s+\S/.test( line );
		if ( continua ) {
			saida[ saida.length - 1 ] += ' ' + line.trim();
			continue;
		}
		saida.push( line );
	}
	return saida;
}

function checkAdrCitations( source, nomes, adrIds ) {
	// Sem lista de seções, o alvo é o arquivo inteiro — mas sem o front-matter:
	// cada item de `paths:` começa com "- " e seria lido como bullet de convenção.
	const corpo = source.replace( /^---\r?\n[\s\S]*?\r?\n---\r?\n/, '' );
	const blocos = nomes.length
		? nomes.map( ( n ) => ( secoes( source ).get( n ) || [] ).join( '\n' ) )
		: [ corpo ];
	const problemas = [];
	for ( const bloco of blocos ) {
		for ( const line of bulletsCompletos( bloco ) ) {
			if ( ! /^\s*-\s+\S/.test( line ) ) {
				continue;
			}
			CITACAO_RE.lastIndex = 0;
			const citadas = [ ...line.matchAll( CITACAO_RE ) ].flatMap( ( m ) =>
				[ ...m[ 0 ].matchAll( ID_NA_CITACAO_RE ) ].map(
					( x ) => x[ 1 ]
				)
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

// A tabela do README duplica `status` e `enforced_by` das ADRs. `checkIndex`
// confere só que a ADR APARECE ali; as colunas em si não eram conferidas por
// ninguém, então mudar o front-matter deixava a tabela mentindo com tudo
// verde. Duplicação sem checagem é a deriva que este mecanismo existe para
// impedir — e aqui ela estava dentro do próprio mecanismo.
//
// Ausência continua sendo assunto de `checkIndex`: aqui só se confere a linha
// que existe, para que as duas checagens não reportem o mesmo defeito duas
// vezes.
const LINHA_TABELA_RE =
	/^\|\s*\[(\d{4})\]\([^)]*\)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|\s*$/gm;

/**
 * `adr` e `coluna` saem em cada problema para a regra `adr-index-table` montar
 * uma chave de desvio ESTÁVEL: a mensagem cita os dois valores observados e
 * mudaria a cada edição da tabela, invalidando sozinha o `desvios:` escrito
 * contra ela.
 *
 * @param {Object[]} adrs
 * @param {string}   readme conteúdo de docs/adr/README.md
 * @return {Object[]} problemas `{ adr, coluna, line, message }`
 */
function checkIndexTable( adrs, readme ) {
	const porId = new Map( adrs.map( ( a ) => [ a.id, a ] ) );
	const problemas = [];
	const linhaDe = ( idx ) => readme.slice( 0, idx ).split( '\n' ).length;
	LINHA_TABELA_RE.lastIndex = 0;
	let m;
	while ( ( m = LINHA_TABELA_RE.exec( readme ) ) !== null ) {
		const [ , id, , statusCol, defendidaCol ] = m;
		const line = linhaDe( m.index );
		const adr = porId.get( id );
		if ( ! adr ) {
			problemas.push( {
				adr: id,
				coluna: 'inexistente',
				line,
				message: `docs/adr/README.md lista uma ADR-${ id } que não existe em docs/adr/.`,
			} );
			continue;
		}
		const status = statusCol.trim();
		if ( status !== adr.status ) {
			problemas.push( {
				adr: id,
				coluna: 'status',
				line,
				message: `docs/adr/README.md diz que a ADR-${ id } tem status "${ status }", mas o front-matter de ${ adr.file } diz "${ adr.status }".`,
			} );
		}
		// As regras aparecem entre crases na coluna; a comparação é da lista
		// inteira e na ordem do front-matter, para que uma segunda regra
		// omitida na tabela não passe.
		const naTabela = ( defendidaCol.match( /`([^`]+)`/g ) || [] ).map(
			( t ) => t.replace( /`/g, '' )
		);
		if ( naTabela.join( ', ' ) !== adr.enforcedBy.join( ', ' ) ) {
			problemas.push( {
				adr: id,
				coluna: 'enforced_by',
				line,
				message: `docs/adr/README.md diz que a ADR-${ id } é defendida por [${ naTabela.join(
					', '
				) }], mas o enforced_by de ${
					adr.file
				} diz [${ adr.enforcedBy.join( ', ' ) }].`,
			} );
		}
	}
	return problemas;
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

// Cenários E2E declarados na árvore. `test(` e `test.only(`, nunca
// `test.describe(`, que agrupa e não é cenário. Validado contra o oráculo que
// importa: o Playwright reporta 37 na árvore de hoje, e esta conta devolve 37.
//
// `test.skip(` e `test.fixme(` também ficam de fora, e isso é escolha, não
// descuido: quem lê esta linha está avaliando o `revisar_quando` da ADR-0012,
// "a suíte E2E passar de 15 minutos", e cenário que não roda não consome
// tempo. Hoje não existe nenhum na árvore, então a conta bate com o
// Playwright; se algum aparecer, os dois números passam a divergir de
// propósito — o daqui é "cenários que rodam", o do relatório é o mesmo, e o
// que o `--list` do Playwright imprimiria inclui os pulados.
const E2E_SPEC_RE = /^e2e\/.*\.spec\.ts$/;
const E2E_TEST_RE = /^\s*test(?:\.only)?\s*\(/gm;

/**
 * @param {Object} ctx
 * @return {number} quantos cenários E2E existem hoje
 */
function e2eScenarioCount( ctx ) {
	let total = 0;
	for ( const file of ctx.files.filter( ( f ) => E2E_SPEC_RE.test( f ) ) ) {
		E2E_TEST_RE.lastIndex = 0;
		total += ( ctx.read( file ).match( E2E_TEST_RE ) || [] ).length;
	}
	return total;
}

// Qual seção do relatório cobre qual ADR que declara `enforced_by: doctor`.
// O `lint:arch` confere este mapa nas duas direções: uma ADR que pede `doctor`
// sem entrada aqui reprova, e uma entrada aqui que nenhuma ADR pede também.
// Existe porque a ADR-0012 afirmou por semanas que o doctor reportava algo que
// ele não reportava, e o mecanismo era estruturalmente incapaz de perceber:
// o runner pulava os literais sem olhar.
const DOCTOR_CHECKS = {
	'0001': 'seções "ADRs", "higiene das ADRs" e "gatilhos de revisão": contagem por status, ADR acima de 120 linhas, origem inexistente, ausência do índice',
	'0012': 'seção "fronteira Jest/E2E": contagem de cenários E2E e o tempo da última execução',
};

module.exports = {
	e2eScenarioCount,
	DOCTOR_CHECKS,
	checkClaudeMdSize,
	checkAdrCitations,
	checkRulePaths,
	checkIndex,
	checkIndexTable,
	checkAdrHygiene,
	globToRegExp,
	parseRulePaths,
	reviewTriggerCounts,
	filesAboveP95,
	CLAUDE_MD_LINE_CEILING,
	CITED_SECTIONS,
};
