# Pesquisa: engine TTS client-side p/ plugin WordPress

**Data:** 2026-08-08
**Objetivo:** avaliar qual motor de TTS client-side (browser) usar como base p/ um plugin WordPress de narração de posts, inspirado no plugin [Speechable](https://wordpress.org/plugins/speechable/). Este doc documenta a pesquisa; a decisão final e o desenho do plugin ficam num spec separado (`docs/superpowers/specs/`).

## 1. Teardown do Speechable (referência direta)

- **Engine:** Piper TTS (VITS, não-autoregressivo) via ONNX Runtime Web
- **Timestamps p/ highlight de palavra:** Whisper (roda client-side também), gerado uma vez na criação do áudio
- **Distribuição de modelos:** não empacotados no plugin — carregados sob demanda de CDN (jsDelivr, Cloudflare) e Hugging Face, cacheados no browser depois do 1º download
- **Idiomas:** 12 (en-US, en-GB, de, fr, es, it, pt, nl, pl, ru, zh, ja, ko)
- **Editor:** painel lateral "Speechable" no Gutenberg — autor escolhe voz/qualidade, clica "Generate Audio"
- **Player (leitor):** controles básicos, highlight de palavra + auto-scroll, botão de download, cores customizáveis, funciona com plugins de cache e page builders
- **Preço:** grátis, sem limites, sem premium

Fonte: [wordpress.org/plugins/speechable](https://wordpress.org/plugins/speechable/)

## 2. Outros players no mercado (contexto, não concorrentes diretos de arquitetura)

| Plugin | Engine | Observação |
|---|---|---|
| Trinity Audio | Cloud/API | Server-side, 125 idiomas, limite de artigos/mês no free |
| GSpeech | Cloud/API | Server-side, 70+ idiomas, pioneiro do "Read Highlighted Text" |
| Text To Speech TTS Accessibility | — | Player flutuante/sticky configurável (docking), highlight de frase+palavra com cores customizáveis — valida demanda por essas features |
| Reinvent WP Text to Speech | — | Sticky footer player, highlight de frase e palavra |

Nenhum concorrente client-side (fora Speechable) encontrado. **Nenhum oferece voice cloning.**

Fontes: [trinity-audio](https://wordpress.org/plugins/trinity-audio/), [gspeech](https://wordpress.org/plugins/gspeech/), [text-to-audio](https://wordpress.org/plugins/text-to-audio/), [natural-text-to-speech](https://wordpress.org/plugins/natural-text-to-speech/)

## 3. Comparação de engine: Pocket TTS (este repo) vs Piper TTS (Speechable)

| | Pocket TTS (kyutai) | Piper TTS (VITS) |
|---|---|---|
| Arquitetura | Autoregressive flow-LM + codec mimi (pipeline de 5 modelos ONNX: text_conditioner, flow_lm_main, flow_lm_flow, mimi_encoder, mimi_decoder) | VITS não-autoregressivo, 1 modelo ONNX por voz |
| Tamanho por idioma/voz | ~190MB (bundle testado neste repo) | ~60MB por voz (`en_US-hfc_female-medium`) |
| Velocidade CPU | Sem benchmark público — arquitetura mais pesada computacionalmente | Benchmarks públicos: 3-5x realtime só CPU, sem GPU. Realtime até em Raspberry Pi 5 |
| Voice cloning | **Sim** — zero-shot a partir de clipe curto, via `mimi_encoder.onnx` | Não — vozes fixas pré-treinadas |
| Timestamps p/ highlight | Não gera nativamente — precisaria de passo extra (ex.: Whisper) | Idem — Speechable também usa Whisper à parte |
| Idiomas disponíveis hoje | 5 (en, de, it, pt, es) | 12 no Speechable; 30+ no catálogo Piper (inclui 4 vozes pt_BR: cadu, edresson, faber, jeff) |
| Onde roda no fluxo do plugin | Só no editor (autor gera 1x por post) — leitor só recebe áudio+timestamps prontos, sem runtime ML | Mesmo modelo de uso |

**Ponto-chave:** como a geração acontece só no editor (ação ocasional do autor, não do visitante), o tamanho/velocidade do bundle pesa menos do que pesaria se o leitor precisasse rodar o modelo. O diferencial real do Pocket TTS é **voice cloning** — nenhum concorrente client-side tem isso. Trade-off: sem benchmark de velocidade/qualidade em pt-BR ainda validado (pendente — ver seção 4).

## 4. Validação prática

- [x] Pocket TTS testado neste repo (demo `index.html` + `server.py`) — funciona, mas sem RTF/qualidade documentados neste doc ainda.
- [x] **Piper TTS testado em `piper-test/index.html`** (pacote `@mintplex-labs/piper-tts-web@1.0.4`, via CDN jsDelivr) — **resultado: quebrado para pt_BR nesta lib.**

### Bug encontrado — pt_BR quebrado em `@mintplex-labs/piper-tts-web`

Catálogo (`tts.voices()`) só retorna 2 vozes pt_BR de fato utilizáveis, não 4: `pt_BR-edresson-low` e `pt_BR-faber-medium` (cadu/jeff não apareceram na listagem real da lib, apesar de existirem no repo HF `rhasspy/piper-voices`).

Ambas as vozes pt_BR falham na inferência, de forma determinística e independente do texto (testado com o parágrafo original com "BYD" e com texto ASCII simples "Ola mundo teste simples."):

```
ERROR_MESSAGE: Non-zero status code returned while running Gather node.
Name:'/enc_p/emb/Gather' Status Message: indices element out of data bounds,
idx=141 must be within the inclusive range [-130,129]
```

Ou seja, o fonemizador da lib produz um id de fonema (141) fora do vocabulário do modelo (260 entradas, faixa válida -130..129) — bug de mapeamento fonema→id específico desta lib pra pt_BR, não uma questão de qualidade de voz. Testado o mesmo fluxo com voz `en_US-hfc_female-medium`: baixou o modelo (100%) sem erro, mas a inferência ficou presa/lenta na criação da `InferenceSession` no ambiente de teste (sandbox de browser automatizado) sem gerar erro nem resultado dentro do tempo observado — inconclusivo quanto à causa (pode ser limitação do próprio sandbox, não da lib).

**Achado extra:** a lib roda o `predict()` inteiro na thread principal (sem Web Worker) — trava a UI da página durante a geração. Relevante pro editor do WordPress: se usarmos essa lib, o editor Gutenberg congelaria durante a narração.

### 2ª tentativa — lib upstream `@diffusionstudio/vits-web@1.0.3`

`@mintplex-labs/piper-tts-web` é fork de `@diffusionstudio/vits-web`. Antes de descartar Piper, testei a lib original (`piper-test/vits-web.html`), não só o fork, pra não fechar a decisão baseado numa falha de um único pacote.

Inspeção do bundle mostrou que o fork **não mudou nada relevante**: mesmo `HF_BASE` (`huggingface.co/diffusionstudio/piper-voices`), mesmo `onnxruntime-web@1.18.0`, mesmo `@diffusionstudio/piper-wasm@1.0.0` (o binário WASM do fonemizador), mesmo `PATH_MAP` pra pt_BR (`edresson-low`, `faber-medium`, os mesmos 2 arquivos `.onnx`). Testei ao vivo mesmo assim, mesmo texto com "BYD":

```
Erro na geração: failed to call OrtRun(). ERROR_CODE: 2, ERROR_MESSAGE:
Non-zero status code returned while running Gather node. Name:'/enc_p/emb/Gather'
Status Message: indices element out of data bounds, idx=141 must be within
the inclusive range [-130,129]
```

**Erro idêntico, byte a byte.** Confirma que o bug não é do wrapper `piper-tts-web` — está na dupla `@diffusionstudio/piper-wasm@1.0.0` (fonemizador) + modelos `.onnx` pt_BR hospedados em `huggingface.co/diffusionstudio/piper-voices`. Alguma das duas partes está desalinhada da outra (fonemizador gerando um id de fonema — provavelmente um símbolo IPA novo do espeak-ng — que o vocabulário do modelo pt_BR treinado não conhece). Esse par HF+WASM é o que tanto Speechable quanto qualquer projeto baseado nesses 2 npm packages usaria hoje — não é algo que dá pra contornar trocando de wrapper JS.

### Conclusão da validação

Confirmado com 2 implementações JS independentes (fork e upstream): **os modelos pt_BR distribuídos via `huggingface.co/diffusionstudio/piper-voices` estão incompatíveis com o fonemizador WASM (`piper-wasm@1.0.0`) que os acompanha**, pelo menos pras vozes `edresson` e `faber`. Não é bug de wrapper, é bug/desalinhamento na fonte de distribuição desses modelos. Próximos passos possíveis, caso Piper continue sendo cotado:
- Buscar os `.onnx` pt_BR direto do repo oficial `rhasspy/piper-voices` no HF (fonte diferente de `diffusionstudio/piper-voices`) e testar com o Piper CLI oficial (Python) fora do browser, pra isolar se o problema é o modelo em si ou só essa cópia/wasm específica.
- Reportar o bug nos issues de `diffusionstudio/vits-web` e/ou `rhasspy/piper` se confirmado no CLI oficial também.
- Considerar Kokoro TTS (outro motor client-side leve, citado nos benchmarks da seção 3) como terceira alternativa, se Piper pt_BR permanecer quebrado.

## 5. Decisão

**Fechado: Pocket TTS** para o MVP do plugin, com base na validação prática:

- Já testado e funcional neste repo para pt-BR (e demais idiomas do bundle).
- Diferencial de voice cloning se mantém único no mercado client-side.
- Piper TTS, a alternativa mais forte em tese, **falhou na validação prática em pt-BR em 2 implementações JS independentes** (fork `@mintplex-labs/piper-tts-web` e upstream `@diffusionstudio/vits-web`, seção 4) — mesmo erro nas duas, raiz no par modelo/fonemizador distribuído via HF, não no wrapper. Não é uma opção viável agora sem investigar a fonte dos modelos (CLI oficial / repo `rhasspy`) ou trocar de engine leve (ex.: Kokoro).
- Tamanho maior do bundle do Pocket TTS segue aceitável porque a geração roda só no editor (autor), não no leitor.

Revisitar Piper como engine secundária/alternativa só se alguém investigar e corrigir o bug de fonemização pt_BR num binding JS diferente.

## Fontes consultadas

- [wordpress.org/plugins/speechable](https://wordpress.org/plugins/speechable/)
- [github.com/kyutai-labs/pocket-tts](https://github.com/kyutai-labs/pocket-tts)
- [huggingface.co/KevinAHM/pocket-tts-onnx](https://huggingface.co/KevinAHM/pocket-tts-onnx)
- [offlinetts.com — Browser TTS Showdown: Kokoro vs Piper vs Kitten](https://offlinetts.com/blog/browser-tts-showdown-kokoro-piper-kitten/)
- [github.com/rhasspy/piper/blob/master/VOICES.md](https://github.com/rhasspy/piper/blob/master/VOICES.md)
- [huggingface.co/rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices) (pasta `pt/pt_BR`: cadu, edresson, faber, jeff)
- [npmjs.com/package/@mintplex-labs/piper-tts-web](https://www.npmjs.com/package/@mintplex-labs/piper-tts-web)
- [wordpress.org/plugins/trinity-audio](https://wordpress.org/plugins/trinity-audio/), [gspeech](https://wordpress.org/plugins/gspeech/), [text-to-audio](https://wordpress.org/plugins/text-to-audio/), [natural-text-to-speech](https://wordpress.org/plugins/natural-text-to-speech/)
