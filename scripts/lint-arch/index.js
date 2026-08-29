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
			declaradas.add( id );
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
			.filter( ( a ) => a.enforcedBy.includes( DOCTOR ) )
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
		ctx: createContext( { root } ),
		doctorChecks: DOCTOR_CHECKS,
	} );
	process.stdout.write( format( resultado ) + '\n' );
	process.exit( ! reportOnly && resultado.problems.length ? 1 : 0 );
}
