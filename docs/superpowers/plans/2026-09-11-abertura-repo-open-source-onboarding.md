# Abertura do repositório post-voice como open-source + onboarding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar `luigi-moretti/post-voice` público no GitHub com todos os artefatos de onboarding (README, CONTRIBUTING, código de conduta, política de segurança, templates de issue/PR) já no lugar, e branch protection ativa em `master` no instante em que o repo fica público.

**Architecture:** Trabalho quase todo docs-only numa branch, mergeado via PR normal enquanto o repo ainda é privado; só depois do merge o repositório vira público e a proteção de branch é ligada, na mesma sessão, sem janela de exposição.

**Tech Stack:** Markdown, YAML (GitHub issue template config), `gh` CLI, Docker (gitleaks já rodado na fase de spec).

**Spec:** `docs/superpowers/specs/2026-09-11-abertura-repo-open-source-onboarding-design.md`

## Global Constraints

- Repo: `luigi-moretti/post-voice`. Branch de trabalho: `docs/abertura-repo-open-source-onboarding` (já existe, já tem 3 commits da fase de spec).
- Licença permanece GPL-2.0-or-later — não editar `LICENSE`.
- Contato de mantenedor em qualquer doc novo: `luigi@moretti.dev`.
- Nunca commitar ou dar push direto em `master` — sempre via PR (`gh pr create` / `gh pr merge`), conforme CLAUDE.md.
- Gates de `CLAUDE.md` ("Before opening a pull request") são mandatórios antes do PR, mesmo sendo mudança docs-only.
- Branch protection final em `master`: `required_status_checks.contexts = ["lint", "unit", "i18n", "audit"]` (sem `e2e` — pula via path-filter em PR só de docs), `enforce_admins: false`, `required_approving_review_count: 1`.
- Flip de visibilidade pra público e ativação de branch protection são ações irreversíveis/outward-facing — confirmar explicitamente com o usuário no momento da execução, mesmo já aprovadas na spec.
- Toda string nova é conteúdo de repositório (docs/config), não passa por gettext — ADR-0010 não se aplica aqui.

---

## File Structure

```
README.md                                   (novo)
CONTRIBUTING.md                             (novo)
AGENTS.md                                   (novo)
CODE_OF_CONDUCT.md                          (novo)
SECURITY.md                                 (novo)
.distignore                                 (editado — 5 linhas novas)
.github/PULL_REQUEST_TEMPLATE.md            (novo)
.github/ISSUE_TEMPLATE/bug_report.md        (novo)
.github/ISSUE_TEMPLATE/feature_request.md   (novo)
.github/ISSUE_TEMPLATE/question.md          (novo)
.github/ISSUE_TEMPLATE/config.yml           (novo)
.github/assets/hero-demo.gif                (novo, binário — gravado na Task 9)
.github/assets/frontend-player.png          (novo, binário — capturado na Task 9)
post-voice.zip                              (removido — artefato solto na raiz)
```

Nenhum arquivo de código de produto é tocado. `.distignore` é a única edição num arquivo existente.

---

### Task 1: Limpeza — remove o zip solto, fecha o gap do `.distignore`

**Files:**
- Modify: `.distignore`
- Delete: `post-voice.zip` (raiz, untracked)

**Interfaces:**
- Consumes: nada de tarefas anteriores.
- Produces: `.distignore` atualizado — tarefas 2-7 dependem dele já cobrir os docs que vão criar, senão cada novo doc entraria no zip de distribuição do plugin.

- [ ] **Step 1: Remove o artefato solto**

```bash
cd /home/luigi/Documentos/projects/post-voice
rm -f post-voice.zip
```

- [ ] **Step 2: Edita `.distignore`**

Abra `.distignore` e adicione estas 5 linhas junto das outras entradas de arquivo único (perto de `CLAUDE.md`, `TESTING.md`):

```
README.md
CONTRIBUTING.md
AGENTS.md
CODE_OF_CONDUCT.md
SECURITY.md
```

- [ ] **Step 3: Verifica**

```bash
git status --short
```

Esperado: `post-voice.zip` não aparece mais (já não era rastreado, só sumiu do disco); `.distignore` aparece como modificado (`M .distignore`).

- [ ] **Step 4: Commit**

```bash
git add .distignore
git commit -m "chore: remove zip solto da raiz, exclui docs do zip de distribuição do plugin"
```

---

### Task 2: `.github/PULL_REQUEST_TEMPLATE.md`

**Files:**
- Create: `.github/PULL_REQUEST_TEMPLATE.md`

**Interfaces:**
- Consumes: nada.
- Produces: template carregado automaticamente por qualquer PR aberto contra este repo a partir da Task 10 em diante.

- [ ] **Step 1: Cria o diretório e o arquivo**

```bash
mkdir -p .github
```

Escreva `.github/PULL_REQUEST_TEMPLATE.md` com exatamente este conteúdo:

```markdown
## O que muda

<!-- Descreva a mudança e por quê. Se resolve uma issue, referencie: Closes #N -->

## Origem do conteúdo

- [ ] Este PR foi gerado ou assistido por IA (ex: Claude Code, Copilot, Cursor) — se marcado, qual ferramenta: ____
- [ ] Revisei o diff linha a linha e assino como responsável pelo conteúdo, independente da origem.

## Checklist (obrigatório, `wp-env` rodando: `npx wp-env start`)

Rode em ordem — cada gate mais caro que o anterior, fail-fast:

- [ ] `npm run lint:js && npm run lint:arch`
- [ ] `npx tsc --noEmit`
- [ ] `composer run lint && composer run stan`
- [ ] `npm run test:unit -- --coverage`
- [ ] `npm run test:php && npm run test:php:coverage`
- [ ] `npm run i18n:check`
- [ ] `npm run audit:npm:production && npm run audit:npm && npm run audit:composer`
- [ ] `npm run build && npm run test:e2e` (baixa o modelo na primeira vez)
- [ ] `npm run doctor`

Tudo verde localmente antes de abrir o PR — um PR vermelho custa mais tempo
de review do que rodar isso antes. Detalhes de cada gate e limiares:
`TESTING.md`.

Se você usa Claude Code: rode `superpowers:requesting-code-review` antes
de abrir o PR (CLAUDE.md pede isso). Sem Claude Code, não tem problema —
a revisão do mantenedor cobre esse papel.

## Documentos relevantes

<!-- Esta mudança tocou alguma decisão de arquitetura (docs/adr/), o spec
     do MVP, ou o plano de implementação? Se sim, foram atualizados junto? -->

## Notas para quem revisa

<!-- Algo que facilite a revisão: trade-off feito, alternativa descartada,
     área que merece atenção extra. -->
```

- [ ] **Step 2: Verifica**

```bash
test -f .github/PULL_REQUEST_TEMPLATE.md && echo OK
```

- [ ] **Step 3: Commit**

```bash
git add .github/PULL_REQUEST_TEMPLATE.md
git commit -m "chore: adiciona template de pull request"
```

---

### Task 3: Templates de issue + config do seletor

**Files:**
- Create: `.github/ISSUE_TEMPLATE/bug_report.md`
- Create: `.github/ISSUE_TEMPLATE/feature_request.md`
- Create: `.github/ISSUE_TEMPLATE/question.md`
- Create: `.github/ISSUE_TEMPLATE/config.yml`

**Interfaces:**
- Consumes: nada.
- Produces: os 3 templates + config aparecem juntos no seletor "New issue" — agrupados numa task porque formam um único subsistema (o seletor não faz sentido com só parte deles).

- [ ] **Step 1: Cria o diretório**

```bash
mkdir -p .github/ISSUE_TEMPLATE
```

- [ ] **Step 2: `.github/ISSUE_TEMPLATE/bug_report.md`**

```markdown
---
name: Bug report
about: Reportar um comportamento incorreto do plugin
title: "[Bug] "
labels: bug
---

**Descrição**
O que está errado, em 1-2 frases.

**Passos para reproduzir**
1.
2.
3.

**Esperado**
O que deveria acontecer.

**Observado**
O que acontece de fato — inclua mensagem de erro exata, se houver.

**Ambiente**
- Versão do Post Voice:
- Versão do WordPress:
- Versão do PHP:
- Navegador e versão (relevante — TTS roda no navegador):
- Tema/outros plugins que possam interferir:

**Screenshots / console / logs**
Se aplicável. Para erros do worker de TTS, abra o console do navegador
(não só o log do servidor — nada de TTS roda no servidor).
```

- [ ] **Step 3: `.github/ISSUE_TEMPLATE/feature_request.md`**

```markdown
---
name: Feature request
about: Propor uma funcionalidade ou melhoria
title: "[Feature] "
labels: enhancement
---

**Problema**
Que necessidade real motiva isso? (não a solução ainda — o problema.)

**Proposta**
Como você imagina que isso funcionaria.

**Alternativas consideradas**
Outras formas de resolver o mesmo problema, e por que a proposta acima é
melhor (se já pensou nisso).

**Contexto adicional**
Links, exemplos de outros plugins, mockups — o que ajudar.
```

- [ ] **Step 4: `.github/ISSUE_TEMPLATE/question.md`**

```markdown
---
name: Question
about: Dúvida de uso ou técnica que não é bug nem proposta de feature
title: "[Question] "
labels: question
---

**Pergunta**
O que você quer saber.

**Contexto**
O que já tentou e onde já procurou (README, CONTRIBUTING.md, `docs/adr/`)
antes de perguntar — evita resposta que já está documentada.
```

- [ ] **Step 5: `.github/ISSUE_TEMPLATE/config.yml`**

```yaml
blank_issues_enabled: false
contact_links:
  - name: Reportar vulnerabilidade de segurança
    url: https://github.com/luigi-moretti/post-voice/blob/master/SECURITY.md
    about: Não abra isso como issue pública — siga o processo de disclosure privado.
```

- [ ] **Step 6: Verifica os 4 arquivos e valida o YAML**

```bash
ls .github/ISSUE_TEMPLATE/
python3 -c "import yaml; yaml.safe_load(open('.github/ISSUE_TEMPLATE/config.yml'))" && echo "YAML OK"
```

Esperado: lista mostra os 4 arquivos (`bug_report.md`, `feature_request.md`,
`question.md`, `config.yml`); `YAML OK` impresso sem erro de parse.

- [ ] **Step 7: Commit**

```bash
git add .github/ISSUE_TEMPLATE/
git commit -m "chore: adiciona templates de issue (bug/feature/question) e config do seletor"
```

---

### Task 4: `SECURITY.md`

**Files:**
- Create: `SECURITY.md`

**Interfaces:**
- Consumes: nada.
- Produces: URL `https://github.com/luigi-moretti/post-voice/blob/master/SECURITY.md`, referenciada pelo `config.yml` da Task 3.

- [ ] **Step 1: Escreve `SECURITY.md`**

```markdown
# Política de segurança

## Versões suportadas

O projeto está pré-1.0 (`0.5.x`). Só a versão mais recente publicada em
[Releases](https://github.com/luigi-moretti/post-voice/releases) recebe
correção de segurança — sem suporte a versões antigas nesta fase.

## Reportar uma vulnerabilidade

**Não abra uma issue pública.** Envie um email para `luigi@moretti.dev` com:

- Descrição da vulnerabilidade e impacto potencial
- Passos para reproduzir
- Versão do plugin, do WordPress e do PHP em que foi encontrada

Confirmação de recebimento em até 5 dias úteis. O prazo para correção ou
plano de mitigação varia com a gravidade, mas você recebe uma estimativa
dentro desse mesmo prazo inicial. Depois de uma correção publicada, a
vulnerabilidade é divulgada publicamente com crédito a quem reportou,
salvo pedido em contrário.

## Superfície relevante

TTS roda inteiramente no navegador do autor — nenhum texto de post sai do
navegador para gerar áudio (ver `docs/adr/0002-tts-roda-no-navegador.md`).
Isso limita a superfície de servidor aos endpoints REST que recebem o
áudio já gerado (`post-voice/v1`), sua validação, e o armazenamento como
attachment. Vulnerabilidades de XSS/CSRF/validação nesses pontos são o
que mais importa reportar.
```

- [ ] **Step 2: Verifica**

```bash
test -f SECURITY.md && grep -c "luigi@moretti.dev" SECURITY.md
```

Esperado: `1` (arquivo existe, email aparece).

- [ ] **Step 3: Commit**

```bash
git add SECURITY.md
git commit -m "docs: adiciona SECURITY.md com canal de disclosure privado"
```

---

### Task 5: `AGENTS.md`

**Files:**
- Create: `AGENTS.md`

**Interfaces:**
- Consumes: nada.
- Produces: `AGENTS.md` na raiz — README (Task 8) não referencia esse arquivo diretamente (é descoberto por convenção pelas ferramentas de IA), mas deve existir antes do merge (Task 10).

- [ ] **Step 1: Escreve `AGENTS.md`**

```markdown
# AGENTS.md

Este projeto documenta suas regras de desenvolvimento em `CLAUDE.md` —
válido para qualquer ferramenta de IA (Claude Code, Codex, Cursor, Copilot
Workspace, etc), não só para a que dá nome ao arquivo. Leia `CLAUDE.md`
antes de propor ou aplicar qualquer mudança.

Convenções específicas por diretório, quando existem, ficam em
`.claude/rules/` e carregam automaticamente ao abrir um arquivo que elas
cobrem — vale ler as que tocam a área em que você está mexendo.

Os gates obrigatórios antes de abrir um PR estão na seção "Before opening
a pull request" do `CLAUDE.md`; `.github/PULL_REQUEST_TEMPLATE.md` os
repete como checklist.
```

- [ ] **Step 2: Verifica**

```bash
test -f AGENTS.md && echo OK
```

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: adiciona AGENTS.md — onboarding de IA agnóstico de ferramenta"
```

---

### Task 6: `CODE_OF_CONDUCT.md`

**Files:**
- Create: `CODE_OF_CONDUCT.md`

**Interfaces:**
- Consumes: nada.
- Produces: `CODE_OF_CONDUCT.md` na raiz.

- [ ] **Step 1: Escreve `CODE_OF_CONDUCT.md`**

Texto padrão Contributor Covenant v2.1, com o contato de enforcement
preenchido:

```markdown
# Contributor Covenant Code of Conduct

## Our Pledge

We as members, contributors, and leaders pledge to make participation in
our community a harassment-free experience for everyone, regardless of
age, body size, visible or invisible disability, ethnicity, sex
characteristics, gender identity and expression, level of experience,
education, socio-economic status, nationality, personal appearance, race,
religion, or sexual identity and orientation.

We pledge to act and interact in ways that contribute to an open,
welcoming, diverse, inclusive, and healthy community.

## Our Standards

Examples of behavior that contributes to a positive environment for our
community include:

* Demonstrating empathy and kindness toward other people
* Being respectful of differing opinions, viewpoints, and experiences
* Giving and gracefully accepting constructive feedback
* Accepting responsibility and apologizing to those affected by our
  mistakes, and learning from the experience
* Focusing on what is best not just for us as individuals, but for the
  overall community

Examples of unacceptable behavior include:

* The use of sexualized language or imagery, and sexual attention or
  advances of any kind
* Trolling, insulting or derogatory comments, and personal or political
  attacks
* Public or private harassment
* Publishing others' private information, such as a physical or email
  address, without their explicit permission
* Other conduct which could reasonably be considered inappropriate in a
  professional setting

## Enforcement Responsibilities

Community leaders are responsible for clarifying and enforcing our
standards of acceptable behavior and will take appropriate and fair
corrective action in response to any behavior that they deem
inappropriate, threatening, offensive, or harmful.

Community leaders have the right and responsibility to remove, edit, or
reject comments, commits, code, wiki edits, issues, and other
contributions that are not aligned to this Code of Conduct, and will
communicate reasons for moderation decisions when appropriate.

## Scope

This Code of Conduct applies within all community spaces, and also
applies when an individual is officially representing the community in
public spaces. Examples of representing our community include using an
official e-mail address, posting via an official social media account, or
acting as an appointed representative at an online or offline event.

## Enforcement

Instances of abusive, harassing, or otherwise unacceptable behavior may
be reported to the community leaders responsible for enforcement at
luigi@moretti.dev.
All complaints will be reviewed and investigated promptly and fairly.

All community leaders are obligated to respect the privacy and security
of the reporter of any incident.

## Enforcement Guidelines

Community leaders will follow these Community Impact Guidelines in
determining the consequences for any action they deem in violation of
this Code of Conduct:

### 1. Correction

**Community Impact**: Use of inappropriate language or other behavior
deemed unprofessional or unwelcome in the community.

**Consequence**: A private, written warning from community leaders,
providing clarity around the nature of the violation and an explanation
of why the behavior was inappropriate. A public apology may be requested.

### 2. Warning

**Community Impact**: A violation through a single incident or series of
actions.

**Consequence**: A warning with consequences for continued behavior. No
interaction with the people involved, including unsolicited interaction
with those enforcing the Code of Conduct, for a specified period of time.
This includes avoiding interactions in community spaces as well as
external channels like social media. Violating these terms may lead to a
temporary or permanent ban.

### 3. Temporary Ban

**Community Impact**: A serious violation of community standards,
including sustained inappropriate behavior.

**Consequence**: A temporary ban from any sort of interaction or public
communication with the community for a specified period of time. No
public or private interaction with the people involved, including
unsolicited interaction with those enforcing the Code of Conduct, is
allowed during this period. Violating these terms may lead to a permanent
ban.

### 4. Permanent Ban

**Community Impact**: Demonstrating a pattern of violation of community
standards, including sustained inappropriate behavior, harassment of an
individual, or aggression toward or disparagement of classes of
individuals.

**Consequence**: A permanent ban from any sort of public interaction
within the community.

## Attribution

This Code of Conduct is adapted from the [Contributor Covenant][homepage],
version 2.1, available at
[https://www.contributor-covenant.org/version/2/1/code_of_conduct.html][v2.1].

Community Impact Guidelines were inspired by
[Mozilla's code of conduct enforcement ladder][Mozilla CoC].

For answers to common questions about this code of conduct, see the FAQ
at [https://www.contributor-covenant.org/faq][FAQ]. Translations are
available at [https://www.contributor-covenant.org/translations][translations].

[homepage]: https://www.contributor-covenant.org
[v2.1]: https://www.contributor-covenant.org/version/2/1/code_of_conduct.html
[Mozilla CoC]: https://github.com/mozilla/diversity
[FAQ]: https://www.contributor-covenant.org/faq
[translations]: https://www.contributor-covenant.org/translations
```

- [ ] **Step 2: Verifica**

```bash
test -f CODE_OF_CONDUCT.md && grep -c "luigi@moretti.dev" CODE_OF_CONDUCT.md
```

Esperado: `1`.

- [ ] **Step 3: Commit**

```bash
git add CODE_OF_CONDUCT.md
git commit -m "docs: adiciona CODE_OF_CONDUCT.md (Contributor Covenant v2.1)"
```

---

### Task 7: `CONTRIBUTING.md`

**Files:**
- Create: `CONTRIBUTING.md`

**Interfaces:**
- Consumes: nada (comandos citados já existem em `package.json`/`composer.json`; não dependem de tarefa anterior).
- Produces: `CONTRIBUTING.md` — referenciado pelo README (Task 8) e pelo PR template (Task 2, já commitado).

- [ ] **Step 1: Escreve `CONTRIBUTING.md`**

```markdown
# Contribuindo com o Post Voice

Obrigado pelo interesse. Este documento cobre o fluxo de contribuição —
para detalhes de cada gate (limiares de cobertura, timings, como rodar
uma suíte isolada), veja `TESTING.md`. Para as regras de arquitetura,
`CLAUDE.md` e `docs/adr/`.

## Fluxo: fork + pull request

Ninguém além do mantenedor tem push direto em `master`. O fluxo é:

1. Faça um fork deste repositório.
2. Clone o seu fork, crie uma branch a partir de `master`.
3. Implemente, com commits no padrão [Conventional Commits](https://www.conventionalcommits.org/)
   (`feat:`, `fix:`, `docs:`, `chore:`, etc — veja `git log` para exemplos reais).
4. Rode o checklist completo abaixo antes de abrir o PR.
5. Push no seu fork, abra um Pull Request contra `master` deste repositório.
   O template de PR carrega automaticamente.
6. O CI roda sozinho no PR. Revisão humana acontece depois dos checks verdes.

## Setup local

```bash
git clone <seu-fork>
cd post-voice
npm ci                                   # nunca npm install — lockfile é a superfície de auditoria
composer install
npx playwright install --with-deps chromium chromium-headless-shell
npx wp-env start                         # WordPress em localhost:8888
```

Versões exigidas e o que cada comando cobre: `TESTING.md`.

## Loop de desenvolvimento

- **JS/editor**: `npm run start` (webpack em modo watch) recompila
  `build/` a cada save. wp-env já monta o repo direto no container — o
  build novo aparece depois de um refresh manual no navegador.
- **PHP**: **não tem watch.** Editar um `.php` e salvar não é suficiente —
  Docker Desktop cacheia por inode e o opcache mantém a compilação antiga.
  Depois de editar PHP, rode sempre:
  ```bash
  npm run refresh:php
  ```
  antes de testar a mudança no navegador. Esquecer esse passo é o jeito
  mais comum de perder tempo achando que uma mudança "não funcionou".

## Checklist antes de abrir o PR

Mandatório, nesta ordem — mais barato primeiro, falha rápido. `wp-env`
precisa estar rodando (`npx wp-env start`):

```bash
npm run lint:js && npm run lint:arch
npx tsc --noEmit
composer run lint && composer run stan
npm run test:unit -- --coverage
npm run test:php && npm run test:php:coverage
npm run i18n:check
npm run audit:npm:production && npm run audit:npm && npm run audit:composer
npm run build && npm run test:e2e    # baixa o modelo na primeira vez
npm run doctor
```

O `.github/PULL_REQUEST_TEMPLATE.md` repete essa lista como checklist do
PR — marque cada item depois de rodar, não antes. Se algo falhar, corrija
antes de abrir o PR: um PR vermelho custa mais tempo de review do que
rodar isso localmente primeiro.

## Contribuição assistida por IA

Bem-vinda, com uma condição: você é responsável pelo conteúdo do PR
independente de quem/o que escreveu, e o template de PR pede pra declarar
a ferramenta usada. Revise a saída da IA como revisaria a sua própria —
ela passa pelos mesmos gates e pela mesma revisão humana.

## Dúvidas

Abra uma issue com o template "Question" antes de perguntar dentro de um
PR já aberto — mantém a thread do PR focada no código.
```

- [ ] **Step 2: Verifica**

```bash
test -f CONTRIBUTING.md && echo OK
```

- [ ] **Step 3: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: adiciona CONTRIBUTING.md — fluxo fork+PR, setup local, checklist de gates"
```

---

### Task 8: `README.md`

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: referencia `.github/assets/hero-demo.gif` e `.github/assets/frontend-player.png`, que só existem de fato depois da Task 9 — os `<img>`/`![]()` ficam quebrados até lá, o que é aceitável porque o merge (Task 10) só acontece depois da Task 9.
- Produces: `README.md` — landing page do GitHub.

- [ ] **Step 1: Escreve `README.md`**

```markdown
# Post Voice

[![CI](https://github.com/luigi-moretti/post-voice/actions/workflows/ci.yml/badge.svg)](https://github.com/luigi-moretti/post-voice/actions/workflows/ci.yml)
[![License: GPL-2.0-or-later](https://img.shields.io/badge/license-GPL--2.0--or--later-blue.svg)](LICENSE)

> Narração de posts gerada no navegador do autor — sem TTS no servidor, sem custo por requisição.

![Gerando narração no editor de blocos](.github/assets/hero-demo.gif)

## O que é

Post Voice adiciona um painel "Narração" ao editor de blocos do
WordPress. O autor escolhe um idioma, gera o áudio localmente no
navegador (Pocket TTS via ONNX, rodando num Web Worker), confere o
preview e salva. O PHP nunca sintetiza voz — só grava o áudio já pronto
como attachment e registra os metadados do post.

## Recursos

- Painel de Narração no editor de blocos
- Player flutuante no front-end para os leitores
- Dicionário de pronúncia — corrige como palavras específicas são lidas
- Customização do estilo do player (tela de admin)

![Player flutuante no front-end](.github/assets/frontend-player.png)

## Requisitos

- WordPress 6.6+
- PHP 8.2+
- HTTPS — Web Crypto API e AudioWorklet só funcionam em contexto seguro
- Navegador moderno (Chrome, Firefox, Safari, Edge recentes)

## Usar em um site

Ainda não está no WordPress.org. Pra instalar:

1. Baixe o zip da [última release](https://github.com/luigi-moretti/post-voice/releases/latest).
2. No admin do WordPress: **Plugins → Add New → Upload Plugin**.
3. Selecione o zip baixado, instale e ative.

## Contribuir

```bash
git clone <seu-fork>
cd post-voice
npm ci
composer install
npx wp-env start
npm run build
```

Fluxo completo de contribuição (fork, PR, checklist de gates, convenção
de commit): [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Docs

- [`docs/adr/`](docs/adr/README.md) — decisões de arquitetura
- [Spec do MVP](docs/superpowers/specs/2026-08-08-wp-narration-plugin-mvp-design.md)
- [`TESTING.md`](TESTING.md) — como rodar cada gate

## Licença

GPL-2.0-or-later — ver [`LICENSE`](LICENSE). Código de terceiros vendored
está documentado em [`CREDITS.md`](CREDITS.md).
```

- [ ] **Step 2: Verifica links relativos**

```bash
for f in CONTRIBUTING.md docs/adr/README.md docs/superpowers/specs/2026-08-08-wp-narration-plugin-mvp-design.md TESTING.md LICENSE CREDITS.md; do
  test -f "$f" && echo "OK $f" || echo "FALTA $f"
done
```

Esperado: `OK` em todas as 6 linhas (todos já existem no repo, exceto
`CONTRIBUTING.md` que a Task 7 já criou).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: adiciona README.md — landing page do repositório"
```

---

### Task 9: Captura de mídia — GIF hero e screenshot

**Files:**
- Create: `.github/assets/hero-demo.gif`
- Create: `.github/assets/frontend-player.png`

**Interfaces:**
- Consumes: `README.md` (Task 8) já referencia esses dois caminhos.
- Produces: as duas mídias — fecha as referências quebradas deixadas pela Task 8.

- [ ] **Step 1: Sobe o ambiente**

```bash
npx wp-env start
npm run build
```

- [ ] **Step 2: Grava o GIF hero**

Use a skill `run` (que sabe como subir e dirigir este app) junto de
`claude-in-chrome` pra gravar, via `mcp__claude-in-chrome__gif_creator`:
abrir o editor de blocos num post de teste, abrir o painel "Narração",
escolher um idioma, clicar em gerar, esperar a barra de progresso, tocar
o preview. ~10-15 segundos, em loop. Salvar como
`.github/assets/hero-demo.gif`.

- [ ] **Step 3: Captura o screenshot do player**

Com o mesmo post publicado (ou preview) no front-end, usar
`mcp__claude-in-chrome__computer` (screenshot) pra capturar o player
flutuante em uso. Salvar como `.github/assets/frontend-player.png`.

- [ ] **Step 4: Verifica**

```bash
mkdir -p .github/assets
ls -la .github/assets/hero-demo.gif .github/assets/frontend-player.png
```

Esperado: os dois arquivos existem, tamanho > 0.

- [ ] **Step 5: Confere que o README renderiza as duas mídias**

Abra `README.md` numa preview de Markdown local (ou `gh repo view --web`
depois do push) e confirme visualmente que o GIF anima e o PNG carrega.

- [ ] **Step 6: Commit**

```bash
git add .github/assets/hero-demo.gif .github/assets/frontend-player.png
git commit -m "docs: adiciona GIF de demo e screenshot do player pro README"
```

---

### Task 10: Gates completos + abre o PR

**Files:** nenhum arquivo novo — task de validação e integração.

**Interfaces:**
- Consumes: todo o conteúdo das Tasks 1-9.
- Produces: PR aberto contra `master`, pronto pra merge (Task 11).

- [ ] **Step 1: Confirma `wp-env` rodando**

```bash
npx wp-env start
```

- [ ] **Step 2: Roda o checklist completo, na ordem**

```bash
npm run lint:js && npm run lint:arch
npx tsc --noEmit
composer run lint && composer run stan
npm run test:unit -- --coverage
npm run test:php && npm run test:php:coverage
npm run i18n:check
npm run audit:npm:production && npm run audit:npm && npm run audit:composer
npm run build && npm run test:e2e
npm run doctor
```

Esperado: todos verdes. Se algum falhar, pare e reporte — não segue pra
Task 11 com gate vermelho (CLAUDE.md: "If anything fails, stop and
present correction plans").

- [ ] **Step 3: Push da branch**

```bash
git push -u origin docs/abertura-repo-open-source-onboarding
```

- [ ] **Step 4: Abre o PR**

```bash
gh pr create \
  --base master \
  --head docs/abertura-repo-open-source-onboarding \
  --title "docs: abertura do repositório como open-source + onboarding" \
  --body "Implementa a spec docs/superpowers/specs/2026-09-11-abertura-repo-open-source-onboarding-design.md: README, CONTRIBUTING, AGENTS.md, CODE_OF_CONDUCT, SECURITY.md, templates de issue/PR. Repo ainda privado neste momento — flip pra público e branch protection acontecem depois do merge, como passo separado."
```

- [ ] **Step 5: Verifica**

```bash
gh pr view --json state,mergeable,statusCheckRollup
```

Esperado: `state: OPEN`. `statusCheckRollup` mostra os checks do CI
rodando/verdes (repo ainda privado, sem branch protection, mas o
workflow do CI roda do mesmo jeito em `pull_request`).

---

### Task 11: Merge do PR

**Files:** nenhum.

**Interfaces:**
- Consumes: PR aberto na Task 10.
- Produces: `master` com todo o conteúdo das Tasks 1-9.

- [ ] **Step 1: Confirma CI verde no PR**

```bash
gh pr checks
```

Esperado: todos os checks passando.

- [ ] **Step 2: Merge (merge commit, não squash — mesmo padrão dos PRs anteriores do repo)**

```bash
gh pr merge --merge
```

- [ ] **Step 3: Verifica**

```bash
git fetch origin master
git log origin/master -1 --oneline
```

Esperado: o commit de merge aparece no topo de `origin/master`.

---

### Task 12: Flip do repositório para público

**Files:** nenhum — ação de configuração via `gh`.

**Interfaces:**
- Consumes: `master` atualizado (Task 11).
- Produces: repositório público — habilita a API de branch protection pra Task 13.

**Antes de rodar o Step 1: esta é uma ação irreversível de fato (o
histórico completo fica público, sem volta fácil). Confirme com o
usuário neste exato momento da execução, mesmo já aprovado na spec —
não prossiga sem um "sim" explícito nesta conversa.**

- [ ] **Step 1: Confirma com o usuário, depois torna o repositório público**

```bash
gh repo edit luigi-moretti/post-voice --visibility public
```

- [ ] **Step 2: Verifica**

```bash
gh repo view --json isPrivate
```

Esperado: `{"isPrivate":false}`.

---

### Task 13: Branch protection imediata + validação final

**Files:** nenhum.

**Interfaces:**
- Consumes: repo público (Task 12).
- Produces: `master` protegida. Última tarefa do plano.

- [ ] **Step 1: Liga branch protection — na mesma sessão que a Task 12, sem pausa**

```bash
gh api repos/luigi-moretti/post-voice/branches/master/protection \
  --method PUT \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["lint", "unit", "i18n", "audit"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1
  },
  "restrictions": null
}
JSON
```

- [ ] **Step 2: Verifica a proteção**

```bash
gh api repos/luigi-moretti/post-voice/branches/master/protection
```

Esperado: HTTP 200 (não mais o 403 da investigação da spec), corpo
mostra `required_pull_request_reviews.required_approving_review_count: 1`
e `required_status_checks.contexts` com os 4 jobs.

- [ ] **Step 3: Roda a checklist de validação completa da spec**

```bash
# Repo público
gh repo view --json isPrivate
# esperado: false

# .distignore não empacota os docs novos
./scripts/build-plugin-zip.sh 0.0.0-test 2>&1 | tail -5
unzip -l post-voice-0.0.0-test.zip | grep -E "README|CONTRIBUTING|AGENTS|CODE_OF_CONDUCT|SECURITY" || echo "nenhum doc no zip — correto"
rm -f post-voice-0.0.0-test.zip

# templates aparecem
gh api repos/luigi-moretti/post-voice/contents/.github/ISSUE_TEMPLATE --jq '.[].name'
```

Esperado: `isPrivate: false`; "nenhum doc no zip — correto" impresso;
listagem do `.github/ISSUE_TEMPLATE/` mostra os 4 arquivos.

- [ ] **Step 4: Reporta ao usuário**

Sem commit nesta task (é só configuração remota + validação). Resuma pro
usuário: repo público, URL final, branch protection ativa com os
contexts e approvals configurados, link do PR mergeado.

---

## Self-Review

**Cobertura da spec:** README (Task 8), CONTRIBUTING (Task 7), AGENTS.md
(Task 5), CODE_OF_CONDUCT (Task 6), SECURITY.md (Task 4), templates de
issue/PR + config.yml (Tasks 2-3), `.distignore` + remoção do zip solto
(Task 1), captura de mídia (Task 9), ordem de execução docs→merge→flip→
proteção (Tasks 10-13) — todas as seções da spec têm task correspondente.
WP.org e watcher de PHP ficam fora, conforme "Fora de escopo" da spec.

**Placeholder scan:** nenhum "TBD"/"implementar depois" — todo arquivo
tem conteúdo literal completo, copiado da spec já revisada.

**Consistência:** caminhos (`.github/assets/hero-demo.gif`,
`.github/assets/frontend-player.png`) idênticos entre Task 8 (README que
os referencia) e Task 9 (que os cria). Contexts de branch protection
(`lint`, `unit`, `i18n`, `audit`) idênticos entre spec e Task 13 —
confirmados como job IDs reais de `ci.yml` (sem `name:` override, sem
matrix, então o nome do check bate literalmente). Nomes de arquivo do
`.distignore` (Task 1) batem com os 5 docs criados nas Tasks 4-8.

**Divergências achadas numa segunda revisão (pós-escrita) e corrigidas:**
Task 12 usava `gh repo edit --visibility public --accept-visibility-change-consequences`
— flag inventada, não existe no `gh` 2.45.0 instalado (`gh repo edit --help`
não lista); comando quebraria na execução real. Corrigido para
`gh repo edit --visibility public`. Task 11 usava
`gh pr merge --merge --delete-branch=false` — `--delete-branch` é
booleana sem valor conforme `gh pr merge --help`, sem confirmação de que
aceita `=false`; como o default já é não deletar, a flag era redundante
e arriscada — removida.
