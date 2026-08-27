---
id: 0010
titulo: i18n desde o primeiro commit, com o domínio post-voice
status: aceita
data: 2026-08-27
origem: superpowers/specs/2026-08-08-wp-narration-plugin-mvp-design.md#decisões-já-fechadas-não-reabrir-sem-motivo-novo
enforced_by: [ i18n-text-domain ]
revisar_quando: o plugin passar a ter string de UI gerada dinamicamente no servidor
desvios: []
---

## Contexto

Fazer o retrofit de i18n num plugin já pronto é uma varredura sobre todo
arquivo de UI, e sempre escapa alguma string — a que ficou dentro de um
atributo, a que foi concatenada, a que um PR recente acrescentou sem olhar
para o padrão do resto do arquivo. Passar toda string visível pelo wrapper de
tradução desde o primeiro commit não custa nada por string a mais; custa uma
varredura inteira se deixado para depois.

## Decisão

Toda string visível ao usuário no PHP passa por `__()`, `_x()` ou
`esc_html__()` com o domínio `post-voice`. O arquivo `.pot` é regenerado
sempre que uma string muda (`npm run i18n:pot`), e `npm run i18n:check`
reprova o CI quando o `.pot` no repo está desatualizado em relação ao código.

## Consequências

Fica mais fácil: o plugin é traduzível desde a primeira versão publicada, e o
`.pot` versionado no repo é revisável em diff como qualquer outro artefato
gerado. Fica mais difícil: o `.pot` precisa ser regenerado junto com toda
mudança de string, e esquecer esse passo reprova o CI em vez de passar
silenciosamente com uma tradução defasada.

A exceção deliberada é `SAMPLE_TEXTS` em
`features/narration/editor/voice-catalog.ts`: são as frases de amostra do
seletor de voz, e gettext segue o locale do painel administrativo, mas essas
frases alimentam um modelo de fala cujo idioma é o do bundle de voz
escolhido — traduzi-las faria um admin em português ouvir a voz inglesa lendo
texto em português. Isso **não é desvio desta ADR**: a regra aqui é sobre
gettext em PHP, e `SAMPLE_TEXTS` deliberadamente não usa gettext algum, em
TypeScript ou PHP. A razão fica registrada aqui para que ninguém "corrija"
isso adicionando `__()` ali mais tarde.

## Como verificar

`i18n-text-domain` — sobre PHP: toda chamada a `__`, `_x`, `_n`, `_ex`,
`_nx`, `esc_html__`, `esc_html_e`, `esc_attr__` ou `esc_attr_e` em
`features/**/php/` ou `shared/php/` carrega `'post-voice'` como domínio.

## Alternativas rejeitadas

**i18n só quando alguém pedir uma tradução.** É exatamente o retrofit que
este ADR evita — a varredura completa fica mais cara quanto mais código já
existe, e o pedido de tradução normalmente chega depois de meses de commits.

**Um domínio de texto por feature.** WordPress carrega arquivo de tradução
por domínio; três features com domínio próprio significariam três arquivos
`.mo` para gerar, carregar e manter em vez de um.
