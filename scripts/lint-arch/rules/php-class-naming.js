'use strict';
const { stripPhpNoise, stripPhpComments, isTestPath } = require( '../context' );

const CLASS_RE = /^\s*(?:final\s+|abstract\s+)*class\s+(\w+)/gim;
const PREFIXO = 'Post_Voice_';

// O mesmo formato usado pelo `require_once` em post-voice.php:
// `require_once POST_VOICE_PATH . '<caminho>';`.
const REQUIRE_RE = /require_once\s+POST_VOICE_PATH\s*\.\s*'([^']*)'/g;
const ENTRY_FILE = 'post-voice.php';

const classFiles = ( ctx ) =>
	ctx.files.filter(
		( f ) =>
			/^(?:features\/[^/]+|shared)\/php\/class-[a-z0-9-]+\.php$/.test(
				f
			) && ! isTestPath( f )
	);

/**
 * `Post_Voice_Rest_Api` → `class-rest-api.php`
 *
 * @param {string} klass
 * @return {string} o nome de arquivo esperado
 */
function esperadoParaClasse( klass ) {
	return (
		'class-' +
		klass.slice( PREFIXO.length ).toLowerCase().replace( /_/g, '-' ) +
		'.php'
	);
}

function declaradas( ctx, file ) {
	// stripPhpNoise, e não stripPhpComments: `'class Post_Voice_X'` dentro de uma
	// string não declara nada.
	const source = stripPhpNoise( ctx.read( file ) );
	CLASS_RE.lastIndex = 0;
	const out = [];
	let m;
	while ( ( m = CLASS_RE.exec( source ) ) !== null ) {
		out.push( {
			nome: m[ 1 ],
			line: source.slice( 0, m.index ).split( '\n' ).length,
		} );
	}
	return out;
}

/**
 * Lê os `require_once POST_VOICE_PATH . '<caminho>'` de post-voice.php.
 *
 * `REQUIRE_RE` roda sobre `source` (comentários fora, strings dentro) porque
 * precisa do corpo do literal do caminho — stripPhpNoise apagaria. Mas um
 * `require_once ...` dentro de uma string de verdade (uma mensagem de log, um
 * comentário de exemplo) casaria do mesmo jeito ali; o filtro é o mesmo que
 * `constantes()` usa para `const`: conferir, no mesmo offset, que `codigo`
 * (stripPhpNoise) também começa com "require_once" naquele ponto. Dentro de
 * uma string de verdade, `codigo` teria espaços em branco ali, não a palavra.
 *
 * @param {Object} ctx
 * @return {{ path: string, line: number }[]} um item por `require_once`
 */
function requireOnceEntries( ctx ) {
	const raw = ctx.read( ENTRY_FILE );
	const source = stripPhpComments( raw );
	const codigo = stripPhpNoise( raw );
	REQUIRE_RE.lastIndex = 0;
	const out = [];
	let m;
	while ( ( m = REQUIRE_RE.exec( source ) ) !== null ) {
		if ( codigo.slice( m.index, m.index + 12 ) !== 'require_once' ) {
			continue;
		}
		out.push( {
			path: m[ 1 ],
			line: source.slice( 0, m.index ).split( '\n' ).length,
		} );
	}
	return out;
}

/**
 * @param {Object} ctx
 * @return {Map<string, { feature: string, file: string }>} classe → dono
 */
function phpClassOwners( ctx ) {
	const mapa = new Map();
	for ( const file of classFiles( ctx ) ) {
		const feature = file.startsWith( 'shared/' )
			? 'shared'
			: file.split( '/' )[ 1 ];
		for ( const { nome } of declaradas( ctx, file ) ) {
			mapa.set( nome, { feature, file } );
		}
	}
	return mapa;
}

function check( ctx ) {
	const achados = [];
	for ( const file of classFiles( ctx ) ) {
		const base = file.split( '/' ).pop();
		const classes = declaradas( ctx, file );

		if ( classes.length !== 1 ) {
			const message =
				classes.length === 0
					? 'nenhuma classe declarada — provavelmente uma interface ou trait; ' +
					  'um arquivo "class-*.php" tem de declarar uma classe (ADR-0006)'
					: `${ classes.length } classes declaradas; o padrão é uma classe por arquivo (ADR-0006)`;
			achados.push( {
				key: `${ file } → uma-classe-por-arquivo`,
				file,
				line: classes[ 1 ] ? classes[ 1 ].line : 1,
				message,
			} );
			continue;
		}

		const { nome, line } = classes[ 0 ];
		if ( ! nome.startsWith( PREFIXO ) ) {
			achados.push( {
				key: `${ file } → prefixo`,
				file,
				line,
				message: `a classe "${ nome }" não usa o prefixo ${ PREFIXO } (ADR-0006)`,
			} );
			continue;
		}
		const esperado = esperadoParaClasse( nome );
		if ( base !== esperado ) {
			achados.push( {
				key: `${ file } → nome-do-arquivo`,
				file,
				line,
				message: `a classe "${ nome }" deveria morar em ${ esperado }, não em ${ base } (ADR-0006)`,
			} );
		}
	}

	// ADR-0006 promete as duas direções: toda classe tem um `require_once`
	// correspondente, e todo `require_once` de formato `class-*.php` corresponde
	// a uma classe de fato versionada — não um arquivo renomeado ou removido.
	const rastreados = new Set( classFiles( ctx ) );
	const entries = requireOnceEntries( ctx );
	const exigidos = new Set( entries.map( ( e ) => e.path ) );

	for ( const file of classFiles( ctx ) ) {
		if ( ! exigidos.has( file ) ) {
			achados.push( {
				key: `${ file } → require-once-ausente`,
				file,
				line: 1,
				message: `a classe em ${ file } não tem um require_once correspondente em ${ ENTRY_FILE } (ADR-0006)`,
			} );
		}
	}

	const FORMATO_ARQUIVO_CLASSE =
		/^(?:features\/[^/]+|shared)\/php\/class-[a-z0-9-]+\.php$/;
	for ( const { path, line } of entries ) {
		if ( FORMATO_ARQUIVO_CLASSE.test( path ) && ! rastreados.has( path ) ) {
			// O caminho entra na chave de propósito: dois órfãos no mesmo arquivo
			// não podem colidir numa única chave de desvio.
			achados.push( {
				key: `${ ENTRY_FILE } → require-once-orfao:${ path }`,
				file: ENTRY_FILE,
				line,
				message: `${ ENTRY_FILE } tem um require_once para "${ path }", que não é um arquivo de classe versionado (ADR-0006)`,
			} );
		}
	}

	return achados;
}

module.exports = { id: 'php-class-naming', adr: '0006', check, phpClassOwners };
