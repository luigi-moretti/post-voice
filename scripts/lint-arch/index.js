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
const LITERAIS = new Set( [ 'review-manual', 'doctor' ] );

/**
 * @param {Object}   entrada
 * @param {Object[]} entrada.adrs
 * @param {Object}   entrada.registry mapa id → Rule
 * @param {Object}   entrada.ctx
 * @return {{ problems: Object[], warnings: Object[] }} achados
 */
function run( { adrs, registry, ctx } ) {
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
	const resultado = run( { adrs, registry, ctx: createContext( { root } ) } );
	process.stdout.write( format( resultado ) + '\n' );
	process.exit( ! reportOnly && resultado.problems.length ? 1 : 0 );
}
