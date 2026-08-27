---
id: 0002
titulo: O TTS roda inteiro no navegador; o servidor só orquestra
status: aceita
data: 2026-08-27
origem: superpowers/specs/2026-08-08-wp-narration-plugin-mvp-design.md
enforced_by: [ no-server-side-tts ]
revisar_quando: um requisito exigir gerar narração sem um autor presente (agendamento, importação em lote)
desvios: []
---

## Contexto

O plugin roda em hospedagem WordPress típica, muitas vezes compartilhada. Um
modelo ONNX de ~190 MB e a inferência que ele exige — texto a áudio, com um
pipeline de cinco modelos — não cabem no orçamento de memória, CPU nem tempo de
execução de um processo PHP comum. A alternativa óbvia, chamar uma API de TTS
de terceiros, resolveria isso trocando o problema por outro: o texto do post
sairia do servidor do autor para um serviço pago, o plugin passaria a depender
de rede em toda geração, e o diferencial de voice cloning do Pocket TTS
(ADR-0003) não é algo que qualquer API de terceiros oferece de graça.

## Decisão

A síntese de voz acontece inteiramente no navegador do autor, num Web Worker.
O PHP nunca gera áudio: ele recebe o blob já pronto via REST, guarda como
attachment (`wp_insert_attachment`) e grava o post meta. Nenhum caminho de
código PHP fora de testes invoca processo externo, carrega modelo de TTS nem
chama serviço de síntese.

## Consequências

Fica mais fácil: instalação sem requisito de servidor além do WordPress
comum, custo zero de infraestrutura por narração gerada, e o texto do post
nunca sai da máquina do autor. Fica mais difícil: só se gera narração quando
há um autor com o editor aberto — agendamento e importação em lote ficam fora
de alcance sem uma decisão nova — e a primeira geração de cada sessão paga o
download do modelo.

## Como verificar

`no-server-side-tts` — nenhum arquivo PHP fora de `tests/` chama `exec`,
`shell_exec`, `proc_open`, `passthru`, `system` ou `popen`, nem referencia
`.onnx`/`onnxruntime`. Comentários são ignorados na varredura; strings não,
porque um caminho de modelo ou um argumento de linha de comando moraria numa
string.

## Alternativas rejeitadas

**API de TTS de terceiros.** Custo recorrente por narração, o texto do post
sai do servidor do usuário, e o plugin passa a depender de rede — quebra o
fluxo de geração sem conexão.

**Binário de TTS instalado no servidor.** Não instalável na hospedagem
compartilhada que é o alvo do plugin, e vira suporte de plataforma (versão de
Python, dependências nativas) em vez de um plugin WordPress comum.

**Fila com worker externo (processo separado, cron, serviço à parte).**
Exige infraestrutura que o usuário-alvo — quem instala um plugin de um clique
— não tem e não quer operar.
