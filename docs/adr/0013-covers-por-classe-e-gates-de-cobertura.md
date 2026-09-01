---
id: 0013
titulo: "@covers por classe, e gates de cobertura que não descem"
status: aceita
data: 2026-08-27
origem: superpowers/specs/2026-08-08-wp-narration-plugin-mvp-design.md
enforced_by: [ covers-annotation ]
revisar_quando: um gate for reprovado três vezes seguidas por código que o time considera coberto
desvios: []
---

## Contexto

Cobertura de código sem `@covers` credita à classe sob teste tudo que a
execução do teste tocou, incluindo colaboradores instanciados no caminho. O
número de cobertura sobe sem que ninguém tenha escrito um teste a mais, e a
métrica deixa de dizer o que parece dizer.

## Decisão

Toda classe de teste PHPUnit declara `@covers` apontando para a classe que de
fato exercita. Os gates de cobertura são 80% de linhas em JS e 85% em PHP.
Nenhum dos dois desce para fazer um PR passar; baixar um gate é decisão
própria, registrada com a razão no spec — não um efeito colateral de código
que não atingiu o número.

## Consequências

Fica mais fácil: o número de cobertura significa exatamente o que diz, e uma
queda real aparece como queda real. Fica mais difícil: código alcançado
apenas através de outra classe lê como não coberto, por desenho — hoje são 10
classes de teste PHPUnit, uma por classe sob teste — e essa leitura já custou
uma sessão de investigação; está registrada nos Gotchas do `CLAUDE.md`.

## Como verificar

`covers-annotation` — toda classe de teste PHPUnit sob `features/*/tests/php/`
e `shared/tests/php/` carrega uma anotação `@covers`. Os limiares em si são
aplicados por `scripts/check-coverage-threshold.php` (PHP, 85%) e pelo
`coverageThreshold` de `jest.config.js` (JS, 80%) — o `lint:arch` verifica só
a presença da anotação, não a cobertura percentual.

## Alternativas rejeitadas

**Cobertura sem `@covers`.** O número sobe com testes de colaboradores e
deixa de apontar o que está realmente exercitado.

**Gate por arquivo em vez de global.** Transforma cada PR que toca um
arquivo pouco coberto numa negociação de limiar, em vez de manter um piso
único e estável para todo o projeto.
