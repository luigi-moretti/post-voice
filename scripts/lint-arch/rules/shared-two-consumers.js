'use strict';
const { isTestPath } = require( '../context' );
const { phpClassOwners } = require( './php-class-naming' );

/**
 * Todo módulo de shared/ precisa de dois consumidores reais.
 *
 * `post-voice.php` não conta: a raiz carrega e registra tudo, e contá-la faria
 * qualquer módulo de shared/ parecer ter um consumidor a mais do que tem.
 * Testes também não contam — um teste consome por definição.
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
