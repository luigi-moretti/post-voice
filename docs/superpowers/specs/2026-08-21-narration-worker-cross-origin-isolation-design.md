# Narração — entrega do Worker sob isolamento cross-origin

**Data:** 2026-08-21
**Status:** Aprovado para implementação (achados e decisão fechados nesta sessão; nada implementado ainda)
**Issue:** https://github.com/luigi-moretti/post-voice/issues/5 (sub-projeto B — performance)
**Branch:** `fix/issue-5-tts-performance`
**Spec relacionada:** `2026-08-21-narration-tts-performance-coop-coep-design.md` — aquela spec
resolve o documento (`post.php`/`post-new.php`) receber `Cross-Origin-Opener-Policy`/
`Cross-Origin-Embedder-Policy`. Esta spec cobre o que foi descoberto **depois** que
esse fix já estava implementado, testado (PHPUnit) e QA'd (Jetpack/Yoast/WooCommerce
reais): o documento fica corretamente isolado, mas a geração de narração trava —
`window.crossOriginIsolated === true` não é suficiente, o Worker que faz a inferência
nunca chega a rodar.

## Contexto

Ao rodar a suite E2E completa depois da Task 1 daquela spec (primeira vez que
`crossOriginIsolated` chegou a `true` de verdade num teste, desde sempre — ver a spec
irmã, seção "Achado de investigação — `send_headers` não dispara em `wp-admin`"), toda
geração de áudio real trava em "Preparing…" até estourar timeout. O único teste que
passa é o que desliga os headers de propósito (fallback single-thread).

Investigado nesta sessão, em Chrome real (não headless, extensão `claude-in-chrome`,
Chrome 151) — não é artefato de teste automatizado.

## Achado 1 (confirmado, com fix confirmado) — asset estático do Worker sem cabeçalho COEP

`Post_Voice_Editor_Headers` (spec irmã) manda os cabeçalhos só quando WordPress
processa a requisição — via `admin_init`. Mas o script do Worker
(`features/narration/editor/engine/pocket-tts.worker.js`, compilado para
`build/285.js` pelo webpack) é servido pelo Apache **direto do disco**, como
qualquer `.js` estático — nunca passa por `wp-load.php`, nunca aciona `admin_init`,
nunca recebe cabeçalho nenhum. Confirmado via `curl`:

```
$ curl -s -D - -o /dev/null http://localhost:8888/wp-content/plugins/post-voice/build/285.js
HTTP/1.1 200 OK
Content-Type: text/javascript
```

(sem nenhum `Cross-Origin-*`.)

Um documento cross-origin-isolado exige que o **script do próprio Worker** também
carregue COEP para `new Worker(...)` suceder — sem isso, a construção falha com um
`error` event opaco (sem `message`, sem `filename`, sem objeto `Error`). Confirmado
ao vivo, fora do React, construindo o Worker manualmente contra a URL real:

```js
const w = new Worker('http://localhost:8888/wp-content/plugins/post-voice/build/285.js', { type: 'module' });
// -> error event: { hasError: false } — nenhum detalhe, e nenhuma 'message' depois
```

Mesmo resultado com `{ type: 'classic' }`. `fetch()` da mesma URL funciona normal
(200, conteúdo correto) — não é falha de rede, é especificamente a construção do
Worker sob isolamento cross-origin.

**Bug irmão, que transforma isso em hang silencioso em vez de erro visível**:
`PocketTtsEngine.load()` (`features/narration/editor/engine/tts-engine.ts:69-98`) só
escuta `this.worker.addEventListener('message', onMessage)` — nunca `'error'`. Quando
a construção do Worker falha, a `Promise` de `load()` nunca resolve nem rejeita; o
`await` fica pendurado para sempre. "Preparing…" nunca vira mensagem de erro porque
nada captura a falha. Esse bug precisa de correção independente da causa raiz —
qualquer falha futura na criação do Worker, por qualquer motivo, vai continuar
travando em silêncio até isso ser corrigido.

**Fix confirmado, ao vivo, sem tocar servidor**: buscar o script via `fetch()`
(mesma origem, sem obstáculo de COEP para `fetch()` puro) e construir o Worker a
partir de um `blob:` gerado localmente, em vez de apontar direto para a URL do
arquivo:

```js
const resp = await fetch('http://localhost:8888/wp-content/plugins/post-voice/build/285.js');
const code = await resp.text();
const blob = new Blob([code], { type: 'text/javascript' });
const blobUrl = URL.createObjectURL(blob);
const w = new Worker(blobUrl, { type: 'module' });
// -> nenhum error event; primeira mensagem chega: {type:"status", status:"Worker Thread Started", state:"idle"}
```

`URL.createObjectURL()` precisa de `URL.revokeObjectURL()` depois — sem isso é
vazamento (a referência ao `Blob` fica retida pelo resto da vida da página).
Testado ao vivo: revogar **imediatamente** depois de `new Worker(blobUrl)`
(antes até de receber a primeira mensagem) não quebra nada — o worker roda
normal até o mesmo ponto de sempre. O navegador já capturou o conteúdo do
blob no momento da construção; não precisa manter a URL viva depois disso.

Confirmado com `postMessage({type:'load'})` real: o worker progride até "Loading
ONNX Runtime..." e "Loading english_2026-04 bundle..." — passa por
`loadOrt()` inteiro (`import()` dinâmico do `ort.min.mjs` via jsdelivr, cross-origin,
funciona normal — jsdelivr manda `Access-Control-Allow-Origin`/
`Cross-Origin-Resource-Policy: cross-origin` corretos, confirmado por `curl` com
`Origin` setado).

Por que isso é seguro: é o mesmo arquivo, byte a byte, que o navegador carregaria de
qualquer jeito — mesma origem, já autenticado por ser tela de `wp-admin`. `blob:` só
muda como o Worker é instanciado, não o que roda nem que política de acesso se aplica.
Ponto de atenção real, **não coberto pelo QA já feito** (ver "Fora de escopo"):
`Content-Security-Policy` de terceiro sem `blob:` em `worker-src`/`script-src`
quebraria isso.

## Achado 2 (confirmado, fix confirmado pelo spike abaixo) — `importScripts()` incompatível com Worker módulo ES

Com o Worker construído (achado 1 corrigido), a geração ainda trava — agora num
ponto diferente, dentro de `loadBundle()`, exatamente na criação das sessões ONNX
(`ort.InferenceSession.create(...)`, `pocket-tts.worker.js:740-746`):

```
TypeError: Failed to execute 'importScripts' on 'WorkerGlobalScope':
Module scripts don't support importScripts().
```

`onnxruntime-web` usa `importScripts()` — API de Worker **clássico** — na
inicialização do backend WASM multi-thread. `pocket-tts.worker.js` só precisa ser
`{ type: 'module' }` porque seu **próprio** código-fonte usa `import`/`export`
estático (`import { MODEL_BASE_URL } from '../model-source'` etc. — assim que o
webpack 5 empacota `new Worker(new URL(...), { type: 'module' })`). O erro dispara
no `self` do nosso próprio worker (não é um worker aninhado cujo erro não
propagaria) — ou seja, algum ponto do bootstrap do ORT chama `self.importScripts(...)`
direto, síncrono, dentro do escopo que declaramos como módulo.

**Não é bug de versão do `onnxruntime-web`.** Testado ao vivo, reescrevendo só a
string da versão dentro do código real buscado (sem tocar no repositório, sem
rebuild) e reconstruindo via `blob:`:

| Versão testada | Resultado |
|---|---|
| `1.20.0` (pinada hoje) | mesmo erro |
| `1.22.0` | mesmo erro |
| `1.27.0` (mais recente do npm em 2026-08-21) | mesmo erro |

Persistiu idêntico nas três — não é regressão nem bug já corrigido rio acima.
Pesquisa no rastreador do `microsoft/onnxruntime` (issues/PRs sobre
`importScripts`/module worker) não encontrou nenhum indício de que versões mais
novas tenham mudado esse comportamento especificamente para este caso; a mudança
real entre 1.18 e 1.19+ foi o backend threaded virar o **padrão automático**
(antes era opt-in), não o mecanismo de carregamento em si (issue
`microsoft/onnxruntime#25666`, lida nesta sessão).

**Candidato de fix, ainda não testado empiricamente** (não dá para simular via
`blob:` + troca de string como o achado 1 e a checagem de versão acima — um script
clássico não aceita `import`/`export` de jeito nenhum, precisa de bundle gerado
diferente): compilar `pocket-tts.worker.js` como chunk **clássico** no webpack, não
módulo ES. Webpack 5 sabe empacotar/inlinar `import`s estáticos num Worker clássico
normal (era o único jeito antes do suporte nativo a Worker-módulo do webpack 5) —
isso faria `importScripts()` voltar a ser válido no escopo do worker, porque deixa
de ser um Worker módulo. Mudança concreta cogitada: tirar `{ type: 'module' }` da
chamada `new Worker(new URL('./pocket-tts.worker.js', import.meta.url), ...)` em
`tts-engine.ts:64-67`, e confirmar que o webpack gera um chunk sem `import`/`export`
de fato (não só remover a flag e torcer).

## Spike — build do Worker como chunk clássico (não módulo ES)

Testado ao vivo nesta sessão: em `tts-engine.ts:64-67`, removida temporariamente a
opção `{ type: 'module' }` da chamada `new Worker(new URL('./pocket-tts.worker.js',
import.meta.url), ...)`, seguido de `rm -rf build && npm run build`.

**Confirmado**: o webpack 5 empacota `pocket-tts.worker.js` como um chunk clássico
de verdade — `build/285.js` sai como uma única IIFE, sem `import`/`export` estático
nenhum. O próprio runtime do webpack passa a usar `importScripts()` pra carregar
seus chunks preguiçosos (ex. `646.js`, o `SentencePieceProcessor` do tokenizer) —
confirma que o modo clássico compilou certo, não é só a flag removida por acaso.

Testado ao vivo (`blob:` + Worker sem `{type:'module'}`, `postMessage({type:'load'})`
real): a mensagem de erro **muda de categoria por completo**.

| | Worker módulo (hoje) | Worker clássico (spike) |
|---|---|---|
| Erro | `TypeError: ... Module scripts don't support importScripts().` | `NetworkError: ... The script at 'http://localhost:8888/646.js?ver=...' failed to load.` |
| Categoria | Incompatibilidade de API — `importScripts` nem existe nesse contexto | Erro de rede — `importScripts` **funciona**, só busca URL errada |

**Achado 2 confirmado corrigido pelo build clássico.** `importScripts()` passa a
funcionar. O que aparece na frente é um problema novo, mais raso:

## Achado 3 (descoberto pelo spike, não corrigido ainda) — `publicPath` do webpack não sobrevive a `blob:`

Com o worker construído via `blob:` (achado 1) a partir de um chunk clássico
(achado 2), a **próxima** falha é o webpack tentar carregar o chunk `646.js`
(`SentencePieceProcessor`, o tokenizer) do lugar errado:
`http://localhost:8888/646.js` em vez de
`http://localhost:8888/wp-content/plugins/post-voice/build/646.js`.

Causa: o bundle clássico calcula seu próprio `publicPath` em tempo de execução lendo
`globalThis.location` (a única informação de URL que um Worker tem sobre si mesmo,
sem `document`/`currentScript`) — código gerado pelo webpack quando
`output.publicPath` não é fixado explicitamente (o padrão herdado de
`@wordpress/scripts` é `'auto'`). Um Worker nascido de uma URL `blob:` não tem um
caminho de diretório de verdade — `globalThis.location` dentro dele é a própria
`blob:...`, e o cálculo de "tira o último segmento" do webpack produz uma base
errada.

Diferente dos achados 1 e 2, este **não é uma incompatibilidade de plataforma nem de
biblioteca de terceiro** — é configuração de build sob nosso controle total.

**Primeira hipótese, testada e descartada**: prependar
`self.__webpack_public_path__ = "<diretório real>";` ao código buscado antes de
blobar, contando com o mecanismo "on-the-fly publicPath" documentado do webpack
(https://webpack.js.org/guides/public-path/#on-the-fly). Testado ao vivo — **não
funciona**: com `output.publicPath` resolvendo para `'auto'` (herdado do
`@wordpress/scripts`), o runtime gerado roda a auto-detecção incondicionalmente,
sem checar essa variável antes. Mesmo erro de antes, idêntico.

**Causa mais profunda, e fix testado com sucesso**: o `646.js` só existe porque
`pocket-tts.worker.js` importa o tokenizer com `import()` **dinâmico**
(`await import("./sentencepiece.js")`, `pocket-tts.worker.js:760`) — e esse import
não é condicional, roda sempre, toda vez que um bundle carrega. Sem motivo pra ser
lazy. Trocado para `import` **estático** no topo do arquivo
(`import * as spModuleStatic from './sentencepiece.js';`), o webpack para de
gerar o chunk separado — o tokenizer entra inline no bundle principal do worker,
e não sobra nenhuma chamada `n.e()`/carregamento de chunk em tempo de execução pra
depender de `publicPath` nenhum. Testado ao vivo, ponta a ponta, com
`postMessage({type:'generate', ...})` real (não só `load`): sequência completa
`status → generation_started → status → stream_ended`, 3 `audio_chunk` recebidos,
zero erro — em `crossOriginIsolated: true` de verdade (`wp-admin/post-new.php`
autenticado), combinando os três achados (`blob:` + build clássico + import
estático). Primeira geração de áudio multi-thread bem-sucedida, ponta a ponta,
desde que a issue #5 foi aberta.

## Decisão

| Ponto | Decisão |
|---|---|
| Achado 1 (COEP no asset do Worker) | Adotar construção via `blob:` — buscar `pocket-tts.worker.js` compilado com `fetch()`, envolver em `Blob`, `URL.createObjectURL()`, construir o `Worker` a partir disso, e revogar a URL logo em seguida (`URL.revokeObjectURL()`, testado ao vivo que não quebra nada — o navegador já capturou o conteúdo no momento da construção). Sem mudança de servidor, portável em qualquer host (Apache ou nginx), sem overhead de proxy PHP. |
| Bug irmão (Worker nunca escuta `'error'`) | Corrigir independente do achado 1 — `PocketTtsEngine.load()`, `setLanguage()` **e `generate()`** passam a escutar `worker.addEventListener('error', ...)` e rejeitar a Promise, para qualquer falha futura do Worker (na construção ou em qualquer ponto depois, inclusive durante uma geração já em andamento) virar erro visível na UI, nunca mais hang silencioso. `generate()` não fazia parte da leitura original do bug (só `load()`/`setLanguage()`) — mesma classe, mesmo padrão, mesmo risco de hang silencioso mid-geração; incluído por consistência. |
| Achado 2 (`importScripts` vs módulo ES) | Adotar build do Worker como chunk clássico (tirar `{ type: 'module' }` de `new Worker(...)`) — spike confirmou que resolve o `importScripts`, sem downgrade de versão do `onnxruntime-web`. |
| Achado 3 (`publicPath` sob `blob:`) | Trocar o `import()` dinâmico do tokenizer (`pocket-tts.worker.js:760`, `await import("./sentencepiece.js")`) por `import` estático no topo do arquivo. Elimina o chunk `646.js` e, com ele, qualquer carregamento de chunk em tempo de execução dentro do worker — não sobra nada que dependa de `publicPath` resolvido certo. Testado ao vivo, com sucesso, geração completa ponta a ponta. |
| Achado 4 (resiliência a navegador não testado) | `load()` tenta uma vez; se falhar com o documento `crossOriginIsolated`, descarta o worker e tenta de novo forçando single-thread (`data: { forceSingleThread: true }` na mensagem `load`, `loadOrt()` pula a checagem de `crossOriginIsolated` quando presente). Uma segunda falha propaga normal. Retenta em qualquer causa de falha (rede, parse, threading), não só as que parecem ser de threading — distinguir a causa de forma confiável exigiria casar string de mensagem de erro, frágil entre versões do `onnxruntime-web`; o custo de uma segunda tentativa desnecessária (poucos segundos) é aceitável. Quando a segunda tentativa (single-thread) tem sucesso, a UI mostra um aviso não bloqueante (`createErrorNotice(..., { type: 'snackbar' })`, mesmo padrão já usado pro aviso de "dispositivo lento") — sem isso o autor só percebe que ficou mais lento, sem saber por quê. |
| Abordagens descartadas | Header via `.htaccess`/`mod_headers` no `build/` — não portável pra host nginx (comum em hosting gerenciado), e o plugin não controla o servidor de produção. Proxy via endpoint PHP — portável, mas overhead por requisição, perde cache estático do Apache, muda o esquema de build do Worker sem necessidade agora que `blob:` resolve sem tocar servidor. Downgrade/mudança de versão do `onnxruntime-web` — descartado pelo spike de versão (achado 2): erro idêntico em 1.20.0/1.22.0/1.27.0, não é bug de versão. `self.__webpack_public_path__` prependado ao código (primeira tentativa do achado 3) — testado ao vivo, não funciona: `output.publicPath: 'auto'` ignora essa variável e sempre roda a auto-detecção. `output.publicPath` fixo em `webpack.config.js` — descartado por depender de um caminho absoluto que só existe em tempo de execução (domínio/subdiretório da instalação, nome real da pasta do plugin), não em tempo de build — e ficou desnecessário assim que o import estático eliminou o chunk que precisava dele. |

## Achado 4 (decisão de resiliência, sem investigação de causa raiz) — fallback automático multi-thread → single-thread

O worker já tem um fallback pra single-thread, testado e coberto
(`e2e/narration-fallbacks.spec.ts`): `ort.env.wasm.numThreads` cai pra `1`
sempre que `self.crossOriginIsolated` é `false`. Isso cobre o caso "documento
não isolado" — mas não cobre o caso **documento isolado, multi-thread
tentado, e mesmo assim falha por outro motivo**: um bug de navegador
específico no backend WASM com threads (não a ausência da flag em si).

Não investigado nesta sessão em navegador nenhum além de Chrome 151 — o plugin
declara suporte a Safari/Firefox desde a spec do MVP
(`2026-08-08-wp-narration-plugin-mvp-design.md`), e Safari em particular já
teve bugs históricos de `SharedArrayBuffer`/threading. Sem cobrir esse caso,
um navegador com essa falha específica passaria a ver um **erro visível**
(graças ao achado 1) em vez de travar em silêncio — já uma melhora — mas a
narração simplesmente pararia de funcionar ali, sem alternativa.

**Decisão**: `PocketTtsEngine.load()` tenta uma vez, e se falhar **e** o
documento estava `crossOriginIsolated` (ou seja, multi-thread foi realmente
tentado — não adianta repetir uma tentativa que já era single-thread),
descarta o worker e tenta de novo, dessa vez forçando single-thread via uma
flag na própria mensagem `load` (`data: { forceSingleThread: true }`), que o
worker usa pra pular a checagem de `crossOriginIsolated` em `loadOrt()`. Uma
segunda falha propaga normalmente (erro visível, sem laço infinito). Quando a
segunda tentativa funciona, um aviso não bloqueante (snackbar) informa o
autor que caiu pra modo mais lento — sem isso a única pista seria a geração
demorar mais que o normal, sem explicação nenhuma.

**Escopo exato, pra não confundir**: a retentativa cobre o `load()` inteiro
como uma unidade — inclusive a chamada a `setLanguage()` que `load()` já faz
internamente quando o primeiro idioma do post não é o inglês padrão (essa
chamada acontece *dentro* do mesmo bloco que a retentativa recria do zero).
O que fica de fora é uma chamada **independente** a `setLanguage()` feita
*depois* que `load()` já retornou com sucesso — ou seja, trocar de idioma no
meio de uma geração multi-idioma, já com o worker rodando multi-thread com
sucesso uma vez. Uma falha nessa chamada independente é mais provável ser de
rede/dados do bundle específico do que de threading, e forçar single-thread
não ajudaria mesmo — o modo de threading já está fixado pro worker inteiro
desde a primeira carga (`loadOrt()` só roda uma vez por instância de worker).

## Fora de escopo

- Qualidade de áudio (sub-projeto A) — spec e branch próprios.
- WebGPU — já descartado na issue e na spec irmã.
- **Compatibilidade com `Content-Security-Policy` de terceiro que bloqueie
  `blob:` em `worker-src`/`script-src`.** Diferente do QA de COOP/COEP já
  feito (Jetpack/Yoast SEO/WooCommerce reais, spec irmã) — aquele QA rodou
  **antes** desta spec existir, contra o código antigo, sem `blob:` nenhum
  envolvido. Nenhum teste desta sessão exercitou a construção do Worker via
  `blob:` com plugin de segurança/CSP nenhum ativo. Risco residual conhecido
  e não coberto, registrado aqui explicitamente para não virar suposição
  silenciosa — não "mesma categoria já resolvida", é uma checagem nova ainda
  pendente. Se aparecer relato de generation quebrada com algum plugin de
  segurança específico, começar por aqui.

## Estado desta investigação

Três achados, três causas raiz confirmadas ao vivo (Chrome real, Chrome 151), e os
três fixes **verificados juntos, ponta a ponta, com geração de áudio real**:

1. Asset estático do Worker sem cabeçalho COEP → `new Worker()` falha silencioso.
   Fix: construção via `blob:`.
2. `importScripts()` incompatível com Worker módulo ES (`onnxruntime-web`, qualquer
   versão testada). Fix: build do Worker como chunk clássico (tirar
   `{ type: 'module' }`).
3. `publicPath` do webpack mal calculado sob `blob:`. Primeira hipótese
   (`self.__webpack_public_path__`) testada e descartada. Fix real: `import`
   estático do tokenizer em vez de `import()` dinâmico, eliminando o chunk que
   dependia de `publicPath`.

**Teste final, combinando os três**: `blob:` + build clássico + import estático,
numa aba `wp-admin/post-new.php` autenticada e realmente isolada
(`crossOriginIsolated: true`), com `postMessage({type:'generate', ...})` de
verdade — sequência completa `status → generation_started → status →
stream_ended`, 3 `audio_chunk`, zero erro. Primeira geração de áudio multi-thread
bem-sucedida, ponta a ponta, desde que a issue #5 foi aberta.

Nenhum código de produção mudou nesta sessão — tudo verificado por spikes
temporários (edição local + `rm -rf build && npm run build` + teste ao vivo via
`javascript_tool`), sempre revertidos ao final. `git diff --stat` confirmado limpo
(só `TESTING.md`, sobra não relacionada de uma sessão anterior desta mesma
branch) depois de cada rodada; `build/` recompilado de volta ao estado que bate
com o código committado ao encerrar a investigação.

Achado 4 é uma decisão de resiliência, não uma causa raiz investigada — não há
bug reproduzido de navegador nenhum além de Chrome (não testado), é defesa em
profundidade contra um caso a issue não pede explicitamente mas que a spec do
MVP já compromete (Safari/Firefox).

Pendente: implementação real dos três achados + o achado 4 juntos no código do
repositório (hoje só existem como edições temporárias já revertidas) + o bug
irmão do achado 1 (`load()`/`setLanguage()`/`generate()` escutarem `'error'`
do Worker, ainda não exercitado no teste final acima porque nada falhou) +
cobertura de teste (nenhum teste automatizado existe ainda para nada disto).

**Quatro pontos em aberto resolvidos numa revisão posterior desta mesma
sessão** (a pedido do usuário, depois de perguntar "existem pontos em aberto
que a spec e o plano não decidiram?"):

1. `generate()` também escuta `'error'`, não só `load()`/`setLanguage()` — a
   spec original só cobria os dois primeiros, o plano já tinha estendido pra
   `generate()` mas a spec nunca foi atualizada de volta. Alinhado.
2. `URL.revokeObjectURL()` depois de construir o Worker — testado ao vivo
   (revogar imediatamente, antes até da primeira mensagem, não quebra nada).
3. Aviso não bloqueante (snackbar) quando o retry do achado 4 cai pra
   single-thread com sucesso — sem isso o fallback era totalmente silencioso.
4. Risco de CSP de terceiro com `blob:` movido pra "Fora de escopo"
   explicitamente — a redação original dizia "mesma categoria já coberta
   pelo QA" da spec irmã, o que era impreciso: aquele QA rodou antes desta
   spec existir, nunca exercitou `blob:`.

Nenhum dos quatro foi implementado ainda (exceto o revoke, que foi só
verificado ao vivo do mesmo jeito exploratório dos achados 1-3, sem tocar o
repositório).
