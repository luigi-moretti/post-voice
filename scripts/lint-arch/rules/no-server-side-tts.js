'use strict';
const { scanForbidden } = require( './forbidden-php' );

// Não procura a palavra "model" nem "voice": ambas aparecem legitimamente em
// strings traduzíveis e em nomes de opção. Procura o que só existe se o
// servidor estiver de fato sintetizando — spawn de processo e referência ao
// runtime ou ao arquivo do modelo.
const PADROES = [
	{
		pattern: /\b(?:exec|shell_exec|proc_open|passthru|system|popen)\s*\(/g,
		rotulo: 'spawn-de-processo',
		motivo: 'spawn de processo no servidor; o TTS roda no navegador (ADR-0002)',
	},
	{
		pattern: /\.onnx\b/g,
		rotulo: 'arquivo-onnx',
		motivo: 'referência a arquivo ONNX no servidor; o modelo vive no navegador (ADR-0002)',
	},
	{
		pattern: /\bonnxruntime\b/gi,
		rotulo: 'onnxruntime',
		motivo: 'referência ao runtime ONNX no servidor (ADR-0002)',
	},
];

module.exports = {
	id: 'no-server-side-tts',
	adr: '0002',
	check: ( ctx ) => scanForbidden( ctx, PADROES ),
};
