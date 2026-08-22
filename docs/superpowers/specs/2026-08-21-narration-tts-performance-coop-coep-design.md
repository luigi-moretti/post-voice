# Performance da narração — cabeçalhos COOP/COEP no editor

**Data:** 2026-08-21
**Status:** Aprovado para implementação (bounded)
**Issue:** https://github.com/luigi-moretti/post-voice/issues/5 (sub-projeto B —
performance; sub-projeto A, qualidade/chunking, tem spec própria em
`2026-08-18-narration-audio-quality-chunking-design.md`, que já registrava
esta como pendente: "tem spec própria")
**Branch:** `fix/issue-5-tts-performance`

## Contexto

Corpo da issue #5, seção "Causa raiz — performance (posts longos demoram
muito)": posts longos demoram muito mais que curtos para narrar. Causa
estabelecida na própria issue, não re-investigada aqui:

1. **Single-thread quase sempre, na prática.** `ort.env.wasm.numThreads` só
   ativa multi-thread se `self.crossOriginIsolated` for `true`
   (`pocket-tts.worker.js:562-564`), o que exige os cabeçalhos
   `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy` na resposta. O
   plugin **não seta esses cabeçalhos em produção** hoje — só o mu-plugin de
   E2E os seta, para CI (`e2e/mu-plugins/coop-coep-headers.php`). A maioria
   dos hosts WordPress não manda esses cabeçalhos por padrão, então a maioria
   das instalações reais roda single-thread mesmo em máquinas com vários
   núcleos. Alavanca mais barata para ganhar velocidade, por isso a issue a
   marca como prioridade sobre WebGPU.
2. O loop autoregressivo roda um `session.run` por frame, sequencial —
   inerente ao design streaming; o ganho real de paralelismo vem do
   threading interno do WASM (item 1), não de reestruturar o loop.

## Fora de escopo

Decidido na própria issue, não reaberto nesta spec:

- **WebGPU.** Bundles são int8 (kyutai documenta que int8 não roda em GPU);
  ganho de GPU é inconsistente mesmo nativo; exigiria bundle fp16/fp32
  paralelo. Retomar só como investigação própria se o RTF multi-thread ainda
  for insuficiente depois deste fix.
- **Reestruturar o loop autoregressivo.** Sequencial por design (streaming
  autoregressivo); o paralelismo que existe é o do WASM.
- Qualidade de áudio (reset de estado, split de sentença) — sub-projeto A,
  spec e branch próprios, sem dependência com este.

## Decisão

| Ponto | Decisão |
|---|---|
| Onde setar os cabeçalhos | Só nas telas do editor de post (`post.php`, `post-new.php`) **e só quando o post type é `post`** — nunca no site inteiro. `post.php`/`post-new.php` são compartilhados por qualquer post type (Página, produto WooCommerce etc.); narração só renderiza pra `post` (mesmo guard de `Post_Voice_Assets::enqueue_editor_assets`). Sem o segundo filtro, editar uma Página ou um produto ganharia os cabeçalhos à toa — exatamente o tipo de tela que a issue pede pra checar em QA (WooCommerce), então vale fechar o escopo em vez de só documentar o risco. |
| Valor de `Cross-Origin-Embedder-Policy` | `credentialless`, não `require-corp`. `credentialless` habilita `crossOriginIsolated` sem exigir que todo subrecurso cross-origin mande `Cross-Origin-Resource-Policy` própria — reduz bastante o risco de quebrar assets de outros plugins na mesma tela, mesmo assim QA manual (Jetpack, Yoast, WooCommerce) antes do merge, conforme a issue pede. |
| Hook de emissão | `admin_init`, **não** `send_headers`. Ver seção "Achado de investigação" abaixo — `send_headers` nunca dispara em `post.php`/`post-new.php`, a suposição inicial (baseada no mu-plugin de E2E) estava errada. `admin_init` dispara cedo no bootstrap de `wp-admin/admin.php`, antes de qualquer saída HTML, com `$pagenow` já setado. |
| Verificação de escopo | Checagem contra `$pagenow` (`post.php`/`post-new.php`), não `get_current_screen()` — `$pagenow` já está setado no momento em que `admin_init` dispara (setado em `wp-includes/vars.php`, carregado antes de qualquer hook de plugin rodar); `get_current_screen()` só fica disponível depois, em `set_current_screen()`, que roda depois de `admin_init`. |
| Fallback | Já existe e já é coberto: sem os cabeçalhos, `crossOriginIsolated` fica `false`, engine roda single-thread sem erro (`e2e/narration-fallbacks.spec.ts`, teste `generates audio single-threaded when crossOriginIsolated is unavailable`). Este fix não toca esse caminho. |
| `e2e/mu-plugins/coop-coep-headers.php` | **Apagar.** Ele existia como substituto de "servidor de produção que seta os cabeçalhos" para o CI poder exercitar o caminho multi-thread — mas, hookado em `send_headers`, nunca chegou a fazer isso na tela do editor (ver "Achado de investigação"). Mantê-lo depois deste fix mascararia se o código de produção funciona de verdade. Specs de geração existentes (`narration.spec.ts`, `narration-fase2.spec.ts`, `narration-audio-quality.spec.ts`) não mudam de código — mas passam a rodar, pela primeira vez, o caminho multi-thread de verdade na tela do editor, via `Post_Voice_Editor_Headers`. Isso é uma correção de um gap de cobertura pré-existente, não uma regressão a se preocupar: o pior caso é esses specs exporem uma race condition de threading que nunca foi exercitada em CI antes — se algum deles ficar flaky depois desta mudança, é sinal a investigar, não a suprimir. |
| Métrica de performance (RTF) | Sem gate de CI. Benchmark manual (post curto vs. longo, single-thread vs. multi-thread), documentado no PR — mesmo precedente da spec de qualidade (áudio, verificação qualitativa por audição, não é gate automatizado): número de RTF depende de máquina, hard-gate seria flaky. |

## Achado de investigação — `send_headers` não dispara em `wp-admin`

A primeira versão desta spec assumia que o hook certo era `send_headers`,
copiando `e2e/mu-plugins/coop-coep-headers.php` — que já usa esse hook em
produção há tempo, aparentemente funcionando (o teste
`generates audio single-threaded when crossOriginIsolated is unavailable` em
`narration-fallbacks.spec.ts` intercepta a resposta de `post-new.php` e
**remove** esses dois cabeçalhos dela). Essa suposição estava **errada**, e o
teste existente nunca provou o contrário — ele só afirma
`crossOriginIsolated === false` **depois** de remover os cabeçalhos, o que
seria verdade mesmo que eles nunca tivessem existido ali. Verificado nesta
sessão:

- **Leitura de código** (`wp-includes/class-wp.php`): `do_action_ref_array(
  'send_headers', ... )` só é chamado de um lugar, `WP::send_headers()`, por
  sua vez só chamado de `WP::main()` (linha 821) — o roteador de requisição do
  **front-end**, disparado por `wp()` em `wp-blog-header.php`. `wp-admin` não
  inclui `wp-blog-header.php` para as telas de post.
- **Confirmado empiricamente**: `curl` autenticado contra
  `wp-admin/post-new.php` num wp-env limpo (`npm run refresh:php` antes, pelo
  gotcha de cache do `CLAUDE.md`) não trazia nenhum cabeçalho
  `Cross-Origin-*`, com o mu-plugin ativo e mapeado.
- **De onde vem a falsa evidência**: `edit.php` (lista de posts, tela
  diferente de `post.php`/`post-new.php`) *também* recebe os cabeçalhos do
  mu-plugin — rastreado via `debug_backtrace()` até
  `WP_Posts_List_Table::prepare_items() → wp_edit_posts_query() → wp()`, uma
  chamada interna que a *list table* faz para rodar sua própria query,
  efeito colateral não documentado e específico de `edit.php`, não do editor
  de post nem de `wp-admin` em geral.
- **Fix confirmado**: trocando o hook para `admin_init` e checando
  `$pagenow`, `post-new.php` passou a receber
  `Cross-Origin-Embedder-Policy: credentialless` (mesmo `curl`, mesmo
  ambiente limpo), enquanto `edit.php` e o frontend continuaram só com o que
  o mu-plugin manda (`require-corp`) — confirma que `Post_Voice_Editor_Headers`
  não vaza pra fora do escopo pretendido.

**Consequência prática, além da correção do hook**: como `send_headers` nunca
disparou no editor, **o caminho multi-thread nunca foi exercitado em CI** até
hoje, apesar da intenção documentada no cabeçalho do mu-plugin ("Pocket TTS
needs `self.crossOriginIsolated`... wp-env's WordPress image does not, so E2E
supplies them here"). Os specs de geração (`narration.spec.ts` e os demais)
sempre rodaram single-thread. Esta branch corrige isso como efeito colateral
do fix em si — não é um problema novo introduzido aqui.

## Achado de investigação — COEP e o host do modelo (Hugging Face)

Risco que precisava de checagem antes de fechar em `credentialless`: se
`Cross-Origin-Embedder-Policy` (qualquer um dos dois valores) bloquearia o
`fetch()` do bundle do modelo, hospedado cross-origin em
`huggingface.co/.../resolve/...` (`model-source.ts`). Verificado nesta
sessão via `curl -H "Origin: ..."` contra a URL real do `MODEL_BASE_URL`
pinado, seguindo o redirect até a resposta final: o host responde
`Access-Control-Allow-Origin` refletindo a origem pedida (CORS real, não só
`*`) em toda a cadeia de redirect. COEP — em `require-corp` ou
`credentialless` — dispensa o cabeçalho `Cross-Origin-Resource-Policy` para
respostas obtidas em modo `cors` com CORS bem-sucedido (comportamento padrão
do Chromium); `fetch()` sem `mode` explícito já é `cors` por padrão para
requisição cross-origin. **Conclusão: nenhum dos dois valores de COEP
bloquearia o download do modelo** — não é um risco a mais que justifique
reabrir a escolha por `credentialless` (que segue decidida pelo motivo
original: não exigir `Cross-Origin-Resource-Policy` de terceiros no admin,
tipo Gravatar/oEmbed).

## Achado de investigação — escopo por post type, não só por `$pagenow`

`post.php`/`post-new.php` são o `$pagenow` de **qualquer** post type, não só
`post` — inclusive Página e qualquer CPT de terceiros (ex.: produto
WooCommerce, `post-new.php?post_type=product`). A primeira versão desta spec
e a implementação inicial checavam só `$pagenow`, então editar uma Página
teria ganhado os cabeçalhos à toa: narração nunca renderiza ali
(`Post_Voice_Assets::enqueue_editor_assets` já trava em `post_type ===
'post'`), então seria só blast radius sem benefício — precisamente o cenário
que a issue já pede pra checar em QA manual (Jetpack/Yoast/**WooCommerce**).
Em vez de só documentar o risco pra QA manual pegar, fechado por código:
`is_editor_screen()` agora recebe `post_type` também, e só retorna `true`
para `post`. Verificado empiricamente (curl autenticado, wp-env limpo):
`post-new.php` sem `post_type` no `$_GET` (post normal) recebe os
cabeçalhos; `post-new.php?post_type=page` não recebe nenhum.

## Achado de investigação — QA manual com Jetpack, Yoast SEO, WooCommerce

Feito nesta sessão, não só documentado como pendente: instalados no wp-env
(versões compatíveis com o WP 6.6 pinado — `jetpack` 13.0, `woocommerce`
8.5.0, `wordpress-seo` 22.0, via zip direto do wp.org, já que `wp plugin
install` recusa por slug alegando exigir WP 6.9, checagem contra a versão
mais recente do diretório, não contra a versão pedida) e testados via browser
real (Chrome, extensão `claude-in-chrome`) com os três ativos ao mesmo tempo:

- **Tela do editor de post** (`post-new.php`, `post_type=post`): carregou
  normal — título, blocos, metabox do Yoast SEO, ícone do Jetpack e o painel
  de Narração todos renderizaram. `window.crossOriginIsolated === true`.
  339 requisições de rede na carga da página, todas `200`, todas mesma
  origem (ou `data:`) — nenhuma chamada cross-origin de verdade disparada
  (Jetpack sem conta conectada não liga pra wordpress.com; Yoast/WooCommerce
  só carregam scripts locais nesse estado). Console sem erro (só logs de
  debug do `block-library` do próprio Gutenberg, alheios a isto). Painel de
  Narração abriu normal ao clicar no ícone.
- **Tela de produto WooCommerce** (`post-new.php?post_type=product`):
  carregou normal (editor clássico, várias metaboxes do WooCommerce).
  `window.crossOriginIsolated === false` — confirma que o filtro por
  `post_type` (achado anterior) funciona também com WooCommerce de verdade
  instalado, não só em teoria.
- Plugins desinstalados ao final do teste; wp-env voltou ao estado limpo
  (`hello` inativo + `post-voice`); suite PHP re-confirmada verde (112
  testes) depois.

**Limitação desta rodada de QA, registrada para não virar suposição
silenciosa**: nenhum dos três plugins estava **conectado** a um serviço
externo (Jetpack sem conta WordPress.com, Yoast sem chave de API,
WooCommerce sem loja configurada) — é exatamente por isso que nenhuma
chamada cross-origin apareceu para o COEP potencialmente bloquear. Um
Jetpack conectado de verdade carrega avatar/Gravatar, iframes de
`wordpress.com`, e possivelmente teria alguma chamada bloqueada por COEP
`require-corp` (não testado; `credentialless`, a escolha desta spec, é
justamente o valor que evita essa classe de bloqueio sem exigir
`Cross-Origin-Resource-Policy` do lado deles). Não foi encontrado nada que
quebre com os três ativos e desconectados; não foi verificado o caso "com
conta conectada", que ficaria abaixo do custo/benefício de configurar nesta
sessão (exigiria contas reais de terceiros). Registrado como risco residual
conhecido, não como bloqueio: `credentialless` já foi escolhido justamente
para minimizar esse cenário.

## Achado de investigação — revisão final: iframe de embed e popup OAuth, mais o escape hatch

Encontrado pelo reviewer final (não pela QA manual acima, que nunca inseriu
um embed nem abriu um popup de conexão de conta), dois riscos residuais que a
análise de blast radius anterior não cobria — `credentialless` relaxa a
exigência de CORP só para *subresources* carregados via `fetch`/`<img>`/etc.
(no-cors), não para documentos aninhados:

- **Preview de embed em bloco** (YouTube, Twitter/X): o Gutenberg renderiza
  em um iframe que herda o container de política do documento pai. O
  provedor do embed não manda `Cross-Origin-Embedder-Policy` nenhum, então
  esse iframe específico pode ficar em branco sob `COEP: credentialless` no
  editor. Não verificado nesta sessão (não seria caro: inserir um bloco de
  embed e olhar); registrado como risco não confirmado, não como bug
  confirmado.
- **Popup de OAuth ("conectar conta")**: `COOP: same-origin` corta
  `window.opener` para qualquer popup cross-origin aberto a partir do
  editor. Um fluxo de "conectar ao Jetpack/WordPress.com" que dependa de
  `postMessage` de volta pro `opener` pode quebrar. A QA manual da seção
  anterior testou os três plugins **desconectados** exatamente pelo custo de
  configurar contas reais — o que significa que essa classe de quebra é
  estruturalmente invisível a esse teste, não que ele a descartou.

Nenhum dos dois é motivo pra reverter a decisão (`credentialless` continua
sendo a escolha que minimiza a classe geral de bloqueio, e nenhum dos dois
foi *confirmado* quebrado — só não são *verificáveis* sem uma conta real ou
um embed de verdade). Mitigação adotada: um filtro,
`post_voice_send_isolation_headers` (default `true`,
`class-editor-headers.php`), deixa qualquer site desligar os headers sem
patch, caindo de volta pro comportamento single-thread anterior a esta
branch — a mesma saída que já existia antes desta feature existir, só que
opcional em vez de definitiva.

## Achado de investigação — revisão final: CSP sem `blob:` é perda total, não degradação

A spec do Worker (`2026-08-21-narration-worker-cross-origin-isolation-design.md`)
já registrava como risco não verificado um CSP de terceiro sem `blob:` em
`worker-src`. A revisão final apontou que o impacto estava descrito de forma
otimista: como as duas tentativas de `load()` (multi-thread e o retry
single-thread do Achado 4) constroem o **mesmo** tipo de Worker via `blob:`,
um CSP que bloqueia `blob:` faz as duas falharem — narração para de
funcionar por completo nesse site, onde antes desta branch funcionava
(single-thread). Não é "mais lento", é "não funciona". Continua sem
verificação nesta sessão (exigiria um site real com CSP restritivo); o
filtro `post_voice_send_isolation_headers` acima é a mesma saída para esse
caso.

## Resultado do benchmark manual de RTF

Medido em `13th Gen Intel Core i7-1355U, 12 threads`, `2026-08-22`. Cada número
é a segunda de duas gerações seguidas no mesmo post (a primeira, descartada,
apenas aquece o download/calibração do bundle, para não inflar o tempo medido
com custo de rede):

| Post | Multi-thread (RTF) | Single-thread (RTF) | Ganho |
|---|---|---|---|
| Curto (~40 palavras) | `0.987` | `1.126` | `1.14`x |
| Longo (~1350 palavras) | `0.830` | `0.908` | `1.09`x |

RTF < 1 em ambos os modos: a geração já é mais rápida que a duração do áudio
gerado, inclusive single-thread. O ganho do multi-thread é real mas modesto
(9–14%, não algo próximo de 12x apesar de 12 threads disponíveis) — WASM SIMD
com pool de threads tem overhead de coordenação que não escala linearmente
com núcleos para esta carga de trabalho, e o gargalo desta arquitetura de
modelo pode não ser puramente compute-bound. Suficiente para justificar a
mudança (Achado 1-5 da spec de Worker), mas não deve ser vendido como uma
melhoria de ordem de grandeza.

## Mudanças

Arquivos tocados:

- **Novo** `features/narration/php/class-editor-headers.php` —
  `Post_Voice_Editor_Headers`:
  - `is_editor_screen( string $pagenow, string $post_type ): bool` — função
    pura, `true` só para `post.php`/`post-new.php` **com** `post_type ===
    'post'`.
  - `resolve_post_type( string $pagenow ): string` — privado. Resolve o post
    type do jeito que o próprio core resolve em `post.php`/`post-new.php`
    (não dá pra esperar `set_current_screen()`, que roda depois de
    `admin_init`): `post-new.php` cai em `post` quando `$_GET['post_type']`
    está ausente; `post.php` busca o post existente por `$_GET['post']` e lê
    `post_type` dele.
  - `maybe_send_headers(): void` — lê `$pagenow` global, resolve o post
    type; se `is_editor_screen()`, manda `Cross-Origin-Opener-Policy:
    same-origin` + `Cross-Origin-Embedder-Policy: credentialless`.
  - `register(): void` — `add_action( 'admin_init', ... )`.
- `post-voice.php` — `require_once` + `Post_Voice_Editor_Headers::register()`,
  mesmo padrão das outras classes de feature já registradas ali.
- **Apagado** `e2e/mu-plugins/coop-coep-headers.php` (ver tabela acima).

Sem mudança de interface pública (mensagens do worker, REST, meta de post),
sem migração de dado.

## Testes

- **PHPUnit**, `features/narration/tests/php/test-editor-headers.php`,
  `@covers Post_Voice_Editor_Headers`. Só a função pura
  `is_editor_screen()` é testada por unidade — `post.php`/`post-new.php`
  com `post_type = 'post'` (`true`), `edit.php` (`false`), e `post.php`/
  `post-new.php` com `post_type` de Página ou de outro CPT, ex. `product`
  (`false`) — o efeito colateral `header()` de `maybe_send_headers()`, e a
  resolução de `resolve_post_type()` (que depende de `$_GET`/`get_post()`),
  não têm forma limpa de asserção no WP core/PHPUnit sem xdebug (não
  configurado neste projeto); ficam cobertos pelo E2E abaixo, que observa o
  efeito real (`window.crossOriginIsolated`) do fluxo completo.
- **E2E** — estender `e2e/narration-fallbacks.spec.ts` (ou arquivo dedicado
  `e2e/narration-performance.spec.ts`, a decidir na implementação conforme o
  padrão de nome-por-tópico já usado):
  - `crossOriginIsolated === true` em `post-new.php`, **sem** interceptar/
    remover cabeçalhos — prova que o código de produção os manda por padrão.
    Não existe hoje nenhum teste que prove isso (o teste existente só
    verifica o comportamento **depois** de removê-los, o que passaria mesmo
    se eles nunca tivessem sido enviados — ver "Achado de investigação"
    acima); esta é a asserção que fecha essa lacuna.
  - `crossOriginIsolated` **não** `true` numa tela admin não relacionada
    (`edit.php`) — prova que o escopo é só `post.php`/`post-new.php`, não o
    admin inteiro.
  - `crossOriginIsolated` **não** `true` em `post-new.php?post_type=page` —
    prova que o filtro por post type funciona (ver "Achado de investigação —
    escopo por post type").
- **Benchmark manual**: RTF antes/depois em post curto e post longo,
  single-thread vs. multi-thread, documentado no PR (qualitativo/numérico,
  não é gate de CI — ver tabela "Decisão").
- **QA manual**: telas do editor com Jetpack, Yoast, WooCommerce ativos
  continuam carregando sem quebra visível — **feito nesta sessão**, ver
  "Achado de investigação — QA manual com Jetpack, Yoast SEO, WooCommerce"
  acima; documentar o mesmo resumo no PR.
- Gates normais de `TESTING.md` (lint, tsc, PHP, cobertura, build+E2E
  completo) se aplicam antes do PR, conforme `CLAUDE.md`.

## Estado desta implementação

`Post_Voice_Editor_Headers` (classe + registro em `post-voice.php`) e seu
teste PHPUnit já foram implementados via TDD nesta sessão, em três rodadas
RED→GREEN: (1) a classe em si, (2) a troca do hook `send_headers` →
`admin_init`, (3) o filtro por `post_type` além de `$pagenow`. PHPUnit verde
(5 testes) depois da terceira rodada. Confirmado manualmente via `curl`
autenticado, em wp-env limpo (`npm run refresh:php`): `post-new.php` (post
normal) recebe `credentialless`; `edit.php`, frontend e
`post-new.php?post_type=page` não recebem nada — os três casos ainda sem
teste automatizado (E2E, pendente).

QA manual com Jetpack/Yoast/WooCommerce reais também feita nesta sessão
(plugins desinstalados depois, wp-env de volta ao estado limpo, PHPUnit
reconfirmado verde) — ver seção própria acima, com a limitação registrada
(nenhum dos três testado conectado a serviço externo).

Pendente: apagar o mu-plugin de E2E, escrever os testes E2E de escopo
(inclusive o caso `post_type=page`), benchmark manual de RTF, e os gates
completos de `TESTING.md`.
