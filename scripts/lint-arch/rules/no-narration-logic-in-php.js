'use strict';
const { scanForbidden } = require( './forbidden-php' );

const PADROES = [
	{
		// Ver o comentário sobre os dois lookbehinds em no-server-side-tts.js.
		pattern: /(?<!->)(?<!::)\b(?:md5|sha1|hash|hash_hmac)\s*\(/g,
		motivo: 'o cliente calcula source_hash; o servidor guarda e compara, nunca recomputa (ADR-0008)',
	},
	{
		pattern: /\bparse_blocks\s*\(/g,
		motivo: 'a seleção do que é narrado é do cliente; o servidor não reimplementa (ADR-0008)',
	},
];

module.exports = {
	id: 'no-narration-logic-in-php',
	adr: '0008',
	check: ( ctx ) => scanForbidden( ctx, PADROES ),
};
