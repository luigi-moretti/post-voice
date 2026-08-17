# Post Voice — Fase 3: customização visual do player

**Data:** 2026-08-17
**Status:** Aprovado para planejamento de implementação
**Fases anteriores:** [`2026-08-08-wp-narration-plugin-mvp-design.md`](2026-08-08-wp-narration-plugin-mvp-design.md) (Fase 1) e [`2026-08-14-post-voice-fase2-design.md`](2026-08-14-post-voice-fase2-design.md) (Fase 2) seguem sendo fonte de verdade do que decidiram. Este documento só acrescenta; onde muda algo delas, diz explicitamente.
**Pré-trabalho:** [`2026-08-09-phase3-player-settings-notes.md`](2026-08-09-phase3-player-settings-notes.md) — notas exploratórias de UI escritas enquanto a Fase 1 estava em revisão. Este spec confirma o que aquelas notas decidiram (página própria em `Configurações → Narração`, layout com preview no topo) e fecha os três pontos que elas deixaram em aberto.

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
| Contraste insuficiente | Avisa, não bloqueia | Mesma postura do core no Customizer. A escolha continua do autor, informada |
| Casa da settings page | `shared/php/` | Segunda feature passa a depender dela — é o gatilho que o `CLAUDE.md` define para `shared/` |

## Escopo

**Dentro:**

- Opção `post_voice_player_style` com quatro campos, sanitizada no servidor.
- Seção "Player" em `Configurações → Narração`, com preview ao vivo.
- Aviso de contraste WCAG no preview.
- Emissão do CSS no frontend só quando há diferença em relação ao padrão.
- Mudança de `class-settings-page.php` para `shared/php/`, com as seções passando
  a ser registradas por cada feature.

**Fora, explicitamente:**

- Highlight de palavra sincronizado e auto-scroll (fase futura, spec próprio).
- Posição do player (continua fixa: pílula flutuante inferior, centrada).
- Tipografia (o player segue herdando `font: inherit` do tema).
- Preview com áudio tocável.
- Herança de cores do tema ativo ou do esquema do wp-admin.
- Estilo por post — a customização é do site inteiro.

## Arquitetura

### Feature nova

```
features/player-style/
  php/class-style-store.php     # OPTION, DEFAULTS, sanitize(), get(), inline_css()
  php/class-style-section.php   # campos na settings page, enqueue do preview
  admin/preview.ts              # custom properties ao vivo + aviso de contraste
  tests/php/…
  tests/js/…
```

Feature própria porque customização do player é capacidade própria — o spec do
MVP já a lista como uma das features previstas ("estilo do player"), ao lado de
narração e pronúncia.

### A settings page vira compartilhada

Hoje `Post_Voice_Settings_Page` mora em `features/pronunciation/php/`, onde a
Fase 2 a criou. Com a Fase 3 uma segunda feature depende dela, que é exatamente
o gatilho registrado no `CLAUDE.md` ("shared code moves to `shared/` only when a
second feature actually needs it").

A classe vai para `shared/php/class-settings-page.php` e vira casca: título,
`<form method="post" action="options.php">`, `settings_fields()`,
`do_settings_sections()` e `submit_button()`. Nenhum campo é dela. Cada feature
registra a sua seção no `admin_init`, contra o `OPTION_GROUP` que já existe:

- pronúncia registra a seção do dicionário, com a tabela que hoje está inline no
  `render()` mudando para `features/pronunciation/php/class-dictionary-section.php`;
- player-style registra a seção do player, em
  `features/player-style/php/class-style-section.php`.

Um `<form>`, um botão Salvar, as duas opções salvas na mesma submissão — que é
como o WordPress faz uma página de settings com várias seções.

Rejeitada a alternativa de manter a página em `features/pronunciation` e o
player-style pendurar campos nela: inverteria a direção da dependência por
acidente de histórico e deixaria a feature de pronúncia dona de UI que não é
dela.

O `enqueue()` da página, que hoje carrega o script do dicionário, passa a ser
responsabilidade de cada seção — a casca não conhece os assets de ninguém. Para
as duas não copiarem a mesma condição, a casca expõe
`Post_Voice_Settings_Page::is_current_screen( $hook_suffix ): bool`, que encapsula
a comparação com `settings_page_post-voice`; cada seção engancha o próprio
`admin_enqueue_scripts` e sai cedo por ela. A guarda de `manage_options` continua
no `render()` da casca.

### Armazenamento

Opção única, registrada no mesmo grupo:

```php
class Post_Voice_Style_Store {
    public const OPTION = 'post_voice_player_style';

    public const DEFAULTS = array(
        'surface' => '#1e1e1e',  // fundo da pílula
        'accent'  => '#2b62f0',  // play, progresso, thumb
        'text'    => '#ffffff',  // ícones, rótulos, anel de foco
        'radius'  => 'pill',     // pill | rounded | square
    );
}
```

Uma opção em vez de quatro: os quatro valores são lidos e escritos sempre
juntos, e uma linha só de `wp_options` é um `get_option` só por request.

`sanitize()` segue a política do `Post_Voice_Dictionary_Store` — descartar o
inválido, não recusar a submissão inteira:

- cada cor passa por `sanitize_hex_color()` do core, que aceita `#abc` e
  `#aabbcc`, devolve `''` para string vazia e não devolve nada (`null`) para o
  resto; qualquer resultado que não seja um hex válido cai no default do campo;
- `radius` é whitelist das três chaves, qualquer outra coisa cai em `pill`;
- chave desconhecida no array é ignorada; chave ausente vira o default.

O resultado é sempre um array completo com as quatro chaves, então nenhum
consumidor precisa tratar campo faltando. `get()` sanitiza também na leitura,
pelo mesmo motivo que o dicionário: cobre uma linha escrita direto no banco.

O preset de raio existe em vez de um campo numérico porque três valores cobrem a
intenção real (pílula / cartão / quadrado), são triviais de validar e o preview
mostra cada um sem ambiguidade. Mapeamento: `pill → 999px`, `rounded → 12px`,
`square → 0`.

### Do banco até a página do leitor

`style.scss` troca as variáveis Sass por custom properties com fallback:

```scss
background: var(--pv-surface, #1e1e1e);
```

O fallback dentro do `var()` é o que garante que um site sem opção salva
renderize exatamente como hoje — o CSS continua correto sozinho, sem depender de
nada que o PHP emita.

`Post_Voice_Style_Store::inline_css()` devolve um bloco
`.post-voice-player { … }` contendo **só as propriedades que diferem do
padrão**, e string vazia quando nada difere. `Post_Voice_Assets::enqueue_frontend_assets()`
chama `wp_add_inline_style( 'post-voice-player', … )` apenas quando a string não
é vazia. Site que nunca customizou não recebe um byte novo.

Os dois tons derivados de hoje — hover `#333` e trilha da barra `#4a4a4a` — não
viram campo. São decisões que o autor não quer tomar, e quebrariam se ele
escolhesse fundo claro. Derivam do fundo em CSS puro, com declaração dupla:

```scss
background: #4a4a4a;
background: color-mix(in srgb, var(--pv-surface, #1e1e1e) 70%, var(--pv-text, #fff));
```

Navegador sem `color-mix` descarta a segunda declaração e fica com a de hoje.
Escolhido CSS em vez de calcular o mix no PHP porque o preview precisa do mesmo
resultado ao vivo: no PHP, a matemática teria de ser reimplementada em TS, e as
duas cópias divergiriam na primeira mudança.

Alternativas de entrega rejeitadas:

- **Atributo `style` no elemento raiz** — imune a plugin de cache que concatene
  stylesheets, mas escapar CSS dentro de atributo HTML é superfície de escape
  mais chata que um bloco `<style>`, e o preview não compartilharia o caminho.
- **Arquivo CSS gerado em `uploads/`** — paga escrita em disco, invalidação,
  permissão de filesystem e um request a mais, por ~200 bytes de CSS.

## UI

Layout confirmado das notas de 2026-08-09: preview no topo, campos abaixo em
tabela clássica de settings.

A página passa a ter duas seções. "Pronunciation dictionary" (a tabela da Fase 2,
inalterada em comportamento) e "Player", nesta ordem. Dentro da seção do player:

1. o preview, no topo;
2. quatro campos — `<input type="color">` para fundo, destaque e texto,
   `<select>` para o raio;
3. o aviso de contraste, quando aplicável, junto ao preview;
4. link "Restaurar padrão", que reescreve campos e preview **no cliente**. Quem
   grava continua sendo o botão Salvar da página — o link não faz request, então
   um clique acidental não apaga a customização de ninguém sem confirmação.

### Preview

Fiel por construção, não por imitação. `Post_Voice_Frontend_Render::append_player()`
tem seu HTML extraído para `markup( ?string $src, bool $preview ): string`:

- frontend: passa a URL do anexo, `$preview = false` — saída idêntica à de hoje;
- admin: passa `null`, `$preview = true` — mesmo HTML já com
  `post-voice-player--enhanced`, sem `<audio>`, sem os atributos `hidden`, com a
  barra em 40% para mostrar destaque e trilha ao mesmo tempo.

É a única forma de o preview não virar uma segunda cópia da aparência: mudou o
player, mudou o preview.

Três regras do preview, fixadas aqui:

- **Controles vão `disabled`.** `aria-hidden` num bloco com botões focáveis é
  violação (`aria-hidden-focus` no axe), e o preview não é operável de todo
  jeito.
- **Sem `aria-live` e sem `role="region"`** na cópia do admin. A região do player
  só faz sentido no post; duplicá-la só acrescenta ruído de landmark na tela de
  settings.
- **Wrapper `.post-voice-preview`** devolve `position: static` e desliga a
  animação de entrada. O player real é `position: fixed; bottom: 1rem` — cru na
  tela de settings, a pílula flutuaria sobre o wp-admin. O wrapper não toca em
  mais nada da aparência.

`preview.ts` escuta `input` nos quatro campos e escreve as custom properties no
wrapper. Sem debounce: são quatro `style.setProperty` por evento.

### Aviso de contraste

Função pura em TS: luminância relativa (WCAG 2.x) → razão entre dois hex. Roda
sobre dois pares — texto/fundo e destaque/fundo — e mostra aviso abaixo de
4.5:1, nomeando o par que falhou. Não impede salvar.

Avisar e não bloquear é a postura do core no Customizer, e bloquear trataria o
autor como suspeito num cálculo que não cobre bem todos os casos legítimos.

## Segurança

- Escrita exige `manage_options`, pela `settings_fields()`/`options.php` do core
  (nonce e capability inclusos) mais a guarda que a página já tem.
- Toda cor passa por `sanitize_hex_color()` antes de tocar o banco, e de novo na
  leitura. O CSS emitido é montado a partir do array sanitizado, nunca do valor
  cru — não há caminho de `wp_options` para o `<style>` que não passe pelo
  sanitizador.
- `radius` nunca chega ao CSS como string do usuário: a whitelist mapeia chave
  para valor literal.
- Nada aqui é exposto por REST. A opção não é `show_in_rest`.

## Qualidade e testes

**PHPUnit** (`@covers` por classe, como manda o `CLAUDE.md`):

- `Post_Voice_Style_Store`: cada campo inválido caindo no seu default; hex de
  três dígitos aceito; chave desconhecida ignorada; chave ausente virando
  default; `radius` fora da whitelist virando `pill`; `inline_css()` vazio quando
  tudo é padrão e contendo só as propriedades alteradas quando não é.
- `Post_Voice_Frontend_Render`: `markup()` nos dois modos — com `<audio>` e URL
  no frontend, sem `<audio>` e com `--enhanced` no preview.
- `Post_Voice_Settings_Page`: as duas seções registradas, e a de cada feature
  sobrevivendo à ausência da outra.

**Jest:**

- razão de contraste, com casos conhecidos: branco/preto = 21:1, o par padrão
  acima de 4.5:1, um par ruim abaixo;
- `preview.ts` escrevendo as custom properties certas a cada `input`.

**E2E (Playwright):**

- salvar destaque `#c00000`, abrir post narrado, checar `getComputedStyle` do
  botão play;
- axe na tela de settings, com o preview renderizado;
- post sem customização: nenhuma tag `<style>` do plugin no `<head>`.

Vale a regra registrada no `TESTING.md` depois da Fase 2: rodar a suíte E2E
inteira antes de dar por pronta qualquer tarefa que toque no browser, nunca um
`--grep`.

**Três entradas por feature nova**, cada uma descoberta na marra pela Fase 2:

- `<directory>` de `features/player-style/tests/php` no `phpunit.xml.dist`;
- `features/player-style` nas listas de `i18n:pot` em `package.json` **e** em
  `scripts/check-pot.sh`;
- entry `player-style-admin` no `webpack.config.js`.

Os gates de cobertura não mudam: 80% de linhas no JS, 85% no PHP.

## Critérios de aceite

1. Site que nunca abriu a tela renderiza o player exatamente como hoje, sem CSS
   inline nenhum.
2. Autor muda as quatro opções, salva, e o post narrado reflete as quatro.
3. Preview reflete cada mudança sem salvar e sem recarregar.
4. Par de cores com contraste insuficiente mostra aviso e ainda assim salva.
5. Valor inválido enviado direto ao `options.php` cai no default em vez de
   chegar ao CSS.
6. "Restaurar padrão" devolve os campos aos valores de fábrica sem gravar nada.
7. Navegador sem `color-mix` mostra hover e trilha nos tons de hoje.
8. Tela de settings passa no axe com o preview visível.

## Não-metas explícitas

- Highlight sincronizado, auto-scroll e timestamps — fase futura.
- Posição, tamanho e tipografia do player.
- Customização por post, por autor ou por categoria.
- Modo claro/escuro automático do player seguindo o sistema do leitor.
- Migrar o que quer que seja do `theme.json` ou para ele.
