'use strict';
const { scanForbidden } = require( './forbidden-php' );

// Não procura a palavra "model" nem "voice": ambas aparecem legitimamente em
// strings traduzíveis e em nomes de opção. Procura o que só existe se o
// servidor estiver de fato sintetizando — spawn de processo e referência ao
// runtime ou ao arquivo do modelo.
const PADROES = [
	{
		// `(?<!->)(?<!::)` impede casar `$obj->exec(` e `self::system(`: `\b`
		// dispara logo depois de `->` e de `::`, e um método próprio com esse nome
		// é código legítimo. Os dois lookbehinds são de dois caracteres de
		// propósito — um `(?<![>:])` de um caractere só também engoliria
		// `case 1:exec(` e `$a>exec(`, que são violações de verdade.
		// `password_hash(` já não casa, porque `_` é caractere de palavra e o
		// `\b` não abre ali.
		pattern:
			/(?<!->)(?<!::)\b(?:exec|shell_exec|proc_open|passthru|system|popen)\s*\(/g,
		motivo: 'spawn de processo no servidor; o TTS roda no navegador (ADR-0002)',
	},
	{
		pattern: /\.onnx\b/g,
		motivo: 'referência a arquivo ONNX no servidor; o modelo vive no navegador (ADR-0002)',
	},
	{
		pattern: /\bonnxruntime\b/gi,
		motivo: 'referência ao runtime ONNX no servidor (ADR-0002)',
	},
];

module.exports = {
	id: 'no-server-side-tts',
	adr: '0002',
	check: ( ctx ) => scanForbidden( ctx, PADROES ),
};
