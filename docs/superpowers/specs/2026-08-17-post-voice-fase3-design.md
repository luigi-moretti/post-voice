# Post Voice — Fase 3: customização visual do player

**Data:** 2026-08-17
**Status:** Aprovado para planejamento de implementação
**Fases anteriores:** [`2026-08-08-wp-narration-plugin-mvp-design.md`](2026-08-08-wp-narration-plugin-mvp-design.md) (Fase 1) e [`2026-08-14-post-voice-fase2-design.md`](2026-08-14-post-voice-fase2-design.md) (Fase 2) seguem sendo fonte de verdade do que decidiram. Este documento só acrescenta; onde muda algo delas, diz explicitamente.
**Pré-trabalho:** [`2026-08-09-phase3-player-settings-notes.md`](2026-08-09-phase3-player-settings-notes.md) — notas exploratórias de UI escritas enquanto a Fase 1 estava em revisão. Este spec confirma o que aquelas notas decidiram (página própria em `Configurações → Narração`, preview no topo) e fecha os três pontos que elas deixaram em aberto: lista de campos, implementação do preview e origem dos valores padrão.

## Contexto

O roadmap da Fase 1 listava duas capacidades para a Fase 3: customização visual
do player e highlight de palavra sincronizado com auto-scroll. **Esta fase
entrega só a primeira.**

O highlight sai do escopo por dois motivos concretos. Ele depende de timestamps
por palavra que o pipeline de geração atual não produz, e a própria Fase 1 já o
marcava como "requer investigação própria de alinhamento de timestamp" — uma
incógnita técnica que, no mesmo spec, travaria também a parte sem incógnita. E é
subsistema independente: não compartilha armazenamento, tela nem código com o
estilo do player. Vira fase futura, com spec próprio, provavelmente precedida de
um spike sobre o que o Pocket TTS expõe.

O que **não** muda nesta fase: a narração continua sendo um MP3 por post, gerado
100% no navegador. Nada no pipeline de geração, no painel do editor ou no REST é
tocado.

## Decisões fechadas

| Decisão | Escolha | Por quê |
|---|---|---|
| Escopo da fase | Só customização do player | Highlight tem incógnita de timestamp e é subsistema separado; juntar os dois deixaria a parte pronta refém da parte incerta |
| Campos expostos | Fundo, destaque, texto, raio da borda | Cobre o caso real ("fazer o player parecer do site") com quatro valores; posição e tipografia ficam de fora por YAGNI |
| Valores padrão | Fixos, iguais aos de hoje | Determinístico: nenhum site muda de aparência ao atualizar o plugin. Herdar do `theme.json` amarraria o padrão ao suporte do tema ativo |
| Entrega do CSS | `wp_add_inline_style` no handle do player | Sem escrita em disco, sem request extra, e nada é impresso em página sem player |
| Preview | Player real, sem áudio | Mesmo markup e mesmo CSS do frontend: fiel por construção, sem asset de áudio novo |
| Campo de cor | `<input type="color">` + campo hex sincronizados | Colar o hex da marca é o caso real; o seletor do SO não cobre isso de forma previsível. Sem depender de jQuery, que o `wp-color-picker` traria |
| Contraste insuficiente | Avisa, não bloqueia, com limiar por tipo de elemento | Postura do core no Customizer. Limiar único de 4.5:1 acusaria como ruim combinação de botão que a WCAG aprova |
| Raio | Preset de três valores | Cobre pílula / cartão / quadrado, é trivial de validar e o preview mostra cada um sem ambiguidade |
| Casa da settings page | `shared/php/` | Segunda feature passa a depender dela — é o gatilho que o `CLAUDE.md` define para `shared/` |

## Escopo

**Dentro:**

- Opção `post_voice_player_style` com quatro campos, sanitizada no servidor.
- Seção "Player" em `Configurações → Narração`, com preview ao vivo e aviso de
  contraste.
- Emissão do CSS no frontend só quando há diferença em relação ao padrão.
- Mudança de `class-settings-page.php` para `shared/php/`, com as seções passando
  a ser registradas por cada feature.
- As entradas de configuração que uma feature nova e um diretório novo exigem
  (build, testes, cobertura, i18n, análise estática) — inventariadas abaixo.

**Fora, explicitamente:**

- Highlight de palavra sincronizado e auto-scroll (fase futura, spec próprio).
- Posição do player (continua fixa: pílula flutuante inferior, centrada).
- Tipografia (o player segue herdando `font: inherit` do tema).
- Preview com áudio tocável.
- Herança de cores do tema ativo ou do esquema do wp-admin.
- Estilo por post, por autor ou por categoria — a customização é do site inteiro.
- Limpeza da opção na desinstalação. O plugin não tem `uninstall.php` hoje e o
  dicionário da Fase 2 também persiste; criar essa política é decisão própria,
  não efeito colateral desta fase.

## Arquitetura

### Feature nova

```
features/player-style/
  php/class-style-store.php      # OPTION, DEFAULTS, sanitize(), get(), inline_css(), css_declarations()
  php/class-style-section.php    # seção, campos, register_setting, enqueue dos assets da tela
  admin/index.ts                 # entry: importa style.scss, liga preview e sincronia dos campos
  admin/preview.ts               # aplica custom properties no wrapper, escreve o aviso
  admin/contrast.ts              # função pura: hex → luminância → razão
  admin/hex-field.ts             # função pura: normaliza/valida hex do campo de texto
  admin/style.scss               # só o que o preview precisa; nada disso vai pro frontend
  tests/php/test-style-store.php
  tests/js/contrast.test.ts
  tests/js/hex-field.test.ts
```

Feature própria porque customização do player é capacidade própria — o spec do
MVP já a lista entre as features previstas ("estilo do player"), ao lado de
narração e pronúncia.

A divisão entre `preview.ts` (toca DOM) e `contrast.ts` / `hex-field.ts` (puras)
é deliberada e segue o precedente do repositório: `collectCoverageFrom` no
`jest.config.js` é uma lista explícita que inclui módulos puros e omite scripts
de admin que só fazem DOM (`features/pronunciation/admin/settings.ts` não está
lá). As duas funções puras entram na lista; `index.ts` e `preview.ts` ficam de
fora dela e são cobertos por E2E.

### A settings page vira compartilhada

Hoje `Post_Voice_Settings_Page` mora em `features/pronunciation/php/`, onde a
Fase 2 a criou. Com a Fase 3 uma segunda feature depende dela — exatamente o
gatilho registrado no `CLAUDE.md` ("shared code moves to `shared/` only when a
second feature actually needs it").

Nova casa:

```
shared/php/class-settings-page.php
shared/tests/php/test-settings-page.php     # movido de features/pronunciation/tests/php/
```

A classe vira casca e passa a conter **apenas**:

- `MENU_SLUG` e `OPTION_GROUP`, o segundo promovido de `private` para `public`
  porque as seções agora registram contra ele;
- `add_page()` (inalterado);
- `render()`: guarda de `manage_options`, `<h1>`, `<form method="post"
  action="options.php">`, `settings_fields( self::OPTION_GROUP )`,
  `do_settings_sections( self::MENU_SLUG )`, `submit_button()`;
- `is_current_screen( string $hook_suffix ): bool`, que encapsula a comparação
  com `settings_page_post-voice` para as seções não copiarem a condição.

Nenhum campo, nenhum `register_setting`, nenhum `wp_enqueue_script` é dela.

Cada feature ganha uma classe de seção que engancha `admin_init` (para
`register_setting` + `add_settings_section` + `add_settings_field`) e
`admin_enqueue_scripts` (saindo cedo por `is_current_screen()`):

- `features/pronunciation/php/class-dictionary-section.php` — recebe a tabela
  que hoje está inline no `render()` e o `enqueue()` do `dictionary-admin`;
- `features/player-style/php/class-style-section.php` — a seção do player.

Um `<form>`, um botão Salvar, as duas opções gravadas na mesma submissão — que é
como o WordPress faz uma página de settings com várias seções. Ordem na tela:
dicionário primeiro (é o que já existe), player depois.

Rejeitada a alternativa de manter a página em `features/pronunciation` e o
player-style pendurar campos nela: inverteria a direção da dependência por
acidente de histórico e deixaria a feature de pronúncia dona de UI que não é
dela.

### Armazenamento

Opção única, registrada pela seção do player no mesmo grupo:

```php
class Post_Voice_Style_Store {
    public const OPTION = 'post_voice_player_style';

    public const DEFAULTS = array(
        'surface' => '#1e1e1e',  // fundo da pílula
        'accent'  => '#2b62f0',  // play, progresso, thumb
        'text'    => '#ffffff',  // ícones, rótulos, anel de foco
        'radius'  => 'pill',     // pill | rounded | square
    );

    public const RADII = array(
        'pill'    => '999px',
        'rounded' => '12px',
        'square'  => '0',
    );
}
```

Uma opção em vez de quatro: os quatro valores são lidos e escritos sempre
juntos, e uma linha só de `wp_options` é um `get_option` por request.

`sanitize( mixed $value ): array` segue a política do
`Post_Voice_Dictionary_Store` — descartar o inválido, nunca recusar a submissão
inteira:

- entrada que não é array vira `DEFAULTS`;
- cada cor passa por `sanitize_hex_color()` do core, que aceita `#abc` e
  `#aabbcc`, devolve `''` para string vazia e não devolve nada (`null`) para o
  resto. Qualquer resultado que não seja um hex válido cai no default **daquele
  campo** — um campo ruim não derruba os outros três;
- forma curta é preservada como veio (`#abc` fica `#abc`): o CSS trata as duas
  igual e normalizar seria mudar o que o autor digitou sem motivo;
- `radius` fora das chaves de `RADII` cai em `pill`;
- chave desconhecida no array é ignorada; chave ausente vira o default.

O retorno tem sempre as quatro chaves, então nenhum consumidor trata campo
faltando. `get(): array` chama `sanitize( get_option( self::OPTION, array() ) )`
— sanitizar na leitura também cobre uma linha escrita direto no banco, mesmo
motivo do dicionário.

### Do banco até a página do leitor

`style.scss` do player troca as variáveis Sass por custom properties com
fallback:

```scss
background: var( --pv-surface, #1e1e1e );
```

Quatro propriedades, todas declaradas no seletor `.post-voice-player`:

| Propriedade | Fallback | Onde aparece |
|---|---|---|
| `--pv-surface` | `#1e1e1e` | fundo da pílula; base dos dois tons derivados |
| `--pv-accent` | `#2b62f0` | fundo do botão play, progresso e thumb da barra |
| `--pv-text` | `#fff` | cor herdada por ícones e rótulos, anel de `:focus-visible` |
| `--pv-radius` | `999px` | `border-radius` **da pílula, e só dela** |

O fallback dentro do `var()` é o que garante que um site sem opção salva
renderize exatamente como hoje: o CSS continua correto sozinho, sem depender de
nada que o PHP emita.

`--pv-radius` não toca em botão nenhum. Play e fechar continuam `border-radius:
50%` e o botão de velocidade continua `999px` — são círculos e pílula por
função, não por decoração, e arredondamento zero neles produziria quadrados
dentro de um cartão. O preset muda só o contorno externo do player.

`Post_Voice_Style_Store::inline_css(): string` devolve
`.post-voice-player{--pv-accent:#c00000}` — bloco com **só as propriedades que
diferem de `DEFAULTS`** — e string vazia quando nada difere.
`Post_Voice_Assets::enqueue_frontend_assets()` chama
`wp_add_inline_style( 'post-voice-player', $css )` apenas quando a string não é
vazia, depois do `wp_enqueue_style` que já existe. Site que nunca customizou não
recebe um byte novo, e a tag `<style id="post-voice-player-inline-css">` do core
sequer é impressa.

`css_declarations(): string` é o mesmo conteúdo sem o seletor
(`--pv-accent:#c00000`), para o atributo `style` do wrapper do preview. As duas
funções compartilham a mesma montagem, então frontend e preview não podem
divergir.

### Os dois tons derivados

Hover (`#333`) e trilha da barra (`#4a4a4a`) não viram campo: são decisões que o
autor não quer tomar e quebrariam se ele escolhesse fundo claro. Derivam do
fundo em CSS puro, com declaração dupla:

```scss
// trilha da barra de progresso
background: #4a4a4a;
background: color-mix( in srgb, var( --pv-surface, #1e1e1e ) 80%, var( --pv-text, #fff ) );

// hover de botão
background: #333;
background: color-mix( in srgb, var( --pv-surface, #1e1e1e ) 91%, var( --pv-text, #fff ) );
```

Navegador sem `color-mix` descarta a segunda declaração e fica com a de hoje.

As porcentagens saem dos valores atuais: `#1e1e1e` (30) para `#4a4a4a` (74) é
19,6% do caminho até `#fff`, e para `#333` (51) é 9,3%. Arredondadas para 20% e
9%, o resultado no padrão é `#4b4b4b` e `#323232` — um valor de diferença por
canal, imperceptível e deliberado: a alternativa seria carregar
`color-mix(... 80.4%)`, precisão falsa para uma cor derivada.

Escolhido CSS em vez de calcular o mix no PHP porque o preview precisa do mesmo
resultado ao vivo: no PHP, a matemática teria de ser reimplementada em TS e as
duas cópias divergiriam na primeira mudança.

Alternativas de entrega rejeitadas:

- **Atributo `style` no elemento raiz do frontend** — imune a plugin de cache que
  concatene stylesheets, mas escapar CSS dentro de atributo HTML é superfície de
  escape mais chata que um bloco `<style>`, e o `the_content` teria de conhecer o
  estilo.
- **Arquivo CSS gerado em `uploads/`** — paga escrita em disco, invalidação,
  permissão de filesystem e um request a mais, por ~200 bytes de CSS.

## UI

Layout confirmado das notas de 2026-08-09: preview no topo da seção, campos
abaixo em tabela clássica de settings.

A seção "Player" contém, nesta ordem:

1. **Preview** — o player real, renderizado pelo servidor já com os valores
   salvos (ver abaixo), com o aviso de contraste logo abaixo dele.
2. **Quatro linhas de `add_settings_field`** — fundo, destaque, texto, raio.
3. **Link "Restaurar padrão"**, que reescreve campos e preview **no cliente**.
   Quem grava continua sendo o botão Salvar da página: um clique acidental não
   apaga a customização de ninguém sem confirmação. O link é criado por
   `preview.ts`; sem JavaScript ele não existe, mesma política dos controles do
   player na Fase 1 — controle que parece operável e não faz nada é pior que
   controle ausente.

### Campo de cor

Cada uma das três cores é uma linha com dois inputs sincronizados:

- `<input type="color">` — **sem atributo `name`**. É controle visual;
- `<input type="text" name="post_voice_player_style[surface]">` com o hex,
  `pattern="^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$"`, `maxlength="7"`,
  `inputmode="text"`, `spellcheck="false"`.

O campo de texto é o único que carrega `name`, então há um valor por chave na
submissão e nenhuma ambiguidade sobre qual vence. Regras de sincronia, em
`hex-field.ts` (pura) e aplicadas por `preview.ts`:

- digitar hex válido no texto atualiza o color input e o preview;
- digitar hex inválido não atualiza nada e não apaga o que estava — o preview
  continua mostrando o último valor válido;
- mexer no color input reescreve o texto em minúsculas com `#`;
- ao sair de um campo de texto inválido (`blur`), ele volta ao último valor
  válido, para não submeter lixo que o servidor teria de descartar em silêncio.

O `pattern` dá validação nativa do browser, e o servidor valida de novo — a UI
restringe, não garante, que é a regra de REST do `CLAUDE.md` aplicada ao form.

Cada linha tem `<label for>` no campo de texto e `aria-label` no color input,
porque os dois controlam o mesmo valor e um `<label>` só pode apontar para um.

### Raio

`<select name="post_voice_player_style[radius]">` com três `<option>`
traduzidas: "Pílula (padrão)", "Cantos arredondados", "Cantos retos". Os valores
submetidos são as chaves (`pill`, `rounded`, `square`), nunca o `px`.

### Preview

Fiel por construção, não por imitação. O HTML de
`Post_Voice_Frontend_Render::append_player()` é extraído para
`markup( ?string $src, bool $preview = false ): string`:

- **frontend**: `markup( $url )` — saída idêntica à de hoje, byte a byte;
- **admin**: `markup( null, true )` — mesmo HTML, com quatro diferenças, todas
  necessárias e nenhuma cosmética:
  - a raiz ganha `post-voice-player--enhanced` (no frontend quem adiciona é
    `player.ts`, que não roda aqui);
  - não sai `<audio>`;
  - os controles saem sem `hidden` e **com `disabled`**;
  - `[data-role="seek"]` sai com `value="40"`, para destaque e trilha
    aparecerem ao mesmo tempo.

Os controles vão `disabled` porque `aria-hidden` num bloco com botões focáveis é
violação (`aria-hidden-focus` no axe) e o preview não é operável de todo jeito.
No modo preview também não saem `role="region"`, `aria-label` da região nem o
`<span aria-live>`: a região do player só faz sentido no post, e duplicá-la
acrescentaria ruído de landmark na tela de settings.

O wrapper que a seção imprime em volta:

```html
<div class="post-voice-preview" style="--pv-surface:#c00000">…markup…</div>
```

O `style` vem de `css_declarations()`, então o preview já nasce com os valores
salvos, antes de qualquer JavaScript — e continua correto se o script falhar.
`preview.ts` só escreve por cima, com `setProperty`, a cada evento `input`. Sem
debounce: são quatro `setProperty` por evento.

`features/player-style/admin/style.scss` contém só o que o preview precisa e
nada disso chega ao frontend:

```scss
.post-voice-preview .post-voice-player--enhanced {
  position: static;
  animation: none;
  max-width: 40rem;
}
```

O player real é `position: fixed; bottom: 1rem`; cru na tela de settings, a
pílula flutuaria sobre o wp-admin. Além dessas três regras, o preview usa o CSS
do frontend sem alteração — `class-style-section.php` enfileira
`build/style-narration-player.css` na tela de settings, sob o mesmo handle
`post-voice-player`, mais `build/style-player-style-admin.css` e
`build/player-style-admin.js`.

### Aviso de contraste

`contrast.ts` é pura: hex → componentes → luminância relativa (WCAG 2.x) → razão
entre duas cores. `preview.ts` avalia três pares, com o limiar que a WCAG dá a
cada tipo de elemento:

| Par | Onde aparece | Limiar |
|---|---|---|
| texto × fundo | rótulo "1×" do botão de velocidade, ícone de fechar | 4.5:1 |
| texto × destaque | o glifo ▶ dentro do botão play | 4.5:1 |
| destaque × fundo | o botão play e a barra de progresso contra a pílula | 3:1 (componente de UI, não texto) |

O limiar por tipo não é preciosismo: o par padrão do plugin (`#2b62f0` sobre
`#1e1e1e`) dá **3,26:1**. Com um limiar único de 4.5, a tela avisaria contra a
configuração de fábrica na primeira vez que o autor a abrisse — um aviso que não
tem ação correta e que ensina o autor a ignorar avisos.

O aviso lista os pares reprovados pelo nome do campo, num `<p role="status">`
junto ao preview — `status` e não `alert`, porque é informação enquanto o autor
mexe, não interrupção. Some quando todos passam. Nunca impede salvar: avisar e
não bloquear é a postura do core no Customizer, e bloquear trataria o autor como
suspeito num cálculo que não cobre todos os casos legítimos.

## Segurança

- Escrita exige `manage_options`, pela dupla `settings_fields()` / `options.php`
  do core (nonce e capability inclusos) mais a guarda que a página já tem no
  `render()`.
- Toda cor passa por `sanitize_hex_color()` antes de tocar o banco, e de novo na
  leitura. O CSS emitido é montado a partir do array sanitizado, nunca do valor
  cru — não há caminho de `wp_options` até o `<style>` que não passe pelo
  sanitizador.
- `radius` nunca chega ao CSS como string do usuário: `RADII` mapeia chave para
  literal.
- O atributo `style` do wrapper do preview sai por `esc_attr()`, sobre uma
  string que já é só hex e nomes de propriedade.
- Nada aqui é exposto por REST: a opção não é `show_in_rest`, e nenhum endpoint
  novo existe.

## Qualidade e testes

**PHPUnit** (um `@covers` por classe de teste, como manda o `CLAUDE.md`):

- `Post_Voice_Style_Store` (`features/player-style/tests/php/test-style-store.php`):
  entrada que não é array; cada cor inválida caindo no seu default sem afetar as
  outras; hex de três dígitos aceito e preservado; `radius` fora da whitelist
  virando `pill`; chave desconhecida ignorada; chave ausente virando default;
  `inline_css()` vazio quando tudo é padrão; `inline_css()` contendo só as
  propriedades alteradas; `css_declarations()` sem seletor; `get()` sanitizando
  um valor escrito direto no banco.
- `Post_Voice_Style_Section` (`.../test-style-section.php`): opção registrada com
  o sanitizador do store; seção e os quatro campos registrados no `MENU_SLUG`;
  `enqueue` saindo cedo em `hook_suffix` alheio e enfileirando os três assets no
  próprio; ausência do `.asset.php` não fatalizando (mesma guarda das outras
  telas).
- `Post_Voice_Dictionary_Section` (`features/pronunciation/tests/php/test-dictionary-section.php`):
  o que hoje o teste da settings page cobre sobre o dicionário, movido para cá.
- `Post_Voice_Settings_Page` (`shared/tests/php/test-settings-page.php`, movido):
  página adicionada para administrador; `render()` saindo sem `manage_options`;
  `is_current_screen()` nos dois casos; e — o teste que a nova estrutura pede —
  **cada seção sobrevivendo à ausência da outra**, porque a casca não pode
  depender de quem se registrou.
- `Post_Voice_Frontend_Render`: `markup()` nos dois modos — com `<audio>` e URL
  no frontend; sem `<audio>`, com `--enhanced`, com `disabled`, com `value="40"`
  e sem `aria-live` no preview. Mais uma asserção de que o caminho do frontend
  não mudou de saída.
- `Post_Voice_Assets`: `wp_add_inline_style` chamado com o CSS quando há
  customização, e não chamado quando não há.

**Jest** (arquivos novos entram em `collectCoverageFrom`; gate de 80% de linhas
não muda):

- `contrast.ts`: branco/preto = 21:1; par padrão (`#fff` sobre `#1e1e1e`) acima
  de 4.5; `#2b62f0` sobre `#1e1e1e` acima de 3 e abaixo de 4.5 — o caso que
  justifica o limiar por tipo; hex de três dígitos dando o mesmo resultado que a
  forma longa.
- `hex-field.ts`: aceita `#abc` e `#aabbcc`; rejeita `abc`, `#ab`, `#gggggg` e
  string vazia; normaliza maiúsculas para minúsculas.

**E2E (Playwright), cenários novos:**

- salvar destaque `#c00000` em `Configurações → Narração`, abrir um post
  narrado, e checar `getComputedStyle` do botão play;
- post narrado num site sem customização: `style#post-voice-player-inline-css`
  ausente do documento;
- preview refletindo uma mudança de cor sem salvar e sem recarregar;
- axe na tela de settings com o preview renderizado, mesmo critério dos cenários
  existentes (nenhuma violação `serious`/`critical`).

Vale a regra registrada no `TESTING.md` depois da Fase 2: rodar a suíte E2E
inteira antes de dar por pronta qualquer tarefa que toque no browser, nunca um
`--grep`.

### Inventário de configuração — o que muda fora do código da feature

Cada linha aqui é uma armadilha que a Fase 2 pagou para descobrir. A feature
nova **e** o diretório `shared/` novo obrigam:

| Arquivo | Mudança |
|---|---|
| `post-voice.php` | `require_once` de `shared/php/class-settings-page.php`, `features/pronunciation/php/class-dictionary-section.php`, `features/player-style/php/class-style-store.php` e `.../class-style-section.php`; `register()` das duas seções |
| `webpack.config.js` | entry `player-style-admin` → `features/player-style/admin/index.ts` |
| `phpunit.xml.dist` | `<directory>` para `features/player-style/tests/php` e `shared/tests/php`; `<include>` de cobertura ganha `shared`; `<exclude>` ganha `shared/tests` |
| `jest.config.js` | `contrast.ts` e `hex-field.ts` em `collectCoverageFrom` |
| `phpstan.neon` | `shared` em `paths` (hoje só `features`, então a página sairia da análise ao mudar de casa); `shared/*/tests/php/*` em `excludePaths` |
| `package.json` (`i18n:pot`) | `--include` ganha `shared/php`, `features/player-style/php` e `build/player-style-admin.js` |
| `scripts/check-pot.sh` | a mesma lista, que é duplicada lá de propósito |
| `languages/post-voice.pot` | regenerado (`npm run i18n:pot`) |

Sem `shared/php` nas duas listas de i18n, as strings da página de settings — que
já existem e já estão traduzidas — desaparecem do `.pot` no momento em que o
arquivo muda de diretório, e `i18n:check` fica vermelho por uma mudança que não
acrescentou string nenhuma.

Os gates não mudam: 80% de linhas no JS, 85% no PHP, `serious`/`critical` zero
no axe.

## Critérios de aceite

1. Site que nunca abriu a tela renderiza o player exatamente como hoje, sem
   `style#post-voice-player-inline-css` no documento.
2. Autor muda os quatro campos, salva, e o post narrado reflete os quatro.
3. Preview reflete cada mudança sem salvar e sem recarregar, e já nasce com os
   valores salvos mesmo antes do JavaScript rodar.
4. Par de cores abaixo do seu limiar mostra aviso nomeando o par, e ainda assim
   salva.
5. Valor inválido enviado direto ao `options.php` cai no default daquele campo,
   sem afetar os outros, e não chega ao CSS.
6. "Restaurar padrão" devolve os campos aos valores de fábrica sem gravar nada;
   sem JavaScript, o link não aparece.
7. Navegador sem `color-mix` mostra hover e trilha nos tons de hoje.
8. `radius: square` deixa a pílula com cantos retos e mantém play e fechar
   circulares.
9. Tela de settings passa no axe com o preview visível, e a seção do dicionário
   continua funcionando como na Fase 2.

## Emenda de 2026-08-17 — o que o planejamento descobriu

**`<input type="color">` só entende a forma de seis dígitos.** Entregue `#abc`,
ele não erra: mostra preto e não avisa. Como a opção preserva a forma curta como
o autor digitou, o valor do seletor precisa ser expandido na hora de renderizar
e na hora de sincronizar. Duas funções nascem disso —
`Post_Voice_Style_Store::expand_hex()` no PHP e `expandHex()` no
`hex-field.ts` — e o campo de texto continua guardando a forma curta.

**O `pattern` do HTML é ancorado implicitamente.** O `^…$` escrito acima é
redundante; o plano usa `#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})`, que é equivalente.

## Não-metas explícitas

- Highlight sincronizado, auto-scroll e timestamps — fase futura.
- Posição, tamanho e tipografia do player.
- Customização por post, por autor ou por categoria.
- Modo claro/escuro automático do player seguindo o sistema do leitor.
- Migrar o que quer que seja do `theme.json` ou para ele.
- `uninstall.php` e limpeza de opções na desinstalação.
