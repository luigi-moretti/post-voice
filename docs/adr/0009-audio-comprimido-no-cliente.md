---
id: 0009
titulo: O áudio é comprimido no cliente; o servidor nunca transcodifica
status: aceita
data: 2026-08-27
origem: superpowers/specs/2026-08-08-wp-narration-plugin-mvp-design.md#formato-de-áudio-salvo-definido
enforced_by: [ no-server-side-audio-processing ]
revisar_quando: for preciso oferecer um segundo formato de áudio a partir de uma narração já salva
desvios: []
---

## Contexto

Corolário direto da ADR-0002 — o TTS roda no navegador — mas independente
dela: um servidor poderia orquestrar a síntese inteiramente no cliente e
ainda assim transcodificar o áudio recebido antes de guardá-lo. PHP não tem
encoder de áudio nativo, e um binário como `ffmpeg` não está disponível na
hospedagem compartilhada que é o alvo do plugin. O áudio bruto que a síntese
produz também é grande demais para o `upload_max_filesize` típico desse tipo
de hospedagem.

## Decisão

O cliente comprime o áudio antes do upload. O servidor recebe o arquivo já
pronto e o guarda como attachment, sem nunca decodificar, recodificar ou
normalizar o que recebeu. O formato exato e a taxa de bits são valores de
spec, não desta ADR — o que está fixado aqui é que a compressão acontece no
navegador do autor, nunca no processo PHP.

## Consequências

Fica mais fácil: o upload chega pequeno o bastante para hospedagem
compartilhada, e o servidor não carrega dependência binária nenhuma para
processar mídia. Fica mais difícil: oferecer um segundo formato de saída
— ou trocar o existente — exige regerar o áudio a partir do editor, com o
autor presente; não há como o servidor produzir uma segunda versão de um
áudio já salvo.

## Como verificar

`no-server-side-audio-processing` — nenhum arquivo PHP fora de `tests/`
referencia `ffmpeg`, `lame`, `sox` ou `getID3`, os sinais de que o servidor
estaria processando ou inspecionando o áudio recebido em vez de só
armazená-lo.

## Alternativas rejeitadas

**Enviar WAV cru e comprimir no servidor.** O upload fica várias vezes maior
— justamente o problema que a compressão client-side resolve — e o servidor
passaria a depender de um binário de encoding que a hospedagem-alvo não
oferece.

**Deixar o servidor normalizar volume ou metadados do áudio recebido.** Mesma
dependência binária, pelo mesmo motivo: qualquer processamento de áudio no
PHP pressupõe uma ferramenta que não existe no ambiente que o plugin precisa
suportar.
