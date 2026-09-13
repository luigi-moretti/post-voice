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
| **Detecção de "já baixado" (correção sobre a v1 desta spec)** | **Não** reaproveita `cachedBundles()` de `bundle-cache-status.ts` puro — essa função só verifica a presença de `bundle.json`, que é o *primeiro* arquivo do bundle a ser buscado, então um download interrompido entre `bundle.json` e os demais arquivos passaria como "Downloaded" incorretamente. Verificação correta, sem chamada de rede (tudo lido do próprio cache): (1) `cache.match` no `bundle.json` daquele idioma — ausente ⇒ `Not downloaded`, fim; (2) presente ⇒ parseia o JSON já cacheado (sem rede) e resolve a lista completa de URLs exigidas via `model-manifest.ts`; (3) `cache.match` em cada uma — todas presentes ⇒ `Downloaded`; qualquer ausente ⇒ `Not downloaded` (tratado igual a "nunca começou", mesma regra de não retomar parcial). Um bundle detectado como incompleto **não é limpo automaticamente** só por abrir a tela — a limpeza só acontece quando o usuário clica Download de novo (ver linha "Resíduo" abaixo). Implementado em `bundle-status.ts` (módulo próprio — ver "Componentes novos"). |
| Fetch dos arquivos de um idioma | `bundle.json` é buscado primeiro (é dele que vem `tokenizer_file`/`bos_before_voice_file`); os demais arquivos exigidos (até 8) são buscados **em paralelo** (`Promise.all`), não em sequência — os cabeçalhos `Content-Length` chegam quase de imediato para todos, dando um total confiável pra barra de progresso desde cedo, em vez de um total que só se completa conforme cada arquivo termina. |
| Resíduo de download anterior | Antes de iniciar um novo download (clique em Download ou Retry), a fila apaga preventivamente qualquer entrada já cacheada sob o prefixo daquele idioma (`cache.keys()` filtrado por `${MODEL_BASE_URL}${language}/`) — cobre tanto um retry pós-erro quanto um resíduo de uma sessão anterior encerrada abruptamente (fechar aba, crash) que a detecção acima identificou como incompleto. Garante que nunca se mistura arquivo de uma tentativa antiga com os da nova. |
| Progresso | Barra com percentual real: soma dos bytes recebidos (via `response.body.getReader()` de cada um dos arquivos buscados em paralelo) sobre o total esperado (soma do `Content-Length` de cada resposta, com `LANGUAGE_BUNDLE_BYTES` como estimativa de exibição só no instante antes do primeiro cabeçalho chegar). |
| Escrita no cache | Segue a mesma regra do interceptor existente (`installModelCache`): só resposta `200` completa é gravada (`cache.put`), nunca parcial. Cada arquivo entra no cache somente depois de totalmente recebido. |
| Cancelamento | Botão **Cancel** durante `Downloading`: aborta os fetches em curso (`AbortController`), apaga qualquer entrada já gravada daquele idioma no cache (evita ficar com um bundle "meio baixado" que nenhum estado da tabela descreve corretamente), volta para `Not downloaded`. |
| Concorrência | Fila sequencial global — **um downloader ativo por vez**. Clicar Download num idioma enquanto outro está em `Downloading` marca a linha como `Queued`; ela assume assim que o ativo terminar, falhar ou for cancelado. Evita 2×~200MB competindo por banda/memória. |
| Tamanho — `Not downloaded` | Estimativa fixa, `~199 MB` (de `LANGUAGE_BUNDLE_BYTES`, formatado por `formatBytes`), prefixada `~` por ser projeção, não medição. |
| Tamanho — `Downloading` | Bytes recebidos até agora sobre o esperado (ex. `84 MB de ~199 MB`), acompanhando a mesma contagem usada na barra de progresso. |
| Tamanho — `Downloaded` | Medido de verdade: soma do tamanho de cada resposta cacheada cujo URL começa com o prefixo daquele idioma (`cache.keys()` + `blob().size` de cada `match`) — não a constante. Decisão explícita do usuário (preferiu medir a usar só o valor fixo). |
| Tamanho — `Error` | Não mostra tamanho; mostra o motivo do erro. Qualquer parcial já limpo (mesma limpeza do cancelamento). |
| Erro — classificação | Motivo curto, não só "Error" genérico: `hasEnoughStorage()` checado *antes* de iniciar recusa cedo com "Sem espaço livre"; `QuotaExceededError` a meio do download cai na mesma mensagem; falha de rede (`fetch` rejeitado ou status ≠ 200) vira "Falha de rede"; qualquer outra causa cai num fallback genérico "Erro ao baixar". |
| Erro — quando checar espaço | `hasEnoughStorage()` é checado quando o item **sai da fila e começa de fato** (não no clique que o enfileirou) — enquanto esperava, outro download pode ter terminado e liberado espaço, ou o inverso. Evita recusar um download que se tornaria viável, ou aceitar um que não cabe mais. |
| Erro — ação | Botão **Retry** substitui o de Download na linha em erro. Reinicia do zero (sem tentar retomar arquivo truncado) — mesma limpeza de parciais do cancelamento antes de reenfileirar. |
| Remoção | Botão **Remove** em `Downloaded`, atrás de um `confirm()` nativo do browser (ação que descarta ~199 MB e força novo download na próxima geração naquele idioma). Apaga todas as entradas cacheadas daquele prefixo, volta para `Not downloaded`. |
| Cobertura de teste | **Sem E2E novo** — decisão explícita do usuário: suíte E2E já é o passo mais lento do pipeline e baixar um bundle real de ~199 MB só para provar a mecânica de streaming/cache/cancelamento é caro à toa. Jest com `fetch`/`caches` mockados cobre a lógica (mesmo padrão já em uso por `bundle-cache-status.test.ts`); validação manual documentada no PR cobre o caminho real. Ver "Testes". |

## Componentes novos

| Arquivo | Responsabilidade |
|---|---|
| `features/narration/php/class-models-section.php` (**novo**) | Registra a seção "Models" na tela existente (`Post_Voice_Settings_Page::MENU_SLUG`), seguindo o padrão de `Post_Voice_Style_Section`. Sem `register_setting` — nada aqui é persistido no servidor. Renderiza o `<table>` inteiro no PHP: as 5 linhas, Modelo, Idioma (rótulo traduzido por idioma, mapa próprio em PHP — não há como importar o `LANGUAGE_LABELS` de TypeScript no servidor) e Voz (lista completa das 8 vozes, estática, sem depender de JS). Status, Tamanho e Ações nascem com um placeholder neutro (`role="status"`, texto "Checking…") até o script preencher. Enfileira o script só nesta tela, via `Post_Voice_Settings_Page::is_current_screen()`. |
| `features/narration/admin/index.ts` (**novo**) | Entry point (`DOMContentLoaded`). Roda a checagem inicial de completude (ver `bundle-status.ts`) pra decidir `Downloaded`/`Not downloaded` de cada linha, mede o tamanho real das já baixadas, e liga os botões de cada linha à fila. |
| `features/narration/admin/model-manifest.ts` (**novo**) | Resolve a lista completa de URLs de um bundle a partir do seu `bundle.json` já parseado (os 7 nomes estáticos + `tokenizer_file`/`bos_before_voice_file` dinâmicos do manifest, quando presente). Usada tanto pelo download (com `bundle.json` recém-buscado da rede) quanto pela checagem de completude (com `bundle.json` lido do cache, sem rede) — mesma função, fonte do JSON é responsabilidade de quem chama. Duplica a pequena lista de nomes `.onnx`/`voices.bin` em vez de importar de `pocket-tts.worker.js` — mesmo motivo que já levou `bundle-cache-status.ts` a duplicar `CACHE_NAME` ao invés de importar `engine/model-cache.ts`: não acoplar este painel ao arquivo vendorizado (ADR-0011) nem ao interceptor do worker. |
| `features/narration/admin/bundle-status.ts` (**novo**) | `isBundleComplete(language)`: implementa o algoritmo de detecção fechado na tabela de Decisão — `cache.match` no `bundle.json`, se ausente já retorna incompleto; se presente, parseia, resolve URLs via `model-manifest.ts` e confere `cache.match` em cada uma. Zero chamada de rede. Substitui o uso de `cachedBundles()` (`bundle-cache-status.ts`) neste painel — aquela função continua servindo só o painel do editor, que já assume o próprio worker como fonte de verdade do quão completo o bundle está. |
| `features/narration/admin/download-queue.ts` (**novo**) | A máquina de estado e a fila: um downloader ativo por vez, limpeza preventiva do prefixo antes de iniciar (novo download ou retry), busca de `bundle.json` seguida de busca em paralelo dos demais arquivos exigidos, `AbortController` por download, streaming de progresso via `response.body.getReader()`, escrita no cache só em resposta `200` completa, limpeza de parciais em cancelamento/erro, classificação de erro. Lógica testável em Jest com `fetch`/`caches` mockados — não depende de DOM. |
| `features/narration/admin/bundle-size.ts` (**novo**) | Mede bytes reais cacheados de um idioma (`cache.keys()` filtrado pelo prefixo `${MODEL_BASE_URL}${language}/`, soma de `blob().size`). Reaproveita `LANGUAGE_BUNDLE_BYTES`/`formatBytes`/`hasEnoughStorage` de `editor/storage-check.ts` (pura, sem efeito colateral — importável). |
| `features/narration/admin/models-table.ts` (**novo**) | Desenha as transições de estado nas 5 linhas já renderizadas pelo PHP (troca texto/classe de Status, atualiza Tamanho, troca o botão de Ações entre Download/Cancel/Retry/Remove) e delega cliques para `download-queue.ts`. |
| `features/narration/admin/style.scss` (**novo**) | Estilo da barra de progresso, badges de status e do `<details>` de vozes. |
| `webpack.config.js` | Nova entry `models-admin` → `features/narration/admin/index.ts`, ao lado de `dictionary-admin`/`player-style-admin`. |
| `post-voice.php` | `require_once` de `class-models-section.php` e `Post_Voice_Models_Section::register()`, ao lado das outras seções. |
| `features/narration/tests/js/model-manifest.test.ts`, `bundle-status.test.ts`, `download-queue.test.ts`, `bundle-size.test.ts` (**novos**) | Ver "Testes". |
| `jest.config.js` | `collectCoverageFrom` ganha os quatro módulos novos de `admin/` (gate de 80% linhas, `CLAUDE.md`). |
| `TESTING.md` | Registra os testes novos e o passo de validação manual desta tela. |
| `languages/post-voice.pot` | Regenerado (`npm run i18n:pot`) pelas strings novas — rótulos de idioma em PHP, textos de status (`Downloaded`, `Downloading…`, `Not downloaded`, mensagens de erro), botões (`Download`, `Cancel`, `Retry`, `Remove`), confirmação de remoção. |

Sem mudança de interface pública server-side nova (nenhuma rota REST — tudo
client-side sobre Cache API), sem migração de dado, sem alteração de contrato
(`MODEL_BASE_URL`, mínimos de WordPress/PHP).

## Máquina de estados

```
Not downloaded --[Download]--> Queued --[vez chega]--> Downloading (X%)
Queued --[Cancel]--> Not downloaded
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
  - `bundle-status.test.ts` — `isBundleComplete`: `bundle.json` ausente ⇒
    incompleto sem tentar mais nada; presente mas faltando um dos arquivos
    resolvidos ⇒ incompleto; todos presentes ⇒ completo. Caso central desta
    revisão: bundle.json cacheado sozinho (simula uma interrupção logo após
    o primeiro arquivo) tem que dar incompleto, não `Downloaded`.
  - `download-queue.test.ts` — transições de estado (incluindo fila com um
    downloader ativo por vez), limpeza preventiva do prefixo antes de um novo
    download/retry, busca em paralelo dos arquivos após o `bundle.json`,
    cancelamento limpando parciais, classificação de erro (sem espaço / rede /
    genérico), retry reiniciando do zero.
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
- **Suporte a múltiplos modelos/engines além do Pocket TTS.** A engine é
  decisão de arquitetura própria (ADR-0003: "trocar de engine é reescrever o
  Worker inteiro... precisa de uma ADR nova, não de aprovação silenciosa") —
  hoje há exatamente um engine, então esta tela não abstrai "modelo" como
  conceito plugável. A linha da tabela é indexada só por idioma
  (`Post_Voice_Model::ALLOWED_LANGUAGES`), a coluna Modelo é texto fixo
  ("Kyutai Pocket TTS"), e todo o formato de manifest/bundle em
  `model-manifest.ts`/`bundle-status.ts`/`download-queue.ts` é específico do
  formato Pocket TTS (`bundle.json` com esses campos, esses 5 `.onnx`). Um
  segundo engine no futuro trocaria a chave de linha para (modelo, idioma) e
  quase certamente teria um formato de bundle diferente — não dá pra
  generalizar essa forma sem um segundo caso real para validar contra, e
  construir a abstração agora seria generalização especulativa sobre uma ADR
  que ainda não existe. Fica fora deste documento, como mudança própria
  quando (e se) a ADR-0003 for revisitada.
- Cenário E2E novo para esta tela — decisão explícita do usuário, ver tabela
  de Decisão.
- **Coordenação entre abas/janelas.** A fila (`download-queue.ts`) é estado em
  memória de uma carga de página, não do navegador — duas abas desta mesma
  tela, ou uma aba desta tela e outra do editor gerando uma narração ao mesmo
  tempo, não sabem uma da outra. Cada uma pode achar que é "a" ativa e
  escrever no mesmo Cache API independentemente. Não é corrupção de dado
  (mesma URL, mesmo conteúdo, escrita é idempotente), mas gasta banda em
  dobro e as duas telas mostram progresso dessincronizado uma da outra. Não
  implementado (`BroadcastChannel` ou lock via `navigator.locks` resolveriam,
  nenhum dos dois pedido) — cenário considerado raro o bastante (mesmo
  admin, duas abas, mesmo idioma, ao mesmo tempo) pra não justificar a
  complexidade agora.
