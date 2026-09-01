'use strict';
// Executa as regras de arquitetura usando as ADRs como configuração.
// Ver docs/adr/README.md e o spec 2026-08-25-adr-e-governanca-de-arquitetura-design.md.
const path = require( 'node:path' );

// `./adr`, `./context` e `./rules` são exigidos dentro do bloco de CLI, no fim do
// arquivo, e não aqui. `require` no topo executa no load, então um require de topo
// tornaria este módulo impossível de importar enquanto qualquer um dos três não
// existisse — e é exatamente isso que a suíte de testes faz: importa `{ run, format }`
// e injeta um `ctx` falso. A separação biblioteca/CLI é o que mantém `run` testável.

// Valores de `enforced_by` que não nomeiam uma regra: dizem que a decisão é
// defendida por leitura humana ou por relatório, não por gate determinístico.
// `review-manual` e `doctor` não nomeiam regra, então a busca no registro de
// regras pula os dois. Mas os dois NÃO são iguais: `review-manual` é enforçado
// por gente, e não há o que verificar automaticamente; `doctor` afirma que um
// RELATÓRIO cobre a decisão, e isso é verificável — ver `DOCTOR` abaixo.
const LITERAIS = new Set( [ 'review-manual', 'doctor' ] );

// A ADR-0012 afirmava que "o doctor reporta a contagem de cenários E2E e o
// tempo da última execução". O doctor não tinha nenhuma das duas linhas, e
// como este runner pulava os literais, nada conseguia detectar que aquele
// `enforced_by` não enforçava coisa alguma: uma ADR podia afirmar qualquer
// coisa sobre o relatório e continuar verde. `doctor` passa a exigir entrada
// em `doctorChecks`, espelhada nas duas direções — a mesma disciplina que já
// vale entre as ADRs e o registro de regras.
const DOCTOR = 'doctor';
const DOCTOR_SOURCE = 'scripts/doctor.mjs';

/**
 * Os títulos das seções que o relatório IMPRIME de fato.
 *
 * Padrão de duas fontes, como nas regras: a ESTRUTURA — onde há uma chamada a
 * `secao(` de verdade — sai da cópia com comentário e corpo de string
 * branqueados; o TÍTULO sai do cru, no mesmo offset, porque é justamente o
 * corpo da string que o branqueamento apaga.
 *
 * Uma versão anterior buscava o título direto no cru, e por isso um
 * `secao( 'x' )` dentro de `/* ... *\/`, de template ou de string satisfazia o
 * gate enquanto a seção não era impressa: apagar a chamada reprovava, comentar
 * não.
 *
 * @param {string} raw conteúdo de scripts/doctor.mjs
 * @return {Set<string>} títulos impressos
 */
function secoesDe( raw ) {
	const { stripJsNoise } = require( './context' );
	const codigo = stripJsNoise( raw );
	const titulos = new Set();
	for ( const m of codigo.matchAll( /^[ \t]*secao\(\s*/gm ) ) {
		const abre = m.index + m[ 0 ].length;
		const aspa = raw[ abre ];
		if ( aspa !== "'" && aspa !== '"' && aspa !== '`' ) {
			continue;
		}
		// O título vai até a aspa que fecha, no CRU. Quando ele carrega
		// contagem (`\`ADRs (${ n })\``), o `DOCTOR_CHECKS` nomeia só o
		// prefixo, então o prefixo também entra.
		const fim = raw.indexOf( aspa, abre + 1 );
		if ( fim === -1 ) {
			continue;
		}
		const titulo = raw.slice( abre + 1, fim );
		titulos.add( titulo );
		const corte = titulo.indexOf( ' (' );
		if ( corte > 0 ) {
			titulos.add( titulo.slice( 0, corte ) );
		}
	}
	return titulos;
}

// `status` decide se a ADR enforça. Antes o campo não era lido em lugar
// nenhum: `proposta`, `aceita`, `revogada` e `superada-por-0016` bloqueavam
// identicamente, e a ADR-0001 afirmava — falsamente — que "o lint:arch já
// exige que reflita a realidade". Medido: marcar uma ADR como revogada e
// zerar os desvios dela deixava os problemas dela de pé.
//
// A consequência prática era não existir caminho para aposentar uma regra. A
// supersessão descrita na ADR-0001 e na skill manda mudar o status e escrever
// uma ADR nova; com o status inerte, a única saída era apagar o `enforced_by`
// ou a regra — e as duas apagam o rastro histórico que este sistema existe
// para preservar.
const ENFORCAM = new Set( [ 'aceita', 'aceita-com-desvio' ] );
const enforca = ( adr ) => ENFORCAM.has( adr.status );

// `proposta` é decisão ainda em discussão: não bloqueia, porque bloquear a CI
// com ela forçaria a decisão pela porta dos fundos. Mas a regra que ela nomeia
// não é órfã — existe porque a ADR em escrita a pede.
const emVoo = ( adr ) => adr.status === 'proposta';

/**
 * @param {Object}   entrada
 * @param {Object[]} entrada.adrs
 * @param {Object}   entrada.registry       mapa id → Rule
 * @param {Object}   entrada.ctx
 * @param {Object}   [entrada.doctorChecks] mapa id da ADR → seção do doctor
 *                                          que cobre a decisão. O CLI passa o registro real de `health.js`.
 * @return {{ problems: Object[], warnings: Object[] }} achados
 */
function run( { adrs, registry, ctx, doctorChecks = {} } ) {
	const problems = [];
	const warnings = [];
	const declaradas = new Set();
	const cache = new Map();

	const executar = ( id ) => {
		if ( ! cache.has( id ) ) {
			cache.set( id, registry[ id ].check( ctx ) );
		}
		return cache.get( id );
	};

	for ( const adr of adrs ) {
		for ( const id of adr.enforcedBy ) {
			if ( LITERAIS.has( id ) ) {
				continue;
			}
			// Revogada e superada NÃO registram: a regra delas passa a
			// aparecer como órfã, que é o sinal para apagá-la. O porquê
			// histórico fica no texto da ADR, que não se reescreve.
			if ( enforca( adr ) || emVoo( adr ) ) {
				declaradas.add( id );
			}
			if ( ! enforca( adr ) ) {
				// Exigir que a regra ainda exista numa ADR aposentada
				// obrigaria a manter código morto para sempre. Numa proposta,
				// a regra pode simplesmente ainda não ter sido escrita: isso
				// é aviso, não reprovação.
				if ( emVoo( adr ) && ! registry[ id ] ) {
					warnings.push( {
						adr: adr.id,
						rule: id,
						message: `ADR-${ adr.id } está como proposta e declara enforced_by: ${ id }, que ainda não existe em scripts/lint-arch/rules/. Enquanto o status for proposta isso não reprova, mas aceitar a ADR sem a regra deixaria a decisão sem gate.`,
					} );
				}
				continue;
			}
			if ( ! registry[ id ] ) {
				problems.push( {
					adr: adr.id,
					rule: id,
					message: `ADR-${ adr.id } declara enforced_by: ${ id }, mas essa regra não existe em scripts/lint-arch/rules/. Implemente a regra ou corrija o front-matter de ${ adr.file }.`,
				} );
			} else if ( registry[ id ].adr !== adr.id ) {
				problems.push( {
					adr: adr.id,
					rule: id,
					message: `ADR-${ adr.id } declara enforced_by: ${ id }, mas a regra declara adr: ${ registry[ id ].adr }. Uma das duas está errada.`,
				} );
			}
		}
	}

	// Espelho do `doctor` nas duas direções, como o das regras logo abaixo.
	const pedemDoctor = new Set(
		adrs
			.filter( ( a ) => enforca( a ) && a.enforcedBy.includes( DOCTOR ) )
			.map( ( a ) => a.id )
	);
	for ( const adrId of pedemDoctor ) {
		if ( ! doctorChecks[ adrId ] ) {
			problems.push( {
				adr: adrId,
				rule: DOCTOR,
				message: `ADR-${ adrId } declara enforced_by: doctor, mas nenhuma seção do relatório declara cobrir essa decisão. Implemente a seção em scripts/lint-arch/health.js e registre-a em DOCTOR_CHECKS, ou corrija o front-matter.`,
			} );
		}
	}
	// A terceira direção do espelho: `DOCTOR_CHECKS` nomeia as seções entre
	// aspas, e o relatório tem de imprimi-las de fato. Sem isto o espelho
	// conferia só a DECLARAÇÃO — `DOCTOR_CHECKS` é um mapa escrito à mão, e
	// apagar a seção correspondente do `doctor.mjs` deixava o gate em 0. Era o
	// defeito que a ADR-0012 sofreu por semanas, sobrevivendo dentro da própria
	// correção dele.
	//
	// A checagem é estática: o nome da seção aparece como literal na chamada
	// `secao( '<nome>'`, ou como início de um template quando o título carrega
	// contagem (`secao( \`ADRs (${ n })\``). A chamada pode quebrar linha
	// depois do parêntese, e por isso a busca é por regex e não por
	// `includes`. Não executa o relatório, não importa ESM e não depende do
	// Jest — que era a razão dada para declarar esta lacuna em vez de
	// fechá-la, e ela valia para EXECUTAR o doctor, não para lê-lo.
	if ( pedemDoctor.size ) {
		// Arquivo ausente NÃO é silêncio. Uma versão anterior desta checagem
		// pulava quando `scripts/doctor.mjs` não estava na árvore, que é o
		// mesmo defeito que o `adr-index-table` acabara de fechar um commit
		// antes: apagar o alvo desligava o gate sem deixar rastro, e `doctor`
		// não roda no `ci.yml`. Medido: `git rm scripts/doctor.mjs` dava exit 0
		// e zero saída.
		const fonte = ctx.files.includes( DOCTOR_SOURCE )
			? ctx.read( DOCTOR_SOURCE )
			: null;
		const titulos = fonte === null ? new Set() : secoesDe( fonte );
		if ( fonte === null ) {
			problems.push( {
				rule: DOCTOR,
				message: `${ [ ...pedemDoctor ]
					.map( ( id ) => `ADR-${ id }` )
					.join(
						', '
					) } declara(m) enforced_by: doctor, mas ${ DOCTOR_SOURCE } não existe na árvore — o relatório que essas ADRs dizem ter não pode ser conferido.`,
			} );
		}
		for ( const [ adrId, descricao ] of Object.entries(
			fonte === null ? {} : doctorChecks
		) ) {
			for ( const m of descricao.matchAll( /"([^"]+)"/g ) ) {
				const nome = m[ 1 ];
				if ( ! titulos.has( nome ) ) {
					problems.push( {
						adr: adrId,
						rule: DOCTOR,
						message: `DOCTOR_CHECKS diz que o relatório tem a seção "${ nome }" pela ADR-${ adrId }, mas ${ DOCTOR_SOURCE } não a imprime. Implemente a seção ou corrija a descrição em health.js.`,
					} );
				}
			}
		}
	}

	for ( const adrId of Object.keys( doctorChecks ) ) {
		if ( ! pedemDoctor.has( adrId ) ) {
			problems.push( {
				adr: adrId,
				rule: DOCTOR,
				message: `seção órfã do doctor: DOCTOR_CHECKS declara cobrir a ADR-${ adrId }, mas essa ADR não declara enforced_by: doctor. Sem ADR ninguém sabe por que a seção existe.`,
			} );
		}
	}

	for ( const id of Object.keys( registry ) ) {
		if ( ! declaradas.has( id ) ) {
			problems.push( {
				rule: id,
				message: `regra órfã: ${ id } existe em scripts/lint-arch/rules/ mas nenhuma ADR a declara em enforced_by. Sem ADR ninguém sabe por que a regra existe.`,
			} );
		}
	}

	for ( const adr of adrs ) {
		if ( ! enforca( adr ) ) {
			// Desvios numa ADR que não enforça não congelam nada: dizer isso
			// em voz alta evita que alguém leia a lista como dívida viva.
			if ( adr.desvios.length ) {
				warnings.push( {
					adr: adr.id,
					message: `ADR-${ adr.id } tem status "${ adr.status }" e não enforça, mas lista ${ adr.desvios.length } desvio(s) — são inertes. Remova-os de ${ adr.file } ou reveja o status.`,
				} );
			}

			// Uma ADR em `proposta` não bloqueia, de propósito — bloquear a CI
			// com decisão ainda em discussão forçaria a decisão pela porta dos
			// fundos. Mas ela não pode ficar MUDA: `revogada` e
			// `superada-por-NNNN` deixam a regra órfã, que reprova alto;
			// `proposta` não deixa rastro nenhum. Medido: baixar uma ADR
			// aceita para proposta, ajustar a tabela do índice e esvaziar
			// `desvios:` — tudo o que o próprio mecanismo exige para ficar
			// consistente — dava lint:arch em 0 com a regra ainda achando
			// violação real. Desligar um gate é decisão legítima; desligá-lo
			// sem deixar rastro é como esta branch inteira começou.
			if ( emVoo( adr ) ) {
				for ( const id of adr.enforcedBy ) {
					if ( LITERAIS.has( id ) || ! registry[ id ] ) {
						continue;
					}
					const achadosEmVoo = executar( id );
					if ( achadosEmVoo.length ) {
						warnings.push( {
							adr: adr.id,
							rule: id,
							message: `ADR-${ adr.id } está como proposta, então ${ id } não reprova — mas acha ${ achadosEmVoo.length } violação(ões) agora. Aceitar a ADR sem corrigir ou sem listar em desvios: deixa a CI vermelha.`,
						} );
					}
				}
			}
			continue;
		}

		// Agrupado por ADR, e não por regra: uma ADR com duas regras tem uma única
		// lista de desvios, e comparar por regra faria uma acusar de "dívida
		// quitada" o desvio que pertence à outra.
		const achados = [];
		for ( const id of adr.enforcedBy ) {
			if ( LITERAIS.has( id ) || ! registry[ id ] ) {
				continue;
			}
			for ( const finding of executar( id ) ) {
				achados.push( { ...finding, rule: id } );
			}
		}

		const permitidos = new Set( adr.desvios );
		for ( const finding of achados ) {
			if ( permitidos.has( finding.key ) ) {
				continue;
			}
			problems.push( {
				adr: adr.id,
				rule: finding.rule,
				file: finding.file,
				line: finding.line,
				message: `${ finding.file }:${ finding.line } viola a ADR-${ adr.id } (${ adr.titulo }) — ${ finding.message }. Regra: ${ finding.rule }. Chave de desvio: "${ finding.key }". O porquê está em ${ adr.file }.`,
			} );
		}

		// Dívida quitada só é afirmável quando TODAS as regras da ADR existem.
		// Com uma regra ausente, `achados` fica incompleto por omissão e todo
		// desvio listado pareceria quitado — o aviso mandaria apagar entradas que
		// ainda são violações reais. "Regra ausente" já é reportado como problema
		// à parte; aqui o correto é silêncio, não uma afirmação falsa.
		const idsReais = adr.enforcedBy.filter(
			( id ) => ! LITERAIS.has( id )
		);
		if ( ! idsReais.every( ( id ) => registry[ id ] ) ) {
			continue;
		}

		const vistos = new Set( achados.map( ( f ) => f.key ) );
		for ( const desvio of adr.desvios ) {
			if ( ! vistos.has( desvio ) ) {
				warnings.push( {
					adr: adr.id,
					message: `dívida quitada: "${ desvio }" não viola mais a ADR-${ adr.id }. Remova a entrada de desvios: em ${ adr.file }.`,
				} );
			}
		}
	}

	return { problems, warnings };
}

function format( { problems, warnings } ) {
	const linhas = [];
	if ( problems.length ) {
		linhas.push( `lint:arch — ${ problems.length } violação(ões):`, '' );
		for ( const p of problems ) {
			linhas.push( `  ✗ ${ p.message }` );
		}
		linhas.push( '' );
	}
	if ( warnings.length ) {
		linhas.push( `lint:arch — ${ warnings.length } aviso(s):`, '' );
		for ( const w of warnings ) {
			linhas.push( `  ! ${ w.message }` );
		}
		linhas.push( '' );
	}
	if ( ! problems.length && ! warnings.length ) {
		linhas.push(
			'lint:arch — nenhuma violação e nenhuma dívida quitada pendente.'
		);
	}
	return linhas.join( '\n' );
}

module.exports = { run, format };

if ( require.main === module ) {
	const { loadAdrs } = require( './adr' );
	const { createContext } = require( './context' );
	const registry = require( './rules' );
	const root = process.cwd();
	// --report: não sai não-zero. É como `npm run doctor` consome o linter.
	const reportOnly = process.argv.includes( '--report' );
	const adrs = loadAdrs( path.join( root, 'docs/adr' ) );
	const { DOCTOR_CHECKS } = require( './health' );
	const resultado = run( {
		adrs,
		registry,
		// As ADRs entram no ctx porque a regra `adr-index-table` confere a
		// tabela do índice contra o front-matter delas.
		ctx: createContext( { root, adrs } ),
		doctorChecks: DOCTOR_CHECKS,
	} );
	process.stdout.write( format( resultado ) + '\n' );
	process.exit( ! reportOnly && resultado.problems.length ? 1 : 0 );
}
