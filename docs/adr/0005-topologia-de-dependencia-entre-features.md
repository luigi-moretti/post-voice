---
id: 0005
titulo: Topologia de dependência entre features
status: aceita-com-desvio
data: 2026-08-27
origem: superpowers/specs/2026-08-25-adr-e-governanca-de-arquitetura-design.md#estado-atual-medido
enforced_by: [ feature-deps ]
revisar_quando: uma quarta feature entrar, ou uma extensão passar narration em número de classes, ou a lista de desvios abaixo chegar a zero
desvios:
  - features/player-style/php/class-style-section.php → Post_Voice_Frontend_Render
  - features/pronunciation/php/class-dictionary-section.php → Post_Voice_Model
  - features/pronunciation/php/class-dictionary-store.php → Post_Voice_Model
  - features/narration/editor/index.tsx → pronunciation/editor/register-narration-extension
  - features/pronunciation/editor/register-narration-extension.ts → narration/editor/dictionary-extension
  - features/pronunciation/editor/dictionary-panel.tsx → narration/editor/model-source
  - features/pronunciation/editor/dictionary-entry.ts → narration/editor/model-source
---

## Contexto

O `CLAUDE.md` dizia *"shared code moves to `shared/` only when a second
feature actually needs it"*, mas nunca disse o que fazer quando a feature A
precisa da **feature B inteira**. Sem regra, cada caso resolveu com uma
referência direta, e a medição de 2026-08-25 encontrou onze arestas formando
os ciclos `narration ↔ pronunciation` e `narration ↔ player-style`, nas duas
linguagens. A causa raiz é a regra que faltava, não descuido: `shared/`
responde "dois consumidores do mesmo utilitário", e nenhuma das onze arestas
é isso.

A forma real do sistema também importa. `features/` sugere pares
independentes; a realidade é um núcleo com duas extensões. `narration` tem 5
das 10 classes PHP e ~24 dos 33 módulos TypeScript do plugin;
`pronunciation` e `player-style` modificam o comportamento dela e nenhuma faz
sentido sozinha. A decisão que nunca foi tomada é: `narration` pode nomear
suas extensões, ou elas se plugam nela?

## Decisão

Uma feature não referencia outra feature. O que atravessa a fronteira vai
para `shared/` (utilitário com dois consumidores, ADR-0004) ou passa por um
ponto de extensão que o núcleo publica. As onze arestas existentes ficam
congeladas na lista de `desvios:` do front-matter: valem enquanto estiverem
listadas, e uma décima segunda reprova o CI.

Congelar em vez de corrigir é deliberado. O guard rail passa a valer
imediatamente, a refatoração custa zero agora, e a saída fica desenhada (ver
"Saída conhecida") em vez de virar uma linha em `FOLLOW-UPS.md`.

## Consequências

Fica mais fácil: a deriva para. Uma décima segunda aresta reprova o CI
citando esta ADR, e a lista mede exatamente quanto teoria e implementação
divergem. O aviso de dívida quitada faz a lista encolher em vez de
fossilizar.

Fica mais difícil: as onze continuam lá, e o código não fica mais limpo
hoje. Quem inverter uma delas paga o custo medido no spike, e precisa
removê-la da lista — senão o lint acusa dívida já quitada ainda listada.

## Saída conhecida

Das onze arestas, só cinco (1, 2, 7, 8 e 9) fazem o núcleo depender do
satélite e formam os dois ciclos; as outras seis já apontam satélite →
núcleo, a direção que "pronunciation e player-style se pluguem em narration"
pede.

- **Fazer agora, independente de qualquer decisão sobre ciclo:** mover
  `ALLOWED_LANGUAGES` para um dono próprio dentro de `narration` (arestas 4 e
  5) e `auth_callback` para `shared/` (aresta 6) — relocações, não
  inversões: nenhum filtro novo, nenhum teste quebra, e corrigem uma classe
  de transporte HTTP guardando a lista de idiomas do modelo.
- **Não inverter:** arestas 3, 10 e 11 — já apontam satélite → núcleo;
  inverter recriaria o anti-padrão ao contrário.
- **Não inverter agora** as arestas 1, 2, 7, 8 e 9. Cada mecanismo medido
  custa algo real: um filtro público (1, 2) vira compromisso de
  compatibilidade que ninguém pediu; a extensão registrada (7-9) exige um
  segundo bundle webpack e uma ordem de carga nova. Nada no projeto hoje
  exige `narration` rodando com as duas extensões desligadas. Se esse
  requisito aparecer, a ordem é aresta 1, depois 2, depois 7-9 por último.

Detalhe completo, por mecanismo:
`docs/research/2026-08-27-custo-inversao-arestas-cross-feature.md`.

## Como verificar

`feature-deps`, em PHP e em TypeScript. Em PHP: um `Post_Voice_*` cuja
classe é declarada em outra feature; comentários são ignorados, strings
não — a aresta 6 é um callable em string (`array( 'Post_Voice_Post_Meta',
'auth_callback' )`) e sumiria se strings fossem descartadas junto com
comentários. Em TypeScript: um import relativo que sobe até
`features/<outra>/`. Classes e módulos de `shared/` nunca contam como
aresta, nas duas linguagens.

## Alternativas rejeitadas

**Corrigir as onze agora.** Mudança em código de produção com risco real, no
meio de um trabalho de documentação; o spike mede primeiro.

**Trocar o layout para `core/` + `extensions/`.** O que falhou foi a regra
de dependência, ortogonal ao layout: reorganizar as pastas deixaria os
mesmos onze ciclos no lugar, e a decisão que falta vale igual em qualquer
layout.

**Permitir aresta em direção única, do núcleo para as extensões.** Não
descreve o que existe: das onze, seis saem de uma extensão para o núcleo.
Uma regra que já nasce com metade dos casos como exceção não é regra.

**Não ter regra.** É o estado que produziu os ciclos.
