# Post Voice — Plugin WordPress de narração client-side — Fase 1 (MVP)

**Data:** 2026-08-08
**Status:** Aprovado para planejamento de implementação
**Pesquisa relacionada:** [`docs/research/2026-08-08-tts-engine-research.md`](../../research/2026-08-08-tts-engine-research.md)

## Contexto

Plugin WordPress que gera narração em áudio de posts, 100% no navegador (client-side TTS), inspirado no [Speechable](https://wordpress.org/plugins/speechable/). Diferencial: usa **Pocket TTS** (voice cloning), não Piper — ver justificativa na pesquisa vinculada.

Projeto grande, dividido em fases. Este documento cobre só a **Fase 1 (MVP)**. Fases seguintes têm spec própria quando chegar a vez:

- **Fase 2:** trecho/bloco do post lido em outro idioma; dicionário de pronúncia (texto alternativo só pra leitura em voz, ex. "BYD" → "Bi Iou Di").
- **Fase 3:** customização visual do player (cores/identidade); highlight de palavra sincronizado com a narração + auto-scroll (requer investigação própria de alinhamento de timestamp).

## Decisões já fechadas (não reabrir sem motivo novo)

| Decisão | Escolha | Por quê |
|---|---|---|
| Engine TTS | Pocket TTS | Único client-side com voice cloning; Piper testado e reprovado em pt-BR em 2 libs JS independentes (ver pesquisa) |
| Distribuição | Privado/custom por ora | Sem review wordpress.org agora; construído com padrão WP desde já pra migração barata depois |
| Hosting do modelo | Hugging Face em runtime | Zero infra agora; endpoint isolado numa constante pra trocar por auto-hospedado sem reescrever código |
| i18n | Desde o primeiro commit | Todas strings via `__()`/`_x()`, `.pot` gerado por script |
| Áudio por post | 1 por vez | Gerar de novo substitui o anterior — sem seletor de idioma no player do leitor |
| Linguagem editor | TypeScript | Segurança de tipo, prioridade do usuário sobre velocidade de escrita |
| Gating de performance | Calibração empírica em runtime, não checagem estática de device | Ver seção "Requisitos de hardware e calibração" — `hardwareConcurrency`/`deviceMemory` são Chromium-only e grosseiros; medir de verdade é mais confiável em navegador heterogêneo (Safari/Firefox incluso) |

## Itens em aberto (revisão da spec — 2026-08-10, fechada 2026-08-11)

Achados numa revisão de consistência: 1 contradição (corrigida, ver tabela de cobertura acima — referenciava `includes/`, arquitetura já é feature-based) e os gaps abaixo. Cada um vira uma seção própria, com status, discutida em conversa — sem isso, decisão se perde entre turnos. Status: `pendente` → `em progresso` → `definido` (aí o conteúdo final substitui a descrição do gap). **Todos os 13 itens fechados — revisão completa.**

### Nome/slug real do plugin [definido]

**Nome: "Post Voice". Slug/namespace: `post-voice`.**

Escolhido por ser outcome-first (não amarra no motor/tecnologia — "voice" é o resultado, não "pocket"/"local"), sem bater no cluster saturado de "text to speech" (~12 dos 20 plugins da tag usam a frase crua), e sem colidir com "Speechable" (referência direta).

Pesquisa de disponibilidade (2026-08-10):
- wordpress.org: slug `post-voice` livre, nenhum plugin com esse nome existe.
- Domínio: `postvoice.com`/`post-voice.com` já tomados (`.com` à venda por $5.000). `.io`/`.dev`/`.co`/`.net`/`.app` livres — não bloqueia o plugin (distribuição é privada por ora), só relevante se/quando for pra público. Sem checagem de marca registrada (fora de escopo pra decisão de plugin privado).
- Rejeitado antes de fechar: "audio-post" — tecnicamente livre (slug e a maioria dos domínios), mas "audio post" é termo já estabelecido da indústria (audio post-production, edição/mixagem de som pra filme/podcast) — colide semanticamente, pioraria achabilidade em vez de melhorar.

Convenções derivadas (usar daqui pra frente em todo o doc e no código):
- Pasta do plugin / arquivo bootstrap: `post-voice/post-voice.php`
- Namespace REST: `post-voice/v1`
- Text-domain (i18n): `post-voice`
- Prefixo de classe PHP: `Post_Voice_*` (ou namespace `PostVoice\` se optar por PSR-4 com autoload via Composer — decisão de implementação, não bloqueia o spec)

### Contrato do endpoint REST [definido]

**Rota:** `POST /wp-json/post-voice/v1/posts/{post_id}/narration` — post ID na URL (recurso aninhado, convenção da própria WP REST API, `/wp/v2/posts/<id>`), não no body. `permission_callback` valida `current_user_can('edit_post', $post_id)` direto da URL antes de tocar no body.

**Payload — `multipart/form-data`** (não JSON+base64, que infla ~33% um arquivo já grande):

| Campo | Tipo | Obs |
|---|---|---|
| `audio` | file | O blob gerado no browser |
| `language` | string | Código do bundle (ex. `pt`, alinhado com pasta `onnx/<language>/`) |
| `source_hash` | string | SHA-256 hex, calculado no client (`crypto.subtle.digest`) sobre o texto filtrado que foi de fato narrado |

Autenticação: header `X-WP-Nonce` padrão WP REST (cookie+nonce), não vai no body.

**Quem calcula `source_hash`:** client calcula, server só guarda. Server nunca recomputa nem reimplementa em PHP a lógica de "quais blocos entram na narração" — duplicaria regra de negócio em 2 linguagens, risco de dessincronia. Coerente com "Backend só orquestra". Checagem de "desatualizado" também é 100% client-side: editor recalcula hash do texto atual toda vez que abre o painel, compara com o meta salvo. PHP nunca valida, só armazena.

**Resposta:** sucesso (200) → `{ attachment_id, url, generated_at, language }`, painel atualiza pro estado "áudio existente" sem reload. Erro → formato padrão WP REST (`WP_Error` → `{code, message, data:{status}}`), códigos tipo `post_voice_missing_audio` (400), `post_voice_forbidden` (403, herdado do `permission_callback`).

**Método:** POST, não PUT — mesmo sendo upsert (sempre substitui o áudio anterior), é ação/comando ("gerar e salvar narração"), não troca pura de recurso.

**Risco cross-referenciado (não resolvido aqui):** `upload_max_filesize`/`post_max_size` do PHP (comum 2-8MB em hosting compartilhado) pode rejeitar áudio de post longo — depende direto da decisão de **Formato de áudio salvo** (próximo item).

### Formato de áudio salvo [definido]

Modelo gera PCM Float32 a 24kHz mono (`onnx-streaming.js`, `SAMPLE_RATE = 24000`). Repo já tem `float32ToWavBlob()` convertendo pra WAV 16-bit — matemática de conversão Float32→Int16 reaproveitável, só troca o writer.

**Números reais:** WAV 24kHz/16-bit/mono ≈ 2,8MB/minuto. Post de 10min ≈ 28MB — estoura `upload_max_filesize` padrão de hosting compartilhado (2-8MB). Risco real, não hipotético (cross-referenciado no item de Contrato REST).

**Decisão: MP3 client-side antes do upload, 64kbps mono fixo (constante, não configurável na Fase 1).** Encoder: `lamejs` (JS puro, sem WASM, porta consolidada da libmp3lame, opera sobre Int16 — mesmo formato que `float32ToWavBlob` já produz). Resultado: ~0,48MB/minuto, ~6x menor que WAV; post de 10min ≈ 4,8MB.

**Quando codifica:** não no preview (usa buffer Float32 cru em memória, instantâneo) — só entre "autor confirma" e "envia pro REST" (Fluxo de dados, entre passo 4 e 5).

**Por que MP3 e não Opus/WebM via `MediaRecorder`:** Opus comprime melhor, mas `MediaRecorder` captura em tempo real de um stream — exigiria re-arquitetar pra gravar ao vivo em vez de codificar o array já pronto que a síntese gera. MP3 codifica o buffer finalizado direto, sem streaming, encaixa no fluxo atual sem mudança de arquitetura. Compatibilidade de `<audio>` + Media Library também mais garantida com MP3 em qualquer browser/tema/plugin de cache.

### Capability `upload_files` [definido]

Não é obrigação técnica — `wp_insert_attachment()` não checa capability sozinha, é decisão de quem chama. Nosso REST custom (não o `/wp/v2/media` nativo) decide.

**Decisão: exigir os dois.** `permission_callback` vira `current_user_can('edit_post', $post_id) && current_user_can('upload_files')`. Respeita a escolha deliberada do core WP (Contributor tem `edit_post` mas não `upload_files` por padrão, pra evitar encher a media library de qualquer um) em vez de escalar capability por baixo do pano — evita surpresa ruim numa auditoria de segurança do site.

**Trade-off aceito:** Contributor sem `upload_files` fica bloqueado até admin liberar. Intencional — melhor bloqueado-e-claro que ignorar config de segurança do site.

**Não bloqueia geração/preview** (100% client-side, sem capability). Só bloqueia "Salvar" (chamada REST). Sem `upload_files`, painel mostra erro claro ("sua função não tem permissão pra adicionar mídia — peça a um administrador"), mesmo padrão do resto de "Tratamento de erro" — nunca falha silenciosamente.

### Quais post types [definido]

Só `post` na Fase 1. `page`/CPT ficam pra depois (não é fase 2/3 já mapeada — vira demanda futura se aparecer, sem spec própria ainda).

### Post sem ID ainda (rascunho novo) [definido]

Gutenberg cria uma linha `auto-draft` com ID numérico real assim que o editor abre, antes de qualquer digitação — `wp.data` já tem esse ID disponível, então a rota `{post_id}` sempre tem o que preencher. Não é o problema que parecia ser.

O risco real: `auto-draft` é status frágil — WP tem cron (`wp_scheduled_delete`) que apaga de vez posts em `auto-draft` há mais de ~7 dias. Se o autor gerar narração num post recém-aberto e nunca salvar mais nada, o post some depois e o attachment de áudio + meta ficam órfãos.

**Guarda:** botão "Gerar áudio" desabilitado enquanto `post_status === 'auto-draft'`, com hint "salve o post primeiro". Fora isso, `draft`/`pending`/`publish`/`private` não mudam nada na lógica — mesma capability (`edit_post`), mesmo endpoint, mesmo comportamento.

**Guarda espelhada no server:** botão desabilitado é só UX, não impede 2ª aba/race condition/chamada direta na API. `permission_callback`/handler do REST também checa `get_post_status($post_id) !== 'auto-draft'`, retorna 409 (`post_voice_post_not_saved`) se falhar — o motivo original (evitar attachment órfão quando o cron do WP apaga `auto-draft` velho) continua valendo nesse caminho, cliente-only não protege contra ele.

### `post_parent` do attachment [definido]

**`post_parent = post_id`, sim** — idioma padrão do WP (mesma convenção de imagem destacada/mídia inline), aparece em "Enviado para este post" na Media Library, custo zero (só passar no array do `wp_insert_attachment()`).

**Achado no caminho:** WP core não apaga attachments filhos automaticamente quando o post pai é deletado, mesmo com `post_parent` setado (proposital — mídia pode ser reusada). Então isso não resolve órfão em delete de post sozinho — precisa hook próprio: `before_delete_post` (delete permanente, da lixeira ou forçado) → checa meta `_narration_attachment_id` → `wp_delete_attachment()`. Extensão do mesmo princípio "sem attachment órfão" já usado no regenerar, agora cobrindo delete de post também.

**Lixeira (trash, não delete permanente):** WP não mexe em mídia anexada só por mandar pra lixeira — attachment e meta sobrevivem, restaura junto se o post voltar. Comportamento padrão já serve.

**Caminho inverso — attachment deletado direto pela Media Library, post sobrevive:** sem tratamento, a meta do post (`_narration_attachment_id` etc.) ficaria apontando pra um attachment que não existe mais — badge mostraria "Atualizado" mentindo, player do frontend quebrado. Hook `delete_attachment` → pega `post_parent` do attachment (já é o post narrado) → se `_narration_attachment_id` desse post bater com o attachment sendo deletado, limpa as 3 metas (`_narration_attachment_id`, `_narration_language`, `_narration_source_hash`), post volta pro estado "sem áudio" limpo. Usa `post_parent` pra achar o post (lookup direto, dado que já temos guardado) em vez de `meta_query` varrendo tudo. Checagem extra (attachment_id bate com a meta) protege contra `post_parent` ter sido trocado manualmente sem atualizar a meta. Fecha o par simétrico com `before_delete_post` (post morre → limpa attachment) — agora nas duas direções.

### WP/PHP mínimos suportados [definido]

**PHP mínimo: 8.2.** Em 2026 só 8.2/8.3/8.4 recebem patch de segurança oficial (7.4/8.0/8.1 já EOL, sem correção). WP core tá subindo o próprio piso pra 7.4 (WP 7.0, abr/2026) só por compat de instalação antiga — não é recomendação, plugin novo sem legado não tem motivo pra mirar aí. Não subo pra 8.3 (recomendado oficial do WP.org): 8.2 já é seguro/atual, exigir mais alto excluiria hosting suportado sem ganho técnico real.

**WP mínimo: 6.6.** Não é "o mais velho ainda seguro" (vago) — é onde `PluginSidebar` (API que o painel inteiro usa) deixou de estar deprecated em `@wordpress/edit-post` e passou a viver em `@wordpress/editor`. Construir em cima da API já-deprecated num plugin recém-nascido seria burrice evitável. WP 6.6 é meados de 2024, piso conservador.

### UI/UX do player do leitor (sticky/mobile) [definido]

**Opção B — pílula flutuante.** Comparada com A (barra fixa full-width, padrão de app de música/podcast) e C (nasce inline no topo do post, vira mini-barra fixa só depois que o card original sai da tela rolando — 2 estados pra construir, mais complexo). B ganhou: menor, com margem das bordas, sensação mais leve que ocupar a largura toda; não precisa dos 2 estados que C exigiria.

Controles: play/pause, progresso/scrubber, seletor de velocidade, fechar. Fixo (`position: fixed`), aparece assim que existe áudio pro post, sem estado "inline" prévio.

Mockups (fonte + screenshot):
- [`assets/2026-08-10-reader-player-options.html`](assets/2026-08-10-reader-player-options.html) — comparação A/B/C em viewport mobile (~375px, prioridade mobile-first já decidida).
- [`assets/2026-08-10-reader-player-option-b.png`](assets/2026-08-10-reader-player-option-b.png) — screenshot renderizado.

Continua valendo o já decidido em "Acessibilidade" (teclado, aria-label, aria-live, `prefers-reduced-motion`) e em "Frontend (TypeScript leve)" (sem framework, controla `<audio>` nativo, botão de fechar/minimizar).

### A11y — enforcement automatizado em CI [definido]

Fechado junto com "Cenários E2E obrigatórios" (mesmo conserto, ver abaixo). Resumo:
- **Editor (React/TSX):** `eslint-plugin-jsx-a11y`, já embutido no config recomendado do `@wordpress/eslint-plugin` — não é dependência nova, roda no step de lint que já existe.
- **Editor + player, em runtime:** `@axe-core/playwright` no Playwright existente, gate em violações `serious`/`critical` (não em qualquer achado — `minor`/`moderate` vira ruído).
- **Teclado de verdade:** axe pega semântica faltando, não pega interação quebrada — cenário E2E dedicado, tab+Enter+Espaço nos controles do player, confirma mudança de estado.
- **`prefers-reduced-motion`:** axe não checa isso — cenário E2E dedicado, `page.emulateMedia({ reducedMotion: 'reduce' })` + assert sem animação.

### Cenários E2E obrigatórios incompletos [definido]

Lista final (ver também "Qualidade e testes"): fluxo feliz completo · fallback sem `crossOriginIsolated` · cancelar no meio da geração · storage insuficiente · regenerar substitui/limpa attachment · axe zero violações serious/critical (editor + frontend) · navegação 100% por teclado no player · respeita `prefers-reduced-motion`.

### Pin de versão do modelo [definido]

**Mirror próprio no Hugging Face**, não dependência direta de `KevinAHM/pocket-tts-onnx`.

**Licença checada (não bloqueia):** modelo base (`kyutai/pocket-tts`) é CC-BY-4.0 — permite redistribuir/derivar com atribuição, tem cláusula de uso proibido (nada ilegal/enganoso/impersonação sem consentimento — relevante pro voice cloning, vira nota de política de uso aceitável do plugin, não bloqueio legal). Export ONNX (`KevinAHM/pocket-tts-onnx`) também é CC-BY-4.0. Ambos permissivos.

**Correção (2026-08-11, durante execução do plano):** a frase acima antes dizia que o export ONNX era "dual: modelos CC-BY-4.0, código de conversão Apache 2.0" — **errado**, verificado contra a fonte. `KevinAHM/pocket-tts-onnx` declara `cc-by-4.0` no card e o `LICENSE` que distribui é o texto Attribution 4.0. O Apache 2.0 é do código do *demo Space* (`CODE-LICENSE`), que não é o repo do modelo e não é espelhado.

**Achado mais grave no mesmo caminho:** o demo Space distribui `onnx/ONNX-LICENSE` cujo conteúdo é Attribution-**NonCommercial** 4.0 — contradiz o próprio frontmatter dele (`license: cc-by-4.0`), o `kyutai/pocket-tts` e o `KevinAHM/pocket-tts-onnx`, os três declarando CC-BY-4.0 puro. Esse arquivo chegou a ser republicado no nosso mirror por engano; foi removido e substituído pelo texto Attribution 4.0 que as fontes reais declaram. Importa muito: NC proibiria uso comercial, o que inviabilizaria o plugin na maioria dos sites que o instalariam. Se algum dia o upstream esclarecer que NC é a licença correta de fato, essa decisão inteira ("Engine TTS: Pocket TTS") precisa ser reaberta.

**Por que mirror em vez de só pin por commit:** pin protege contra o arquivo *mudar de conteúdo*, não protege contra a conta/repo inteiro sumir (conta pessoal de terceiro, sem garantia de permanência). Mirror sob controle próprio remove esse risco. É inclusive primeiro passo barato pro caminho já combinado ("Hosting do modelo: HF agora, trocável por auto-hospedado depois").

**Onde hospedar o mirror: Hugging Face, não GitHub.** Bundle é ~950MB total (5 idiomas × ~190MB) — GitHub trava em 100MB/arquivo sem LFS, e mesmo com LFS o free tier (1GB storage + 1GB/mês bandwidth) não aguenta asset baixado em runtime por navegador de cada autor. HF Hub é feito pra isso (LFS embutido, CDN, sem teto de bandwidth em repo público) — mesma infra que a pesquisa toda já usou. Código do plugin continua no GitHub normal (workflow de dev/PR/CI); modelo no HF — repos separados, propósitos diferentes.

**O que o mirror leva:** só os `onnx/<idioma>/` dos 5 idiomas que o plugin usa (`english_2026-04, german, italian, portuguese, spanish` — cada um com `bundle.json`, `tokenizer.model`, `bos_before_voice.npy`, `voices.bin`, 5 arquivos `.onnx`). Upstream tem 10 pastas no total (inclui variantes `24l` + `french_24l`, que este projeto já decidiu não suportar) — mirror pula essas, ~metade do storage de graça. **O que não leva:** `generate.py`/`pocket_tts_onnx.py` (scripts Python de conversão do KevinAHM, ferramenta offline, nunca roda no browser, zero uso pro plugin). README do mirror é novo, escrito por nós, com atribuição a `kyutai/pocket-tts` e `KevinAHM/pocket-tts-onnx` (exigência da CC-BY-4.0).

**Pin:** `MODEL_BASE_URL` aponta pro nosso mirror, pinado em commit SHA do nosso próprio repo (não mais do KevinAHM). Bump de versão é ação deliberada (PR próprio, smoke test nos 5 idiomas + e2e antes de mergear), nunca `resolve/main` automático — lição direta do bug de fonemizador/modelo dessincronizado que achamos testando Piper.

### Itens menores [definido]

**Multisite:** fora de escopo da Fase 1, sem tratamento especial. Cache de modelo já é por navegador (client-side), então já se comporta bem entre sites de uma rede multisite sem precisar de código extra — não é omissão, é consequência natural do que já foi decidido. Vira não-meta explícita.

**Fallback sem JS:** markup do player renderizado no servidor é `<audio controls src="...">` nativo puro — funciona sem JS nenhum (alguns browsers já dão velocidade nativa nos controles padrão). JS só faz enhancement progressivo por cima (pílula flutuante sticky, seletor de velocidade customizado, aria-live). Sem JS, leitor perde o polish mas não perde a reprodução.

**Preview em memória, gerar de novo antes de salvar:** descarta o blob anterior silenciosamente, sem confirmação — nada foi persistido ainda, não há perda real de dado, YAGNI pra um diálogo de confirmação aqui. Consistente com "nada é gravado antes do preview confirmado" já decidido.

## Escopo da Fase 1

**Dentro:**
- Painel no editor Gutenberg (aba "Narração") — visível durante edição do post.
- Autor escolhe idioma, gera áudio (Pocket TTS, 100% client-side).
- Autor ouve preview antes de persistir.
- Áudio confirmado é salvo como asset de mídia do post (Media Library).
- Player no frontend do post: play, pause, stop, seletor de velocidade.
- Player sticky (acompanha scroll) e mobile-first.
- Fundação de qualidade: lint, testes automatizados, CI, i18n (nasce junto, não é add-on depois).

**Fora (fica pras fases 2/3):**
- Selecionar trecho/bloco pra ler em outro idioma.
- Dicionário de pronúncia customizada.
- Customização de cor/identidade visual do player.
- Highlight de palavra + auto-scroll sincronizado.
- Múltiplos áudios/idiomas simultâneos no mesmo post.

## Arquitetura

Organização **feature-based** (não layer-based): cada capacidade do plugin (narração hoje; trecho-em-outro-idioma, dicionário de pronúncia, estilo do player, highlight-sync nas fases seguintes) vive em `features/<nome>/` com seu próprio PHP+TS+testes juntos, em vez de espalhado entre pastas por tipo técnico. Bate com o roadmap já fechado — fases 1/2/3 já são capacidades separadas por natureza, isso não é especulação, é o que já decidimos. Único ponto que ganha uma fronteira mais formal dentro disso é o **engine de TTS** (`editor/engine/`) — é a única costura que já sabemos ser um fork real no futuro (engine server-side, ver "Evolução futura" abaixo). O resto (REST/post-meta/attachment) fica simples porque É simples — não ganha camada de domínio artificial.

```
post-voice/
├── post-voice.php              # bootstrap — registra features ativas
├── features/
│   └── narration/                # única feature da Fase 1
│       ├── php/
│       │   ├── class-rest-api.php    # endpoint REST: salvar asset gerado no post
│       │   ├── class-post-meta.php   # meta: audio attachment id, idioma, hash do texto-fonte
│       │   └── class-assets.php      # enqueue condicional (editor vs frontend)
│       ├── editor/                    # TS/React, buildado via @wordpress/scripts
│       │   ├── index.tsx              # PluginSidebar — painel "Narração"
│       │   ├── engine/
│       │   │   └── tts-engine.ts      # port do engine: generate(texto, config) → blob (hoje: Pocket TTS)
│       │   └── model-source.ts        # constante MODEL_BASE_URL (HF hoje, trocável depois)
│       ├── frontend/                  # player leitor, TS leve, sem React
│       │   └── player.ts
│       └── tests/
│           ├── php/                   # PHPUnit
│           └── js/                    # Jest
├── shared/                             # só o que 2+ features realmente precisam
│   ├── php/                            # capability/nonce helper, "attach media ao post"
│   └── ts/                             # formatters, primitivas de UI comuns
├── build/                               # gerado, gitignored
├── e2e/                                  # Playwright (@wordpress/e2e-test-utils-playwright) — fluxo de usuário cruza features
├── languages/                             # .pot + traduções
└── readme.txt                             # formato wordpress.org (pronto p/ migração futura)
```

Não cria pasta vazia `features/segment-language/` ou similar agora — enfeite morto até a fase existir de fato. O valor é a convenção, não antecipar pasta.

### Backend (PHP)

Só orquestra — nunca roda TTS no servidor. Recebe o blob de áudio já gerado no browser via REST, salva como attachment (`wp_insert_attachment`), grava meta:
- `_narration_language` — idioma do áudio gerado
- `_narration_source_hash` — hash do texto do post no momento da geração (detecta desatualização)
- `_narration_attachment_id` — liga o post ao asset de mídia

Toda ação passa por checagem de capability (`edit_post` **e** `upload_files`, ver "Capability `upload_files`") e nonce, padrão WP. Esse endpoint já é agnóstico de engine por acidente de design simples: recebe "esse é o áudio, anexa no post", não sabe se veio de WASM local ou de uma API de servidor — mantém assim de propósito.

### UI/UX do painel "Narração" (aprovado)

Layout: **card de status no topo + controles de ação abaixo**, não "tudo visível de uma vez" nem "wizard passo a passo" — escolhido por ser composicional: cada fase futura empilha um card novo abaixo sem redesenhar o que já existe (validado com a ilustração da Fase 2 nos mockups).

- **Sem áudio:** card de status ("Nenhum áudio gerado ainda") + seletor de idioma + botão "Gerar áudio".
- **Com áudio existente:** card de status mostra data de geração + badge "Atualizado"/"Pode estar desatualizado" (se o hash do texto mudou) + player inline (play/scrubber/tempo) + botão "Gerar novamente".
- **Gerando:** card de status vira progresso (texto + barra + ETA) + botão "Cancelar".

Mockups aprovados (fonte + screenshot, não só descrição):
- [`assets/2026-08-08-narration-panel-layout-options.html`](assets/2026-08-08-narration-panel-layout-options.html) — comparação das 3 direções de layout (A/B/C).
- [`assets/2026-08-08-narration-panel-option-c-states.html`](assets/2026-08-08-narration-panel-option-c-states.html) — opção C nos estados áudio-existente / desatualizado / gerando + ilustração de compatibilidade com Fase 2.
- [`assets/2026-08-08-narration-panel-option-c.png`](assets/2026-08-08-narration-panel-option-c.png) — screenshot renderizado.

**Nota de compatibilidade entre fases:** customização visual do player (Fase 3) não mora nesse painel — é configuração de site/tema, não por post; vai pra uma tela de Configurações separada do plugin (ver seção abaixo). Highlight de palavra (Fase 3) não deve exigir card novo aqui — é automático uma vez que o áudio é gerado com timestamps.

### Editor (TypeScript/React)

`PluginSidebar` registrado com aba "Narração". Pocket TTS carregado sob demanda (só quando o autor abre a aba, não em toda carga do editor — evita pesar o editor pra quem não usa a feature). Reaproveita a lógica de `onnx-streaming.js` / `inference-worker.js` deste repo de referência, adaptada como módulo TS importável em vez de scripts soltos, atrás da interface exposta por `engine/tts-engine.ts`.

### Frontend (TypeScript leve)

Player custom sem framework — controla um `<audio>` nativo + UI sticky/mobile-first. Nenhum runtime de ML no lado do leitor: o leitor só reproduz o arquivo já gerado. Player fixo tem botão de fechar/minimizar — temas já costumam ter header sticky, cookie banner ou CTA fixo, então o player não pode ser fixo *sem* saída, principalmente em mobile onde a colisão de UI fixa é mais provável.

### Extração de texto para narração

Nem todo bloco do editor deve virar áudio. Regra da Fase 1: entram blocos de texto corrido — parágrafo, heading, lista, citação. Ficam de fora — bloco de código, embed, galeria/imagem, tabela, HTML customizado. Sem essa regra explícita, a extração pega HTML cru ou lê trecho de código em voz alta. (Selecionar blocos específicos manualmente pra incluir/excluir/trocar idioma é Fase 2 — aqui é só o filtro automático por tipo de bloco.)

### Evolução futura — engine server-side (fork de arquitetura conhecido, não construído agora)

Se o plugin evoluir pra permitir engines que rodam via servidor (próprio ou de mercado — ElevenLabs, OpenAI TTS, etc.), duas partes da arquitetura atual seguram bem e duas não:

- **Seguram sem mudança:** o endpoint REST (já recebe "áudio pronto, anexa no post", agnóstico de origem) e a fronteira `engine/tts-engine.ts` (trocar de implementação aí não exige tocar em UI nem REST, desde que a nova implementação também devolva um blob).
- **Não seguram, e tá certo não resolver isso agora:** a state machine do painel assume geração síncrona/local (gera → já tem o blob → preview). Engine de servidor é assíncrono por natureza (job, poll/webhook, timeout, retry, custo por request) — isso é fluxo de UX diferente, não parâmetro a mais na função `generate()`. Some a isso: credenciais de API, rate limit, tela de configuração de provedor — escopo 100% novo, sem segredo nenhum existindo hoje na arquitetura client-only.

Não construímos abstração de multi-engine nem porta assíncrona agora (YAGNI — arriscaríamos adivinhar a forma errada da interface antes de ter um provedor real pra validar contra). Quando/se isso for priorizado, vira `features/server-engine/` com spec próprio, reaproveitando o endpoint REST e a fronteira de engine que já existem, sem precisar reorganizar o que já foi construído.

## Requisitos de hardware e calibração

Pocket TTS roda só em CPU (INT8), então não herda a exigência de GPU/VRAM que Chrome usa pra Gemini Nano — ponto a favor. Mas texto longo em máquina fraca ainda pode demorar bastante, e isso precisa de sinalização antes de travar o autor numa espera sem fim, principalmente porque não existe fallback de servidor pra assumir o trabalho.

Nota à parte: o cache do modelo (~190MB/idioma, OPFS/IndexedDB) é por navegador, não por post — cada navegador novo que o autor usar paga o download de novo, mesmo que já tenha gerado narração antes noutra máquina/perfil.

**Referência de mercado (Chrome Prompt API / Gemini Nano):** antes de baixar o modelo, o Chrome checa storage (≥22GB livres), GPU (≥4GB VRAM) e conexão (não-medida); expõe `LanguageModel.availability()` retornando `available`/`downloadable`/`unavailable` antes de disparar o download; e desinstala o modelo automaticamente se o storage cair abaixo de 10GB depois. (Fontes: [developer.chrome.com/docs/ai/prompt-api](https://developer.chrome.com/docs/ai/prompt-api), [Ubergizmo — Chrome's On-Device AI Uses 20GB Free Space](https://www.ubergizmo.com/2026/08/chromes-on-device-ai-20gb/))

**Adaptação pro nosso caso** (sem GPU, bundle ~190MB não 4GB, precisa funcionar em Safari/Firefox onde `deviceMemory` nem existe):

1. **Pré-checagem rápida, antes de baixar o modelo:** `navigator.storage.estimate()` — exige margem de sobra acima do tamanho do bundle do idioma escolhido (não só o tamanho exato, dá folga pra cache do browser + buffers). Se não tem espaço, avisa antes de gastar banda com o download, não depois.
2. **Sinal auxiliar, best-effort (só Chromium tem):** `navigator.hardwareConcurrency` e `navigator.deviceMemory`, usados só como heurística fraca — não bloqueiam nada sozinhos, porque não existem em todo navegador.
3. **Calibração real (mecanismo principal, funciona em qualquer navegador):** depois do modelo carregado, roda uma síntese de aquecimento com um texto curto fixo (poucas palavras), mede o tempo, calcula um RTF (real-time factor) empírico daquele dispositivo+navegador específico. Com o RTF medido:
   - Estima o tempo total pro texto real do post e mostra ETA ao autor antes de confirmar a geração completa ("~48s estimados").
   - Se RTF medido for muito ruim (ex.: >3x mais lento que tempo real), mostra aviso — não bloqueia, porque não tem alternativa de servidor: só avisa que pode demorar e sugere gerar num momento mais tranquilo ou aceitar a espera.
   - Pra textos muito longos (ETA acima de um limite, ex. 2min), pede confirmação explícita antes de disparar a geração completa — evita o autor travar sem saber que vai demorar.

Isso substitui a linha antiga "bloqueia se WASM não suportado" por um degradê em camadas: WASM ausente de verdade (raro) bloqueia; WASM presente mas sem `crossOriginIsolated` cai pra single-thread; dispositivo lento não bloqueia, só avisa com números reais medidos, não estimativa estática.

## Fluxo de dados

1. Autor abre post → aba "Narração" → escolhe idioma → clica "Gerar".
2. Editor extrai o texto do post (via `wp.data` dos blocos, só tipos elegíveis — ver "Extração de texto para narração"), roda Pocket TTS no browser dentro de um Web Worker (não trava a UI do editor).
3. Antes da síntese completa, roda calibração rápida (ver "Requisitos de hardware e calibração") → mostra ETA. Texto muito longo pede confirmação explícita. Geração tem botão "Cancelar" visível o tempo todo, com indicador de progresso (download do modelo % + síntese %).
4. Áudio resultante fica em memória (blob) → player de preview toca antes de qualquer persistência.
5. Autor confirma → `POST /wp-json/post-voice/v1/posts/{post_id}/narration` envia o blob → PHP salva como attachment + post meta. Se já existia um áudio anterior nesse post, o attachment antigo é apagado (`wp_delete_attachment`) — não vira órfão no Media Library, já que é sempre 1 áudio por post.
6. Frontend do post: se `_narration_attachment_id` existir, enqueue do player + `<audio>` apontando pra URL do attachment. Sem geração em runtime pro leitor.
7. Se o autor editar o post depois da geração, o hash do texto-fonte muda → painel mostra aviso "áudio pode estar desatualizado". Não regenera sozinho — ação manual do autor.
8. Se o post for deletado permanentemente (não só lixeira), hook `before_delete_post` apaga o attachment de narração junto — sem isso ficaria órfão, WP não faz esse cleanup sozinho mesmo com `post_parent` setado.
9. Caminho inverso: se o attachment de áudio for deletado direto pela Media Library (post sobrevive), hook `delete_attachment` limpa a meta de narração do post — sem isso o post ficaria "acreditando" que tem áudio atualizado, apontando pra um arquivo que não existe mais.

## Tratamento de erro

| Cenário | Comportamento |
|---|---|
| WASM realmente ausente (raro) | Aba mostra aviso, botão "Gerar" fica desabilitado (feature-detect antes de deixar tentar) |
| Contexto não-seguro (site em HTTP puro) | `crypto.subtle` e AudioWorklet não existem fora de secure context — painel bloqueia a geração com "precisa de HTTPS (ou localhost)". Achado na revisão da Task 5: sem isso o hash de fonte lança e a detecção de desatualizado quebra. |
| WASM ok, mas sem `crossOriginIsolated` (headers COOP/COEP ausentes) | Cai pra build single-thread do ONNX Runtime — mais lento, mas funciona. Não bloqueia. |
| Storage insuficiente (`navigator.storage.estimate()`) | Avisa *antes* de baixar o modelo, não depois de gastar banda |
| Dispositivo lento (RTF medido na calibração ruim, ou ETA alto pra texto longo) | Aviso com tempo estimado + pede confirmação pra textos longos; nunca bloqueia — não existe fallback de servidor |
| Falha ao baixar modelo (HF fora do ar) | Erro claro no painel + botão retry; resto do editor não é afetado |
| Geração interrompida (aba fechada, erro no worker, ou autor clica "Cancelar") | Estado limpo, sem asset órfão — nada é gravado no WP antes do preview ser confirmado |
| Falha ao salvar via REST (rede, permissão) | Erro visível no painel; blob de áudio permanece em memória pra retry sem regenerar |
| Sem `upload_files` (ex.: Contributor) | 403 no REST; painel mostra "sua função não tem permissão pra adicionar mídia — peça a um administrador" |
| Post ainda `auto-draft` (não salvo de verdade) | Botão desabilitado no client (UX) **e** REST rejeita com 409 `post_voice_post_not_saved` (guarda real, contra race condition/chamada direta) |
| Attachment de áudio deletado direto pela Media Library | Hook `delete_attachment` limpa a meta de narração do post automaticamente — painel volta a mostrar "sem áudio" em vez de referência quebrada |
| Texto do post mudou após geração | Aviso não-bloqueante de "possivelmente desatualizado", sem ação automática |

## Acessibilidade

Feature é adjacente a acessibilidade (narração ajuda quem prefere/precisa ouvir) — não faz sentido o próprio player não ser acessível. Não-negociável na Fase 1:

- Controles do player (play/pause/stop/velocidade) operáveis por teclado, com `aria-label` em cada um.
- Estado de reprodução anunciado pra leitor de tela (ex. `aria-live` na mudança play/pause).
- Botão de fechar/minimizar do player sticky também por teclado.
- Respeita `prefers-reduced-motion` na animação de entrada/saída do player fixo.

## Qualidade e testes (fundação — nasce junto com o código, não depois)

- **Lint/format:** ESLint + Prettier via `@wordpress/scripts`; WPCS + PHPStan no PHP; pre-commit via lint-staged bloqueando commit com erro.
- **Testes unitários:** Jest (lógica do editor/player em TS); PHPUnit (endpoint REST, post meta, capability checks).
- **E2E:** Playwright com `@wordpress/e2e-test-utils-playwright`, fluxo completo gerar → preview → salvar → conferir no frontend, rodando contra `wp-env`.
- **Meta de cobertura (diferenciada por camada, não um número único pro repo):**

  | Camada | Meta | Por quê |
  |---|---|---|
  | PHP (`features/*/php/`, `shared/php/` — REST, post meta, capability/nonce, ciclo de vida do attachment) | ≥85% linha (PHPUnit) | Lógica pura e determinística, barata de cobrir bem; e é código sensível a segurança (nonce/capability, delete de attachment do usuário) — bug aqui é sério. |
  | TS lógica pura (filtro de blocos elegíveis, cálculo de RTF/ETA, hash de "desatualizado", state machine play/pause/stop) | ≥80% linha (Jest) | Funções puras, sem DOM/WASM/Worker — fácil e barato de isolar e testar direito. |
  | TS glue (wrapper Pocket TTS, orquestração do Worker, componentes React do painel) | Sem meta de % — coberto por E2E obrigatório | Mockar ONNX Runtime/Worker só pra bater número dá teste que sempre passa e não pega o bug real (threading, `crossOriginIsolated`, timing). Esse risco só aparece em browser de verdade. |

  Acima de ~80-85% o ganho por teste extra cai muito (branches triviais, getters) — tratado como "bom o suficiente", não meta a perseguir até 100% (persegui-la incentiva teste de mentira só pra bater número, Goodhart's law).
- **CI:** GitHub Actions em cada PR — lint (inclui `eslint-plugin-jsx-a11y`, já embutido no config recomendado do `@wordpress/eslint-plugin`), unit (com os thresholds acima via `coverageThreshold` do Jest por pasta e gate de `phpunit --coverage-clover`), e2e (falha se faltar qualquer um destes cenários: fluxo feliz completo, fallback sem `crossOriginIsolated`, cancelar no meio da geração, storage insuficiente, regenerar substitui/limpa attachment, `@axe-core/playwright` zero violações `serious`/`critical` no editor e no frontend, navegação 100% por teclado no player, respeita `prefers-reduced-motion`).
- **i18n:** toda string via `__()`/`_x()` desde o primeiro commit; `.pot` gerado por script no CI.
- **Auditoria de dependências (segurança):** dois ecossistemas (npm pro build TS, Composer pro tooling PHP — WPCS/PHPStan/PHPUnit), gate por threshold (não zero-tolerância, ruído de dev-tool transitório não deveria quebrar CI toda hora), mas **threshold diferente por classe de dependência**:
  - `npm audit --omit=dev` (só produção — hoje só `lamejs`, o único pacote npm que de fato vai pro bundle que roda no browser do autor; ONNX Runtime Web vem de CDN em runtime, nem é dependência npm nossa) → **0 crítica, 0 alta**. Baixo ruído esperado (poucas deps), alto sinal se disparar.
  - `npm audit` completo (inclui dev — ESLint/Jest/Playwright/`@wordpress/scripts`/etc., nunca chega no site de ninguém) → threshold pragmático (crítica: 1, alta: 5, moderada: 10), mesmo padrão de scripts de auditoria já usados noutros projetos — ruído esperado, impacto real baixo.
  - `composer audit` → **0 crítica, 0 alta**. Arquitetura atual não tem dependência de runtime PHP nenhuma (REST/post-meta/capability são só WP core), gate fica pronto pra quando/se isso mudar.
  - Scripts Node tipo `audit-check.mjs` (roda `X audit --json`, conta por severidade, compara com threshold, falha CI só acima do limiar) — um por ecossistema.
  - **Limite reconhecido:** audit pega CVE já catalogado, não pega supply-chain zero-day (pacote comprometido antes de virar advisory). Mitigação barata: CI sempre `npm ci`/`composer install --no-dev`, nunca `install` solto — só instala o que já tá no lockfile commitado e revisado, não resolve dependência nova sem passar por PR.

## Critérios de aceite (Fase 1 "pronta")

- Autor consegue gerar, ouvir preview e salvar narração de um post, num idioma suportado, sem sair do editor.
- Áudio salvo aparece na Media Library e reproduz corretamente no frontend do post; regenerar substitui o áudio anterior sem deixar attachment órfão.
- Player no frontend: play/pause/stop/velocidade funcionam, fica fixo ao rolar, tem botão de fechar/minimizar, é utilizável em viewport mobile e operável 100% por teclado.
- Autor recebe ETA antes de disparar geração de texto longo, e consegue cancelar uma geração em andamento a qualquer momento.
- Editor sem `crossOriginIsolated` ainda gera áudio (single-thread), só mais devagar — nunca bloqueia por causa disso.
- Editor de post sem áudio gerado não sofre nenhuma degradação de performance (modelo só carrega sob demanda).
- CI verde (lint+unit+e2e) é pré-condição de merge.
- Nenhuma string hardcoded fora de wrapper de tradução.

## Não-metas explícitas da Fase 1

- Não gera timestamps/highlight de palavra.
- Não permite múltiplos idiomas simultâneos por post.
- Não expõe customização visual do player ao autor.
- Não roda em Classic Editor (assume Gutenberg/block editor).
- Não é otimizado ainda para distribuição em wordpress.org (readme.txt e compliance ficam prontos para migração, mas não é objetivo desta fase publicar lá).
- Não tem tratamento especial de multisite (cache de modelo já é client-side/por navegador, se comporta bem sem código extra, mas não é testado especificamente contra rede multisite).
- Só post type `post` (`page`/CPT ficam pra depois).
