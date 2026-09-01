---
id: 0007
titulo: Namespace REST fixo e validação sempre no servidor
status: aceita
data: 2026-08-27
origem: superpowers/specs/2026-08-08-wp-narration-plugin-mvp-design.md#contrato-do-endpoint-rest-definido
enforced_by: [ rest-namespace, review-manual ]
revisar_quando: uma segunda versão da API for necessária (post-voice/v2)
desvios: []
---

## Contexto

O editor é a única UI que fala com o plugin, e é tentador confiar nela para
restringir o que chega ao servidor — um seletor de voz que só lista bundles
válidos, um campo desabilitado quando a narração já existe. Mas uma rota REST
é um endpoint público: qualquer requisição autenticada com o cookie certo
pode chamá-la com qualquer corpo, ignorando toda restrição que só existe na
interface.

## Decisão

Toda rota do plugin vive sob o namespace `post-voice/v1`, e **todo valor que
o endpoint aceita é validado no servidor**, mesmo quando a UI já o restringe.
Um controle desabilitado no editor é UX, não garantia de segurança.

## Consequências

Fica mais fácil: o endpoint é seguro por si só, e a interface pode mudar —
novo bundle de voz, novo estado do player — sem abrir um buraco de validação
em produção. Fica mais difícil: a lista de valores aceitos (bundles de voz,
formatos, IDs de post) existe nos dois lados — no `sanitize_callback`/
`validate_callback` do PHP e nas opções do editor — e as duas cópias precisam
ser mantidas em sincronia manualmente.

## Como verificar

`rest-namespace` cobre metade da regra: todo `register_rest_route` passa
`post-voice/v1` como primeiro argumento, resolvendo constantes de classe —
`self::REST_NAMESPACE` conta como o literal que ela guarda, não apenas uma
string inline. A outra metade é `review-manual`: "todo argumento do endpoint
tem `validate_callback` ou `sanitize_callback` que rejeita o que a UI já
impede" não é verificável por expressão regular sem gerar falso positivo, e a
mitigação é o passo 3 do fluxo pré-PR — o reviewer confere a lista de
argumentos contra o que o cliente pode enviar.

## Alternativas rejeitadas

**Confiar na validação da UI.** O endpoint é público independente do que o
editor mostra; qualquer requisição fora do editor contorna a restrição.

**`admin-ajax.php` em vez de REST.** Sem esquema de argumentos declarativo,
sem `validate_callback`/`sanitize_callback` por campo — a validação viraria
código solto no topo de cada handler, em vez de declarada junto ao endpoint.

**Namespace sem versão (`post-voice` em vez de `post-voice/v1`).** A primeira
mudança que quebra o contrato do endpoint não teria como conviver com clientes
antigos; a versão no namespace é o que torna `post-voice/v2` possível depois.
