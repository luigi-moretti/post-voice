'use strict';
// O corpus sobre o qual as regras operam, e os strippers de PHP que elas
// compartilham. Nenhuma regra lê o disco por conta própria.
const { execFileSync } = require( 'node:child_process' );
const fs = require( 'node:fs' );
const path = require( 'node:path' );

const TEST_PATH_RE = /(^|\/)tests?\//;

/**
 * Arquivos versionados no git.
 *
 * `git ls-files` em vez de varrer o disco: pula node_modules/, vendor/, build/,
 * coverage/ e artifacts/ sem manter uma lista de exclusão que apodrece, e
 * "arquivo versionado" é a definição usada nos critérios de aceite.
 *
 * @param {string} root
 * @return {string[]} caminhos relativos, com barra normal
 */
function trackedFiles( root ) {
	const out = execFileSync( 'git', [ '-C', root, 'ls-files', '-z' ], {
		encoding: 'utf8',
		maxBuffer: 32 * 1024 * 1024,
	} );
	return out.split( '\0' ).filter( Boolean );
}

function blank( text ) {
	return text.replace( /[^\n]/g, ' ' );
}

/**
 * Substitui comentários PHP por espaços, e opcionalmente o corpo das strings.
 *
 * Substitui em vez de remover para que linha e coluna de um match continuem
 * apontando para o lugar certo no arquivo original.
 *
 * @param {string}  source
 * @param {boolean} strings também apaga o corpo dos literais de string
 * @return {string} o mesmo comprimento, com o ruído em branco
 */
function strip( source, strings ) {
	let out = '';
	let i = 0;
	while ( i < source.length ) {
		const dois = source.slice( i, i + 2 );
		// `#[` abre um atributo do PHP 8, não um comentário.
		const hashComment = source[ i ] === '#' && source[ i + 1 ] !== '[';
		if ( dois === '//' || hashComment ) {
			const fim = source.indexOf( '\n', i );
			const stop = fim === -1 ? source.length : fim;
			out += blank( source.slice( i, stop ) );
			i = stop;
			continue;
		}
		if ( dois === '/*' ) {
			const fim = source.indexOf( '*/', i + 2 );
			const stop = fim === -1 ? source.length : fim + 2;
			out += blank( source.slice( i, stop ) );
			i = stop;
			continue;
		}
		if ( source[ i ] === "'" || source[ i ] === '"' ) {
			const aspas = source[ i ];
			let j = i + 1;
			while ( j < source.length && source[ j ] !== aspas ) {
				j += source[ j ] === '\\' ? 2 : 1;
			}
			const corpo = source.slice( i + 1, Math.min( j, source.length ) );
			out += aspas + ( strings ? blank( corpo ) : corpo );
			if ( source[ j ] === aspas ) {
				out += aspas;
			}
			i = j + 1;
			continue;
		}
		out += source[ i ];
		i += 1;
	}
	return out;
}

const stripPhpComments = ( source ) => strip( source, false );
const stripPhpNoise = ( source ) => strip( source, true );

const isTestPath = ( file ) => TEST_PATH_RE.test( file );

/**
 * PHP de produção: o que é entregue dentro do plugin.
 *
 * Allowlist por raiz, e não só "não é teste". `e2e/mu-plugins/*.php` e
 * `scripts/check-coverage-threshold.php` são PHP versionado, não moram em
 * diretório de teste, e não são código do plugin — deixá-los entrar faria as
 * regras de conteúdo (ADRs 0002, 0008, 0009), a de namespace REST (0007) e a
 * de i18n (0010) valerem sobre ferramental de teste. Hoje nenhum deles as
 * dispararia; um harness futuro que use `exec` ou uma string sem text domain
 * dispararia, e o lint reprovaria código correto.
 *
 * @param {Object} ctx
 * @return {string[]} .php versionados de `features/`, `shared/` e a raiz do plugin
 */
function phpSources( ctx ) {
	return ctx.files.filter(
		( f ) =>
			f.endsWith( '.php' ) &&
			! isTestPath( f ) &&
			( f === 'post-voice.php' ||
				f.startsWith( 'features/' ) ||
				f.startsWith( 'shared/' ) )
	);
}

/**
 * @param {Object}   [entrada]
 * @param {string}   [entrada.root]  raiz do repo
 * @param {string[]} [entrada.files] injetado nos testes
 * @param {Function} [entrada.read]  injetado nos testes
 * @return {Object} o contexto
 */
function createContext( { root = process.cwd(), files, read } = {} ) {
	const lista = files || trackedFiles( root );
	const ler =
		read || ( ( f ) => fs.readFileSync( path.join( root, f ), 'utf8' ) );
	const cache = new Map();
	return {
		root,
		files: lista,
		read( file ) {
			if ( ! cache.has( file ) ) {
				cache.set( file, ler( file ) );
			}
			return cache.get( file );
		},
	};
}

module.exports = {
	createContext,
	trackedFiles,
	stripPhpComments,
	stripPhpNoise,
	isTestPath,
	phpSources,
};
