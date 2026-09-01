---
id: 0010
titulo: i18n desde o primeiro commit, com o domínio post-voice
status: aceita
data: 2026-08-27
origem: superpowers/specs/2026-08-08-wp-narration-plugin-mvp-design.md#decisões-já-fechadas-não-reabrir-sem-motivo-novo
enforced_by: [ i18n-text-domain, review-manual ]
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

A "## Decisão" acima afirma duas coisas, e só uma delas tem gate. Isto está
escrito porque uma ADR que promete verificação inexistente é pior que uma sem
verificação nenhuma: ensina a confiar num silêncio que não significa nada.

`i18n-text-domain` — **a metade mecânica**: toda chamada a função gettext em
`features/**/php/` ou `shared/php/` carrega `'post-voice'` como domínio. A
lista de funções reconhecidas vive em `CALL_RE`, na própria regra, e não é
repetida aqui de propósito — duplicá-la criaria duas versões da mesma verdade,
e a cópia desta ADR já esteve desatualizada (listava nove funções quando a
regra reconhecia dezesseis).

`review-manual` — **a metade de julgamento**: que toda string visível ao
usuário de fato passe por gettext. Nenhum gate cobre isso, e não é descuido.
A regra varre chamadas de gettext, então só enxerga código que já decidiu
traduzir: `echo '<p>Save narration</p>'` não tem chamada nenhuma para
inspecionar, e passa. O `i18n:check` também não pega — ele compara o `.pot`
com o que está em gettext, e string crua nunca entra no `.pot`.

Cobrir essa metade por script exigiria decidir se uma string é visível ao
usuário, e o PHP não distingue `'Save narration'` de `'utf-8'`, de
`'post-voice/v1'` ou de `'display: none'`. A diferença é semântica, não
sintática. Uma heurística por conteúdo acusaria as duas coisas juntas, e um
gate que acusa errado é desligado — o que deixaria o projeto pior do que
está, porque a autoridade do `desvios:` depende de o linter não acusar
bobagem. Fica com o revisor humano, declarado, em vez de fingido.

## Alternativas rejeitadas

**i18n só quando alguém pedir uma tradução.** É exatamente o retrofit que
este ADR evita — a varredura completa fica mais cara quanto mais código já
existe, e o pedido de tradução normalmente chega depois de meses de commits.

**Um domínio de texto por feature.** WordPress carrega arquivo de tradução
por domínio; três features com domínio próprio significariam três arquivos
`.mo` para gerar, carregar e manter em vez de um.
