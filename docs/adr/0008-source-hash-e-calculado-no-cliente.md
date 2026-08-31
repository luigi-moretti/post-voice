---
id: 0008
titulo: O source_hash é calculado no cliente; o PHP só guarda e compara
status: aceita
data: 2026-08-27
origem: superpowers/specs/2026-08-08-wp-narration-plugin-mvp-design.md#fluxo-de-dados
enforced_by: [ no-narration-logic-in-php ]
revisar_quando: o servidor precisar decidir sozinho se uma narração está obsoleta
desvios: []
---

## Contexto

"A narração está desatualizada?" é uma comparação entre o texto que foi
narrado e o texto atual do post. O cliente já monta esse texto narrado por
inteiro — extrai só os blocos elegíveis, aplica o dicionário de pronúncia,
sanitiza — antes de sintetizar. Se o PHP recalculasse o mesmo hash a partir
do conteúdo do post, existiriam duas implementações independentes de "o que
é narrado", que precisariam concordar para sempre a cada mudança em qualquer
uma das duas.

## Decisão

O cliente calcula `source_hash` a partir do texto que efetivamente enviou
para síntese e o envia junto com o áudio. O PHP guarda esse valor como post
meta e, mais tarde, apenas o compara byte a byte com o que recebeu antes.
Nenhum código PHP recomputa hash de conteúdo nem reimplementa a seleção de
blocos, a aplicação de pronúncia ou a sanitização que produzem o texto
narrado.

## Consequências

Fica mais fácil: existe uma única definição de "o que é narrado", e mudar a
regra de extração ou o dicionário de pronúncia é mudar um lugar só — o
cliente — sem tocar no servidor. Fica mais difícil: o servidor não sabe
julgar obsolescência sozinho; qualquer verificação de "esta narração ainda
bate com o post?" fora do editor (um cron, um relatório de admin) precisa de
uma decisão nova, porque hoje só o editor sabe montar o texto comparável.

## Como verificar

`no-narration-logic-in-php` — nenhum PHP de produção chama
`md5`, `sha1`, `hash`, nem `parse_blocks` (a função que decompõe conteúdo de
post em blocos), que são os sinais de que o servidor estaria recalculando o
texto narrado em vez de só armazenar e comparar o hash recebido.

"PHP de produção" é uma allowlist por raiz, não "tudo que não é teste":
`post-voice.php`, `features/` e `shared/` (`phpSources`, em
`scripts/lint-arch/context.js`). `e2e/mu-plugins/*.php` e
`scripts/check-coverage-threshold.php` ficam de fora de propósito — são
ferramental versionado, e nada ali recalcula o texto narrado do post.

## Alternativas rejeitadas

**Hash calculado no servidor a partir do post salvo.** Duplica a definição de
"o que é narrado" no PHP; a primeira divergência entre a extração do cliente
e a do servidor apareceria como bug de "sempre desatualizado" sem que a causa
fosse óbvia.

**Hash dos dois lados com comparação cruzada.** Paga o custo de manter duas
implementações sincronizadas pelo mesmo resultado que uma implementação só,
no cliente, já entrega.
