#!/usr/bin/env node
// Relatório de saúde do projeto. Heurístico: reporta, nunca bloqueia, e sempre
// sai com código 0. Regra nova nasce aqui e só sobe para lint:arch depois de
// provar que não produz falso positivo. Ver ADR-0001.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire( import.meta.url );
const { loadAdrs } = require( './lint-arch/adr.js' );
const { createContext } = require( './lint-arch/context.js' );
const { run, format } = require( './lint-arch/index.js' );
const regras = require( './lint-arch/rules/index.js' );
const health = require( './lint-arch/health.js' );

const root = process.cwd();
const ler = ( rel ) => {
	try {
		return fs.readFileSync( path.join( root, rel ), 'utf8' );
	} catch {
		return '';
	}
};

const secao = ( titulo, linhas ) => {
	process.stdout.write(
		`\n── ${ titulo } ${ '─'.repeat(
			Math.max( 0, 58 - titulo.length )
		) }\n`
	);
	if ( ! linhas.length ) {
		process.stdout.write( '   nada a relatar\n' );
		return;
	}
	for ( const l of linhas ) {
		process.stdout.write( `   ${ l }\n` );
	}
};

const adrs = loadAdrs( path.join( root, 'docs/adr' ) );
const ctx = createContext( { root } );
const adrIds = new Set( adrs.map( ( a ) => a.id ) );

// 1. lint:arch em modo relatório: os desvios listados aparecem como dívida.
const lint = run( { adrs, registry: regras, ctx } );
secao( 'lint:arch', format( lint ).split( '\n' ) );

const dividas = adrs.flatMap( ( a ) =>
	a.desvios.map( ( d ) => `ADR-${ a.id }: ${ d }` )
);
secao( `dívida congelada (${ dividas.length })`, dividas );

// 2. ADRs: status, higiene, índice.
const porStatus = adrs.reduce( ( acc, a ) => {
	acc[ a.status ] = ( acc[ a.status ] || 0 ) + 1;
	return acc;
}, {} );
secao(
	`ADRs (${ adrs.length })`,
	Object.entries( porStatus ).map( ( [ s, n ] ) => `${ n } ${ s }` )
);
secao(
	'higiene das ADRs',
	[
		...health.checkAdrHygiene( adrs, ctx.files ),
		...health.checkIndex( adrs, ler( 'docs/adr/README.md' ) ),
	].map( ( p ) => p.message )
);

// 3. revisar_quando: condição em prosa, impressa junto dos números estruturais
//    que ela costuma mencionar. Quem julga é o humano.
const features = new Set(
	ctx.files
		.filter( ( f ) => f.startsWith( 'features/' ) )
		.map( ( f ) => f.split( '/' )[ 1 ] )
);
const sharedModulos = ctx.files.filter( ( f ) =>
	/^shared\/php\/class-.*\.php$/.test( f )
).length;
secao( 'gatilhos de revisão', [
	`features hoje: ${ features.size } (${ [ ...features ]
		.sort()
		.join( ', ' ) })`,
	`módulos em shared/: ${ sharedModulos }`,
	'',
	...adrs
		.filter( ( a ) => a.revisarQuando )
		.map( ( a ) => `ADR-${ a.id }: ${ a.revisarQuando }` ),
] );

// 4. CLAUDE.md e as rules.
const claudeMd = ler( 'CLAUDE.md' );
const rulesDir = path.join( root, '.claude/rules' );
const rules = fs.existsSync( rulesDir )
	? fs
			.readdirSync( rulesDir )
			.filter( ( f ) => f.endsWith( '.md' ) )
			.map( ( f ) => ( {
				file: `.claude/rules/${ f }`,
				source: ler( `.claude/rules/${ f }` ),
			} ) )
			.map( ( r ) => ( {
				...r,
				paths: health.parseRulePaths( r.source ),
			} ) )
	: [];

secao(
	'CLAUDE.md e rules',
	[
		// Teto de 95, não os 80 que o plano estimou: a estimativa foi feita
		// antes de o arquivo existir, e chegar a 80 exigiria cortar os Gotchas,
		// que não são path-scopáveis e custaram uma sessão cada. 95 continua bem
		// abaixo das ~200 linhas onde a aderência cai.
		...health.checkClaudeMdSize( claudeMd, 95 ),
		// Só `## Conventions`. `## Never` fica de fora de propósito: "não
		// commite em master" é processo, não decisão de arquitetura, e não há
		// ADR por trás para citar. Exigir citação ali produziria três achados
		// que ninguém consegue fechar sem inventar uma ADR.
		...health.checkAdrCitations( claudeMd, [ 'Conventions' ], adrIds ),
		...rules.flatMap( ( r ) =>
			health.checkAdrCitations( r.source, [], adrIds )
		),
		...health.checkRulePaths( rules, ctx.files ),
	].map( ( p ) => p.message )
);

// 5. Tamanho de arquivo acima do p95: sinal relativo de "faz coisa demais",
//    sem limiar arbitrário.
const tamanhos = ctx.files
	.filter(
		( f ) =>
			/\.(?:php|ts|tsx|js)$/.test( f ) &&
			! f.startsWith( 'features/narration/editor/engine/' )
	)
	.map( ( f ) => ( { f, n: ler( f ).split( '\n' ).length } ) )
	.sort( ( a, b ) => a.n - b.n );
const p95 = tamanhos.length
	? tamanhos[ Math.floor( tamanhos.length * 0.95 ) ].n
	: 0;
secao(
	`arquivos acima do p95 (${ p95 } linhas)`,
	tamanhos.filter( ( t ) => t.n > p95 ).map( ( t ) => `${ t.n }\t${ t.f }` )
);

// 6. Dívida declarada e cobertura, quando houver relatório no disco.
const followUps = ( ler( 'docs/FOLLOW-UPS.md' ).match( /^##\s+/gm ) || [] )
	.length;
const cobertura = fs.existsSync(
	path.join( root, 'coverage/coverage-summary.json' )
)
	? `linhas (JS): ${
			JSON.parse( ler( 'coverage/coverage-summary.json' ) ).total.lines
				.pct
	  }%`
	: 'sem relatório recente no disco — rode `npm run test:unit -- --coverage`';
secao( 'outros', [ `FOLLOW-UPS.md: ${ followUps } item(ns)`, cobertura ] );

process.stdout.write(
	'\ndoctor: relatório, não gate. Nada aqui reprova um PR.\n'
);
process.exit( 0 );
