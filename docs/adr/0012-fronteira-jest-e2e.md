---
id: 0012
titulo: Fronteira entre Jest e E2E — Worker e ONNX não se mockam
status: aceita
data: 2026-08-27
origem: superpowers/specs/2026-08-08-wp-narration-plugin-mvp-design.md
enforced_by: [ review-manual, doctor ]
revisar_quando: a suíte E2E passar de 15 minutos, ou um mock de Worker aparecer num PR
desvios: []
---

## Contexto

Mockar o Worker e o ONNX produz um teste que passa enquanto o produto quebra:
o mock afirma o comportamento que se quer que a engine tenha, não o que ela
de fato faz. Ao mesmo tempo, empurrar tudo que o editor toca para E2E deixa a
suíte lenta e faz lógica pura — que poderia ser testada em milissegundos —
esperar minutos por um browser real a cada execução.

## Decisão

Todo comportamento que envolve Worker, ONNX ou navegador real ganha cenário
E2E, **exceto** quando o comportamento sob teste é ele mesmo uma função pura,
apenas alcançada através da UI. Nesse caso, extrai-se a função para um módulo
próprio e dá-se a ela uma suíte Jest. `tokenizer-sanitize.ts` é o precedente
nessa direção: foi extraída de `pocket-tts.worker.js` porque seu único
acoplamento ao Worker era morar no mesmo arquivo que um, não porque a lógica
tocasse `self` ou ONNX.

## Consequências

Fica mais fácil: os testes rápidos exercitam código de verdade em vez de um
mock, e cada extração deixa o Worker um pouco menor. Fica mais difícil: a
suíte E2E é lenta (~9 min, com download de modelo na primeira execução), e a
pergunta "isto é puro?" recai sobre quem escreve o teste — não há script que
responda por ela.

## Como verificar

`review-manual`, com uma pergunta fixa: "este cenário E2E novo estaria só
fixando a saída de uma função pura?". `e2e/segment-pipeline-perf.spec.ts` é o
contraexemplo que tem de continuar E2E apesar de parecer candidato a Jest: o
`DOMParser` do jsdom é ordens de grandeza mais lento que o de um navegador
real e produzia números de tempo não confiáveis — o cabeçalho do próprio
arquivo registra isso. O `doctor` reporta a contagem de cenários E2E e o
tempo da última execução, para que o crescimento da suíte apareça antes de
doer.

O `lint:arch` confere que esta ADR e o `DOCTOR_CHECKS` do `health.js` se
declarem mutuamente **e** que a seção nomeada ali apareça de fato no fonte de
`scripts/doctor.mjs`. Apagar a seção reprova. O que continua sem gate é o
conteúdo das duas linhas: que a contagem e a duração impressas estejam certas
é responsabilidade de quem editar o relatório.

## Alternativas rejeitadas

**Mockar o Worker.** Testa a fidelidade do mock, não a engine.

**Só E2E, sem extração.** A suíte cresce até ninguém mais rodá-la
localmente antes do PR, e o feedback de uma função pura quebrada passa a
levar minutos.

**Só Jest, com o Worker inteiro reimplementado em memória.** O caminho que
de fato quebra em produção — o real `self`, o real ONNX Runtime — fica sem
nenhum teste cobrindo-o.
