# Post Voice — Abertura do repositório como open-source + onboarding de contribuidor

**Data:** 2026-09-11
**Status:** Aprovado para plano de implementação

## Contexto

`post-voice` é hoje um repositório privado no GitHub (`luigi-moretti/post-voice`).
Governança técnica já é madura — `docs/adr/` com 16 ADRs, CI cobrindo lint,
arquitetura, testes PHP/JS, e2e, auditoria de dependências, releases
automatizados via tag (`v0.1.0`…`v0.5.1`, cada um com zip publicado por
`.github/workflows/release-assets.yml`). O que falta é a camada social/de
entrada: nada explica a um dev (humano ou IA) de fora como contribuir, e o
repo não tem os artefatos que o GitHub e o ecossistema open-source esperam
(README, CONTRIBUTING, licença de conduta, etc).

Objetivo desta spec: tornar o repositório público, com onboarding claro para
contribuidores externos — humanos e ferramentas de IA agnósticas de
fornecedor. Publicação no WordPress.org fica para uma spec futura separada
(prioridade explícita do usuário: abrir o repo primeiro).

## Decisões já fechadas (não reabrir sem motivo novo)

| Decisão | Escolha | Por quê |
|---|---|---|
| Escopo desta spec | Abertura do repo + onboarding | WP.org é subsistema independente, spec própria depois |
| Modelo de contribuição | Fork + PR revisado, sem CLA/DCO | Padrão universal em open-source, zero fricção extra; GPL do repo já cobre a licença de qualquer contribuição por convenção |
| Licença | Mantém GPL-2.0-or-later | Já é a exigida pelo WP.org (fase futura) e já validada contra código Apache-2.0 vendored em `CREDITS.md` |
| Onboarding de IA | Agnóstico de ferramenta | `AGENTS.md` novo, aponta para as mesmas regras do `CLAUDE.md` sem duplicar conteúdo — não exclui quem usa outra ferramenta |
| README | Completo, com GIF + screenshot | Ver seção "Estrutura do README" abaixo — estrutura fechada, sem ponto em aberto |
| Código de conduta | Contributor Covenant padrão | Contato: `luigi@moretti.dev` |
| Política de segurança | `SECURITY.md` com canal privado | Contato: `luigi@moretti.dev` — plugin roda em site de terceiros, precisa de disclosure responsável antes de virar issue pública |
| Templates de issue/PR | bug report + feature request + PR checklist | PR template espelha a lista "Before opening a pull request" do `CLAUDE.md` |
| Hot-reload PHP | Só documentar o fluxo manual existente | `npm run start` (JS, watch) + `npm run refresh:php` (PHP, manual) — sem construir watcher novo; fora de escopo |
| Ordem de execução | Docs primeiro (privado) → flip público → branch protection imediata | Ver "Ordem de execução" abaixo |
| Captura de GIF/screenshot | Dentro do escopo, como tarefa de implementação | Usa skill `run` + `claude-in-chrome`; não é decisão de arquitetura, é execução |

## Achados da investigação (2026-09-11)

- **Scan de segredos no histórico completo**: `gitleaks detect --log-opts="--all"`
  via Docker, 320 commits escaneados, **zero leak**. Repo pode abrir com
  segurança quanto a esse risco.
- **`post-voice.zip` solto na raiz**: artefato de build manual, não bate o
  padrão `post-voice-*.zip` do `.gitignore` (falta o hífen). Remover — não é
  risco de segredo, é lixo de working tree.
- **Branch protection em `master` não existe** (memória do usuário estava
  errada). Confirmado via `gh api repos/luigi-moretti/post-voice/branches/master/protection`
  → 403 "Upgrade to GitHub Pro or make this repository public to enable this
  feature". GitHub Free bloqueia proteção de branch em repo privado — só
  fica disponível **depois** do flip para público. Isso define a ordem de
  execução abaixo.
- **Releases já existem e já publicam zip**: `v0.1.0`…`v0.5.1` no GitHub
  Releases, cada um com `post-voice-X.Y.Z.zip` anexado por
  `release-assets.yml`. A seção "Usar em um site" do README pode apontar
  para `releases/latest` de verdade, não é promessa vazia.
- **`.distignore` já exclui `.github/` e `docs/`** do zip de distribuição do
  plugin (filosofia declarada no próprio arquivo: só o que o WordPress
  precisa pra rodar). Isso decide onde as mídias do README vivem (ver
  abaixo) e expõe um gap: `README.md`, `CONTRIBUTING.md`, `AGENTS.md`,
  `CODE_OF_CONDUCT.md`, `SECURITY.md` **não** estão na lista — hoje seriam
  empacotados no zip do plugin. Corrigir adicionando as 5 ao `.distignore`
  (consistente com a filosofia já documentada ali, não é decisão nova).

## Inventário de arquivos

| Arquivo | Ação | Conteúdo |
|---|---|---|
| `README.md` | criar | Ver "Estrutura do README" |
| `.github/assets/hero-demo.gif` | criar | Gravação: editor de blocos → painel "Narração" → escolhe idioma → gera → progresso → preview toca. ~10–15s, loop. |
| `.github/assets/frontend-player.png` | criar | Screenshot estático do player flutuante no front-end, em um post real. |
| `CONTRIBUTING.md` | criar | Fluxo fork+PR (linkando a explicação já dada nesta conversa em linguagem própria do doc), setup local (`npx wp-env start`), os dois comandos de hot-reload (`npm run start`, `npm run refresh:php`) com a explicação do gotcha do CLAUDE.md, checklist completo de gates copiado de "Before opening a pull request" do CLAUDE.md, convenção de commit (Conventional Commits — já em uso, ver `git log`) |
| `AGENTS.md` | criar | Curto: aponta para `CLAUDE.md` como fonte de verdade das regras do projeto, nota que `.claude/rules/` tem convenções por path, sem duplicar conteúdo |
| `CODE_OF_CONDUCT.md` | criar | Contributor Covenant v2.1 (texto padrão do GitHub), contato `luigi@moretti.dev` |
| `SECURITY.md` | criar | Versões suportadas (só a mais recente, plugin pré-1.0), canal de report privado por email `luigi@moretti.dev` com pedido de não abrir issue pública antes de resposta, prazo alvo de resposta |
| `.github/ISSUE_TEMPLATE/bug_report.md` | criar | Campos: versão do plugin, versão WP/PHP, navegador, passos, esperado vs. observado |
| `.github/ISSUE_TEMPLATE/feature_request.md` | criar | Campos: problema que motiva, proposta, alternativas consideradas |
| `.github/PULL_REQUEST_TEMPLATE.md` | criar | Checklist = mesma lista do CLAUDE.md "Before opening a pull request", em ordem, como caixas de marcar |
| `.distignore` | editar | Adiciona `README.md`, `CONTRIBUTING.md`, `AGENTS.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` à lista de exclusão do zip de distribuição |
| `post-voice.zip` (raiz) | remover | Artefato solto, não rastreado, não serve pra nada |

## Estrutura do README (fechada, sem ponto em aberto)

Ordem exata das seções, com o que cada uma cobre:

1. **Título + tagline + badges** — `# Post Voice`; badge de status do CI
   (`ci.yml`); badge de licença GPL-2.0-or-later. Tagline de uma linha:
   narração gerada no navegador do autor, sem TTS no servidor, sem custo por
   requisição.
2. **GIF hero** (`.github/assets/hero-demo.gif`), logo abaixo da tagline —
   único vídeo do README, mostra o fluxo completo de geração.
3. **O que é** — um parágrafo: TTS 100% client-side (Pocket TTS via ONNX
   num Web Worker), PHP só grava o áudio pronto como attachment e post meta.
4. **Recursos** — lista das 4 capacidades reais (mapeadas de `features/`):
   painel de Narração no editor de blocos; player flutuante no front-end;
   dicionário de pronúncia (overrides de palavras); customização do estilo
   do player (admin).
5. **Screenshot** (`.github/assets/frontend-player.png`) — logo após
   Recursos, mostra o player flutuante em uso.
6. **Requisitos** — WP 6.6+, PHP 8.2+, HTTPS obrigatório (Web Crypto e
   AudioWorklet exigem contexto seguro), navegador moderno.
7. **Usar em um site** — ainda não está no WordPress.org; baixar o zip da
   [última release](https://github.com/luigi-moretti/post-voice/releases/latest),
   `Plugins → Add New → Upload Plugin`, ativar.
8. **Contribuir** — quickstart: clone, `npm ci`, `composer install`,
   `npx wp-env start`, `npm run build`; aponta para `CONTRIBUTING.md` para
   o fluxo completo e a lista de gates.
9. **Docs** — links para `docs/adr/README.md`, a spec MVP
   (`docs/superpowers/specs/2026-08-08-wp-narration-plugin-mvp-design.md`),
   `TESTING.md`.
10. **Licença** — GPL-2.0-or-later, link para `LICENSE`; nota que código
    vendored está documentado em `CREDITS.md`.

## Ordem de execução

Aprovada como "Approach C" com ajuste pela investigação de branch
protection:

1. Criar/editar todos os arquivos do inventário acima, ainda com o repo
   **privado**. Commit numa branch, PR normal (fluxo interno de sempre —
   ninguém de fora ainda tem acesso).
2. Gravar GIF hero e tirar o screenshot (via skill `run` +
   `claude-in-chrome`, app rodando em `wp-env`), salvar em
   `.github/assets/`.
3. Merge do PR em `master`. Rodar gates normais do CLAUDE.md antes (é
   trabalho docs-only, mas os gates continuam mandatórios).
4. Flip do repositório para público (`gh repo edit --visibility public`
   ou GitHub UI — ação irreversível de fato, confirmar com o usuário no
   momento da execução mesmo já combinado aqui).
5. **Imediatamente em seguida**, mesma sessão/comando, sem pausa: ligar
   branch protection em `master` via `gh api` —
   PR obrigatório antes de merge, checks do CI (`lint`, `test`, etc.)
   obrigatórios e verdes, sem push direto (nem do próprio dono, salvo
   override explícito de admin). Fecha a janela entre "público" e
   "protegido" a segundos, não a um passo manual futuro.

## Validação — "pronto quando"

- `npm run doctor` continua verde.
- `npm run lint:js && npm run lint:arch` passam (arquivos novos são
  docs/templates, não deveriam tocar essas regras, mas roda por
  precaução).
- `gh api repos/luigi-moretti/post-voice/branches/master/protection`
  retorna 200 depois do passo 5, com `required_pull_request_reviews` e
  `required_status_checks` configurados.
- Repo aparece público (`gh repo view --json isPrivate` → `false`).
- README renderiza corretamente na preview do GitHub (links relativos
  batem, GIF e screenshot carregam).
- Abrir um PR de teste dispara automaticamente o `PULL_REQUEST_TEMPLATE.md`
  e os templates de issue aparecem ao clicar "New issue".
- `scripts/build-plugin-zip.sh` (rodado localmente, sem publicar release)
  confirma que o zip de distribuição não inclui `README.md`,
  `CONTRIBUTING.md`, `AGENTS.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`.

## Fora de escopo (specs futuras)

- **Publicação no WordPress.org**: finalizar `readme.txt` (hoje tem
  placeholder `Contributors: (your wordpress.org username...)`), processo
  de review do WP.org, assets de listing (banner, ícone), SVN. Spec
  própria, priorizada depois desta.
- **Watcher automático de PHP** (auto-`refresh:php` em save): melhoria de
  DX, não bloqueia onboarding — fica documentado como fluxo manual por
  enquanto.
