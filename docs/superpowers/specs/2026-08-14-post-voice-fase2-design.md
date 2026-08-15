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

---

## Emenda de 2026-08-15 — o que a execução descobriu

Esta seção fecha a Fase 2. Ela registra tudo que a execução das 18 tarefas
descobriu e que **contradiz, refina ou confirma** o que está decidido acima. A
regra do projeto é que código e spec não podem divergir em silêncio: onde a
execução mudou uma decisão, a mudança está aqui, com o motivo.

### 1. Confirmações — decisões que a execução validou

**O filtro `wp_kses_allowed_html` não era necessário, e não existe.** O plano
previa um filtro para preservar `data-pv-lang` no `post_content` de quem não tem
`unfiltered_html`. Ele foi deliberadamente não implementado: `data-*` é atributo
global permitido pelo kses desde o WP 5.0
(`wp-includes/kses.php`, `_wp_add_global_attributes()`, `'data-*' => true`, e o
casamento por curinga em `wp_kses_attr_check()`, chamada por `wp_kses_attr()`).
Adicionar o filtro seria ampliar a superfície de HTML aceito sem necessidade —
o oposto do que a seção de segurança desta spec pede.

Isso não ficou no raciocínio: o cenário E2E "an inline marked run survives a save
as Author" publica como um Author de verdade (papel sem `unfiltered_html`) e
**relê o post pela REST com `context=edit`**, afirmando sobre
`saved.content.raw`. A primeira versão desse cenário afirmava sobre
`getEditedPostContent()` — os blocos serializados pelo próprio cliente — e por
isso não podia falhar por kses nenhum: parecia cobertura e não afirmava nada
sobre o servidor. A versão corrigida falha de verdade se o atributo for retirado.

**O teto de desempenho vale, com uma ressalva sobre o que ele mede.** O critério
de aceite "extração + dicionário + hash de um post de 64 KB abaixo de 50 ms"
passa. Medido em ~36 ms na máquina de desenvolvimento — não os ~18 ms que o plano
previu — e a divisão importa: `extractSegments` ~31 ms, merge ~0,2 ms,
`applyDictionary` com 200 termos ~1,7 ms, `computeSegmentHash` ~3 ms. Quase todo
o orçamento é o `DOMParser` do jsdom, muito mais lento que o parser do navegador
que o editor realmente usa. Ou seja: o teto continua protegendo o que deveria
proteger (recompilar o regex de 200 termos a cada chamada), mas a folga real num
runner carregado é menor do que o número 50 sugere, e uma falha desse teste deve
ser lida primeiro como carga de runner e só depois como regressão.

**Atualização, mais tarde no mesmo dia — o teste moveu para o E2E, e o teto virou
dois números.** O parágrafo acima identificou o problema mas não o resolveu: um
teste cuja folga real (1,4×) é estreita o bastante para "piscar" num runner
carregado não é um teto confiável, é uma fonte de alarme falso esperando a
oportunidade certa. A decisão foi mover a medição para onde o `DOMParser` é o
mesmo que o editor usa de verdade — um navegador real — em vez de continuar
compensando o ambiente de teste com margem.

`features/narration/tests/js/segment-pipeline-perf.test.ts` foi apagado.
`e2e/segment-pipeline-perf.spec.ts` o substitui: mesmo pipeline
(`extractSegments` → dicionário → `resolveSegments`/`mergeAdjacent` →
`computeSegmentHash`), mesmo fixture de 64 KB, agora compilado pelo mesmo
bundler de produção (`webpack.config.js`, entry `segment-pipeline-harness`) e
executado num Chromium real via Playwright. O pipeline é texto puro — nunca
toca ONNX, worker ou o host do modelo — então o cenário carrega só uma página
front-end qualquer, sem editor e sem download; `e2e/mu-plugins/segment-pipeline-harness.php`
expõe o pipeline em `window`, mapeado no wp-env só por `.wp-env.json`, do mesmo
jeito que `coop-coep-headers.php` — nenhum `require` de `post-voice.php` carrega
esse arquivo, então uma instalação de produção nunca o enfileira.

Medido em 10 sessões de 30 execuções cada (300 amostras) na máquina de
desenvolvimento: mínimo 1,24 ms, mediana 1,92 ms, p90 3,64 ms, p95 5,2 ms, p99
7,41 ms, máximo 13,13 ms. Contra os ~36 ms do jsdom, isso é grosseiramente
19× mais rápido — confirma o diagnóstico: **o parâmetro de 50 ms nunca esteve
errado, a medição estava.** Uma sessão de exemplo (ordenada):

```
min=1.50ms median=2.42ms mean=2.63ms max=9.39ms
samples=[1.50, 1.50, 1.61, 1.63, 1.65, 1.76, 1.77, 1.82, 1.83, 1.90, 1.94, 1.97,
2.38, 2.40, 2.40, 2.42, 2.45, 2.48, 2.48, 2.48, 2.50, 2.53, 2.63, 2.65, 2.69,
2.91, 3.25, 4.75, 5.20, 9.39]
```

E outra, a que teve o pico mais alto observado nas 10 sessões:

```
min=1.52ms median=1.91ms mean=2.45ms max=13.13ms
samples=[1.52, 1.53, 1.54, 1.55, 1.58, 1.58, 1.61, 1.62, 1.66, 1.67, 1.68, 1.84,
1.87, 1.87, 1.88, 1.91, 1.93, 1.95, 1.96, 1.99, 2.03, 2.03, 2.11, 2.20, 2.33,
2.34, 3.29, 3.59, 5.67, 13.13]
```

Vinte e oito das trinta amostras de qualquer sessão típica ficam abaixo de 3 ms;
os poucos picos de 5-13 ms lêem como ruído de GC/scheduling do processo do
Chromium, não como o pipeline — eles não se repetem na mesma posição entre
sessões, e não há nada no código sob medição (sem alocação incomum, sem I/O)
que explicaria uma cauda tão distante da mediana.

Isso deixou uma escolha: recalibrar os 50 ms para um número mais apertado que
descreva a mediana, ou manter os 50 ms. Nenhum dos dois sozinhos estava certo.
Um teto único apertado (por exemplo 15 ms) trataria o ruído de GC como parte do
orçamento e voltaria a arriscar alarme falso num runner carregado — exatamente
o defeito que motivou a mudança. Um teto único frouxo (manter 50 ms sozinho)
perde poder de detecção: uma regressão de 3× (mediana indo de ~2 ms para ~6 ms)
passaria sem ser notada, porque 6 ms ainda está bem abaixo de 50.

A decisão foi afirmar os dois, cada um com um papel:

- **`MEDIAN_CEILING_MS = 5`** — a rede de regressão de verdade. A mediana é
  robusta à cauda ocasional de GC, então dispara a partir de uma regressão real
  de ~2,7× (mediana ~1,9 ms → 5 ms), que é o tipo de coisa que recompilar o
  regex de 200 termos a cada chamada produziria.
- **`SAMPLE_CEILING_MS = 50`** — o número original desta spec, mantido como teto
  absoluto sobre cada amostra individual. Existe para capturar uma regressão
  catastrófica que uma mediana suavizaria (por exemplo, um pipeline que
  ocasionalmente trava por dezenas de milissegundos mas cuja mediana continua
  baixa), não para descrever a velocidade em regime normal.

Nada foi descartado: o 50 ms da spec original continua significando o que
sempre significou (um teto absoluto), e ganhou companhia em vez de ser
substituído por um número ajustado à medição. O comentário no próprio teste
(`e2e/segment-pipeline-perf.spec.ts`) e `TESTING.md` registram os dois números
e o motivo de cada um.

### 2. Contradições — decisões que a execução teve de mudar

**`_narration_languages` sempre inclui o idioma principal.** A spec descreve
`language` como o idioma padrão do post e `languages` como os idiomas falados. O
servidor foi implementado exigindo `language ∈ languages`, e isso criou um estado
impossível de satisfazer: um post em que **todo** bloco está explicitamente
marcado em outro idioma nunca fala o idioma padrão, então a lista de grupos não o
contém. O sintoma era o pior possível — a síntese terminava depois de vários
minutos e só então o save devolvia 400, sem recuperação a não ser trocar o
seletor e gerar tudo de novo.

Decisão do parceiro humano: **o cliente sempre inclui o principal em
`languages`** (união do idioma do seletor com os idiomas dos grupos). A checagem
do servidor permanece, porque é ela que impede um `languages` arbitrário vindo de
fora. O significado de `_narration_languages` muda de "os idiomas falados" para
**"o idioma principal do post mais todo idioma efetivamente falado"**. É essa a
definição que vale.

**Casamento do dicionário é case-insensitive, e o teste é que estava errado.** O
plano trazia dois testes que se contradiziam quanto a maiúsculas/minúsculas. A
spec já dizia case-insensitive; o parceiro humano decidiu que a spec governa e o
teste do plano foi reescrito. Nada mudou na spec — o registro existe porque a
divergência custou uma rodada de correção e porque a regra ("spec governa,
teste se corrige") é a que vale nas próximas fases.

**Warm-up por idioma não é cancelável.** O plano prometia, em comentário próprio,
que o cancelamento evitava uma espera de vários segundos. `calibrate()` não
recebe `AbortSignal`, então a calibração em voo termina mesmo depois do cancelar.
Decisão do parceiro humano: **documentar por teste em vez de corrigir**, porque
enfiar um sinal por `calibrate()` mexeria em código de engine da Fase 1 que a
Fase 2 não deveria tocar. O pior caso é ~2 s de espera após o cancelamento, sem
corrupção de áudio; o cenário E2E "cancelling during a language warm-up leaves
the editor recoverable" afirma exatamente esse comportamento — o observado, não o
prometido.

### 3. Refinamentos — o que a execução acrescentou ao desenho

**Escrever meta pela rota REST do plugin não avisa o editor.** Este foi o defeito
de produto mais caro da fase, e ele só apareceu no E2E. `confirmSave` gravava as
metas pela rota do plugin e nunca informava o data store do editor, então
`getEditedPostAttribute('meta')` continuava devolvendo os valores do carregamento
da página pelo resto da sessão. Duas consequências visíveis: o efeito de
"desatualizado" curto-circuita num `savedHash` falsy, então o selo nunca mais
podia voltar a acender; e o cartão de status renderizava rótulo de idioma vazio.
Três cenários E2E falhavam por essa única causa. A correção é
`receiveEntityRecords` para o registro persistido (que também "desuja" o post),
com um `editPost` condicional apenas quando já existe edição de meta pendente —
sem ele, o `mergedEdits: { meta: true }` deixaria um termo de dicionário
meio-digitado sombrear os valores recém-recebidos.

O desenho implícito da Fase 1 — "o endpoint grava, o painel já sabe" — não vale
para nada que o painel releia do post. Qualquer fase futura que escreva meta por
fora do `core` data store precisa devolver o resultado ao store.

**Nomes acessíveis são contrato, e um nome duplicado quebra tudo de uma vez.** O
painel por bloco do inspector nasceu com o título "Narration", o mesmo nome
acessível do toggle da barra lateral do plugin. Duas coisas com o mesmo nome é um
defeito de acessibilidade antes de ser um problema de teste — um leitor de tela
anuncia as duas identicamente. O painel do bloco agora se chama **"Narration for
this block"**, espelhando "Pronunciation for this post"; o toggle da barra lateral
mantém "Narration". O helper de E2E localiza a barra lateral por `aria-controls`,
não por nome, e continua assim de propósito.

**O `.pot` cobre `features/pronunciation`.** As listas `--include` de
`package.json` e `scripts/check-pot.sh` nasceram sem essa pasta, então strings
novas eram extraídas para lugar nenhum enquanto `i18n:check` continuava
reportando "current" — um gate verde que não checava nada. Corrigido durante a
Tarefa 4. Vale como regra: **toda pasta `features/<x>/php` nova entra nas duas
listas no mesmo commit em que nasce**, e o mesmo para cada bundle novo em
`build/`.

**`phpunit.xml.dist` precisa de um `<directory>` por feature.** `features/pronunciation/tests/php` não era descoberto por ninguém; a suíte passava sem
rodar aqueles testes. Mesma regra: feature nova, entrada nova.

### 4. Processo — a lição que custou mais commits

A suíte E2E inteira da Fase 1 ficou vermelha por **cinco commits** (14 de 14
cenários, cada um falhando em menos de 2 s) porque a Tarefa 12 duplicou o nome
acessível e nada entre a Tarefa 12 e a 17 rodou a suíte inteira — só `--grep`
apontados para o cenário da vez.

O ponto cego tem causa concreta: `narration-a11y.spec.ts` limita o axe a
`.post-voice-panel`, então um nome duplicado **entre** o painel e o inspector do
bloco cai fora do escopo verificado. O gate de acessibilidade existia e estava
verde durante toda a regressão de acessibilidade.

Regra que passa a valer: **toda tarefa que toca o navegador roda a suíte E2E
completa antes de ser dada por pronta**, nunca um `--grep`. Está registrada em
`TESTING.md`, na seção de sintomas.

### 5. Dívida deliberada que atravessa a fase

- **`LANGUAGE_LABELS` não passa por `__()`.** Lacuna de i18n herdada da Fase 1,
  preservada de propósito nesta fase para não misturar a correção com o trabalho
  de idioma por trecho. Candidata a follow-up.
- **Falha de download no meio da geração** continua coberta pelo caminho de abort
  existente, sem cenário dedicado: falhar uma requisição de 199 MB não é
  reproduzível em CI sem stubbar o host do modelo, e as regras de teste desta
  spec proíbem mockar essa camada.
- **`(string) $request->get_param(...)` em `class-rest-api.php`** emite aviso de
  "Array to string conversion" se o parâmetro chegar como `languages[]=`. A
  requisição ainda para em 400. Pré-existente à fase, e o mesmo padrão vale para
  `language`, `voice` e `source_hash`.

### 6. Revisão final da branch — as costuras entre Fase 1 e Fase 2

A revisão de branch inteira não achou defeito crítico nem falha de segurança,
mas achou seis pontos importantes, e todos são a mesma espécie de problema: um
caminho da Fase 1 e um caminho da Fase 2 assumindo coisas diferentes sobre o
mesmo valor. O que cada um mudou está abaixo; os que não mexem em nada que esta
spec descreve estão registrados só no relatório da execução.

**A checagem de storage e o download passam a contar o mesmo conjunto.** O
`startGeneration` calculava os bundles pendentes a partir de
`groupByLanguage( segments )` — os idiomas realmente falados — e logo em seguida
chamava `ensureEngine()`, que carregava incondicionalmente o idioma do seletor
do painel. Num post em que **todo** bloco carrega `pvLanguage` explícito, o
idioma do seletor não está em grupo nenhum: ele nunca é ouvido no áudio, nunca
foi contado pela checagem, e mesmo assim era o primeiro a ser baixado. Com 250 MB
livres, um post inteiramente marcado em inglês e o inglês já cacheado, a
checagem não rodava (`pending === 0`) e o plugin ia buscar 199 MB de português
que não entram no áudio — podendo esgotar o disco no meio do download.

Havia duas correções possíveis: contar também o idioma do seletor (existe o
helper `withPrimaryLanguage()` para exatamente essa união), ou parar de carregar
um bundle que ninguém vai usar. **A decisão foi a segunda.** Contar a união
tornaria a checagem honesta sobre um download de 199 MB que continua sendo puro
desperdício — legitimaria o desperdício em vez de removê-lo — e ainda contradiria
a linha da tabela de tratamento de erro acima, que soma "199 MB × (idiomas ainda
não cacheados)" no sentido de idiomas *que a narração precisa*. Carregando
`groups[0].language`, o conjunto baixado passa a ser exatamente o conjunto
contado, e a linha da tabela volta a descrever o código sem precisar mudar de
texto.

`groups[0]` e não outro qualquer porque `generateSegments` percorre os grupos em
ordem e chama `ensureLanguage` em cada um: o primeiro grupo é o bundle que ele
carregaria primeiro de qualquer jeito, então o warm-up mede o bundle certo e
nenhuma troca extra de sessão ONNX é paga. `ensureEngine` ganhou um parâmetro
com default no idioma do seletor, que é o que o botão de amostra de voz quer.

Consequência que não é óbvia: o cache de amostras do painel é indexado por
`idioma:voz`, e o áudio do warm-up é guardado nele. Como o warm-up pode agora
falar um idioma diferente do seletor, `cacheSample` recebe explicitamente o
idioma que falou — sem isso, o botão de amostra passaria a tocar a frase do
idioma errado.

**Nada muda em `_narration_languages`.** A união com o idioma principal decidida
na seção 2 desta emenda continua valendo: ela é sobre o que a meta registra e o
que o servidor exige, não sobre o que o navegador baixa. Um post inteiramente
marcado em inglês continua sendo salvo com o principal na lista, e agora sem
baixar o bundle dele.
