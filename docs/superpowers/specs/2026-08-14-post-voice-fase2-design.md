# Post Voice — Fase 2: idioma por trecho e dicionário de pronúncia

**Data:** 2026-08-14
**Status:** Aprovado para planejamento de implementação
**Fase anterior:** [`2026-08-08-wp-narration-plugin-mvp-design.md`](2026-08-08-wp-narration-plugin-mvp-design.md) — segue sendo a fonte de verdade de tudo que a Fase 1 decidiu. Este documento só acrescenta; onde ele muda algo da Fase 1, diz explicitamente.

## Contexto

A Fase 1 entregou narração de post inteiro num idioma só, gerada no navegador do
autor. Duas limitações apareceram na própria spec dela, listadas como "Fora (fica
pras fases 2/3)":

- selecionar trecho ou bloco para ler em outro idioma;
- dicionário de pronúncia customizada.

Esta fase entrega as duas, mais a seleção manual de blocos para incluir ou
excluir da narração — que a Fase 1 já apontava como Fase 2 na seção "Extração de
texto para narração".

O que **não** muda: a narração continua sendo **um MP3 por post**, gerado
100% no navegador, salvo como attachment pelo mesmo endpoint REST. O player do
leitor não muda em nada nesta fase.

## Decisões fechadas

| Decisão | Escolha | Por quê |
|---|---|---|
| Onde o autor marca o bloco | Inspector do bloco, como block attribute | Estado vive no `post_content`, salvo pelo próprio Gutenberg: sem meta nova, sobrevive a copiar/colar e a revisões. Idiomático do WP: ajuste de bloco fica no inspector |
| Trecho estrangeiro dentro do bloco | Formato de rich text (`registerFormatType`) | Dicionário respella termo, não frase. Texto→toolbar é a outra metade do idioma do WP |
| Escopo do dicionário | Global do site **e** por post | Cobre os dois casos reais: a marca que aparece em todo post e o nome próprio deste post. Entrada do post vence a global |
| Idioma da entrada de dicionário | Uma entrada por idioma | Respelling é fonético, e fonética é do bundle: "Bi Iou Di" lido pelo modelo inglês sai errado |
| Casamento do termo | Palavra inteira, sem distinção de maiúsculas, Unicode-aware | Cobre sigla e nome próprio sem pegar substring por acidente ("US" dentro de "usar"). Regex do autor foi rejeitado — ver "Alternativas rejeitadas" |
| Hash de "desatualizado" | Sobre os segmentos resolvidos (texto pós-dicionário + idioma) | O badge passa a dizer a verdade quando o autor exclui bloco, marca idioma ou corrige o dicionário |
| Voz | Uma só para o post inteiro | Os 5 bundles trazem as mesmas 8 vozes, então o nome sempre existe. Narração soa como um narrador que fala outra língua no trecho, não como troca de locutor |
| Idioma padrão do post | Derivado do locale do WP | Hoje é `'portuguese'` hardcoded — mente em qualquer site não-lusófono. Detecção automática do texto foi rejeitada — ver "Alternativas rejeitadas" |
| Download de bundle adicional | Avisa ao marcar, baixa ao gerar | Marcar um select não deveria custar 199 MB de banda de quem estava só experimentando |
| Síntese multi-idioma | Segmentos agrupados por idioma, concatenados na ordem original | O worker carrega um bundle por vez. Agrupar limita as trocas ao número de idiomas, não ao de segmentos |

## Escopo

**Dentro:**

- Incluir/excluir bloco da narração, pelo inspector do bloco.
- Idioma por bloco, pelo inspector.
- Idioma por trecho dentro do bloco, por formato de rich text.
- Dicionário de pronúncia global do site (`Configurações → Narração`).
- Dicionário de pronúncia por post (painel Narração).
- Síntese multi-idioma num único MP3.
- Idioma padrão derivado do locale do site.

**Fora:**

- Customização visual do player e highlight de palavra (Fase 3, inalterado).
- Voz diferente por idioma ou por trecho.
- Vários áudios por post, ou seletor de idioma no player do leitor.
- Detecção automática de idioma do texto.
- Importar/exportar dicionário, ou dicionário por autor/categoria.

## Tamanho real dos bundles (correção de número, não de decisão)

A Fase 1 registrou "~190MB/idioma" e "~950MB total (5 idiomas × ~190MB)". Ambos
estavam certos, mas a leitura de que 190 MB cobririam todos os idiomas circulou
nesta conversa e precisa ficar registrada contra a fonte. Medido em 14/08/2026
via API do Hugging Face, no commit pinado do mirror (`b18a051`):

| Arquivo | Tamanho |
|---|---|
| `flow_lm_main_int8.onnx` | 76,3 MB |
| `voices.bin` | 52,4 MB |
| `mimi_decoder_int8.onnx` | 22,7 MB |
| `mimi_encoder_int8.onnx` | 20,8 MB |
| `text_conditioner_int8.onnx` | 16,4 MB |
| `flow_lm_flow_int8.onnx` | 10,0 MB |
| `tokenizer.model`, `bundle.json`, `bos_before_voice.npy` | ~0,1 MB |
| **Total por idioma** | **198,6 MB** |

Mirror inteiro: ~993 MB. **Nenhum arquivo é compartilhado entre bundles** — os
hashes divergem nos nove arquivos, inclusive `mimi_encoder`/`mimi_decoder` (o
codec de áudio) e `voices.bin`. As 8 vozes são as mesmas por nome, mas gravadas
por idioma: por isso trocar de voz não baixa nada e trocar de idioma baixa tudo
de novo. Deduplicar exigiria reexportar o modelo — trabalho upstream, fora do
alcance deste plugin.

**Número a usar na UI e nas mensagens: ~199 MB por idioma adicional.** Um post
PT+EN custa ~400 MB de cache no navegador do autor. É por navegador/perfil, não
por post.

## Arquitetura

Duas features, na convenção `features/<nome>/` já estabelecida.

```
features/
├── narration/                      # estendida
│   ├── editor/
│   │   ├── extract-narratable-text.ts    # passa a devolver Segment[]
│   │   ├── block-narration-attributes.ts # atributos + InspectorControls
│   │   ├── inline-language-format.ts     # registerFormatType
│   │   ├── segment-hash.ts               # hash dos segmentos resolvidos
│   │   ├── site-language.ts              # locale do WP → bundle
│   │   └── engine/tts-engine.ts          # ganha generateSegments()
│   └── php/class-rest-api.php            # valida `languages`
└── pronunciation/                  # nova
    ├── php/class-settings-page.php       # Configurações → Narração
    ├── php/class-dictionary-store.php    # sanitização de option e meta
    ├── editor/apply-dictionary.ts        # função pura
    └── editor/dictionary-panel.tsx       # entradas do post
```

Sem `shared/` novo: `pronunciation` expõe uma função pura e `narration` a
importa. Vira `shared/` quando uma terceira feature precisar, não antes.

A fronteira que importa: **quem resolve segmentos não sabe sintetizar, e quem
sintetiza não sabe de blocos.**

- extração: `Block[] → Segment[]`
- dicionário: `Segment[] → Segment[]`
- hash: `Segment[] → string`
- engine: `Segment[] → Float32Array`

Cada etapa é testável isolada em Jest, sem Worker e sem ONNX.

### Segmento

```ts
interface Segment {
	text: string;
	language: string | null; // null = idioma padrão do post
}
```

A string única da Fase 1 vira o caso degenerado: um segmento com `language: null`.

### Extração

`extractSegments` percorre os blocos com as mesmas regras de elegibilidade da
Fase 1 (parágrafo, heading, lista, citação entram; código, embed, galeria,
tabela e HTML customizado ficam fora), mais:

- bloco elegível com `pvNarrate === false` não produz segmento;
- `pvLanguage` define o `language` dos segmentos daquele bloco;
- `<span data-pv-lang="...">` dentro do bloco corta o texto em segmentos
  adicionais.

O parsing passa de regex para `DOMParser`. O regex atual (`stripHtml`) só sabe
apagar tag, e agora é preciso preservar uma. A ordem "tirar tag, depois decodificar
entidade" que a Fase 1 documenta deixa de ser necessária: o `DOMParser` decodifica
entidade ao construir a árvore, e `textContent` nunca devolve markup.

Segmentos vizinhos com o mesmo idioma resolvido são fundidos antes da síntese.
Sem isso, três frases seguidas em inglês viram três sínteses e a prosódia quebra
em cada emenda.

**Valor de idioma desconhecido** — em `pvLanguage` ou em `data-pv-lang` — cai no
idioma padrão do post, com aviso no painel. O atributo vive no `post_content`,
que sobrevive a downgrade de plugin e a edição manual do banco: confiar nele sem
validar contra `SUPPORTED_LANGUAGES` mandaria um bundle inexistente para o
worker.

**Nenhum segmento** (autor excluiu todos os blocos, ou o post só tem blocos
não-narráveis) desabilita o botão de gerar, com a explicação no painel. Sem essa
guarda a geração seguiria para o worker com texto vazio.

**Padrões sincronizados (`core/block`)** ficam fora, como já ficavam na Fase 1: o
conteúdo deles não está na árvore de blocos do post e não vira segmento. Marcar
um bloco dentro de um padrão sincronizado alteraria o padrão em todos os posts
que o usam — não é o que o autor espera de um ajuste feito neste post. Fica como
limitação conhecida, não como bug.

### Idioma padrão do post

`class-assets.php` passa o locale do site mapeado para bundle:

| Locale | Bundle |
|---|---|
| `pt_*` | `portuguese` |
| `en_*` | `english_2026-04` |
| `de_*` | `german` |
| `it_*` | `italian` |
| `es_*` | `spanish` |
| qualquer outro | `english_2026-04` |

É só o valor inicial do select. `_narration_language` continua vencendo quando o
post já tem áudio, exatamente como hoje.

### Dicionário

Mesma forma nos dois escopos:

```php
[ 'term' => 'BYD', 'replacement' => 'Bi Iou Di', 'language' => 'portuguese' ]
```

- **Global:** option `post_voice_dictionary`, capability `manage_options`,
  `register_setting` com `sanitize_callback`. Chega ao editor por
  `wp_localize_script`, junto do resto que já é enfileirado.
- **Por post:** meta `_narration_dictionary`, capability `edit_post`,
  `register_meta` com `auth_callback` e `sanitize_callback`.
- **Precedência:** entrada do post com o mesmo par (termo, idioma) vence a
  global.
- **Tetos, validados no servidor:** 200 entradas por lista, termo ≤ 100
  caracteres, substituição ≤ 200. A lista viaja para o editor de todo mundo que
  abre um post; option sem teto é payload sem fim.

Substituição vazia é rejeitada na validação. Apagar um termo da narração é
função da exclusão de bloco ou da não-marcação, não do dicionário — aceitar
vazio criaria duas maneiras de sumir com texto, e a silenciosa seria a difícil
de depurar.

Aplicação: para cada segmento, usa as entradas cujo idioma é o idioma resolvido
daquele segmento. O dicionário não é aplicado à amostra de voz, que continua
sendo a frase fixa por bundle da Fase 1. Casamento por palavra inteira, sem distinção de maiúsculas,
com fronteira Unicode-aware (letra acentuada conta como letra). Termo de várias
palavras é permitido.

Implementação: uma alternação compilada por idioma (`\b(t1|t2|…)\b`), memoizada
pela identidade da lista — não recompilada por chamada. **Todo termo é escapado
antes de entrar na alternação**: uma entrada contendo `(` derrubaria a geração de
qualquer autor que abrisse o post.

### Pipeline de geração

```
blocos
  → extractSegments
  → applyDictionary (por segmento, no idioma resolvido)
  → hash SHA-256 do JSON dos segmentos resolvidos   → _narration_source_hash
  → agrupa por idioma → engine.generateSegments     → Float32 concatenado
  → MP3 (lamejs, 64 kbps mono — inalterado)         → POST REST
```

`generateSegments` agrupa por idioma, chama `ensureLanguage` uma vez por grupo,
sintetiza todos os segmentos daquele idioma e remonta na ordem original do
documento. Emenda entre segmentos de idiomas diferentes ganha ~120 ms de
silêncio — sem isso a troca soa como corte seco.

A concatenação soma os comprimentos primeiro, aloca **um** `Float32Array` do
tamanho final e escreve cada segmento com `.set(offset)`. Concatenar por spread
dobraria o pico de memória, que num post de 10 minutos já é ~57 MB.

### Hash: um caminho só, sem compatibilidade com a Fase 1

Trocar o que entra no hash invalida todo `_narration_source_hash` já gravado: um
post narrado na Fase 1 passaria a exibir "pode estar desatualizado" para um áudio
que está atualizado.

**Decisão (14/08/2026): aceitar isso, e não construir compatibilidade.** O
plugin não tem base instalada — a distribuição é privada e ninguém além do autor
o executa — e os posts de teste existentes serão apagados antes de validar esta
fase. Preservar o hash antigo no caso sem marcação custaria dois caminhos de
serialização e um teste de valor fixo, para proteger dados que não existem.

Consequência registrada, para não ser reaberta como bug: **qualquer narração
gerada antes desta fase aparece como possivelmente desatualizada.** Se o plugin
ganhar usuários antes desta fase ir para produção, essa decisão precisa ser
reaberta — aí a compatibilidade do caso degenerado volta a valer o custo.

O hash é sempre calculado sobre o JSON dos segmentos resolvidos, com ordem de
campo fixa (`text`, depois `language`) e o idioma já resolvido — nunca `null`.
Serialização instável mudaria o hash sem que o post mudasse.

### Calibração, ETA e cancelamento

A Fase 1 mede o RTF do dispositivo com uma síntese de aquecimento depois de
carregar o bundle, e usa esse número para estimar o tempo total, avisar em
dispositivo lento e pedir confirmação acima do limiar de texto longo. Com dois
bundles isso muda em três pontos:

- **RTF é medido por bundle**, no aquecimento de cada um. Os bundles têm o mesmo
  tamanho e a mesma arquitetura, mas medir é mais barato que supor — o
  aquecimento já acontece de qualquer forma ao carregar.
- **A ETA soma os grupos**: para cada idioma, caracteres daquele grupo × RTF
  medido dele. Enquanto o segundo bundle ainda não carregou, o grupo dele entra
  na ETA com o RTF do primeiro, marcado como estimativa.
- **O download entra na ETA**, não só a síntese. Baixar 199 MB numa conexão
  modesta pode passar do tempo da própria síntese de um post curto, e a Fase 1 já
  estabeleceu que o autor recebe o número antes de decidir.

A confirmação de texto longo e o botão Cancelar continuam iguais; cancelar entre
grupos descarta tudo, pelo mesmo motivo do áudio parcial na tabela de erros.

### Metas e REST

- `_narration_language` — continua sendo o idioma **padrão** do post.
- `_narration_languages` — **nova**, array dos idiomas de fato usados; serve para
  o card de status dizer "Português + Inglês" em vez de mentir "Português".
- `_narration_source_hash` — mesma forma, conteúdo novo (segmentos resolvidos).
- `_narration_dictionary` — **nova**, entradas do post.
- `_narration_voice` e `_narration_attachment_id` — inalteradas.

O endpoint `POST /wp-json/post-voice/v1/posts/{post_id}/narration` ganha o campo
`languages`, string com os códigos separados por vírgula (o corpo é
`multipart/form-data`, onde campo repetido depende de convenção de parser — uma
string é inequívoca). Cada valor é validado contra `ALLOWED_LANGUAGES` no
servidor, e `language` precisa estar contido em `languages`. Rejeição: 400
`post_voice_invalid_language`. A regra da Fase 1 vale igual — controle
desabilitado no painel é UX, não garantia.

`DELETE` e o ciclo de vida do attachment não mudam, exceto por limpar também as
metas novas.

## UI

Mockup navegável das quatro direções avaliadas, com o post de exemplo em
português contendo citação em inglês, bloco excluído e blocos não-narráveis:

- [`assets/2026-08-14-block-marking-options.html`](assets/2026-08-14-block-marking-options.html) — interativo, quatro abas.
- [`assets/2026-08-14-block-marking-option-a.png`](assets/2026-08-14-block-marking-option-a.png) — a opção aprovada, renderizada.
- `assets/2026-08-14-block-marking-option-b.png`, `-c.png`, `-d.png` — as rejeitadas, para o registro da comparação.

**Inspector do bloco** (opção A): seção "Narração" com toggle *Incluir na
narração* e select *Idioma deste trecho*. Cada opção do select rotula o custo
lido da Cache Storage — "Inglês — já baixado" ou "Inglês — +199 MB". Bloco
não-elegível mostra a explicação, sem controle.

**Formato inline:** item na toolbar de texto, "Narrar em outro idioma", com
submenu dos cinco idiomas. Trecho marcado ganha sublinhado pontilhado e o código
do idioma sobrescrito, visível sem precisar selecionar — senão o autor esquece
que marcou. Reaplicar o mesmo idioma remove a marcação.

O formato é registrado só para os tipos de bloco elegíveis (`tagName` restrito
via a lista da Fase 1). Deixá-lo disponível numa legenda de imagem ofereceria uma
marcação que nunca vira áudio — controle que promete e não cumpre.

**Amostra de voz:** continua usando o idioma padrão do post, não os idiomas
marcados. A amostra existe para julgar timbre, e o timbre é da voz, não do
bundle; sintetizar uma amostra por idioma marcado multiplicaria a espera pelo
mesmo julgamento.

**Painel Narração:** o card de status passa a listar os idiomas usados
("Português + Inglês · voz alba"). Ganha a seção *Pronúncia deste post* — tabela
termo / substituição / idioma, com adicionar e remover, mais um link para o
dicionário do site quando o usuário tem `manage_options`.

**Tela `Configurações → Narração`:** `add_options_page`, `manage_options`, tabela
do dicionário global com as mesmas três colunas. É a tela que a Fase 3 herda para
a customização do player — o que aquelas notas exploratórias já previam.

### Por que as outras três direções foram rejeitadas

- **B, lista no painel:** boa visão geral de post longo, mas o estado exigiria
  meta própria indexada por bloco, que dessincroniza quando o autor reordena ou
  apaga bloco — e não tem onde encaixar a marcação inline.
- **C, toolbar do bloco:** alcance curto de mouse, mas ícone sem rótulo é pior em
  descoberta e em leitor de tela, e a barra passaria a disputar espaço com o
  formato inline que já vai viver ali.
- **D, inspector + resumo no painel:** o resumo ajudaria a conferir antes de
  gastar minutos de geração, mas é superfície a mais para construir e manter
  sincronizada, incluindo com os trechos inline. Fica como candidato natural de
  uma fase futura, se a revisão antes de gerar se mostrar necessária na prática.

## Desempenho

Medido em 14/08/2026, num post sintético de 64 KB (120 parágrafos, ~10 mil
palavras — bem acima do post médio), com dicionário de 202 termos e 240
segmentos:

| Etapa | Custo |
|---|---|
| Parse do HTML em segmentos | 15,7 ms (jsdom; `DOMParser` nativo é mais rápido — é teto pessimista) |
| Dicionário, 202 termos × 240 segmentos | 2,4 ms |
| SHA-256 dos segmentos resolvidos | 0,4 ms |
| **Síntese do mesmo texto** | **dezenas de minutos** (RTF 1–3 sobre ~50 min de fala) |

Tudo que esta fase acrescenta soma ~18 ms num post gigante, contra uma síntese
cinco ordens de grandeza maior. A complexidade nova é de código, não de CPU.

Três guardas, todas obrigatórias:

1. **Debounce de ~300 ms no recálculo de hash.** Hoje o efeito de
   `index.tsx` tem `blocks` como dependência, e `blocks` muda a cada tecla — a
   Fase 1 já recomputa extração + SHA-256 por digitação. Esta fase empilha parse
   e dicionário no mesmo caminho, e 18 ms por tecla é perceptível. É dívida
   existente que esta fase paga.
2. **Regex do dicionário compilada uma vez por idioma**, memoizada pela
   identidade da lista.
3. **Concatenação sem cópia intermediária** (`Float32Array` pré-alocado +
   `.set`), para o pico de memória continuar o da Fase 1.

## Tratamento de erro

Vale tudo da Fase 1, mais:

| Cenário | Comportamento |
|---|---|
| Storage insuficiente para os bundles pendentes | Bloqueia antes de baixar, dizendo quantos MB faltam e quais idiomas exigem download. A checagem soma 199 MB × (idiomas ainda não cacheados) |
| Download do 2º bundle falha no meio da geração | Geração aborta limpa, nada persistido, botão de retry. Segmentos já sintetizados são descartados — áudio parcial mentiria sobre o post |
| Bloco ou trecho marcado num idioma que saiu de `SUPPORTED_LANGUAGES` | Segmento cai no idioma padrão do post, com aviso no painel. Nunca falha silencioso |
| Entrada de dicionário inválida (termo vazio, idioma desconhecido, acima do teto) | Rejeitada na sanitização do servidor, com erro no formulário |
| Usuário sem `manage_options` | Não vê a tela global nem o link. Dicionário do post continua disponível com `edit_post` |

## Segurança

- Option e meta sanitizadas no servidor (`register_setting` e `register_meta` com
  callbacks), tetos validados lá também — não só na UI.
- `languages` do REST validado item a item; `language ∈ languages`.
- Nenhum padrão do usuário vira regex. O termo é escapado antes de compor a
  alternação.
- A tela global exige `manage_options`; o dicionário do post, `edit_post` —
  mesma capability que já governa gerar narração.
- A option é por site. Numa rede multisite cada site tem o próprio dicionário,
  sem dicionário de rede — consistente com a Fase 1, que já declarou multisite
  fora de escopo.
- `_narration_dictionary` é post meta comum, fora do sistema de revisões do WP:
  desfazer uma edição do post não desfaz uma edição do dicionário dele. Aceito —
  a lista é curta e visível no painel, e revisionar meta exigiria registrá-la no
  ciclo de revisões só por isso.

**Risco a verificar na implementação, não depois:** `<span data-pv-lang>`
atravessa `wp_kses` quando quem salva não tem `unfiltered_html` (Author,
Contributor). Se o KSES limpar o atributo, a marcação inline some sem avisar. O
conserto, se necessário, é `wp_kses_allowed_html` liberando o atributo nesse
span; a verificação é cenário E2E com papel Author, não teste de admin.

## Qualidade e testes

Gates inalterados: 80% de linha em TS puro (Jest), 85% em PHP (PHPUnit), CI verde
como pré-condição de merge.

**Jest (funções puras):** extração com bloco excluído, com idioma de bloco e com
span inline; fusão de vizinhos do mesmo idioma; dicionário — palavra inteira, sem
case, com acento, termo contendo caractere de regex, precedência post-sobre-global,
filtro por idioma; substituição vazia rejeitada; hash muda quando o dicionário
muda; hash estável entre chamadas para os mesmos segmentos; mapeamento de
locale; idioma desconhecido caindo no padrão do post; nenhum
segmento desabilitando a geração; agrupamento por idioma preservando a ordem de
remontagem; ETA somando grupos com o RTF de cada bundle.

**Teto de performance (Jest):** post sintético de 64 KB, ~240 segmentos,
dicionário de 200 entradas — extração + dicionário + hash abaixo de **50 ms**.
Medido sob jsdom, mais lento que `DOMParser` nativo: o teto é folgado de
propósito para não virar teste instável, mas aperta o suficiente para pegar uma
regressão do tipo recompilar regex por chamada (o caminho inteiro roda hoje em
~18 ms).

**PHPUnit:** sanitização de option e de meta, tetos, validação de `languages` no
REST, `language ∈ languages`, capability da tela global, e as metas novas
sobrevivendo ao ciclo de vida do attachment que a Fase 1 já cobre.

**E2E (Playwright):** bloco excluído não aparece no áudio; post PT+EN gera um MP3
só, com dois bundles; entrada de dicionário muda a pronúncia; editar o dicionário
vira o badge para "pode estar desatualizado"; storage insuficiente para o segundo
bundle bloqueia com a mensagem certa; marcação inline sobrevive ao salvar como
Author.

**i18n:** toda string nova por `__()`/`_x()` com text domain `post-voice`, `.pot`
regenerado, `npm run i18n:check` no CI. A exceção deliberada continua sendo
`SAMPLE_TEXTS` em `voice-catalog.ts`. O conteúdo do dicionário é dado do usuário,
não string traduzível.

## Alternativas rejeitadas

- **Detecção automática do idioma do texto.** `LanguageDetector` da Prompt API é
  Chromium-only — mesmo motivo pelo qual a Fase 1 rejeitou `deviceMemory` como
  gate. Uma lib como `franc` seria dependência de produção nova (hoje só
  `lamejs`, com gate de audit de produção em 0 crítica / 0 alta), erra em texto
  curto e erraria justamente no post multi-idioma que esta fase existe para
  atender. Detectar errado e narrar quatro minutos com o modelo errado é pior que
  perguntar.
- **Regex do autor no dicionário.** Padrão mal escrito trava a geração no
  navegador (catastrophic backtracking), e o valor vem de option/meta — seria
  entrada não-confiável executada no editor de quem abrir o post.
- **Trocar de bundle a cada segmento, na ordem do documento.** Código mais
  simples; um post que alterna PT/EN dez vezes recarregaria o modelo dez vezes.
- **Um áudio por idioma, vários attachments.** Contradiz "1 áudio por post" da
  Fase 1 e obrigaria o player do leitor a virar seletor de faixa.
- **Voz própria por idioma ou por trecho.** Trocaria de locutor no meio do
  parágrafo e multiplicaria controles no painel, sem resolver o problema que
  motivou a fase.
- **Teto de dois idiomas por post.** Limitaria download e RAM no pior caso, mas
  bloquearia o post que legitimamente cita três línguas. A checagem de storage já
  cobre o risco real.

## Critérios de aceite

- Autor exclui um bloco pelo inspector e o áudio gerado não contém aquele texto.
- Autor marca um bloco em outro idioma, gera, e o MP3 único contém os dois
  idiomas na ordem do documento, com a mesma voz.
- Autor marca um trecho dentro de um parágrafo por formato de rich text, e só
  aquele trecho troca de idioma.
- Entrada de dicionário do post muda a pronúncia; entrada global vale em todos os
  posts; a do post vence a global no mesmo par (termo, idioma).
- Editar o dicionário deixa o áudio existente marcado como "pode estar
  desatualizado".
- Marcar um idioma ainda não baixado avisa o custo (~199 MB) antes da geração;
  storage insuficiente bloqueia antes do download.
- Site com locale não-lusófono abre o painel no idioma do próprio locale.
- Extração + dicionário + hash de um post de 64 KB ficam abaixo de 50 ms no teste
  de teto.
- CI verde (lint, unit, e2e, i18n, audit), gates de cobertura inalterados.

## Não-metas explícitas

- Não gera timestamps nem highlight (continua Fase 3).
- Não expõe customização visual do player (continua Fase 3), embora crie a tela
  onde ela vai morar.
- Não permite voz diferente por idioma ou por trecho.
- Não detecta idioma automaticamente.
- Não importa nem exporta dicionário.
- Não muda o player do leitor, o formato do áudio nem o contrato de attachment.
