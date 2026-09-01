---
id: 0004
titulo: Layout por feature; shared/ só a partir do segundo consumidor
status: aceita-com-desvio
data: 2026-08-27
origem: superpowers/specs/2026-08-08-wp-narration-plugin-mvp-design.md#arquitetura
enforced_by: [ feature-layout, shared-two-consumers ]
revisar_quando: uma quarta feature entrar, ou shared/ passar de três módulos
desvios:
  - features/narration/format-time.ts → fora de features/<f>/{php,editor,frontend,admin,tests}/
---

## Contexto

Um plugin WordPress cresce por padrão em camadas técnicas —
`includes/`, `assets/`, `admin/` — e a camada não diz nada sobre o que o
código faz nem sobre o que pode ser apagado junto quando uma capacidade some.
O layout por feature foi escolhido antes da primeira linha de código, alinhado
ao roadmap já fechado (narração na Fase 1, trecho-em-outro-idioma e
dicionário de pronúncia na Fase 2, estilo do player na Fase 3), e a medição de
2026-08-25 confirma que a divisão continua legível hoje: `narration` tem 5 das
10 classes PHP e ~25 dos ~35 módulos TypeScript do plugin — é o produto —
enquanto `pronunciation` e `player-style` só modificam o comportamento dela.

## Decisão

Todo arquivo de produção mora em
`features/<feature>/{php,editor,frontend,admin,tests}/`. Código só migra para
`shared/` quando um **segundo** consumidor real existe — abstrair a partir de
um único consumidor é adivinhar a fronteira antes de ela existir.

## Consequências

Fica mais fácil: ler uma feature inteira dentro de um diretório e apagá-la
sem caçar restos espalhados por pastas técnicas. Fica mais difícil
compartilhar código entre features: o segundo consumidor paga o custo da
migração para `shared/`, de propósito — é o preço de não adivinhar a
abstração errada antes da hora.

## Como verificar

`feature-layout` — todo arquivo de produção sob `features/` está dentro de
`php/`, `editor/`, `frontend/`, `admin/` ou `tests/` da sua própria feature.
`shared-two-consumers` — todo módulo em `shared/` tem pelo menos dois
consumidores reais fora de `shared/`; um só reprova. O desvio listado é
`features/narration/format-time.ts`, hoje na raiz da feature em vez de dentro
de `editor/` — seu único consumidor de produção é
`editor/mini-player.tsx`. Corrigir é mover o arquivo, uma mudança em código de
produção fora do escopo do trabalho que criou esta ADR; por isso o desvio
fica congelado, e não escondido.

## Alternativas rejeitadas

**Layout por camada técnica** (`includes/`, `admin/`, `assets/`). A camada não
informa a intenção do código nem permite apagar uma capacidade inteira num só
diretório.

**`shared/` desde o início**, com utilitários genéricos criados antes de
existir um segundo consumidor. Adivinha a fronteira antes de haver um caso
real para testá-la contra.

**Monólito num diretório só**, sem separação alguma. Já eram 10 classes PHP e
~35 módulos TypeScript ainda na Fase 1 — a organização já era necessária antes
mesmo da segunda feature entrar.
