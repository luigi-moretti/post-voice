---
id: 0015
titulo: "npm ci em CI e scripts; npm install nunca"
status: aceita
data: 2026-08-27
origem: superpowers/specs/2026-08-08-wp-narration-plugin-mvp-design.md
enforced_by: [ no-npm-install ]
revisar_quando: o projeto migrar de gerenciador de pacotes
desvios: []
---

## Contexto

`npm audit` é gate deste projeto, e o que ele audita é a árvore descrita pelo
`package-lock.json`. `npm install` pode reescrever esse lockfile em silêncio
— resolvendo uma faixa de versão de novo, atualizando uma transitiva — mesmo
quando ninguém pediu uma mudança de dependência. Uma auditoria verde rodada
depois disso pode ter examinado uma árvore diferente da que efetivamente
sobe para produção.

## Decisão

CI e todo script sob `scripts/` usam `npm ci`, que instala exatamente o que o
lockfile descreve e falha se `package.json` e o lockfile divergirem.
`npm install` é para quando se está deliberadamente mudando uma dependência,
na máquina do desenvolvedor, com o lockfile entrando no diff do PR junto do
`package.json`.

## Consequências

Fica mais fácil: o lockfile é a superfície de auditoria de verdade e é
imutável dentro do CI; um lockfile fora de sincronia com `package.json` faz o
CI falhar imediatamente, antes de qualquer outro gate, em vez de seguir
adiante com uma árvore reescrita em silêncio. Fica mais difícil: mudar uma
dependência deixa de ser uma edição de uma linha em `package.json` — exige
rodar `npm install` deliberadamente na própria máquina, conferir o lockfile
resultante e commitá-lo junto da mudança. `npm ci` também apaga e reinstala
`node_modules` do zero a cada execução, o que é mais lento que uma instalação
incremental.

## Como verificar

`no-npm-install` — nenhuma ocorrência de `npm install` em `package.json`, nos
workflows sob `.github/workflows/` ou em `scripts/`.

## Alternativas rejeitadas

**`npm install` com o lockfile commitado.** Ainda reescreve o lockfile
quando a resolução de uma faixa de versão muda entre execuções; commitar o
arquivo não impede a reescrita, só a torna visível depois do fato.

**`--frozen-lockfile`.** É uma flag de pnpm e Yarn; o equivalente do npm é o
próprio `npm ci`, não uma flag adicional em `npm install`.
