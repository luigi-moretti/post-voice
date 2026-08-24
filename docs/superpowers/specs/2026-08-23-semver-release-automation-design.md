# Post Voice — Versionamento semântico automático e asset de release

**Data:** 2026-08-23
**Status:** Aprovado para planejamento de implementação

## Contexto

Hoje a versão do plugin é hardcoded em 3 lugares (`package.json`, header
`Version:` + constante `POST_VOICE_VERSION` em `post-voice.php`, `Stable tag:`
em `readme.txt`), atualizada manualmente, sem tags git e sem artefato de
release. Objetivo: a cada merge em `master`, calcular a próxima versão
semântica a partir dos commits (Conventional Commits, já em uso no projeto),
taggear, publicar uma GitHub Release e anexar o zip instalável do plugin —
sem passo manual.

## Decisões já fechadas (não reabrir sem motivo novo)

| Decisão | Escolha | Por quê |
|---|---|---|
| Ferramenta de versionamento | [semantic-release](https://semantic-release.gitbook.io/) | Zero-fricção: cada push em `master` já vira release, sem PR de release intermediário. Alternativa avaliada e descartada por ora: release-please (PR de release com checkpoint de revisão antes de taggear) — ver "Alternativa descartada" abaixo |
| CHANGELOG | Só GitHub Releases (notas geradas por `release-notes-generator`) | Sem `CHANGELOG.md` versionado no repo — evita um commit de bump a mais toda release |
| Distribuição | Só GitHub Release + zip | Sem deploy SVN para wordpress.org nesta spec — plugin ainda privado/não distribuído lá; deploy SVN fica para spec própria quando/se o plugin ganhar slug aprovado |
| Arquitetura | 2 workflows desacoplados | Motor de versão (`release.yml`) e build do asset (`release-assets.yml`) não se conhecem — trocar de ferramenta de versionamento no futuro (ex. migrar para release-please) toca só o primeiro |
| Gate de qualidade | `release.yml` só roda após `ci.yml` fechar verde em `master` | Push a `master` já dispara o `ci.yml` existente (lint/unit/php/i18n/e2e/audit); taggear antes disso arriscaria publicar código que o próprio CI reprova minutos depois |
| Token do Workflow A | PAT fine-grained (só este repo, `Contents: Read and write`), em secret `SEMANTIC_RELEASE_TOKEN` | `GITHUB_TOKEN` padrão não dispara outros workflows (trava de segurança do GitHub Actions contra loop) — se semantic-release criasse a release com ele, o evento `release: published` nunca chegaria em `release-assets.yml`, falha silenciosa. Workflow B não precisa de PAT: nada depende do que ele dispara depois |
| Tag inicial | Criar `v0.1.0` manualmente em `master` antes do primeiro run do Workflow A | semantic-release sem nenhuma tag prévia trata o repo como primeiro release e computa a partir de `1.0.0` do zero — ignoraria o `0.1.0` já hardcoded nos 3 arquivos e divergiria silenciosamente do que já existe |

### Alternativa descartada: release-please

Mantém um PR "release X.Y.Z" acumulando bump de versão + changelog a cada
push em `master`; só quando esse PR é mergeado manualmente é que a tag/release
sai de fato. Dá um checkpoint de revisão antes de qualquer coisa virar
pública — útil se quiser agrupar vários merges numa release só, editar o
changelog antes de publicar, ou ter uma rede de segurança contra um commit
classificado errado (`feat!` sem querer virando bump maior). Descartado agora
porque contradiz o requisito explícito de "toda vez que merge completar,
gerar versão" e o risco de release prematura é baixo (repo privado, plugin
ainda não distribuído). Migração para essa alternativa depois é barata — ver
"Custo de trocar de ferramenta depois".

## Arquitetura

Dois workflows GitHub Actions, desacoplados por evento:

```
merge → master
  └─ ci.yml (já existe) roda lint/unit/php/i18n/e2e/audit
       └─ conclusion == success
            └─ release.yml (workflow_run) ─ semantic-release
                 ├─ calcula versão (commit-analyzer)
                 ├─ bump nos 3 arquivos (exec)
                 ├─ commit `chore(release): X.Y.Z [skip ci]` (git)
                 └─ cria tag vX.Y.Z + GitHub Release (github)
                      └─ release: published
                           └─ release-assets.yml
                                ├─ checkout na tag, build de produção
                                ├─ zip respeitando .distignore
                                └─ gh release upload
```

`release.yml` dispara via `workflow_run: { workflows: ["CI"], types:
[completed], branches: [master] }` — `"CI"` é o **nome do workflow**
(campo `name:` no topo de `ci.yml`), não nome de job; o filtro
`branches: [master]` é necessário porque `ci.yml` também roda em
`pull_request` de qualquer branch, e só a execução pós-merge em `master`
deve poder gerar release. O job então checa
`github.event.workflow_run.conclusion == 'success'` antes de prosseguir —
nunca em resposta direta a `push`, para não correr em paralelo com o
próprio CI que ainda pode reprovar o commit.

`release-assets.yml` dispara em `release: types: [published]`, mais
`workflow_dispatch` (input `tag`) como reforço manual caso o build do zip
falhe e precise ser reprocessado sem recriar a release.

`concurrency: group: release-master, cancel-in-progress: false` em
`release.yml` — serializa releases que terminem de validar CI quase ao mesmo
tempo, sem cancelar um no meio.

## Workflow A — `release.yml`

Job com `permissions: contents: write`. Steps: checkout, `actions/setup-node@v4`,
`npm ci`, `npx semantic-release` com `env: GH_TOKEN:
${{ secrets.SEMANTIC_RELEASE_TOKEN }}` (o PAT fine-grained — ver tabela de
decisões; `GITHUB_TOKEN` padrão aqui faria o Workflow B nunca disparar).

Config em `.releaserc.json` com `plugins` **declarado explicitamente** (não
usa o set default do semantic-release, que inclui `@semantic-release/npm`
mesmo sem pedir — esse plugin, com `private:true`, não publica mas ainda
escreve `version` em `package.json` no seu `prepare`, duplicando/colidindo
com o `exec` do passo 3 abaixo tocando o mesmo arquivo). Preset
`conventionalcommits`, plugins em ordem:

1. **`@semantic-release/commit-analyzer`** — bump pelos commits desde a
   última tag: `fix:` → patch, `feat:` → minor, `BREAKING CHANGE:`/`!` →
   **major, imediatamente — mesmo em `0.x`.** Sem `releaseRules`
   customizado no `.releaserc.json`, a regra default do commit-analyzer
   (`{ breaking: true, release: "major" }`) é consultada primeiro e
   sempre casa; o downgrade "breaking vira minor enquanto major=0" que o
   preset `conventionalcommits` oferece (`preMajor`) nunca é alcançado,
   porque ele só entra em jogo quando nenhuma release rule já decidiu —
   e uma sempre decide aqui. Verificado no código instalado
   (`@semantic-release/commit-analyzer/lib/default-release-rules.js`,
   `lib/analyze-commit.js`, `semantic-release/lib/get-next-version.js`).
   Decisão: aceitar esse comportamento — um `feat!:`/`BREAKING CHANGE:`
   bem cedo no projeto pula direto pra `1.0.0`, sem rede de segurança.
   Quem mergear um commit desses precisa saber disso antes. Tipos
   `docs:`/`ci:`/`test:`/`chore:`/`refactor:`/`style:` sozinhos não geram
   release.
2. **`@semantic-release/release-notes-generator`** — monta as notas da
   GitHub Release a partir dos mesmos commits.
3. **`@semantic-release/exec`**, hook `prepare` — roda
   `node scripts/bump-plugin-version.mjs <nextRelease.version>`, que edita:
   - `package.json` (`version`)
   - `post-voice.php` (header `Version:` e a constante
     `POST_VOICE_VERSION`)
   - `readme.txt` (`Stable tag:`)

   Guardrail obrigatório: regex mira exatamente essas 3 linhas — nunca
   `Requires at least:`/`Requires PHP` em `post-voice.php`/`readme.txt`.
   Esses são pins de contrato que o CLAUDE.md proíbe mudar como efeito
   colateral de trabalho não relacionado.
4. **`@semantic-release/git`** — commita os 3 arquivos alterados direto em
   `master`: `chore(release): ${nextRelease.version} [skip ci]`. O
   `[skip ci]` impede esse próprio push de re-disparar `ci.yml` — e por
   consequência o `workflow_run` de `release.yml` — quebrando o possível
   loop.
5. **`@semantic-release/github`** — cria a tag `vX.Y.Z` e a GitHub Release
   com as notas geradas. Nenhum asset é anexado aqui; isso é
   responsabilidade do Workflow B.

Dependências novas em `devDependencies` (via `npm install --save-dev`,
passam pelos gates de audit existentes): `semantic-release`,
`@semantic-release/commit-analyzer`, `@semantic-release/release-notes-generator`,
`@semantic-release/exec`, `@semantic-release/git`, `@semantic-release/github`,
`conventional-changelog-conventionalcommits`.

Medido nesta implementação: essas ~410 dependências dev novas levaram o gate
de high de 1→5 (no teto de 5, `scripts/audit-check.mjs`). As 3 instâncias
responsáveis (`brace-expansion`, `ip-address`, `undici`) vivem dentro de
`node_modules/npm`, empacotado como `bundleDependencies` por
`@semantic-release/npm` (dependência do `semantic-release` core, instalada
mesmo sem estar na nossa lista de plugins ativa) — `npm overrides`
documentadamente não alcança `bundleDependencies`, testado e confirmado.
Gate passa hoje (5/5), sem margem: a próxima advisory nova em qualquer
dependência dev existente falha CI até alguém investir em downgrade do
`semantic-release` ou esperar o `@semantic-release/npm` avançar seu peer
de `npm`.

### Detalhes de execução do Workflow A (não óbvios, travados aqui para não virarem decisão de implementação)

- **`actions/checkout` recebe `token: ${{ secrets.SEMANTIC_RELEASE_TOKEN }}`**,
  não só o job inteiro rodando com esse token via env. O `git push` que
  `@semantic-release/git` dispara anda em cima do credential helper que o
  `checkout` configurou — se `checkout` usar o `GITHUB_TOKEN` default
  (comportamento padrão sem essa opção), o push fica autenticado como o
  token errado mesmo com `GH_TOKEN` correto no `env:` do step seguinte, e
  o bug que o PAT existe pra evitar (push não dispara `release-assets.yml`)
  volta a acontecer, em silêncio.
- **`ref: ${{ github.event.workflow_run.head_sha }}`**, não `ref: master`.
  Entre o CI fechar verde e este job rodar, outro merge pode ter entrado —
  `head_sha` fixa exatamente o commit que passou no CI que disparou este
  run; se um push concorrente já moveu `master`, o push subsequente do
  `@semantic-release/git` falha (não fast-forward) em vez de publicar por
  cima de um commit não validado.
- **`fetch-depth: 0`** no checkout — `commit-analyzer` precisa do histórico
  completo desde a última tag; um clone raso (`depth: 1`, comportamento
  padrão do `actions/checkout`) faria ele não enxergar nenhum commit.
- **`composer install` antes de `npx semantic-release`** — não é sobre
  rodar testes PHP aqui. `@semantic-release/git` commita via `git commit`
  de verdade, o que dispara `.husky/pre-commit` → `lint-staged` →
  `./vendor/bin/phpcs` em `post-voice.php` (está no lint-staged do
  `package.json`). Sem `vendor/` instalado esse hook falha e o release
  inteiro aborta — instalar o composer é o que permite o commit passar
  sem pular o hook (`CLAUDE.md`: nunca pular hooks).
- **`git config user.name`/`user.email` antes do commit** — runners do
  Actions não têm identidade git configurada por padrão;
  `@semantic-release/git` falharia com "unknown identity" sem isso.

## Workflow B — `release-assets.yml`

Steps: checkout com `ref: ${{ github.event.release.tag_name }}`, setup
node, `npm ci`, `npm run build` (webpack gera `build/`, hoje gitignored —
precisa ser reconstruído aqui, não existe no commit), empacotamento
respeitando `.distignore` (novo arquivo, ver abaixo), depois
`gh release upload <tag> post-voice-X.Y.Z.zip`.

Empacotamento: copiar a árvore do checkout para um diretório limpo
`post-voice/` excluindo tudo que `.distignore` lista (`rsync -a
--exclude-from=.distignore . post-voice/` ou equivalente), depois
`zip -r post-voice-X.Y.Z.zip post-voice/`. `composer install` não é
necessário nesse workflow — `composer.json` só tem `require-dev`, não há
runtime dependency PHP para vendorizar.

### `.distignore` (novo arquivo)

Filosofia: só o que o WordPress precisa para rodar o plugin instalado.

**Mantém:** `post-voice.php`, `readme.txt`, `LICENSE`, `CREDITS.md`,
`languages/`, `build/` (saída compilada do webpack), `features/*/php`,
`shared/` (só a parte php).

**Exclui:** `node_modules/`, `vendor/`, `*/tests/` (dentro de cada feature),
`e2e/`, `docs/`, `.github/`, `.claude/`, `.superpowers/`, `coverage/`,
`artifacts/`, `test-results/`, `playwright-report/`, fontes TS não
compiladas (`features/*/editor`, `features/*/frontend`,
`features/*/admin` — só o `build/` compilado entra), `scripts/`,
`package.json`/`package-lock.json`, `composer.json`/`composer.lock`,
`webpack.config.js`, `tsconfig.json`, `phpstan.neon`, `phpcs.xml.dist`,
`phpunit.xml.dist`, `jest.config.js`, `playwright.config.ts`,
`.eslintrc.js`, `.prettierrc.js`, `.prettierignore`, `CLAUDE.md`,
`TESTING.md`, `.wp-env.json`, `types/`, `.git*`, `.husky/`, o próprio
`.distignore`.

## Erros e casos de borda

- **Lote só com commits não-releasable** (`docs:`/`ci:`/`test:` etc.):
  `commit-analyzer` não determina bump, `semantic-release` termina sem
  criar tag/release — comportamento padrão da ferramenta, não é falha.
- **`release-assets.yml` falha no build/zip**: a GitHub Release já existe
  (criada pelo Workflow A) mas sem asset anexado. Reprocessar via
  `workflow_dispatch` manual com o `tag` já existente, sem precisar recriar
  a release nem re-rodar `semantic-release`.
- **Dois merges concluindo CI quase ao mesmo tempo**: `concurrency` do
  Workflow A serializa — o segundo `release.yml` espera o primeiro
  terminar (commit de bump + tag) antes de calcular a versão seguinte a
  partir do estado atualizado de `master`.
- **Loop de push**: coberto pelo `[skip ci]` no commit de bump (item 4 do
  Workflow A) — sem esse marcador, o próprio commit de versionamento
  re-disparia `ci.yml` e, na conclusão, o `workflow_run` de `release.yml`.
- **PAT fine-grained expira**: tem validade máxima (renovação manual).
  Quando expirar, `release.yml` falha no passo de push/criação de release
  com erro de autenticação claro (não silencioso) — renovar o secret
  `SEMANTIC_RELEASE_TOKEN` resolve. Fora de escopo automatizar a
  renovação.

## Testing / verificação

- `npx semantic-release --dry-run` localmente antes de habilitar o
  workflow de fato, para conferir que o bump calculado bate com o
  esperado dado o histórico de commits.
- `release-assets.yml` testado via `workflow_dispatch` manual (apontando
  para uma tag/release existente) antes de depender só do evento
  `release.published` em produção.
- Merge de teste com um `fix:` trivial nesta própria branch, depois de
  mergeada, para validar o fluxo 0.1.0 → 0.1.1 fim-a-fim (tag, release,
  zip anexado, conteúdo do zip batendo com `.distignore`).

`scripts/bump-plugin-version.mjs` não ganha suite Jest: precedente já
estabelecido por `scripts/audit-check.mjs` e `scripts/audit-check-composer.mjs`
(scripts de tooling não cobertos por teste, fora do allowlist
`collectCoverageFrom` de `jest.config.js`, que lista arquivos de feature
individualmente). Verificação do script fica pelo dry-run e pelo merge de
teste acima — não é um ponto em aberto, é decisão consistente com o que já
existe no repo.

## Custo de trocar de ferramenta depois

Se o checkpoint de revisão (release-please) se tornar necessário mais
adiante: troca só o Workflow A. `.releaserc.json` sai,
`release-please-config.json` + `.release-please-manifest.json` entram
(bootstrap do manifest com a versão atual — manual, ~5min). Formato de tag
(`vX.Y.Z`) não muda, nenhuma tag antiga quebra. Workflow B, `.distignore` e
o script de bump não mudam — desacoplamento é o ponto central desta
arquitetura.

## Ajustes pós-revisão (2026-08-24)

Achados do code-review obrigatório antes do PR (`superpowers:requesting-code-review`,
verificados contra o código instalado, não só lidos). Cada um corrigido no
código e registrado aqui — spec e implementação não podem discordar.

- **Breaking change vira major imediato, não minor.** A seção "Workflow A"
  acima já foi corrigida in-line: sem `releaseRules` customizado, a regra
  default do commit-analyzer (`{ breaking: true, release: "major" }`)
  sempre casa primeiro, e o downgrade "breaking vira minor enquanto
  major=0" do preset `conventionalcommits` nunca é alcançado. Decisão
  (não implementação): aceitar — `feat!:`/`BREAKING CHANGE:` pula pra
  `1.0.0` direto, mesmo bem cedo no projeto. Sem rede de segurança;
  quem mergear um commit desses precisa saber disso.
- **`.releaserc.json`'s `@semantic-release/github` entry ganhou config**
  (`successCommentCondition: false, failCommentCondition: false`) — sem
  isso, o passo `success` do plugin chama APIs do GitHub
  (`associatedPullRequests`, lookup de commits do PR) que exigem
  `Pull requests: Read`, permissão que o PAT (Contents-only, decisão
  já fechada acima) deliberadamente não tem. Sem essa config, cada
  release publica certo mas o run do Actions reporta falha depois —
  erodindo a confiança no pipeline. As duas condições fazem `success.js`/
  `fail.js` saírem antes de qualquer chamada de API; verificado no
  pacote instalado.
- **`.distignore` ganhou 4 entradas** não previstas na lista original:
  `test/` (dir real, distinto de `tests/`, só `jest.setup.js`), `*.ts`
  (fonte solta fora de `editor/`/`frontend/`/`admin/`, ex.
  `features/narration/format-time.ts`), `segment-pipeline-harness.*`
  (bundle webpack só de e2e, nunca enfileirado pelo PHP do plugin),
  `pocket-tts-onnx-mirror-src/` e `.wp-env.override.json` (paths
  locais já no `.gitignore`, faltando no `.distignore`).
- **`release-assets.yml` ganhou `--clobber`** no `gh release upload` —
  sem isso, reprocessar um zip via `workflow_dispatch` falha com "asset
  already exists", quebrando o próprio fluxo de recuperação que a seção
  "Erros e casos de borda" descreve.
- **Higiene de shell no `release-assets.yml`**: a tag (`$TAG`) e a
  versão derivada (`$VERSION`) são vinculadas a `env:` em vez de
  interpoladas direto em blocos `run:` — nomes de tag git permitem
  `` ` ``/`;`/`$()`, então interpolação direta seria injeção de shell
  (exige acesso de escrita ao repo pra explorar, mas o fix é de graça).
- **Caso de borda que faltava**: se `master` avançar *antes* do checkout
  do Workflow A (não durante, que já é o caso coberto), semantic-release
  loga "branch local está atrás do remoto" e sai com **código 0** — um
  run verde que não publicou nada. Os commits não se perdem (a próxima
  release os pega todos a partir da última tag), mas é diferente do
  "push falha, non-fast-forward" que a seção acima descreve como único
  cenário — esse só acontece se `master` mover *durante* o run.
- **PAT em `persist-credentials`**: o token fica no `.git/config` pelo
  resto do job (comportamento padrão do `actions/checkout`), exposto a
  qualquer `postinstall` malicioso nas ~410 dependências dev novas deste
  branch. Mitigado pelo escopo já mínimo do PAT (Contents-only,
  1 repo só, expira) — não é mudança nova, é o motivo adicional (além de
  disparar `release-assets.yml`) pelo qual esse escopo mínimo importa.

## Fora de escopo

- Deploy automático para o repositório SVN do wordpress.org.
- `CHANGELOG.md` versionado no repo.
- Qualquer canal de pré-release/beta (branch além de `master`).
