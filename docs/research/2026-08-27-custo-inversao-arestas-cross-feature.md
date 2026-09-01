# Custo de inverter as arestas cross-feature — medição

**Data:** 2026-08-27
**Commit medido:** `6f90741`
**Pergunta:** quanto custa fazer `pronunciation` e `player-style` se plugarem em
`narration` em vez de os três se referenciarem mutuamente?

## Reconfirmação das onze arestas

Reexecutado a HEAD (`6f90741`):

```bash
grep -rnE "Post_Voice_(Dictionary_Store|Style_Store|Frontend_Render|Post_Meta|Rest_Api)" features/*/php/*.php
grep -rn "\.\./\.\./\(narration\|pronunciation\|player-style\)/" features/*/editor features/*/admin features/*/frontend
```

O conjunto bate exatamente com a tabela do brief — seis referências PHP
cross-feature, cinco arestas de módulo TypeScript distintas (as linhas 51 e 52
de `index.tsx` miram o mesmo módulo, `dictionary-entry`, então a aresta #8 não
soma um arquivo novo). Nenhuma aresta `pronunciation ↔ player-style` direta
existe — as duas só se relacionam com `narration`, nunca uma com a outra.

## Achado que organiza o resto do documento

O grafo não é simétrico. Separando as onze arestas pelo sentido:

- **`narration` → satélite** (o núcleo lê o satélite): arestas 1, 2, 7, 8, 9 —
  cinco arestas, nas duas linguagens.
- **satélite → `narration`** (o satélite lê o núcleo): arestas 3, 4, 5, 6, 10, 11
  — seis arestas.

`docs/superpowers/specs/2026-08-25-adr-e-governanca-de-arquitetura-design.md`
já registra que `pronunciation` e `player-style` "modificam o comportamento de
narration; nenhuma das duas faz sentido sozinha" — ou seja, satélite depender
do núcleo é a forma esperada do sistema, não um defeito. O ciclo existe porque
**o núcleo também depende dos satélites** (arestas 1, 2, 7, 8, 9). São essas
cinco — não as onze — que precisam inverter para que "pronunciation e
player-style se pluguem em narration" deixe de ser uma descrição aspiracional
e passe a ser verdade no código. As outras seis já estão na direção que o
enunciado pede.

## As onze arestas

| # | De | Para | Dado que atravessa | Sentido |
|---|---|---|---|---|
| 1 | `narration/php/class-assets.php:64` | `Post_Voice_Dictionary_Store::get_global()` | dicionário de pronúncia global (`array<{term,replacement,language}>`) | núcleo → satélite |
| 2 | `narration/php/class-assets.php:118` | `Post_Voice_Style_Store::inline_css()` | CSS inline já computado (string de `var()`) | núcleo → satélite |
| 3 | `player-style/php/class-style-section.php:142` | `Post_Voice_Frontend_Render::markup()` | markup HTML completo do player (modo preview) | satélite → núcleo |
| 4 | `pronunciation/php/class-dictionary-section.php:86` | `Post_Voice_Rest_Api::ALLOWED_LANGUAGES` | lista de idiomas do modelo | satélite → núcleo |
| 5 | `pronunciation/php/class-dictionary-store.php:57` | `Post_Voice_Rest_Api::ALLOWED_LANGUAGES` | lista de idiomas do modelo | satélite → núcleo |
| 6 | `pronunciation/php/class-dictionary-store.php:114` | `'Post_Voice_Post_Meta'::auth_callback` (callable em string) | verificação de capability genérica (`current_user_can('edit_post', …)`) | satélite → núcleo |
| 7 | `narration/editor/index.tsx:50` | `pronunciation/editor/dictionary-panel` (`DictionaryPanel`) | componente React inteiro | núcleo → satélite |
| 8 | `narration/editor/index.tsx:51,52` | `pronunciation/editor/dictionary-entry` (`DictionaryEntry`, `mergeDictionaries`) | tipo + função de merge | núcleo → satélite |
| 9 | `narration/editor/index.tsx:53` | `pronunciation/editor/apply-dictionary` (`applyDictionary`) | função de transformação de texto | núcleo → satélite |
| 10 | `pronunciation/editor/dictionary-panel.tsx:9` | `narration/editor/model-source` (`SUPPORTED_LANGUAGES`) | lista de idiomas do modelo | satélite → núcleo |
| 11 | `pronunciation/editor/dictionary-entry.ts:1` | `narration/editor/model-source` (`SUPPORTED_LANGUAGES`) | lista de idiomas do modelo | satélite → núcleo |

## Por mecanismo

### 1. Filtro do WordPress (arestas 1 e 2 — PHP, núcleo → satélite)

**Aresta 1 — dicionário global.** `class-assets.php:64` trocaria
`Post_Voice_Dictionary_Store::get_global()` por
`apply_filters( 'post_voice_editor_dictionary', array() )`; `pronunciation`
registraria com `add_filter( 'post_voice_editor_dictionary', array( 'Post_Voice_Dictionary_Store', 'get_global' ) )`.

- **Arquivos:** 2 — `features/narration/php/class-assets.php`,
  `features/pronunciation/php/class-dictionary-store.php` (o registro entra em
  `register()`, já chamado no hook `init` existente — nenhum arquivo novo).
- **Testes que exercitam o caminho:**
  `features/narration/tests/php/test-assets.php::test_editor_assets_localise_the_global_dictionary`.
  Continuaria passando sem edição, mas por um motivo frágil: o `set_up()`
  desse teste só chama `Post_Voice_Assets::register()`, não
  `Post_Voice_Dictionary_Store::register()` — o teste depende do `init` já ter
  disparado uma vez no boot normal do plugin dentro do processo PHPUnit. Isso
  já é verdade hoje (o filtro seria registrado de qualquer forma), mas é uma
  dependência implícita que o teste não declara.
- **Ordem de carga:** nenhuma nova. `add_filter` roda no carregamento do
  arquivo (dentro de `register()`, chamado no `init`), sempre antes de
  `enqueue_block_editor_assets` disparar.

**Aresta 2 — CSS inline.** `class-assets.php:118` trocaria
`Post_Voice_Style_Store::inline_css()` por
`apply_filters( 'post_voice_player_inline_css', '' )`.

- **Arquivos:** 3 — `class-assets.php`; `features/player-style/php/class-style-store.php`
  (hoje **não tem `register()`** — é só uma classe de dados, sem hook nenhum;
  precisaria ganhar um); `post-voice.php` (precisaria de uma linha nova
  chamando `Post_Voice_Style_Store::register();` — hoje essa classe não é
  registrada em lugar nenhum).
- **Testes que exercitam o caminho:**
  `test-assets.php::test_no_inline_style_when_the_player_was_never_customised`,
  `test-assets.php::test_customised_player_ships_its_declarations_inline`.
- **Ordem de carga:** tecnicamente nenhuma constrangida (o `add_filter` pode
  rodar em qualquer ponto do carregamento do plugin, sempre antes do hook de
  request `wp_enqueue_scripts` disparar), mas é uma linha de registro
  **inteiramente nova** em `post-voice.php`, sem precedente — ao contrário da
  aresta 1, que reaproveita o `init` já existente de `Dictionary_Store`, aqui
  é fácil esquecer a chamada e o esquecimento não quebra nada visivelmente.

**O que fica pior nas duas:** `post_voice_editor_dictionary` e
`post_voice_player_inline_css` viram pontos de extensão públicos — qualquer
plugin ou tema pode registrar um `add_filter` e injetar valor arbitrário no
script localizado (o dicionário) ou no `<style>` inline do player, sem passar
pelo `sanitize()` de `Dictionary_Store` a menos que `class-assets.php` volte a
sanitizar depois do filtro. E o modo de falha muda de barulhento para
silencioso: hoje, remover `pronunciation/` ou `player-style/` sem atualizar
`class-assets.php` produz um fatal error imediato (classe inexistente) — óbvio
e rastreável. Depois do filtro, a mesma remoção faz o dicionário ou o CSS
simplesmente desaparecerem, sem erro, sem log.

### 2. Mover a constante para o dono certo (arestas 4 e 5 — PHP, satélite → núcleo)

O sentido do fluxo (`pronunciation` lê `narration`) já é o que a topologia-alvo
pede — não é uma inversão. O problema, como o brief já apontava, é que
`ALLOWED_LANGUAGES` mora em `Post_Voice_Rest_Api`, uma classe de transporte
HTTP, quando o dado é "quais idiomas o modelo Pocket TTS suporta" — o
equivalente PHP de `SUPPORTED_LANGUAGES` em `model-source.ts`, que já está no
lugar certo ao lado de `MODEL_BASE_URL` (o pin de modelo protegido pelo
CLAUDE.md). Não existe hoje um `Post_Voice_Model` (ou equivalente) do lado
PHP.

```bash
grep -rn "ALLOWED_LANGUAGES" features/ post-voice.php
```

confirma 4 arquivos de produção usando o símbolo:
`features/narration/php/class-rest-api.php` (definição + 3 usos internos),
`features/narration/php/class-post-meta.php` (2 usos — **dentro de
`narration`**, não uma aresta cross-feature, mas usa o mesmo símbolo),
`features/pronunciation/php/class-dictionary-store.php` (aresta 5),
`features/pronunciation/php/class-dictionary-section.php` (aresta 4).

- **Arquivos:** 4 — os quatro acima. Mover o `const` para uma nova classe (ex.
  `features/narration/php/class-model.php`) e atualizar as 4 referências.
- **Testes:**
  `grep -rln "ALLOWED_LANGUAGES" features/*/tests` retorna **vazio** — nenhum
  teste referencia o símbolo pelo nome; todos usam strings literais
  (`'portuguese'`, `'klingon'`). Nenhum arquivo de teste precisa de edição.
  Os testes que exercitam o caminho por valor, e que continuariam passando
  sem alteração: `test-dictionary-store.php::test_sanitize_drops_an_entry_with_an_unsupported_language`,
  os testes de idioma em `test-dictionary-section.php`, e os testes de
  contagem de idiomas em `test-post-meta.php`.
- **Ordem de carga:** mínima — a nova classe só precisa de um
  `require_once` antes de `class-rest-api.php`, `class-post-meta.php`,
  `class-dictionary-store.php` e `class-dictionary-section.php` a usarem;
  nenhum hook, nenhum `apply_filters`.
- **O que fica pior:** nada de estrutural. É um `rename` de 4 arquivos, sem
  indireção nova, sem superfície pública nova. O único custo é o churn dos 4
  arquivos.

### 3. Mover a utilidade compartilhada para `shared/` (aresta 6 — PHP, satélite → núcleo)

`auth_callback` (`current_user_can( 'edit_post', $post_id )`) não é lógica de
`narration` — é checagem de capability genérica, e já tem dois consumidores
reais: o próprio `Post_Voice_Post_Meta` (`class-post-meta.php:55`, registro do
seu próprio post meta) e `Post_Voice_Dictionary_Store` (aresta 6). A regra que
o spec já aplica a `shared/class-settings-page.php` — "dois consumidores reais
satisfazem a regra" — vale aqui também.

- **Arquivos:** 4 — `features/narration/php/class-post-meta.php` (remove o
  método, atualiza sua própria chamada de registro), novo
  `shared/php/class-*.php` (o método relocado), `features/pronunciation/php/class-dictionary-store.php`
  (atualiza o callable-string), `post-voice.php` (um `require_once` novo,
  posicionado antes de `class-post-meta.php` e de `class-dictionary-store.php`
  — a única ordem de carga genuinamente nova entre os movimentos "de
  relocação", seguindo exatamente o precedente já existente de
  `shared/php/class-settings-page.php`, requerido antes de `pronunciation/`).
- **Testes:** `features/narration/tests/php/test-post-meta.php::test_auth_callback_requires_edit_post_capability`
  (linhas 121-131) teria que se mudar para um novo
  `shared/tests/php/test-*.php` — pelo `@covers` do projeto, deixar o teste
  em `test-post-meta.php` depois do método sair de `Post_Voice_Post_Meta`
  para de compilar (o método não existe mais na classe).
- **O que fica pior:** nada de estrutural — mesma observação da aresta 4/5:
  puro `rename`, sem filtro, sem registro, sem superfície pública nova.

### 4. Extensão registrada no editor (arestas 7, 8 e 9 — TS, núcleo → satélite)

Esta é a aresta mais cara das onze. `index.tsx` é o entry-point do bundle
`narration-editor` — nada mais o importa, nada compõe `index.tsx` de fora, e
`registerPlugin()` do Gutenberg é quem instancia o componente. Isso elimina
"injeção por prop" como opção real: não existe uma raiz de composição acima de
`index.tsx` para injetar a partir dela.

**Sub-opção A — registro dentro do mesmo bundle.**
`features/narration/editor/index.tsx` deixaria de importar `DictionaryPanel`,
`DictionaryEntry`/`mergeDictionaries` e `applyDictionary` diretamente e passaria
a ler de um novo módulo, ex. `features/narration/editor/dictionary-extension.ts`,
que exporta um "slot" preenchível (`registerDictionaryExtension({ Panel,
mergeDictionaries, applyDictionary })`). `pronunciation` chamaria essa função
num módulo próprio no momento de import.

- **Arquivos:** `index.tsx` (troca 4 imports por 1), novo
  `narration/editor/dictionary-extension.ts` (o registro), e um novo arquivo
  em `pronunciation/editor/` que chama `registerDictionaryExtension(...)` —
  mínimo de 3 arquivos.
- **O limite real:** um módulo ES só executa se algo o importar
  transitivamente a partir do entry point do bundle. Como só existe um
  webpack entry (`narration-editor`, `webpack.config.js:7`) cobrindo esse
  código, **algo dentro desse bundle ainda precisa importar o módulo de
  registro de `pronunciation`** — ou seja, `index.tsx` continuaria com um
  `import '../../pronunciation/editor/...'` de efeito colateral. A aresta
  cross-feature **encolhe** (de 4 símbolos nomeados em 3 arquivos para 1
  import de um único módulo de "wiring"), mas não desaparece.

**Sub-opção B — bundle separado, auto-registrado via `@wordpress/hooks`.**
Único jeito de eliminar de fato o import: `pronunciation` ganha seu próprio
entry no `webpack.config.js` (como `dictionary-admin` já é hoje, uma entrada
distinta de `narration-editor`), enfileirado pelo PHP de `pronunciation` com
dependência declarada do handle `post-voice-editor`, e o pacote se
autorregistra via `addFilter`/`applyFilters` de `@wordpress/hooks` — já em uso
dentro de `narration` (`features/narration/editor/block-narration-attributes.ts:4`,
embora só para atributos de bloco, não cross-feature). `index.tsx` chamaria
`applyFilters( 'postVoice.dictionaryPanel', <DefaultPanel /> )` em vez de
importar `DictionaryPanel`.

- **Arquivos:** `webpack.config.js` (novo entry), novo enqueue PHP em
  `pronunciation` (extensão de `class-dictionary-section.php` ou classe nova,
  seguindo o padrão de guarda de `class-assets.php`), `index.tsx` (troca
  import direto por `applyFilters`), `pronunciation/editor/dictionary-panel.tsx`
  (chama `addFilter` na carga do módulo) — 4 arquivos, mais a decisão de nome
  do novo build entry (`class-assets.php`'s próprio comentário já avisa:
  nomes de entry são pinados e mudam junto nos dois lados).
- **Ordem de carga nova, real:** o script de `pronunciation` precisa carregar
  **depois** de `post-voice-editor` (`applyFilters` só resolve algo se o
  `addFilter` já rodou) — resolvido pelo array de dependências do
  `wp_enqueue_script`, que o WordPress já ordena de forma declarativa (mais
  seguro que a ordem de `require_once` do PHP, mas ainda uma peça nova para
  administrar: dois handles, uma dependência entre eles, dois `asset.php`
  gerados pelo build que precisam existir juntos).
- **Testes que exercitam o caminho, para as duas sub-opções:**
  `features/pronunciation/tests/js/dictionary-entry.test.ts` e
  `apply-dictionary.test.ts` testam funções puras e não mudam com nenhuma das
  duas sub-opções. **Não existe teste Jest para `dictionary-panel.tsx`** —
  `find features -iname "*dictionary-panel*"` só retorna o próprio arquivo
  fonte. A única cobertura da renderização real do painel é
  `e2e/narration.spec.ts` ("a dictionary entry changes what is narrated",
  "editing the dictionary marks existing audio as possibly outdated") e
  `e2e/narration-fase2.spec.ts`. Um erro de wiring (registro que não roda a
  tempo, filtro nunca chamado) só aparece nesses ~9 minutos de e2e, nunca num
  `npm run test:unit`.
- **O que fica pior:** a sub-opção A troca 4 imports nomeados por 1 import
  opaco de efeito colateral — quem lê `index.tsx` já não vê mais de onde vem
  `DictionaryPanel`, só que "alguém, em algum lugar, registrou algo". A
  sub-opção B introduz de fato um ponto de extensão (o filtro
  `postVoice.dictionaryPanel`) e um segundo bundle carregado condicionalmente
  — mais uma peça de build, mais um `asset.php` que pode faltar, e a mesma
  classe de risco que `class-assets.php` já comenta hoje sobre os builds
  faltando (404 silencioso). Nenhuma das duas sub-opções é gratuita, e a B é
  o mecanismo mais caro do documento inteiro.

### 5. Deixar como está (arestas 3, 10 e 11 — satélite → núcleo, já correta)

**Aresta 3.** `Post_Voice_Frontend_Render::markup()` é chamado por
`player-style` para renderizar o preview do player nas configurações — um
satélite consumindo uma função do núcleo, exatamente o sentido que a
topologia-alvo pede. "Inverter" essa aresta exigiria `narration` publicar um
filtro que `player-style` chamasse de volta — o que recriaria, ao contrário,
o mesmo anti-padrão das arestas 1/2 (o núcleo precisando saber do satélite
para registrar o callback). Não há ganho nenhum em mexer aqui.

**Arestas 10 e 11.** `SUPPORTED_LANGUAGES` já mora no lugar certo
(`narration/editor/model-source.ts`, ao lado do pin `MODEL_BASE_URL`) e o
sentido do import (`pronunciation` lê `narration`) já é o correto. Mover para
`shared/editor/` — a opção que o brief sugere considerar — foi medida:

```bash
grep -rln "SUPPORTED_LANGUAGES" features/
```

retorna 10 arquivos: 6 dentro de `narration` (`model-source.ts`,
`voice-catalog.ts`, `segment.ts`, `block-narration-attributes.ts`,
`inline-language-format.ts`, `index.tsx`) + 2 testes de `narration`
(`model-source.test.ts`, `voice-catalog.test.ts`) contra só 2 arquivos de
`pronunciation` (as próprias arestas 10 e 11). Mover o símbolo tocaria 8
arquivos de `narration` para "resolver" uma aresta que já está do lado
correto e que não participa de ciclo nenhum uma vez que as arestas 7-9 sejam
tratadas. Custo real, benefício nenhum.

## Recomendação

Das onze arestas, seis (3, 4, 5, 6, 10, 11) já apontam no sentido que
"pronunciation e player-style se pluguem em narration" pede — satélite
dependendo do núcleo. Só cinco (1, 2, 7, 8, 9) têm o núcleo dependendo do
satélite, e são essas que de fato formam os dois ciclos. Nem toda aresta
"errada" custa o mesmo para consertar:

1. **Fazer agora, independente de qualquer decisão sobre ciclo:** mover
   `ALLOWED_LANGUAGES` para um dono próprio dentro de `narration` (arestas 4 e
   5) e mover `auth_callback` para `shared/` (aresta 6). As três são
   relocações, não inversões — nenhum filtro, nenhuma indireção nova, nenhum
   teste quebra, e corrigem uma imprecisão real (`ALLOWED_LANGUAGES` morando
   numa classe de transporte HTTP) que existe com ou sem ADR-0005. Custo: 4 +
   4 arquivos, um dia de trabalho, sem risco.
2. **Não inverter:** aresta 3 (já correta; inverter recriaria o anti-padrão
   ao contrário) e arestas 10/11 (já corretas; mover tocaria 8 arquivos de
   `narration` para zero ganho).
3. **Não inverter agora as arestas 1, 2, 7, 8 e 9** — as únicas que de fato
   formam os ciclos. Todo mecanismo medido para elas tem um custo real: um
   filtro público (1, 2) que ninguém pediu para sustentar como compatibilidade
   externa, ou uma extensão registrada (7-9) cuja versão barata (sub-opção A)
   só encolhe o import sem eliminá-lo e cuja versão completa (sub-opção B)
   exige um segundo bundle webpack + enqueue PHP com ordem de dependência
   nova — o mecanismo mais caro das onze arestas, testável só via e2e porque
   `dictionary-panel.tsx` não tem teste Jest próprio. Nada no projeto hoje
   exige que `narration` rode com `pronunciation`/`player-style` desligados;
   pagar essas indireções agora seria comprar compromisso de compatibilidade
   e complexidade de build por um requisito que não existe. **Se esse
   requisito aparecer**, a ordem certa é: aresta 1 primeiro (reaproveita o
   `init` que `Dictionary_Store::register()` já usa), depois aresta 2 (exige
   inventar `Style_Store::register()` do zero), e as arestas 7-9 por último —
   e só como sub-opção B, porque a sub-opção A entrega decoupling
   parcial por um custo quase igual ao da B.

## O que fica pior

- **Superfície pública nova sem pedido.** `post_voice_editor_dictionary` e
  `post_voice_player_inline_css` (arestas 1 e 2) seriam filtros que qualquer
  plugin ou tema de terceiros pode hookar — um compromisso de compatibilidade
  reversa que hoje não existe e que ninguém pediu. O mesmo vale, ainda mais,
  para o filtro `postVoice.dictionaryPanel` da sub-opção B das arestas 7-9.
- **Falha silenciosa no lugar de falha ruidosa.** Hoje, remover
  `pronunciation/` ou `player-style/` sem atualizar `class-assets.php` é um
  fatal error imediato — óbvio, rastreável, impossível de não notar. Depois de
  um `apply_filters` com default vazio, a mesma remoção faz o dicionário ou o
  CSS desaparecerem sem erro nenhum.
- **Indireção entre o componente e quem o renderiza.** Um registro de
  extensão (arestas 7-9) troca "abra `index.tsx`, veja de onde vem
  `DictionaryPanel`" por "abra `index.tsx`, veja que algo foi registrado em
  algum lugar, procure onde". A sub-opção A troca 4 imports nomeados por 1
  import opaco; a sub-opção B troca o import por um filtro cujo valor
  depende de um segundo script já ter carregado.
- **Ordem de carga que passa a existir onde hoje não existe.** A aresta 2
  (CSS inline) e a aresta 6 (auth callback) exigem uma linha de registro nova
  em `post-voice.php` que hoje não existe — esquecê-la não quebra o build,
  só faz o recurso desaparecer silenciosamente (aresta 2) ou faz o método
  não existir mais onde um teste antigo esperava (aresta 6, capturado em
  tempo de compilação/teste, não em runtime). A sub-opção B das arestas 7-9
  exige coordenar dois handles de script via `wp_enqueue_script`'s `$deps` —
  mais seguro que ordem manual de `require_once`, mas ainda uma peça nova
  para dois `asset.php` gerados pelo build existirem e concordarem.
- **Cobertura de teste que já é fraca no ponto mais caro.** Não existe teste
  Jest para `dictionary-panel.tsx` — só e2e. Qualquer erro de wiring nas
  arestas 7-9 só aparece depois dos ~9 minutos do `npm run test:e2e`, nunca
  num `npm run test:unit` rápido. Isso não é um argumento contra inverter,
  mas é um custo real de detectar erro tarde caso se decida inverter.
