'use strict';
// Registro das regras determinísticas. Uma regra aqui que nenhuma ADR declare
// em `enforced_by` reprova o lint como órfã — o registro e as ADRs são espelhos
// um do outro, de propósito.
module.exports = {
	'no-server-side-tts': require( './no-server-side-tts' ),
	'no-narration-logic-in-php': require( './no-narration-logic-in-php' ),
	'no-server-side-audio-processing': require( './no-server-side-audio-processing' ),
	'php-class-naming': require( './php-class-naming' ),
	'rest-namespace': require( './rest-namespace' ),
	'i18n-text-domain': require( './i18n-text-domain' ),
	'covers-annotation': require( './covers-annotation' ),
};
