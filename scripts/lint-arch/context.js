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

// `<<<` seguido de espaço opcional e então um identificador — cru, ou entre
// aspas simples (nowdoc) ou duplas (heredoc); PHP não distingue os dois para
// fins de onde o corpo começa e termina, só para se ele interpola variável, o
// que não importa aqui.
//
// Espaço só ANTES do rótulo: `<<< EOT` é legal, `<<<EOT ` (com espaço depois)
// é erro de sintaxe — confirmado com `php -l`. A assimetria parece pedante e
// não é: `stripPhpComments` apaga comentário PARA ESPAÇO, então aceitar espaço
// à direita deixava a primeira passada SINTETIZAR um cabeçalho que não existia
// no original, e o corpo sintético engolia o resto do arquivo. `<?=<<<T#\n(`
// é a entrada mínima: o `#` vira espaço, e `stripPhpNoise( stripPhpComments(
// x ) )` deixa de ser igual a `stripPhpNoise( x )` — a composição de que
// `gettextCalls` depende, documentada no JSDoc dele.
const HEREDOC_CABECALHO_RE = /^<<<[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1\r?\n/;

/**
 * Reconhece um heredoc/nowdoc que começa em `source[i]` (que já é `<<<`).
 *
 * O corpo é opaco: um `?>`, uma aspa, um `//`, um `#` ou um bloco `/* ... *\/` lá
 * dentro não abre nem fecha nada, do mesmo jeito que já valia para o corpo
 * de uma string comum antes desta função existir — é por isso que `strip`
 * não faz uma segunda passada sobre o corpo, só decide apagá-lo ou não.
 *
 * O rótulo de fechamento pode vir indentado (PHP 7.3+) — por isso a busca é
 * por uma linha cujo primeiro token, depois de espaço em branco, é o próprio
 * rótulo não seguido de mais um caractere de palavra: um corpo que
 * simplesmente *contém* o rótulo no meio de uma linha, ou como prefixo de um
 * identificador maior, não é o terminador.
 *
 * @param {string} source
 * @param {number} i      posição de `<<<` em `source`
 * @return {{inicioCorpo:number,fimCorpo:number,fimRotulo:number,temTerminador:boolean}|null}
 *   null quando `<<<` ali não é um heredoc válido (não é reconhecido; `strip`
 *   trata os caracteres normalmente, um de cada vez)
 */
function lerHeredoc( source, i ) {
	const cabecalho = HEREDOC_CABECALHO_RE.exec( source.slice( i ) );
	if ( cabecalho === null ) {
		return null;
	}
	const rotulo = cabecalho[ 2 ];
	const inicioCorpo = i + cabecalho[ 0 ].length;
	// `(^|\n)` casa tanto um corpo vazio (rótulo de fechamento já na
	// primeira linha) quanto o início de qualquer linha seguinte.
	const termRe = new RegExp( '(^|\n)([ \t]*)' + rotulo + '(?![A-Za-z0-9_])' );
	const resto = source.slice( inicioCorpo );
	const achado = termRe.exec( resto );
	if ( achado === null ) {
		// Sem terminador: consome até o fim do arquivo, como um comentário
		// de bloco ou uma string sem fechamento.
		return {
			inicioCorpo,
			fimCorpo: source.length,
			fimRotulo: source.length,
			temTerminador: false,
		};
	}
	const fimCorpo = inicioCorpo + achado.index + achado[ 1 ].length;
	const fimRotulo = fimCorpo + achado[ 2 ].length + rotulo.length;
	return { inicioCorpo, fimCorpo, fimRotulo, temTerminador: true };
}

/**
 * Substitui comentários PHP por espaços, e opcionalmente o corpo das strings.
 *
 * Substitui em vez de remover para que linha e coluna de um match continuem
 * apontando para o lugar certo no arquivo original.
 *
 * Um arquivo PHP alterna entre dois modos: fora de `<?php ... ?>` o texto é
 * saída literal (HTML, em geral), e dentro é código. `strip` só entende
 * comentário/string/atributo enquanto está dentro — fora, copia tudo ao pé da
 * letra, porque uma aspa ou um `//` no HTML não abre nada em PHP. Sem essa
 * distinção, uma tag `<?php ... ?>` embutida num atributo `class="<?php ...
 * ?>"` cai dentro do rastreamento de string aberto pela aspa do atributo e é
 * apagada como se fosse corpo de string.
 *
 * @param {string}  source
 * @param {boolean} strings também apaga o corpo dos literais de string
 * @return {string} o mesmo comprimento, com o ruído em branco
 */
function strip( source, strings ) {
	let out = '';
	let i = 0;
	// O arquivo começa fora do PHP. Isso não muda o resultado para os arquivos
	// que já começam com `<?php` — a fatia "fora" antes dele é vazia.
	let dentro = false;
	while ( i < source.length ) {
		if ( ! dentro ) {
			// `<?PHP` e `<?PhP` são PHP válido — a tag não diferencia
			// maiúsculas de minúsculas. `<?=` não tem letra nenhuma, então
			// não precisa da mesma checagem.
			//
			// A tag só abre quando o que vem depois dela é espaço em branco
			// (espaço, tab ou quebra de linha — é a regra do próprio lexer do
			// PHP) ou o fim do arquivo. `<?phpecho 1;` não abre nada: é texto
			// literal. Sem essa segunda metade, o stripper entrava em modo
			// código onde o PHP não entra, e apagava como comentário/string
			// algo que na verdade é saída literal.
			const abrePhp =
				/^<\?php/i.test( source.slice( i, i + 5 ) ) &&
				( i + 5 === source.length ||
					/[ \t\r\n]/.test( source[ i + 5 ] ) );
			const abreEcho = ! abrePhp && source.startsWith( '<?=', i );
			if ( abrePhp || abreEcho ) {
				// `slice`, não um literal fixo: preserva a caixa original da
				// tag em vez de normalizar para `<?php` minúsculo.
				const comprimento = abrePhp ? 5 : 3;
				out += source.slice( i, i + comprimento );
				i += comprimento;
				dentro = true;
				continue;
			}
			// Texto literal (HTML): copiado sem interpretar aspas ou `//`.
			out += source[ i ];
			i += 1;
			continue;
		}

		const dois = source.slice( i, i + 2 );
		if ( dois === '?>' ) {
			out += dois;
			i += 2;
			dentro = false;
			continue;
		}
		// `#[` abre um atributo do PHP 8, não um comentário.
		const hashComment = source[ i ] === '#' && source[ i + 1 ] !== '[';
		if ( dois === '//' || hashComment ) {
			// Diferente de `/* */` e de string, um `?>` FECHA um comentário de
			// linha — é a própria linguagem que trata a tag de fechamento como
			// o fim da linha ali. Para no que vier primeiro: a quebra de linha
			// ou a tag.
			const fimLinha = source.indexOf( '\n', i );
			const fimTag = source.indexOf( '?>', i );
			const paraNaTag =
				fimTag !== -1 && ( fimLinha === -1 || fimTag < fimLinha );
			const fimSemTag = fimLinha === -1 ? source.length : fimLinha;
			const stop = paraNaTag ? fimTag : fimSemTag;
			out += blank( source.slice( i, stop ) );
			i = stop;
			if ( paraNaTag ) {
				out += '?>';
				i += 2;
				dentro = false;
			}
			continue;
		}
		if ( dois === '/*' ) {
			// Um `?>` dentro do comentário não fecha a tag — faz parte do
			// comentário, então a busca é só por `*/`.
			const fim = source.indexOf( '*/', i + 2 );
			const stop = fim === -1 ? source.length : fim + 2;
			out += blank( source.slice( i, stop ) );
			i = stop;
			continue;
		}
		if ( source.startsWith( '<<<', i ) ) {
			const heredoc = lerHeredoc( source, i );
			if ( heredoc !== null ) {
				// Cabeçalho (`<<<EOT\n`, `<<<'EOT'\n`, com o espaço opcional
				// que o PHP aceita): sintaxe de verdade, sempre visível.
				out += source.slice( i, heredoc.inicioCorpo );
				// Corpo: tratado como o corpo de uma string comum — apagado só
				// quando `strings` é true. `?>`, aspas, `//`, `#` e `/* */`
				// dentro dele não abrem nem fecham nada; são só bytes do corpo,
				// do mesmo jeito que um `?>` dentro de uma string comum já era
				// inerte antes desta função existir.
				const corpo = source.slice(
					heredoc.inicioCorpo,
					heredoc.fimCorpo
				);
				out += strings ? blank( corpo ) : corpo;
				if ( heredoc.temTerminador ) {
					// A indentação e o rótulo de fechamento também são
					// sintaxe — ficam visíveis, como a aspa de fechamento de
					// uma string comum.
					out += source.slice( heredoc.fimCorpo, heredoc.fimRotulo );
					i = heredoc.fimRotulo;
				} else {
					// Sem terminador: o heredoc consome até o fim do
					// arquivo, igual a uma string ou comentário de bloco sem
					// fechamento.
					i = heredoc.fimCorpo;
				}
				continue;
			}
		}
		if ( source[ i ] === "'" || source[ i ] === '"' ) {
			const aspas = source[ i ];
			let j = i + 1;
			// Um `?>` dentro da string não fecha a tag — faz parte do corpo,
			// então a busca é só pela aspa de fechamento.
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
