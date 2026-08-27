'use strict';
const { scanForbidden } = require( './forbidden-php' );

const PADROES = [
	{
		pattern: /\b(?:ffmpeg|avconv|lame|sox)\b/gi,
		rotulo: 'encoder-externo',
		motivo: 'encoder de áudio no servidor; o cliente comprime antes do upload (ADR-0009)',
	},
	{
		pattern: /\bgetID3\b/g,
		rotulo: 'getid3',
		motivo: 'biblioteca de áudio no servidor (ADR-0009)',
	},
];

module.exports = {
	id: 'no-server-side-audio-processing',
	adr: '0009',
	check: ( ctx ) => scanForbidden( ctx, PADROES ),
};
