# Política de segurança

## Versões suportadas

O projeto está pré-1.0. Só a versão mais recente publicada em
[Releases](https://github.com/luigi-moretti/post-voice/releases) recebe
correção de segurança — sem suporte a versões antigas nesta fase.

## Reportar uma vulnerabilidade

**Não abra uma issue pública.** Envie um email para `luigi@moretti.dev` com:

- Descrição da vulnerabilidade e impacto potencial
- Passos para reproduzir
- Versão do plugin, do WordPress e do PHP em que foi encontrada

Confirmação de recebimento em até 5 dias úteis. O prazo para correção ou
plano de mitigação varia com a gravidade, mas você recebe uma estimativa
dentro desse mesmo prazo inicial. Depois de uma correção publicada, a
vulnerabilidade é divulgada publicamente com crédito a quem reportou,
salvo pedido em contrário.

## Superfície relevante

TTS roda inteiramente no navegador do autor — nenhum texto de post sai do
navegador para gerar áudio (ver `docs/adr/0002-tts-roda-no-navegador.md`).
Isso limita a superfície de servidor aos endpoints REST que recebem o
áudio já gerado (`post-voice/v1`), sua validação, e o armazenamento como
attachment. Vulnerabilidades de XSS/CSRF/validação nesses pontos são o
que mais importa reportar.
