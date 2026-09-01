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

// Este relatório existe justamente para os momentos em que algo está quebrado,
// e é nesses momentos que ele mais tem de rodar. Qualquer leitura que possa
// estourar passa por aqui: o problema vira UMA LINHA do relatório, nomeando o
// que falhou, e o resto das seções continua sendo impressa. Reportar "não
// consegui ler as ADRs" é honesto; morrer com exit 1 transforma o relatório em
// gate, que é exatamente o que ele promete não ser na última linha da saída.
const avarias = [];
const tolerante = ( oQue, fn, padrao ) => {
	try {
		return fn();
	} catch ( e ) {
		avarias.push( `${ oQue }: ${ e.message }` );
		return padrao;
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

const adrs = tolerante(
	'não consegui ler docs/adr/',
	() => loadAdrs( path.join( root, 'docs/adr' ) ),
	[]
);
// `createContext` chama `git ls-files`: fora de um repositório git ele estoura.
// Vale a mesma regra — vira avaria, não morte.
const ctx = tolerante(
	'não consegui listar os arquivos versionados',
	// `adrs` entra no ctx porque a regra `adr-index-table` confere a tabela do
	// índice contra o front-matter — o mesmo ctx que o CLI do lint:arch monta.
	() => createContext( { root, adrs } ),
	{ root, files: [], read: () => '', adrs: [] }
);
const adrIds = new Set( adrs.map( ( a ) => a.id ) );

// 1. lint:arch em modo relatório: os desvios listados aparecem como dívida.
const lint = tolerante(
	'lint:arch não rodou',
	// Os mesmos parâmetros que o CLI do lint:arch passa. Sem eles o relatório
	// mostraria MENOS que o gate — e um doctor que relata menos do que reprova
	// é pior que um doctor que não relata: ensina a confiar no silêncio dele.
	() =>
		run( {
			adrs,
			registry: regras,
			ctx,
			doctorChecks: health.DOCTOR_CHECKS,
		} ),
	null
);
secao(
	'lint:arch',
	lint ? format( lint ).split( '\n' ) : [ 'não rodou — ver "avarias"' ]
);

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
const { features, sharedModules } = health.reviewTriggerCounts( ctx );
secao( 'gatilhos de revisão', [
	`features hoje: ${ features.length } (${ features.join( ', ' ) })`,
	`módulos em shared/: ${ sharedModules }`,
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
		...health.checkClaudeMdSize( claudeMd ),
		// O teto e a lista de seções vêm de health.js, onde teste os fixa —
		// aqui um comentário era tudo que impedia alguém de voltar para 80 ou
		// de reintroduzir `## Never`.
		...health.checkAdrCitations( claudeMd, health.CITED_SECTIONS, adrIds ),
		...rules.flatMap( ( r ) =>
			health.checkAdrCitations( r.source, [], adrIds )
		),
		...health.checkRulePaths( rules, ctx.files ),
	].map( ( p ) => p.message )
);

// 5. Tamanho de arquivo acima do p95: sinal relativo de "faz coisa demais",
//    sem limiar arbitrário. A conta vive em health.js, que é medido.
const { p95, files: grandes } = health.filesAboveP95( ctx, ler );
secao(
	`arquivos acima do p95 (${ p95 } linhas)`,
	grandes.map( ( t ) => `${ t.lines }\t${ t.file }` )
);

// 5b. Fronteira Jest/E2E (ADR-0012). A ADR promete estas duas linhas, e por
//     semanas elas não existiam — o `revisar_quando` dela é "a suíte E2E passar
//     de 15 minutos", e sem duração no relatório ninguém conseguia avaliar o
//     gatilho lendo o doctor. É o que deixou a ADR e o TESTING.md divergirem
//     sem ninguém notar.
//
//     O espelho de `DOCTOR` (em `index.js`) confere as três direções: toda ADR
//     com `enforced_by: doctor` tem entrada em `DOCTOR_CHECKS`, toda entrada é
//     pedida por alguma ADR, e cada seção que a entrada nomeia entre aspas
//     aparece de fato como `secao( '<nome>'` NESTE arquivo. Apagar o bloco
//     abaixo reprova o `lint:arch`.
//
//     A terceira direção chegou depois: por um tempo o espelho conferia só a
//     declaração, e este comentário afirmava que fechar a lacuna exigiria o
//     gate ler a SAÍDA do relatório. Não exigia — a busca é estática, pelo
//     literal do título no fonte, e a razão ESM/Jest valia para executar o
//     doctor, não para lê-lo.
const REPORT_E2E = 'artifacts/test-results/report.json';
const linhasE2e = [ `cenários E2E: ${ health.e2eScenarioCount( ctx ) }` ];
if ( fs.existsSync( path.join( root, REPORT_E2E ) ) ) {
	linhasE2e.push(
		tolerante(
			`${ REPORT_E2E } ilegível`,
			() => {
				const st = JSON.parse( ler( REPORT_E2E ) ).stats || {};
				// Segundos abaixo de um minuto: "0.0 min" não informa nada,
				// e execução de um spec só é justamente o caso comum de quem
				// está investigando.
				const ms = st.duration || 0;
				const dur =
					ms >= 60000
						? `${ ( ms / 60000 ).toFixed( 1 ) } min`
						: `${ Math.round( ms / 1000 ) } s`;
				const quando = st.startTime
					? new Date( st.startTime )
							.toLocaleString( 'sv-SE' )
							.slice( 0, 16 )
					: 'sem data';
				const falhas = ( st.unexpected || 0 ) + ( st.flaky || 0 );
				return `última execução: ${ dur }, ${
					st.expected || 0
				} passaram, ${ falhas } não (${ quando })`;
			},
			'última execução: relatório no disco, mas ilegível'
		)
	);
	// Só a execução COMPLETA responde ao gatilho: rodar um spec sozinho
	// produz um `report.json` legítimo de poucos segundos, e tratá-lo como
	// medida da suíte seria afirmar mais do que o arquivo diz.
	linhasE2e.push(
		'o gatilho da ADR-0012 (15 min) só é avaliável por uma execução completa'
	);
} else {
	linhasE2e.push(
		'última execução: sem registro no disco — rode `npm run test:e2e`'
	);
}
secao( 'fronteira Jest/E2E', linhasE2e );

// 6. Dívida declarada e cobertura, quando houver relatório no disco.
// Conta seções, e diz "seções": o documento usa duas convenções de item —
// `###` em algumas seções, bullets em negrito em outras — e não há regra única
// que conte item honestamente. Melhor um número verdadeiro sobre o que se conta
// do que um número inventado sobre o que se gostaria de contar.
const secoesFollowUp = ( ler( 'docs/FOLLOW-UPS.md' ).match( /^##\s+/gm ) || [] )
	.length;
const cobertura = fs.existsSync(
	path.join( root, 'coverage/coverage-summary.json' )
)
	? tolerante(
			'coverage/coverage-summary.json ilegível',
			() => {
				// A data vai junto porque `existsSync` responde se o arquivo
				// existe, não se ele é de agora. Sem ela, um relatório de duas
				// semanas atrás sairia com a mesma cara de um recém-gerado, e um
				// número que não corresponde à árvore gasta a confiança do leitor
				// em todos os outros números deste relatório.
				const arquivo = 'coverage/coverage-summary.json';
				const pct = JSON.parse( ler( arquivo ) ).total.lines.pct;
				// Hora LOCAL, montada à mão: `toISOString` devolve UTC, e o
				// leitor confere contra o relógio dele. Uma linha dizendo
				// "20:59" às 17:59 faz duvidar justamente do número que o
				// carimbo existe para autenticar.
				const d = fs.statSync( path.join( root, arquivo ) ).mtime;
				const dd = ( n ) => String( n ).padStart( 2, '0' );
				const quando =
					`${ d.getFullYear() }-${ dd( d.getMonth() + 1 ) }-` +
					`${ dd( d.getDate() ) } ${ dd( d.getHours() ) }:` +
					`${ dd( d.getMinutes() ) }`;
				return `linhas (JS): ${ pct }% (relatório de ${ quando })`;
			},
			'relatório de cobertura no disco, mas ilegível — rode `npm run test:unit -- --coverage` de novo'
	  )
	: 'sem relatório no disco — rode `npm run test:unit -- --coverage`';
secao( 'outros', [
	`FOLLOW-UPS.md: ${ secoesFollowUp } seção(ões)`,
	cobertura,
] );

if ( avarias.length ) {
	secao( 'avarias na própria coleta', avarias );
}

process.stdout.write(
	'\ndoctor: relatório, não gate. Nada aqui reprova um PR.\n'
);
process.exit( 0 );
