'use strict';
const { isTestPath } = require( '../context' );
const { phpClassOwners } = require( './php-class-naming' );

/**
 * Todo módulo de shared/ precisa de dois consumidores reais.
 *
 * Consumidor é arquivo PHP de produção sob `features/`, e o mecanismo é esse
 * filtro, não uma checagem por nome: `post-voice.php` fica de fora porque não
 * começa com `features/` — a raiz carrega e registra tudo, e contá-la faria
 * qualquer módulo de shared/ parecer ter um consumidor a mais do que tem.
 * Teste também não conta, e esse sim tem guarda própria (`isTestPath`): um
 * teste consome por definição, então contá-lo faria qualquer módulo atingir o
 * limiar sem feature nenhuma depender dele.
 *
 * Ponto cego conhecido: a busca é pelo nome da classe dentro dos arquivos de
 * feature, então consumo TRANSITIVO — feature usa o módulo A de shared/, que
 * por sua vez usa o B — lê o B como tendo zero consumidores. Hoje não alcança
 * nada (shared/ tem um módulo só); vale rever quando o `revisar_quando` da
 * ADR-0004 disparar em "shared/ passar de três módulos".
 *
 * @param {Object} ctx
 * @return {Object[]} achados
 */
function check( ctx ) {
	const donos = phpClassOwners( ctx );
	const compartilhadas = [ ...donos.entries() ].filter(
		( [ , v ] ) => v.feature === 'shared'
	);

	const consumidores = ( klass ) => {
		const features = new Set();
		for ( const file of ctx.files ) {
			if (
				! file.startsWith( 'features/' ) ||
				! file.endsWith( '.php' ) ||
				isTestPath( file )
			) {
				continue;
			}
			if ( new RegExp( `\\b${ klass }\\b` ).test( ctx.read( file ) ) ) {
				features.add( file.split( '/' )[ 1 ] );
			}
		}
		return features;
	};

	return compartilhadas
		.map( ( [ klass, { file } ] ) => ( {
			klass,
			file,
			features: consumidores( klass ),
		} ) )
		.filter( ( { features } ) => features.size < 2 )
		.map( ( { klass, file, features } ) => ( {
			key: `${ file } → ${ features.size }-consumidor(es)`,
			file,
			line: 1,
			message: `${ klass } está em shared/ com ${ features.size } feature(s) consumidora(s); shared/ é para o segundo consumidor real, não para o primeiro (ADR-0004)`,
		} ) );
}

module.exports = { id: 'shared-two-consumers', adr: '0004', check };
