# Tela de Configurações — gerenciamento de modelos (download/remoção por idioma)

**Data:** 2026-09-12
**Status:** Aprovado para implementação
**Classificação:** Arquitetural (subsistema novo: tela, máquina de estados de
download, fila, cancelamento e remoção — nada disso existe hoje; o download de
modelo hoje só acontece implicitamente, disparado ao gerar uma narração)

## Contexto

Hoje o autor não tem visibilidade nem controle sobre os modelos Pocket TTS que
seu navegador já baixou. O download acontece de forma implícita — o worker
busca o bundle do idioma na hora de gerar uma narração (`pocket-tts.worker.js`,
via `bundlePath()`) e o resultado fica no Cache API do browser
(`post-voice-models-v1`, ver `engine/model-cache.ts`). Não há tela para ver o
que já está baixado, baixar um idioma de propósito antes de precisar dele, nem
remover um idioma pra liberar espaço.

Pedido do usuário: uma tabela na tela `Configurações → Narration`, uma linha
por modelo, com colunas Modelo / Idioma / Voz / Status / Tamanho / Ações,
permitindo baixar e remover cada um manualmente.

**Achados da exploração que moldam este design:**

- O cache é **por navegador**, não por site — `caches.open('post-voice-models-v1')`
  é local ao browser de quem está olhando a tela. O servidor nunca vê nem
  guarda esse estado (ADR-0002, ADR-0008, ADR-0009). Confirmado com o usuário:
  a tela reflete o cache do navegador atual do admin logado, sem tentar
  centralizar isso por site.
- Um bundle de idioma tem **9 arquivos**, ~198.6 MB total
  (`LANGUAGE_BUNDLE_BYTES` em `storage-check.ts`): `bundle.json`, 5 `.onnx`
  (`mimi_encoder_int8`, `text_conditioner_int8`, `flow_lm_main_int8`,
  `flow_lm_flow_int8`, `mimi_decoder_int8`), `voices.bin`, e dois arquivos cujo
  **nome só se conhece depois de ler o `bundle.json` daquele idioma**:
  `tokenizer_file` e, quando presente, `bos_before_voice_file`
  (`pocket-tts.worker.js`, `bundleMetadata.*`). Um downloader fora do worker
  precisa buscar `bundle.json` primeiro para montar a lista completa.
- As **8 vozes predefinidas** (`voice-catalog.ts`) são idênticas em todo
  bundle — não há voz exclusiva de um idioma. Confirmado com o usuário: a
  granularidade da tabela é **uma linha por idioma** (5 linhas fixas — mesma
  lista de `Post_Voice_Model::ALLOWED_LANGUAGES` / `SUPPORTED_LANGUAGES`), e a
  coluna Voz repete o mesmo conjunto em toda linha.
- Telas de configuração existentes (`Post_Voice_Style_Section`,
  `Post_Voice_Dictionary_Section`) são formulário `options.php` clássico mais
  TypeScript vanilla — nunca React. Este design segue o mesmo padrão.

## Decisão

| Ponto | Decisão |
|---|---|
| Granularidade da tabela | Uma linha por idioma — 5 linhas fixas (`english_2026-04`, `german`, `italian`, `portuguese`, `spanish`), mesma lista de `Post_Voice_Model::ALLOWED_LANGUAGES`. Coluna Modelo repete "Kyutai Pocket TTS" nas 5. |
| Escopo do estado | Por navegador (Cache API do admin logado agora), não por site. Sem tentativa de centralizar no servidor — bateria de frente com ADR-0002/0008/0009. |
| Coluna Voz | Célula mostra a contagem (`8 vozes`) com um `<details>/<summary>` nativo (sem JS) que expande os 8 nomes. Conteúdo é estático — as vozes não variam por idioma nem por estado de download — então é renderizado inteiro no PHP, sem depender de JS ou de Cache API. |
| Nome do estado "disponível, ainda não baixado" | **Not downloaded** — mesma família de verbo de Downloaded/Downloading, sem introduzir um termo novo (`Available`, `Not installed`) que teria que ser explicado à parte. |
| Estados possíveis | `Not downloaded` → `Queued` → `Downloading (X%)` → `Downloaded`; mais `Error (motivo)`. Ver máquina de estados abaixo. |
| Persistência do estado efêmero | Só `Downloaded`/`Not downloaded` sobrevivem a um reload — são a verdade derivada direto do Cache API. `Queued`, `Downloading` e `Error` moram só na memória desta carga de página; um F5 no meio de um download simplesmente volta a checar o Cache API do zero (nada ficou de fato gravado até completar, ver próxima linha). |
| Progresso | Barra com percentual real: soma dos bytes recebidos (via `response.body.getReader()` de cada um dos 9 arquivos) sobre o total esperado (`Content-Length` de cada resposta, com `LANGUAGE_BUNDLE_BYTES` como estimativa de exibição antes do primeiro cabeçalho chegar). |
| Escrita no cache | Segue a mesma regra do interceptor existente (`installModelCache`): só resposta `200` completa é gravada (`cache.put`), nunca parcial. Cada arquivo entra no cache somente depois de totalmente recebido. |
| Cancelamento | Botão **Cancel** durante `Downloading`: aborta os fetches em curso (`AbortController`), apaga qualquer entrada já gravada daquele idioma no cache (evita ficar com um bundle "meio baixado" que nenhum estado da tabela descreve corretamente), volta para `Not downloaded`. |
| Concorrência | Fila sequencial global — **um downloader ativo por vez**. Clicar Download num idioma enquanto outro está em `Downloading` marca a linha como `Queued`; ela assume assim que o ativo terminar, falhar ou for cancelado. Evita 2×~200MB competindo por banda/memória. |
| Tamanho — `Not downloaded` | Estimativa fixa, `~199 MB` (de `LANGUAGE_BUNDLE_BYTES`, formatado por `formatBytes`), prefixada `~` por ser projeção, não medição. |
| Tamanho — `Downloading` | Bytes recebidos até agora sobre o esperado (ex. `84 MB de ~199 MB`), acompanhando a mesma contagem usada na barra de progresso. |
| Tamanho — `Downloaded` | Medido de verdade: soma do tamanho de cada resposta cacheada cujo URL começa com o prefixo daquele idioma (`cache.keys()` + `blob().size` de cada `match`) — não a constante. Decisão explícita do usuário (preferiu medir a usar só o valor fixo). |
| Tamanho — `Error` | Não mostra tamanho; mostra o motivo do erro. Qualquer parcial já limpo (mesma limpeza do cancelamento). |
| Erro — classificação | Motivo curto, não só "Error" genérico: `hasEnoughStorage()` checado *antes* de iniciar recusa cedo com "Sem espaço livre"; `QuotaExceededError` a meio do download cai na mesma mensagem; falha de rede (`fetch` rejeitado ou status ≠ 200) vira "Falha de rede"; qualquer outra causa cai num fallback genérico "Erro ao baixar". |
| Erro — ação | Botão **Retry** substitui o de Download na linha em erro. Reinicia do zero (sem tentar retomar arquivo truncado) — mesma limpeza de parciais do cancelamento antes de reenfileirar. |
| Remoção | Botão **Remove** em `Downloaded`, atrás de um `confirm()` nativo do browser (ação que descarta ~199 MB e força novo download na próxima geração naquele idioma). Apaga todas as entradas cacheadas daquele prefixo, volta para `Not downloaded`. |
| Cobertura de teste | **Sem E2E novo** — decisão explícita do usuário: suíte E2E já é o passo mais lento do pipeline e baixar um bundle real de ~199 MB só para provar a mecânica de streaming/cache/cancelamento é caro à toa. Jest com `fetch`/`caches` mockados cobre a lógica (mesmo padrão já em uso por `bundle-cache-status.test.ts`); validação manual documentada no PR cobre o caminho real. Ver "Testes". |

## Componentes novos

| Arquivo | Responsabilidade |
|---|---|
| `features/narration/php/class-models-section.php` (**novo**) | Registra a seção "Models" na tela existente (`Post_Voice_Settings_Page::MENU_SLUG`), seguindo o padrão de `Post_Voice_Style_Section`. Sem `register_setting` — nada aqui é persistido no servidor. Renderiza o `<table>` inteiro no PHP: as 5 linhas, Modelo, Idioma (rótulo traduzido por idioma, mapa próprio em PHP — não há como importar o `LANGUAGE_LABELS` de TypeScript no servidor) e Voz (lista completa das 8 vozes, estática, sem depender de JS). Status, Tamanho e Ações nascem com um placeholder neutro (`role="status"`, texto "Checking…") até o script preencher. Enfileira o script só nesta tela, via `Post_Voice_Settings_Page::is_current_screen()`. |
| `features/narration/admin/index.ts` (**novo**) | Entry point (`DOMContentLoaded`). Roda a checagem inicial (`cachedBundles`, reaproveitado de `editor/bundle-cache-status.ts` — leitura pura, sem efeito colateral, importável entre subpastas da mesma feature) para decidir `Downloaded`/`Not downloaded` de cada linha, mede o tamanho real das já baixadas, e liga os botões de cada linha à fila. |
| `features/narration/admin/model-manifest.ts` (**novo**) | Busca `bundle.json` de um idioma e resolve a lista completa de URLs daquele bundle (os 7 nomes estáticos + `tokenizer_file`/`bos_before_voice_file` dinâmicos do manifest). Duplica a pequena lista de nomes `.onnx`/`voices.bin` em vez de importar de `pocket-tts.worker.js` — mesmo motivo que já levou `bundle-cache-status.ts` a duplicar `CACHE_NAME` ao invés de importar `engine/model-cache.ts`: não acoplar este painel ao arquivo vendorizado (ADR-0011) nem ao interceptor do worker. |
| `features/narration/admin/download-queue.ts` (**novo**) | A máquina de estado e a fila: um downloader ativo por vez, `AbortController` por download, streaming de progresso via `response.body.getReader()`, escrita no cache só em resposta `200` completa, limpeza de parciais em cancelamento/erro/retry, classificação de erro. Lógica testável em Jest com `fetch`/`caches` mockados — não depende de DOM. |
| `features/narration/admin/bundle-size.ts` (**novo**) | Mede bytes reais cacheados de um idioma (`cache.keys()` filtrado pelo prefixo `${MODEL_BASE_URL}${language}/`, soma de `blob().size`). Reaproveita `LANGUAGE_BUNDLE_BYTES`/`formatBytes`/`hasEnoughStorage` de `editor/storage-check.ts` (pura, sem efeito colateral — importável). |
| `features/narration/admin/models-table.ts` (**novo**) | Desenha as transições de estado nas 5 linhas já renderizadas pelo PHP (troca texto/classe de Status, atualiza Tamanho, troca o botão de Ações entre Download/Cancel/Retry/Remove) e delega cliques para `download-queue.ts`. |
| `features/narration/admin/style.scss` (**novo**) | Estilo da barra de progresso, badges de status e do `<details>` de vozes. |
| `webpack.config.js` | Nova entry `models-admin` → `features/narration/admin/index.ts`, ao lado de `dictionary-admin`/`player-style-admin`. |
| `post-voice.php` | `require_once` de `class-models-section.php` e `Post_Voice_Models_Section::register()`, ao lado das outras seções. |
| `features/narration/tests/js/model-manifest.test.ts`, `download-queue.test.ts`, `bundle-size.test.ts` (**novos**) | Ver "Testes". |
| `jest.config.js` | `collectCoverageFrom` ganha os três módulos novos de `admin/` (gate de 80% linhas, `CLAUDE.md`). |
| `TESTING.md` | Registra os testes novos e o passo de validação manual desta tela. |
| `languages/post-voice.pot` | Regenerado (`npm run i18n:pot`) pelas strings novas — rótulos de idioma em PHP, textos de status (`Downloaded`, `Downloading…`, `Not downloaded`, mensagens de erro), botões (`Download`, `Cancel`, `Retry`, `Remove`), confirmação de remoção. |

Sem mudança de interface pública server-side nova (nenhuma rota REST — tudo
client-side sobre Cache API), sem migração de dado, sem alteração de contrato
(`MODEL_BASE_URL`, mínimos de WordPress/PHP).

## Máquina de estados

```
Not downloaded --[Download]--> Queued --[vez chega]--> Downloading (X%)
Downloading --[sucesso]--> Downloaded
Downloading --[Cancel]--> (limpa parcial) --> Not downloaded
Downloading --[falha]--> (limpa parcial) --> Error(motivo)
Error --[Retry]--> Queued
Downloaded --[Remove + confirm()]--> (apaga cache) --> Not downloaded
```

Ao carregar a página, cada linha começa em "Checking…" e resolve para
`Downloaded` (com tamanho medido) ou `Not downloaded` (com estimativa) —
`Queued`/`Downloading`/`Error` só existem depois de uma ação nesta mesma
carga de página.

## Testes

- **Jest** (`features/narration/tests/js/`), `fetch`/`caches` mockados no
  mesmo estilo de `bundle-cache-status.test.ts`:
  - `model-manifest.test.ts` — resolve a lista de URLs a partir de um
    `bundle.json` mockado, com e sem `bos_before_voice_file` presente.
  - `download-queue.test.ts` — transições de estado (incluindo fila com um
    downloader ativo por vez), cancelamento limpando parciais, classificação
    de erro (sem espaço / rede / genérico), retry reiniciando do zero.
  - `bundle-size.test.ts` — soma de bytes por prefixo de idioma, formatação.
- **Sem E2E novo** — decisão explícita do usuário, ver tabela de Decisão.
- **Verificação manual (documentada no PR)**: na tela Configurações →
  Narration, baixar um idioma de verdade e conferir a barra de progresso e a
  transição para `Downloaded` com tamanho medido; cancelar um download em
  andamento e conferir volta para `Not downloaded`; clicar Download em dois
  idiomas em sequência e conferir que o segundo fica `Queued` até o primeiro
  terminar; remover um idioma baixado e conferir volta para `Not downloaded`;
  forçar um erro de rede (offline) e conferir a mensagem e o Retry.
- Gates normais de `TESTING.md` (lint, tsc, PHP, cobertura, `i18n:check`,
  build+E2E completo da suíte já existente) continuam se aplicando, conforme
  `CLAUDE.md`.

## Fora de escopo

- Estado do modelo por site/servidor — avaliado e rejeitado, ver tabela de
  Decisão (contradiria ADR-0002/0008/0009).
- Retomar um download truncado a partir de onde parou — Retry sempre reinicia
  do zero; não foi pedido, e complicaria a lógica de cache sem necessidade
  clara.
- Suporte a múltiplos modelos/engines além do Pocket TTS — a lista de idiomas
  é a única fonte de linhas hoje (`Post_Voice_Model::ALLOWED_LANGUAGES`); um
  segundo modelo é mudança própria, fora deste documento.
- Cenário E2E novo para esta tela — decisão explícita do usuário, ver tabela
  de Decisão.
