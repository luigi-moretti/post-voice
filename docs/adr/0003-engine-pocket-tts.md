---
id: 0003
titulo: Pocket TTS como engine, não Piper
status: aceita
data: 2026-08-27
origem: research/2026-08-08-tts-engine-research.md
enforced_by: [ review-manual ]
revisar_quando: o bundle de um idioma passar de 60 MB, ou surgir engine com qualidade equivalente e bundle menor
desvios: []
---

## Contexto

O Speechable — a referência direta deste plugin — usa Piper TTS (VITS,
não-autoregressivo) via ONNX Runtime Web, ~60 MB por voz, com benchmarks
públicos de 3-5x realtime só em CPU. Pocket TTS é maior e mais pesado: um
pipeline de cinco modelos ONNX (`text_conditioner`, `flow_lm_main`,
`flow_lm_flow`, `mimi_encoder`, `mimi_decoder`) somando ~190 MB por bundle de
idioma, sem benchmark público de velocidade. Em tese Piper venceria em
tamanho e em CPU. A pesquisa vinculada testou os dois na prática, não só
comparou ficha técnica.

Piper foi testado em duas implementações JS independentes — o fork
`@mintplex-labs/piper-tts-web@1.0.4` e a lib upstream
`@diffusionstudio/vits-web@1.0.3` — e as vozes pt_BR (`edresson-low`,
`faber-medium`) falharam nas duas, com o mesmo erro byte a byte:
`Non-zero status code returned while running Gather node ... idx=141 must be
within the inclusive range [-130,129]`. A causa é um desalinhamento entre o
fonemizador WASM (`piper-wasm@1.0.0`) e os modelos `.onnx` pt_BR distribuídos
via `huggingface.co/diffusionstudio/piper-voices` — não um bug de wrapper, e
não algo que trocar de biblioteca JS contorna, porque as duas usam a mesma
fonte de modelos. A pesquisa também registrou que essa lib roda `predict()`
na thread principal, sem Web Worker, o que congelaria o editor Gutenberg
durante a geração. Pocket TTS, por outro lado, já estava testado e funcional
neste repo para pt-BR e para os demais idiomas do bundle.

## Decisão

O engine de síntese é Pocket TTS. Nenhum código de produção depende de Piper
nem de qualquer outra biblioteca de TTS client-side; a costura de engine fica
isolada em `editor/engine/` justamente para não impedir uma troca futura, mas
a troca em si não é feita nesta ADR.

## Consequências

Fica mais fácil: voice cloning zero-shot (via `mimi_encoder.onnx`) — nenhum
concorrente client-side pesquisado oferece isso — e narração em pt-BR que
funciona de fato, validada em vez de assumida. Fica mais difícil: bundle de
~190 MB contra ~60 MB do Piper por voz, cobertura de apenas 5 idiomas
(en, de, it, pt, es) contra 12 no Speechable, e nenhum benchmark público de
velocidade para comparar RTF com o 3-5x realtime documentado do Piper — o
trade-off é aceito porque a pesquisa também registra que a geração acontece
só no editor, ação ocasional do autor, não do visitante do site.

## Como verificar

Não há regra determinística — `enforced_by: [ review-manual ]`. Trocar de
engine é reescrever o Worker inteiro (tokenizador, pipeline de modelos,
formato de saída), não um import que escapa despercebido num PR. O que olhar
em review: qualquer dependência nova de síntese de voz em
`features/narration/editor/engine/` ou em `package.json` é, por definição,
uma proposta de revogar esta ADR, não uma escolha de implementação — precisa
de uma ADR nova, não de aprovação silenciosa.

## Alternativas rejeitadas

**Piper TTS.** Menor e com benchmark de velocidade público, mas reprovado na
validação prática em pt-BR em duas implementações JS independentes, por um
bug na fonte dos modelos distribuídos, não no wrapper — não é um "quase" que
uma lib diferente resolve.

**Kokoro TTS**, citado na pesquisa como terceira alternativa possível caso
Piper permanecesse quebrado: não chegou a ser testado neste repo, e sem
validação prática entra na mesma categoria de risco que reprovou o Piper.
